import 'server-only'

// Orquestra a conferência do conteúdo: pega os documentos que o robô leu e
// ainda não foram analisados, aplica as conferências fixas (regras.ts), a
// IA (ia.ts, só OE/ETC/PIC) e a comparação com os outros documentos
// (semelhanca.ts + pares.ts), grava e consolida a indicação de cada um.
//
// Roda com a service_role (é ela que lê sp_pep_documentos_texto). Quem chama:
//   • o tique do worker (pg_cron a cada minuto, rota da auditoria);
//   • a rota /api/relacionamento-prestador/pep/documentos/analisar, que a tela
//     PEP chama ao abrir um analista com documentos esperando — depois de
//     conferir a permissão de quem pediu.
//
// O texto nunca sai daqui para log: só contagens e códigos.

import type { SupabaseClient } from '@supabase/supabase-js'
import { conferirTexto } from './regras'
import { lerDocumentoComIA, temRegua } from './ia'
import { aprenderModelo, assinatura, conteudoPreenchido, linhaComparavel, shingles } from './semelhanca'
import { parEntre, type DocParaPar, type Par } from './pares'
import { linhasDe } from './texto'
import type { Achado } from './tipos'

/** Muda quando as conferências mudam (o documento guarda com qual foi analisado). */
export const VERSAO_ANALISE = '2026-10-14.1'

const LOTE_IN = 150
const PARALELO = 3
const CORPUS_POR_SIGLA = 400

type ItemSp = {
  sp_id: string
  nome: string
  sigla: string | null
  competencia: string | null
  prestador_nome: string | null
  prestador_pasta_id: string | null
  paciente_nome: string | null
  paciente_pasta_id: string | null
  padrao: string | null
  removido_em: string | null
}

type Pendente = { sp_id: string; extracao_status: string; analise_tentativas: number; ia_tentativas: number }

export type ResumoAnalise = { analisados: number; falhas: number; ia: number; pares: number; restantes: boolean }

async function emLotes<T>(ids: string[], buscar: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += LOTE_IN) out.push(...(await buscar(ids.slice(i, i + LOTE_IN))))
  return out
}

function falhou(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 300)
}

/** O texto do modelo de uma sigla, aprendido dos textos guardados (semelhanca.ts). */
export async function modeloDaSigla(db: SupabaseClient, sigla: string): Promise<Set<string>> {
  const { data: daSigla } = await db.from('sp_pep_itens')
    .select('sp_id, prestador_pasta_id').eq('tipo', 'evidencia').eq('sigla', sigla)
    .order('criado_em_sp', { ascending: false }).limit(CORPUS_POR_SIGLA)
  const doc = (daSigla ?? []) as { sp_id: string; prestador_pasta_id: string | null }[]
  const grupo = new Map(doc.map(d => [d.sp_id, d.prestador_pasta_id ?? 'sem_prestador']))
  const corpus = await emLotes(doc.map(d => d.sp_id), async lote => {
    const { data } = await db.from('sp_pep_documentos_texto').select('sp_id, texto').in('sp_id', lote)
    return (data ?? []) as { sp_id: string; texto: string }[]
  })
  return aprenderModelo(corpus.map(c => ({ grupo: grupo.get(c.sp_id) ?? 'sem_prestador', texto: c.texto })))
}

