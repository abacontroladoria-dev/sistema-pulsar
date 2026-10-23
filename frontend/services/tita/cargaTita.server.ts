import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { montarMapaConvenioCadastro } from "@/lib/cronograma/convenioCadastro"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import { medirReleituraGrade } from "@/lib/grade/fonte"
import { janelaImportacaoTita } from "@/lib/grade/janelaTita"
import { gravarDisponibilidadeTita, prepararPreviaDisponibilidade } from "@/services/disponibilidadeTita.service"
import { aplicarImportacaoCompleta, previaImportacao } from "@/services/grade.service"
import { lerImportacao } from "@/services/titaImportacoes.service"
import { pedirCopiaGradeTita } from "@/services/tita/copiaGrade.server"
import { buscarSituacaoFavorecidos } from "@/services/tita/situacaoFavorecidos"

// "Carregar o Pulsar segundo o TiTa" no SERVIDOR — a rotina diária das 04:00
// (decisão de 16/10/2026: as 4 etapas, todo dia). Mesmas etapas e mesma ordem
// da página Administração → Carregar do TiTa, com a chave de serviço: as
// funções do banco aceitam a chamada interna e registram "Rotina do TiTa
// (04:00)" (20261016170000). Só LÊ o TiTa; nada é enviado a ele.
//
// Cada carga fica em tita_cargas. Etapa que falha interrompe as seguintes
// (cada uma depende da anterior) e abre o alerta carga_tita_falhou.
//
// O botão da página roda AQUI também (23/10/2026, /api/tita/carga-manual):
// pede antes a releitura ao vivo do TiTa (de hoje até a primeira semana
// completa do mês seguinte), e a etapa Agendamentos espera todos esses dias
// serem reconfirmados em grade_sync_dia. A página acompanha a linha de
// tita_cargas (passo, progresso) e pode pedir para parar (parar_pedido_em).

export type SituacaoEtapa = "sucesso" | "erro" | "pulada"
export type EtapaCarga = {
  etapa: "pacientes" | "profissionais" | "disponibilidade" | "agenda"
  situacao: SituacaoEtapa
  resumo: string[]
  aviso?: string
  erro?: string
  importacao_id?: string
  /** Etapa anterior ao ponto de onde a carga recomeçou: não rodou nesta carga. */
  fora?: boolean
}

type Etapa = EtapaCarga["etapa"]
/** Releitura ao vivo: a partir de `desde`, os dias de inicio..fim contam como relidos. */
type Releitura = { inicio: string; fim: string; desde: string }
/** O que cada etapa recebe para contar o que está fazendo e saber se deve parar. */
type Contexto = {
  passo: (texto: string, progresso?: Record<string, unknown>) => Promise<void>
  /** Aviso de lote (muitos por segundo): grava no máximo a cada 3 s. */
  lote: (texto: string) => void
  pararPedido: () => Promise<boolean>
  releitura: Releitura | null
}

class CargaParada extends Error {}

const ESPERA_POLL_MS = 15_000
/** Sem nenhum dia novo reconfirmado por este tempo, a releitura é dada como travada. */
export const ESPERA_SEM_PROGRESSO_MS = 8 * 60_000
const ESPERA_MAXIMA_MS = 75 * 60_000
const dormir = (ms: number) => new Promise(res => setTimeout(res, ms))

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

