import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { montarMapaConvenioCadastro } from "@/lib/cronograma/convenioCadastro"
import { janelaImportacaoTita } from "@/lib/grade/janelaTita"
import { gravarDisponibilidadeTita, prepararPreviaDisponibilidade } from "@/services/disponibilidadeTita.service"
import { aplicarImportacaoCompleta, previaImportacao } from "@/services/grade.service"
import { lerImportacao } from "@/services/titaImportacoes.service"
import { buscarSituacaoFavorecidos } from "@/services/tita/situacaoFavorecidos"

// "Carregar o Pulsar segundo o TiTa" no SERVIDOR — a rotina diária das 04:00
// (decisão de 16/10/2026: as 4 etapas, todo dia). Mesmas etapas e mesma ordem
// da página Administração → Carregar do TiTa, com a chave de serviço: as
// funções do banco aceitam a chamada interna e registram "Rotina do TiTa
// (04:00)" (20261016170000). Só LÊ o TiTa; nada é enviado a ele.
//
// Cada carga fica em tita_cargas. Etapa que falha interrompe as seguintes
// (cada uma depende da anterior) e abre o alerta carga_tita_falhou.

export type SituacaoEtapa = "sucesso" | "erro" | "pulada"
export type EtapaCarga = {
  etapa: "pacientes" | "profissionais" | "disponibilidade" | "agenda"
  situacao: SituacaoEtapa
  resumo: string[]
  aviso?: string
  erro?: string
  importacao_id?: string
}

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e))

/**
 * Cópia do CADASTRO de pacientes do TiTa (csv_situacao_favorecidos) em
 * tita_favorecidos_cadastro — de onde a importação tira o convênio. Plano em
 * conflito (mesmo paciente com dois planos) ou "Não informado" fica vazio:
 * mesma regra da aba Pacientes (lib/cronograma/convenioCadastro.ts).
 */
export async function gravarCopiaCadastroTita(sb: SupabaseClient): Promise<
  { ok: true; total: number; comConvenio: number; emConflito: number } | { ok: false; mensagem: string; migrationPendente?: boolean }
> {
  const r = await buscarSituacaoFavorecidos()
  if (!r.ok) return { ok: false, mensagem: `O TiTa não respondeu o cadastro de pacientes (${r.erro ?? "erro"}).` }

  const mapa = montarMapaConvenioCadastro(r.favorecidos)
  const agora = new Date().toISOString()
  const porId = new Map<number, Record<string, unknown>>()
  for (const f of r.favorecidos) {
    if (f.id == null) continue
    const atual = porId.get(f.id)
    // Linha repetida: mantém a primeira, mas "Ativo" vence "Inativo".
    if (atual && !(atual.situacao === "Inativo" && f.situacao === "Ativo")) continue
    porId.set(f.id, {
      tita_favorecido_id: f.id,
      nome: f.nome || `ID TiTa ${f.id}`,
      situacao: f.situacao,
      plano_saude: mapa.porPacienteId.get(f.id) ?? null,
      plano_em_conflito: mapa.conflitos.has(f.id),
      numero_carteirinha: f.numeroCarteirinha || null,
      unidade_nome: f.unidadeNome || null,
      sincronizado_em: agora,
    })
  }
  const linhas = [...porId.values()]
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from("tita_favorecidos_cadastro").upsert(linhas.slice(i, i + 500), { onConflict: "tita_favorecido_id" })
    if (error) {
      const pendente = /tita_favorecidos_cadastro|does not exist|schema cache/i.test(error.message)
      return {
        ok: false,
        migrationPendente: pendente,
        mensagem: pendente ? "Falta aplicar a migration 20261023160000 (e as anteriores do cadastro do TiTa)." : `Não foi possível gravar a cópia do cadastro do TiTa: ${error.message}`,
      }
    }
  }
  return { ok: true, total: linhas.length, comConvenio: linhas.filter(l => l.plano_saude).length, emConflito: mapa.conflitos.size }
}

async function etapaPacientes(sb: SupabaseClient): Promise<EtapaCarga> {
  const copia = await gravarCopiaCadastroTita(sb)
  const { data, error } = await sb.rpc("pacientes_importar_tita", { p_origem: "cron" })
  if (error) throw error
  const r = data as { sucesso: boolean; log_id?: string; novos: number; atualizados: number; vistos_na_tita: number; erro?: string }
  if (!r.sucesso) throw new Error(r.erro ?? "A importação de pacientes falhou.")
  return {
    etapa: "pacientes",
    situacao: "sucesso",
    resumo: [`${r.novos} novos`, `${r.atualizados} alterados`, `${r.vistos_na_tita} no TiTa`],
    aviso: copia.ok ? undefined : `${copia.mensagem} Convênios mantidos como estavam.`,
    importacao_id: r.log_id,
  }
}

async function etapaProfissionais(sb: SupabaseClient): Promise<EtapaCarga> {
  const { data, error } = await sb.rpc("profissionais_importar_tita")
  if (error) throw error
  const r = data as { importacao_id?: string; novos: number; atualizados: number; vistos_na_tita: number; erro?: string }
  if (r.erro) throw new Error(r.erro)
  return {
    etapa: "profissionais",
    situacao: "sucesso",
    resumo: [`${r.novos} novos`, `${r.atualizados} alterados`, `${r.vistos_na_tita} no TiTa`],
    importacao_id: r.importacao_id,
  }
}