export async function analisarDocumentosPep(db: SupabaseClient, opcoes: {
  spIds?: string[]
  limite?: number
  orcamentoMs?: number
} = {}): Promise<ResumoAnalise> {
  const inicio = Date.now()
  const limite = Math.max(1, Math.min(opcoes.limite ?? 12, 50))
  const orcamento = opcoes.orcamentoMs ?? 25_000
  const resumo: ResumoAnalise = { analisados: 0, falhas: 0, ia: 0, pares: 0, restantes: false }

  // ── 1. O que analisar ────────────────────────────────────────────────────────
  const dezMinAtras = new Date(Date.now() - 10 * 60_000).toISOString()
  let q = db.from('sp_pep_documentos')
    .select('sp_id, extracao_status, analise_tentativas, ia_tentativas')
    .or(`analise_status.eq.pendente,and(ia_status.eq.erro,ia_tentativas.lt.3,ia_em.lt.${dezMinAtras})`)
    .order('extraido_em', { ascending: true })
    .limit(limite + 1)
  if (opcoes.spIds?.length) q = q.in('sp_id', opcoes.spIds.slice(0, 500))
  const { data: pendBruto, error: erroPend } = await q
  if (erroPend) throw new Error(`sp_pep_documentos: ${erroPend.message}`)
  const pendentes = (pendBruto ?? []) as Pendente[]
  resumo.restantes = pendentes.length > limite
  const alvo = pendentes.slice(0, limite)
  if (alvo.length === 0) return resumo

  // ── 2. Contexto: item, catálogo, pastas, texto ───────────────────────────────
  const ids = alvo.map(p => p.sp_id)
  const itens = await emLotes(ids, async lote => {
    const { data, error } = await db.from('sp_pep_itens')
      .select('sp_id, nome, sigla, competencia, prestador_nome, prestador_pasta_id, paciente_nome, paciente_pasta_id, padrao, removido_em')
      .in('sp_id', lote)
    if (error) throw new Error(`sp_pep_itens: ${error.message}`)
    return (data ?? []) as ItemSp[]
  })
  const itemDe = new Map(itens.map(i => [i.sp_id, i]))

  const { data: catalogo } = await db.from('pep_catalogo_itens').select('sigla, tipo_registro').eq('ativo', true)
  const tipoDe = new Map(((catalogo ?? []) as { sigla: string; tipo_registro: 'GERAL' | 'POR_PACIENTE' }[]).map(c => [c.sigla, c.tipo_registro]))

  const prestadoresPasta = [...new Set(itens.map(i => i.prestador_pasta_id).filter(Boolean))] as string[]
  const pastasPaciente = prestadoresPasta.length
    ? ((await db.from('sp_pep_pastas').select('id, nome, prestador_pasta_id').eq('papel', 'paciente').in('prestador_pasta_id', prestadoresPasta)).data ?? []) as { id: string; nome: string; prestador_pasta_id: string }[]
    : []
  const nomePasta = new Map(pastasPaciente.map(p => [p.id, p.nome]))

  const textos = await emLotes(ids, async lote => {
    const { data, error } = await db.from('sp_pep_documentos_texto').select('sp_id, texto').in('sp_id', lote)
    if (error) throw new Error(`sp_pep_documentos_texto: ${error.message}`)
    return (data ?? []) as { sp_id: string; texto: string }[]
  })
  const textoDe = new Map(textos.map(t => [t.sp_id, t.texto]))

  // ── 3. O texto do modelo, por sigla, aprendido dos documentos guardados ──────
  const modeloPorSigla = new Map<string, Set<string>>()
  for (const sigla of new Set(itens.map(i => i.sigla).filter(Boolean)) as Set<string>) {
    modeloPorSigla.set(sigla.toUpperCase(), await modeloDaSigla(db, sigla))
  }

  // ── 4. Um documento ──────────────────────────────────────────────────────────
  const analisados: string[] = []
  async function analisarUm(p: Pendente) {
    const item = itemDe.get(p.sp_id)
    const texto = textoDe.get(p.sp_id)
    if (!item || p.extracao_status !== 'ok') {
      await db.from('sp_pep_documentos').update({ analise_status: 'concluida', analisado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('sp_id', p.sp_id)
      analisados.push(p.sp_id)
      return
    }
    if (!texto) {
      // Texto já expirou (90 dias) ou não chegou: sem o que analisar.
      await db.from('sp_pep_documentos').update({
        analise_status: 'erro', analise_erro: 'texto indisponível (expirado ou não recebido)',
        analise_tentativas: p.analise_tentativas + 1, atualizado_em: new Date().toISOString(),
      }).eq('sp_id', p.sp_id)
      resumo.falhas++
      return
    }

    const sigla = (item.sigla ?? '').toUpperCase()
    const tipoRegistro = tipoDe.get(sigla) ?? null
    const pastaPaciente = item.paciente_pasta_id ? nomePasta.get(item.paciente_pasta_id) ?? null : null
    const outros = pastasPaciente
      .filter(x => x.prestador_pasta_id === item.prestador_pasta_id && x.id !== item.paciente_pasta_id)
      .map(x => x.nome)

    let achados: Achado[] = []
    let assin: number[] | null = null
    try {
      achados = conferirTexto(texto, {
        sigla, tipoRegistro, competencia: item.competencia, pacienteNome: item.paciente_nome,
        pastaPaciente, prestadorNome: item.prestador_nome, outrosPacientes: outros,
        reprogramacao: item.padrao === 'rep',
      })
      const modelo = modeloPorSigla.get(sigla) ?? new Set<string>()
      const conteudo = conteudoPreenchido(texto, modelo, [item.paciente_nome, pastaPaciente, item.prestador_nome])
      assin = assinatura(shingles(conteudo))
      // Só o modelo: a maioria das linhas é do modelo e quase nada foi escrito.
      const linhas = linhasDe(texto)
      const doModelo = linhas.filter(l => modelo.has(linhaComparavel(l))).length
      const escritas = conteudo.join(' ').split(' ').filter(Boolean).length
      if (modelo.size > 0 && linhas.length >= 5 && doModelo / linhas.length >= 0.6 && escritas < 30) {
        achados.unshift({
          codigo: 'igual_ao_modelo', familia: 'preenchimento', nivel: 'errado', origem: 'regra',
          titulo: 'Só o texto do modelo: quase nada foi preenchido',
          descricao: `${doModelo} de ${linhas.length} linhas são do modelo; só ${escritas} palavras escritas.`,
        })
      }
    } catch (e) {
      await db.from('sp_pep_documentos').update({
        analise_status: 'erro', analise_erro: falhou(e), analise_tentativas: p.analise_tentativas + 1,
        atualizado_em: new Date().toISOString(),
      }).eq('sp_id', p.sp_id)
      resumo.falhas++
      return
    }

    const agora = new Date().toISOString()
    const ia: Record<string, unknown> = {}
    if (!temRegua(sigla)) {
      Object.assign(ia, { ia_status: 'nao_se_aplica', ia_achados: [], ia_erro: null })
    } else {
      try {
        const r = await lerDocumentoComIA({
          sigla, texto,
          pacientes: [item.paciente_nome, pastaPaciente, ...outros],
          profissionais: [item.prestador_nome],
        })
        Object.assign(ia, {
          ia_status: 'concluida', ia_achados: r.achados, ia_resumo: r.resumo, ia_modelo: r.modelo,
          ia_regua: r.regua, ia_erro: null, ia_em: agora,
        })
        resumo.ia++
      } catch (e) {
        Object.assign(ia, { ia_status: 'erro', ia_erro: falhou(e), ia_tentativas: p.ia_tentativas + 1, ia_em: agora })
      }
    }

    const { error } = await db.from('sp_pep_documentos').update({
      analise_status: 'concluida', analise_erro: null, analise_versao: VERSAO_ANALISE, analisado_em: agora,
      achados, assinatura: assin, atualizado_em: agora, ...ia,
    }).eq('sp_id', p.sp_id)
    if (error) { resumo.falhas++; return }
    analisados.push(p.sp_id)
    resumo.analisados++
  }

  for (let i = 0; i < alvo.length; i += PARALELO) {
    if (Date.now() - inicio > orcamento) { resumo.restantes = true; break }
    await Promise.all(alvo.slice(i, i + PARALELO).map(analisarUm))
  }
  if (analisados.length === 0) return resumo

  // ── 5. Cópias: cada analisado contra os documentos vivos ─────────────────────
  const { data: candBruto, error: erroCand } = await db.from('sp_pep_documentos')
    .select('sp_id, sha256, assinatura, sp_pep_itens!inner(sigla, competencia, prestador_pasta_id, paciente_pasta_id, paciente_nome, removido_em)')
    .eq('analise_status', 'concluida')
    .is('sp_pep_itens.removido_em', null)
    .limit(5000)
  if (erroCand) throw new Error(`candidatos: ${erroCand.message}`)
  type Cand = { sp_id: string; sha256: string | null; assinatura: number[] | null; sp_pep_itens: { sigla: string | null; competencia: string | null; prestador_pasta_id: string | null; paciente_pasta_id: string | null; paciente_nome: string | null } | null }
  const candidatos: DocParaPar[] = ((candBruto ?? []) as unknown as Cand[]).map(c => ({
    sp_id: c.sp_id, sha256: c.sha256, assinatura: c.assinatura,
    sigla: c.sp_pep_itens?.sigla ?? null,
    tipoRegistro: tipoDe.get((c.sp_pep_itens?.sigla ?? '').toUpperCase()) ?? null,
    competencia: c.sp_pep_itens?.competencia ?? null,
    prestadorPastaId: c.sp_pep_itens?.prestador_pasta_id ?? null,
    pacientePastaId: c.sp_pep_itens?.paciente_pasta_id ?? null,
    pacienteNome: c.sp_pep_itens?.paciente_nome ?? null,
  }))
  const porId = new Map(candidatos.map(c => [c.sp_id, c]))
  const afetados = new Set<string>(analisados)
  for (const id of analisados) {
    const doc = porId.get(id)
    const novos: Par[] = doc ? candidatos.map(c => parEntre(doc, c)).filter((x): x is Par => !!x) : []
    const { data: antigos } = await db.from('sp_pep_documentos_semelhancas')
      .select('a_sp_id, b_sp_id').or(`a_sp_id.eq.${id},b_sp_id.eq.${id}`)
    const chave = (a: string, b: string) => `${a}|${b}`
    const ficam = new Set(novos.map(n => chave(n.a_sp_id, n.b_sp_id)))
    for (const v of (antigos ?? []) as { a_sp_id: string; b_sp_id: string }[]) {
      if (!ficam.has(chave(v.a_sp_id, v.b_sp_id))) {
        await db.from('sp_pep_documentos_semelhancas').delete().eq('a_sp_id', v.a_sp_id).eq('b_sp_id', v.b_sp_id)
        afetados.add(v.a_sp_id); afetados.add(v.b_sp_id)
      }
    }
    if (novos.length) {
      // Upsert só com as colunas do cálculo: a revisão de uma pessoa fica.
      const agora = new Date().toISOString()
      await db.from('sp_pep_documentos_semelhancas')
        .upsert(novos.map(n => ({ ...n, atualizado_em: agora })), { onConflict: 'a_sp_id,b_sp_id' })
      for (const n of novos) { afetados.add(n.a_sp_id); afetados.add(n.b_sp_id) }
      resumo.pares += novos.length
    }
  }

  // ── 6. Indicação final ───────────────────────────────────────────────────────
  await db.rpc('sp_pep_documentos_consolidar', { p_sp_ids: [...afetados] })
  return resumo
}