async function etapaPacientes(sb: SupabaseClient, ctx: Contexto): Promise<EtapaCarga> {
  await ctx.passo("Lendo o cadastro de pacientes do TiTa e trazendo…")
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

async function etapaProfissionais(sb: SupabaseClient, ctx: Contexto): Promise<EtapaCarga> {
  await ctx.passo("Trazendo profissionais…")
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

async function etapaDisponibilidade(sb: SupabaseClient, ctx: Contexto): Promise<EtapaCarga> {
  await ctx.passo("Lendo a grade do TiTa das próximas semanas…")
  const { data: catalogo, error } = await sb.from("cadastro_terapias").select("id, nome, ativo")
  if (error) throw error
  const previa = await prepararPreviaDisponibilidade({ catalogo: catalogo ?? [], cliente: sb, onPasso: t => ctx.lote(t) })
  const g = await gravarDisponibilidadeTita(previa, (feitos, total) => ctx.lote(total ? `Gravando ${feitos} de ${total} lotes…` : "Conferindo…"), sb)
  const imp = await lerImportacao(previa.id, sb)
  const avisos = [
    g.erros ? `${g.erros} profissional(is) não gravado(s). O motivo está em "Ver o que foi trazido".` : null,
    previa.foraDoCadastro.length ? `${previa.foraDoCadastro.length} profissional(is) da grade do TiTa sem cadastro no Pulsar: ficaram de fora.` : null,
  ].filter(Boolean)
  return {
    etapa: "disponibilidade",
    situacao: "sucesso",
    resumo: [`${imp.novos} novas`, `${imp.alterados} alteradas`, `${imp.iguais} iguais`, ...(imp.pendencias ? [`${imp.pendencias} pendências`] : [])],
    aviso: avisos.length ? avisos.join(" ") : undefined,
    importacao_id: previa.id,
  }
}

/** Espera o TiTa reconfirmar todos os dias da releitura. Lança se travar ou se pedirem para parar. */
async function esperarReleitura(sb: SupabaseClient, ctx: Contexto, r: Releitura) {
  const comeco = Date.now()
  let ultimoAvanco = Date.now()
  let conferidosAntes = -1
  for (;;) {
    const m = await medirReleituraGrade(r.inicio, r.fim, r.desde, 280, sb)
    if (m.faltando.length === 0) return
    if (m.conferidos > conferidosAntes) { conferidosAntes = m.conferidos; ultimoAvanco = Date.now() }
    if (Date.now() - ultimoAvanco > ESPERA_SEM_PROGRESSO_MS || Date.now() - comeco > ESPERA_MAXIMA_MS) {
      const lista = m.faltando.slice(0, 6).map(dataBR).join(", ") + (m.faltando.length > 6 ? "…" : "")
      throw new Error(`O TiTa não confirmou ${m.faltando.length} dia(s) (${lista}). A agenda não foi tocada. Use "Tentar de novo a partir daqui".`)
    }
    await ctx.passo(`Lendo o TiTa na hora (${dataBR(r.inicio)} a ${dataBR(r.fim)}): ${m.conferidos} de ${m.total} dias conferidos.`, {
      inicio: r.inicio, fim: r.fim, total: m.total, conferidos: m.conferidos,
      desde: new Date(comeco).toISOString(), ultimo_avanco_em: new Date(ultimoAvanco).toISOString(),
    })
    if (await ctx.pararPedido()) throw new CargaParada()
    await dormir(ESPERA_POLL_MS)
  }
}

async function etapaAgenda(sb: SupabaseClient, ctx: Contexto): Promise<EtapaCarga> {
  const janela = janelaImportacaoTita()
  if (ctx.releitura) {
    await ctx.passo("Esperando o TiTa reler os agendamentos…")
    await esperarReleitura(sb, ctx, ctx.releitura)
    if (await ctx.pararPedido()) throw new CargaParada()
  }
  await ctx.passo(`Lendo a grade do TiTa de ${dataBR(janela.inicio)} a ${dataBR(janela.fim)}…`)
  const previa = await previaImportacao(janela.inicio, janela.fim, sb)
  if (previa.copia_velha) {
    // Com o TiTa mandando, cópia velha excluiria sessões que ainda existem.
    return {
      etapa: "agenda",
      situacao: "pulada",
      resumo: [],
      aviso: ctx.releitura
        ? `A cópia das 02:00 estava desatualizada: a agenda não foi tocada. Carregue de novo e escolha "Reler tudo e carregar".`
        : "A cópia da grade do TiTa estava velha: a agenda não foi tocada hoje. Confira o sync da grade (02:00).",
      importacao_id: previa.importacao_id,
    }
  }
  const a = await aplicarImportacaoCompleta(previa, (feitos, total) => ctx.lote(total ? `Gravando ${feitos} de ${total} lotes de profissionais…` : "Conferindo…"), true, sb)
  return {
    etapa: "agenda",
    situacao: "sucesso",
    resumo: [
      `${a.sessoes_novas} novas`, `${a.alteradas ?? 0} alteradas`, `${a.sumidos_excluidos} saíram`,
      ...(a.restauradas ? [`${a.restauradas} voltaram`] : []),
      `${previa.contadores.lidas} no TiTa`,
    ],
    aviso: previa.contadores.pendencias ? `${previa.contadores.pendencias} sessão(ões) não entraram: paciente, profissional ou terapia sem cadastro no Pulsar. Quais estão em "Ver o que foi trazido".` : undefined,
    importacao_id: previa.importacao_id,
  }
}

const ETAPAS: [Etapa, (sb: SupabaseClient, ctx: Contexto) => Promise<EtapaCarga>][] = [
  ["pacientes", etapaPacientes],
  ["profissionais", etapaProfissionais],
  ["disponibilidade", etapaDisponibilidade],
  ["agenda", etapaAgenda],
]
const ROTULO: Record<Etapa, string> = { pacientes: "Pacientes", profissionais: "Profissionais", disponibilidade: "Disponibilidades", agenda: "Agendamentos" }

/** Sem sinal por este tempo, a carga "rodando" é dada como morta (servidor reiniciado no meio). */
export const CARGA_ABANDONADA_MS = 20 * 60_000

/**
 * Encerra como erro a carga "rodando" que parou de dar sinal: o processo que a
 * rodava morreu (deploy, reinício) e ela nunca vai terminar. Sem isso, o
 * índice de uma-carga-por-vez travaria o botão e a rotina das 04:00.
 * Sem as colunas de acompanhamento, vale o limite antigo de 3 horas do início.
 */
export async function encerrarCargasAbandonadas(sb: SupabaseClient): Promise<void> {
  const limite = new Date(Date.now() - CARGA_ABANDONADA_MS).toISOString()
  const encerrar = { situacao: "erro", erro_mensagem: "Interrompida: o servidor parou no meio da carga. O que já tinha sido gravado fica.", finalizado_em: new Date().toISOString() }
  const { error } = await sb.from("tita_cargas").update(encerrar)
    .eq("situacao", "rodando").lt("atualizado_em", limite)
  if (error && /column|schema cache/i.test(error.message)) {
    await sb.from("tita_cargas").update(encerrar)
      .eq("situacao", "rodando").lt("iniciado_em", new Date(Date.now() - 3 * 3600_000).toISOString())
  } else if (error) console.error("[carga-tita] não foi possível encerrar cargas abandonadas:", error.message)
}

export type OpcoesCarga = {
  /** Linha já criada pela rota (o botão precisa do id antes de a carga começar). */
  id?: string
  /** Recomeça desta etapa; as anteriores ficam registradas como fora desta carga. */
  inicio?: Etapa
  /** Período relido ao vivo antes da etapa Agendamentos (só o botão; a rotina usa a cópia das 02:00). */
  releitura?: { inicio: string; fim: string }
}

/** Roda as etapas e registra tudo em tita_cargas. Nunca lança: o resultado fica gravado. */
export async function executarCargaTita(sb: SupabaseClient, origem: "cron" | "manual" = "cron", opcoes: OpcoesCarga = {}): Promise<{ id: string | null; situacao: string; etapas: EtapaCarga[] }> {
  let id = opcoes.id ?? null
  if (!id) {
    await encerrarCargasAbandonadas(sb)
    const { data: carga, error: eCarga } = await sb.from("tita_cargas").insert({ origem, atualizado_em: new Date().toISOString() }).select("id").single()
    // 23505: já há uma rodando (índice uq_tita_cargas_uma_rodando). Não roda em paralelo.
    if (eCarga?.code === "23505") {
      console.log(`[carga-tita] ${origem}: já há uma carga rodando; esta não começou`)
      return { id: null, situacao: "ignorada", etapas: [] }
    }
    if (eCarga && /column|schema cache/i.test(eCarga.message)) {
      const r = await sb.from("tita_cargas").insert({ origem }).select("id").single()
      if (r.error) console.error("[carga-tita] não foi possível registrar a carga:", r.error.message)
      id = (r.data as { id: string } | null)?.id ?? null
    } else {
      if (eCarga) console.error("[carga-tita] não foi possível registrar a carga:", eCarga.message)
      id = (carga as { id: string } | null)?.id ?? null
    }
  }
  const etapas: EtapaCarga[] = []
  // As colunas de acompanhamento (20261023180000) podem faltar no banco: sem
  // elas a rotina segue, só sem passo e sem pedido de parada.
  let comAcompanhamento = true
  const registrar = async (campos: Record<string, unknown>, extras: Record<string, unknown> = {}) => {
    if (!id) return
    const vivo = comAcompanhamento ? { ...extras, atualizado_em: new Date().toISOString() } : {}
    let { error } = await sb.from("tita_cargas").update({ etapas, ...campos, ...vivo }).eq("id", id)
    if (error && comAcompanhamento && /column|schema cache/i.test(error.message)) {
      comAcompanhamento = false
      ;({ error } = await sb.from("tita_cargas").update({ etapas, ...campos }).eq("id", id))
    }
    if (error) console.error("[carga-tita] não foi possível atualizar a carga:", error.message)
  }

  let ultimoPasso = 0
  const ctx: Contexto = {
    // O passo de cada etapa sempre grava; só os avisos de lote são limitados.
    passo: async (texto, progresso) => {
      ultimoPasso = Date.now()
      await registrar({}, { passo: texto, progresso: progresso ?? null })
    },
    lote: texto => {
      if (Date.now() - ultimoPasso < 3000) return
      ultimoPasso = Date.now()
      void registrar({}, { passo: texto, progresso: null })
    },
    pararPedido: async () => {
      if (!id || !comAcompanhamento) return false
      const { data } = await sb.from("tita_cargas").select("parar_pedido_em").eq("id", id).maybeSingle()
      return !!(data as { parar_pedido_em?: string | null } | null)?.parar_pedido_em
    },
    releitura: null,
  }

  // A releitura leva ~1 min por dia útil: pede já, para correr enquanto as
  // etapas anteriores rodam. `desde` recua 2 min para absorver diferença de relógio.
  if (opcoes.releitura) {
    const desde = new Date(Date.now() - 2 * 60_000).toISOString()
    const pedido = await pedirCopiaGradeTita(opcoes.releitura.inicio, opcoes.releitura.fim)
    if (pedido.ok) ctx.releitura = { ...opcoes.releitura, desde }
    else console.error("[carga-tita] releitura não pedida:", pedido.mensagem)
  }

  let erroGeral: string | null = null
  let parada = false
  const de = Math.max(0, ETAPAS.findIndex(([n]) => n === opcoes.inicio))
  for (const [nome] of ETAPAS.slice(0, de)) {
    etapas.push({ etapa: nome, situacao: "pulada", resumo: [], fora: true, aviso: `Fora desta carga: recomeçou em ${ROTULO[ETAPAS[de][0]]}.` })
  }
  for (const [nome, rodar] of ETAPAS.slice(de)) {
    if (await ctx.pararPedido()) { parada = true; break }
    if (nome === "agenda" && opcoes.releitura && !ctx.releitura) {
      erroGeral = `${nome}: O sync do TiTa não aceitou o pedido de releitura. A agenda não foi tocada.`
      etapas.push({ etapa: nome, situacao: "erro", resumo: [], erro: "O sync do TiTa não aceitou o pedido de releitura. A agenda não foi tocada." })
      await registrar({})
      break
    }
    try {
      etapas.push(await rodar(sb, ctx))
    } catch (e) {
      if (e instanceof CargaParada) { parada = true; break }
      erroGeral = `${nome}: ${msg(e)}`
      etapas.push({ etapa: nome, situacao: "erro", resumo: [], erro: msg(e) })
      console.error(`[carga-tita] etapa ${nome} falhou:`, msg(e))
    }
    await registrar({})
    if (erroGeral) break
  }

  if (parada) {
    await registrar({ situacao: "parada", finalizado_em: new Date().toISOString() }, { passo: null, progresso: null })
    console.log(`[carga-tita] ${origem} parada a pedido`)
    return { id, situacao: "parada", etapas }
  }

  const situacao = erroGeral ? "erro" : etapas.some(e => !e.fora && (e.situacao !== "sucesso" || e.aviso)) ? "parcial" : "sucesso"
  await registrar({ situacao, erro_mensagem: erroGeral, finalizado_em: new Date().toISOString() }, { passo: null, progresso: null })

  if (erroGeral && origem === "cron") {
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