async function etapaDisponibilidade(sb: SupabaseClient): Promise<EtapaCarga> {
  const { data: catalogo, error } = await sb.from("cadastro_terapias").select("id, nome, ativo")
  if (error) throw error
  const previa = await prepararPreviaDisponibilidade({ catalogo: catalogo ?? [], cliente: sb })
  const g = await gravarDisponibilidadeTita(previa, undefined, sb)
  const imp = await lerImportacao(previa.id, sb)
  const avisos = [
    g.erros ? `${g.erros} profissional(is) não gravado(s) — veja o motivo no relatório.` : null,
    previa.foraDoCadastro.length ? `${previa.foraDoCadastro.length} da grade do TiTa sem cadastro no Pulsar.` : null,
  ].filter(Boolean)
  return {
    etapa: "disponibilidade",
    situacao: "sucesso",
    resumo: [`${imp.novos} novas`, `${imp.alterados} alteradas`, `${imp.iguais} iguais`, ...(imp.pendencias ? [`${imp.pendencias} pendências`] : [])],
    aviso: avisos.length ? avisos.join(" ") : undefined,
    importacao_id: previa.id,
  }
}

async function etapaAgenda(sb: SupabaseClient): Promise<EtapaCarga> {
  const janela = janelaImportacaoTita()
  const previa = await previaImportacao(janela.inicio, janela.fim, sb)
  if (previa.copia_velha) {
    // Com o TiTa mandando, cópia velha excluiria sessões que ainda existem.
    return {
      etapa: "agenda",
      situacao: "pulada",
      resumo: [],
      aviso: "A cópia da grade do TiTa estava velha: a agenda não foi tocada hoje. Confira o sync da grade (02:00).",
      importacao_id: previa.importacao_id,
    }
  }
  const a = await aplicarImportacaoCompleta(previa, undefined, true, sb)
  return {
    etapa: "agenda",
    situacao: "sucesso",
    resumo: [
      `${a.sessoes_novas} novas`, `${a.alteradas ?? 0} alteradas`, `${a.sumidos_excluidos} saíram`,
      ...(a.restauradas ? [`${a.restauradas} voltaram`] : []),
      `${previa.contadores.lidas} no TiTa`,
    ],
    aviso: previa.contadores.pendencias ? `${previa.contadores.pendencias} sessão(ões) com pendência de cadastro não entraram.` : undefined,
    importacao_id: previa.importacao_id,
  }
}

const ETAPAS: [EtapaCarga["etapa"], (sb: SupabaseClient) => Promise<EtapaCarga>][] = [
  ["pacientes", etapaPacientes],
  ["profissionais", etapaProfissionais],
  ["disponibilidade", etapaDisponibilidade],
  ["agenda", etapaAgenda],
]

/** Roda as 4 etapas e registra tudo em tita_cargas. Nunca lança: o resultado fica gravado. */
export async function executarCargaTita(sb: SupabaseClient, origem: "cron" | "manual" = "cron"): Promise<{ id: string | null; situacao: string; etapas: EtapaCarga[] }> {
  const { data: carga, error: eCarga } = await sb.from("tita_cargas").insert({ origem }).select("id").single()
  if (eCarga) console.error("[carga-tita] não foi possível registrar a carga:", eCarga.message)
  const id = (carga as { id: string } | null)?.id ?? null
  const etapas: EtapaCarga[] = []
  const registrar = async (campos: Record<string, unknown>) => {
    if (!id) return
    const { error } = await sb.from("tita_cargas").update({ etapas, ...campos }).eq("id", id)
    if (error) console.error("[carga-tita] não foi possível atualizar a carga:", error.message)
  }

  let erroGeral: string | null = null
  for (const [nome, rodar] of ETAPAS) {
    try {
      etapas.push(await rodar(sb))
    } catch (e) {
      erroGeral = `${nome}: ${msg(e)}`
      etapas.push({ etapa: nome, situacao: "erro", resumo: [], erro: msg(e) })
      console.error(`[carga-tita] etapa ${nome} falhou:`, msg(e))
    }
    await registrar({})
    if (erroGeral) break
  }

  const situacao = erroGeral ? "erro" : etapas.some(e => e.situacao !== "sucesso" || e.aviso) ? "parcial" : "sucesso"
  await registrar({ situacao, erro_mensagem: erroGeral, finalizado_em: new Date().toISOString() })

  if (erroGeral) {
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
    const { error } = await sb.from("alertas").upsert({
      modulo: "sync",
      regra_codigo: "carga_tita_falhou",
      origem: "sistema",
      entidade_tipo: "carga_tita",
      entidade_id: dia,
      entidade_ref: { carga_id: id, erro: erroGeral },
      titulo: "Carga diária do TiTa (04:00) falhou",
      descricao: `A rotina "Carregar o Pulsar segundo o TiTa" parou na etapa ${erroGeral}. Veja em Administração → Carregar do TiTa.`,
      prioridade: "alta",
      status: "aberto",
      setor_destino: "admin",
      fingerprint: `carga_tita|${dia}`,
    }, { onConflict: "fingerprint", ignoreDuplicates: true })
    if (error) console.error("[carga-tita] não foi possível abrir o alerta:", error.message)
  }
  console.log(`[carga-tita] ${origem} terminou: ${situacao}`)
  return { id, situacao, etapas }
}
