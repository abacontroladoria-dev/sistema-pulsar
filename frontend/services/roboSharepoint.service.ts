import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  ArquivoLido, ArquivoLidoCompleto, ArvorePastas, MatrizEvidencias, PacienteDetalhe, ResumoExecucao, RoboExecucao, RoboSaude,
  PepIndicesRobo, SituacaoReconhecimento, SpFilaPendencias, SpItem, SpItemStatus, SpPendenciaPasta, TipoArquivoLido,
} from '@/types/roboSharepoint'

// Leitura das tabelas sp_pep_* (RLS: robo_sharepoint / relacionamento_prestador_pep)
// e as duas escritas permitidas a pessoas (RPCs sp_pep_resolver_item e
// sp_pep_vincular_pasta). O robô em si nunca passa por aqui.

const CAMPOS_EXECUCAO =
  'id, maquina_id, gatilho, modo, status, etapa_atual, etapas, resumo, metricas, erro, versao, certificado, solicitado_por_nome, iniciado_em, concluido_em, duracao_ms'

export async function listarExecucoes(limite = 30): Promise<RoboExecucao[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_execucoes')
    .select(CAMPOS_EXECUCAO)
    .order('iniciado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as RoboExecucao[]
}

/**
 * Histórico completo, paginado. A tabela cresce ~1 linha por dia (mais os
 * "Executar agora"), então página de 25 com contagem exata é barata.
 */
export async function listarExecucoesPagina(input: {
  pagina: number
  tamanho?: number
  status?: 'concluido' | 'erro' | null
  gatilho?: 'agenda' | 'manual' | 'demo' | 'inventario' | null
}): Promise<{ execucoes: RoboExecucao[]; total: number }> {
  const tamanho = input.tamanho ?? 25
  const de = input.pagina * tamanho
  let q = getSupabaseClient()
    .from('sp_pep_execucoes')
    .select(CAMPOS_EXECUCAO, { count: 'exact' })
    .order('iniciado_em', { ascending: false })
    .range(de, de + tamanho - 1)
  if (input.status) q = q.eq('status', input.status)
  if (input.gatilho) q = q.eq('gatilho', input.gatilho)
  const { data, error, count } = await q
  if (error) throw error
  return { execucoes: (data ?? []) as RoboExecucao[], total: count ?? 0 }
}

// ── "O que o robô leu" ───────────────────────────────────────────────────────
// Agregados vêm por RPC (uma linha jsonb): o PostgREST corta listas em 1000
// linhas sem avisar, e uma leitura completa pode passar disso.

export async function obterResumoExecucao(execucaoId: string): Promise<ResumoExecucao> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_resumo_execucao', { p_execucao_id: execucaoId })
  if (error) throw error
  return data as ResumoExecucao
}

export async function obterSituacaoReconhecimento(): Promise<SituacaoReconhecimento> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_situacao_reconhecimento')
  if (error) throw error
  return data as SituacaoReconhecimento
}

export type OrdemArquivos = 'caminho' | 'recentes' | 'nome'

/**
 * Arquivos lidos por UMA execução, com a situação de cada um no Pulsar
 * (vw_sp_pep_arquivos_lidos). Sem a migration 20261001140000 aplicada, cai
 * para a tabela crua — a lista aparece, só sem a situação.
 */
export async function listarArquivosLidos(input: {
  execucaoId: string
  tipo?: TipoArquivoLido | null
  sigla?: string | null
  motivo?: string | null
  prestadorPastaId?: string | null
  pacientePastaId?: string | null
  situacao?: SpItemStatus | null
  motivoPulsar?: string | null
  soNovos?: boolean
  busca?: string
  ordem?: OrdemArquivos
  pagina: number
  tamanho?: number
}): Promise<{ arquivos: ArquivoLidoCompleto[]; total: number }> {
  const tamanho = input.tamanho ?? 25
  const de = input.pagina * tamanho
  const montar = (fonte: string, comSituacao: boolean) => {
    let q = getSupabaseClient().from(fonte).select('*', { count: 'exact' }).eq('execucao_id', input.execucaoId)
    q = input.ordem === 'recentes' ? q.order('criado_em_sp', { ascending: false, nullsFirst: false })
      : input.ordem === 'nome' ? q.order('nome', { ascending: true })
        : q.order('caminho', { ascending: true })
    q = q.range(de, de + tamanho - 1)
    if (input.tipo) q = q.eq('tipo', input.tipo)
    if (input.sigla) q = q.eq('sigla', input.sigla)
    if (input.motivo) q = q.eq('motivo', input.motivo)
    if (input.prestadorPastaId) q = q.eq('prestador_pasta_id', input.prestadorPastaId)
    if (input.pacientePastaId) q = q.eq('paciente_pasta_id', input.pacientePastaId)
    if (comSituacao && input.situacao) q = q.eq('situacao', input.situacao)
    if (comSituacao && input.motivoPulsar) q = q.eq('motivo_pulsar', input.motivoPulsar)
    if (comSituacao && input.soNovos) q = q.eq('novo', true)
    const busca = input.busca?.trim().replace(/[%_,()]/g, ' ')
    if (busca) q = q.or(`nome.ilike.%${busca}%,caminho.ilike.%${busca}%`)
    return q
  }
  const r = await montar('vw_sp_pep_arquivos_lidos', true)
  if (!r.error) return { arquivos: (r.data ?? []) as ArquivoLidoCompleto[], total: r.count ?? 0 }
  const cru = await montar('sp_pep_execucao_arquivos', false)
  if (cru.error) throw cru.error
  return { arquivos: (cru.data ?? []) as ArquivoLidoCompleto[], total: cru.count ?? 0 }
}

export async function obterArvorePastas(execucaoId: string, pastaPai: string | null): Promise<ArvorePastas> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_arvore_pastas', { p_execucao_id: execucaoId, p_pasta_pai: pastaPai })
  if (error) throw error
  return data as ArvorePastas
}

export async function obterMatrizEvidencias(execucaoId: string): Promise<MatrizEvidencias> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_matriz_evidencias', { p_execucao_id: execucaoId })
  if (error) throw error
  return data as MatrizEvidencias
}

export async function obterPacientesDetalhe(): Promise<PacienteDetalhe[]> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_pacientes_detalhe')
  if (error) throw error
  return ((data as { pacientes?: PacienteDetalhe[] })?.pacientes ?? [])
}

export async function listarPlanilhasLidas(execucaoId: string): Promise<ArquivoLido[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_execucao_arquivos')
    .select('*')
    .eq('execucao_id', execucaoId)
    .eq('tipo', 'planilha')
    .order('caminho')
  if (error) throw error
  return (data ?? []) as ArquivoLido[]
}

/**
 * Pastas que o robô não conseguiu reconhecer (prestador ou paciente), com
 * quantos arquivos estão presos atrás de cada uma. Poucas dezenas no máximo.
 */
// A fila separa a CAUSA dos sintomas. Prestador sem planilha prende ele mesmo,
// todas as pastas de paciente dele e os arquivos delas, todos com o motivo
// planilha_ausente — e nenhum vínculo manual resolve, porque o CPF dos
// pacientes vem da planilha. Por isso esses viram uma linha por prestador, sem
// botão; só os outros motivos vão para "Vincular". (1ª leitura real, 01/10/2026:
// 9 prestadores sem planilha prendiam 144 das 150 pastas.)
// Link da pasta "1. Planejamento" de cada prestador, onde a planilha tem de
// entrar; sem ela, a pasta do prestador. web_url chega com o robô 0.3
// (20261001140000). Consulta à parte e tolerante: sem link, a fila funciona.
async function linksDePlanejamento(prestadores: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  if (prestadores.length === 0) return links
  const sb = getSupabaseClient()
  const [proprias, filhas] = await Promise.all([
    sb.from('sp_pep_pastas').select('id, web_url').in('id', prestadores),
    sb.from('sp_pep_pastas').select('pai_id, nome, web_url').in('pai_id', prestadores),
  ])
  if (proprias.error || filhas.error) return links
  for (const p of proprias.data ?? []) if (p.web_url) links.set(p.id as string, p.web_url as string)
  for (const f of filhas.data ?? []) {
    if (f.web_url && /^0*1\s*[.)\-–]/.test(String(f.nome ?? '').trim())) links.set(f.pai_id as string, f.web_url as string)
  }
  return links
}

export async function listarPendenciasDePasta(): Promise<SpFilaPendencias> {
  const sb = getSupabaseClient()
  const [prest, semPlanilha, pac, pastas, itens] = await Promise.all([
    sb.from('sp_pep_prestadores').select('pasta_id, motivo').eq('status', 'nao_reconhecido'),
    sb.from('sp_pep_prestadores').select('pasta_id, origem').is('planilha_sp_id', null),
    sb.from('sp_pep_pacientes').select('pasta_id, prestador_pasta_id, motivo').eq('status', 'nao_reconhecido'),
    sb.from('sp_pep_pastas').select('id, nome').not('papel', 'is', null),
    sb.from('sp_pep_itens').select('prestador_pasta_id, paciente_pasta_id').eq('status', 'nao_reconhecido'),
  ])
  for (const r of [prest, semPlanilha, pac, pastas, itens]) if (r.error) throw r.error

  const nome = new Map((pastas.data ?? []).map(p => [p.id as string, p.nome as string]))
  const presosPorPasta = new Map<string, number>()
  for (const i of itens.data ?? []) {
    for (const id of [i.prestador_pasta_id, i.paciente_pasta_id]) {
      if (id) presosPorPasta.set(id, (presosPorPasta.get(id) ?? 0) + 1)
    }
  }

  const linkPlanejamento = await linksDePlanejamento((semPlanilha.data ?? []).map(p => p.pasta_id as string))

  const pacientesPresos = new Map<string, number>()
  for (const p of pac.data ?? []) {
    if (p.motivo === 'planilha_ausente' && p.prestador_pasta_id) {
      pacientesPresos.set(p.prestador_pasta_id, (pacientesPresos.get(p.prestador_pasta_id) ?? 0) + 1)
    }
  }

  const pastasComPessoa: SpPendenciaPasta[] = [
    ...(prest.data ?? []).map(p => ({
      pasta_id: p.pasta_id as string, tipo: 'prestador' as const, nome_pasta: nome.get(p.pasta_id) ?? '(pasta)',
      prestador_pasta_nome: null, motivo: p.motivo as string | null, arquivos: presosPorPasta.get(p.pasta_id) ?? 0,
    })),
    ...(pac.data ?? []).map(p => ({
      pasta_id: p.pasta_id as string, tipo: 'paciente' as const, nome_pasta: nome.get(p.pasta_id) ?? '(pasta)',
      prestador_pasta_nome: p.prestador_pasta_id ? nome.get(p.prestador_pasta_id) ?? null : null,
      motivo: p.motivo as string | null, arquivos: presosPorPasta.get(p.pasta_id) ?? 0,
    })),
  ]

  return {
    semPlanilha: (semPlanilha.data ?? []).map(p => ({
      pasta_id: p.pasta_id as string,
      nome_pasta: nome.get(p.pasta_id) ?? '(pasta)',
      vinculado_a_mao: p.origem === 'manual',
      pastas_paciente: pacientesPresos.get(p.pasta_id) ?? 0,
      arquivos: presosPorPasta.get(p.pasta_id) ?? 0,
      web_url: linkPlanejamento.get(p.pasta_id) ?? null,
    })).sort((a, b) => b.arquivos - a.arquivos || b.pastas_paciente - a.pastas_paciente || a.nome_pasta.localeCompare(b.nome_pasta)),
    pastas: pastasComPessoa
      .filter(p => p.motivo !== 'planilha_ausente')
      .sort((a, b) => b.arquivos - a.arquivos || a.nome_pasta.localeCompare(b.nome_pasta)),
  }
}

export async function listarItensNaoReconhecidos(limite = 200): Promise<SpItem[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_itens')
    .select('*')
    .eq('status', 'nao_reconhecido')
    .order('criado_em_sp', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as SpItem[]
}

/** Sugestões e confirmados de um prestador num mês (gaveta da tela PEP). */
export async function listarItensDoPrestador(prestadorNome: string, competencia: string): Promise<SpItem[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_itens')
    .select('*')
    .eq('prestador_nome', prestadorNome)
    .eq('competencia', competencia)
    .in('status', ['sugerido', 'confirmado', 'revertido'])
    .order('criado_em_sp', { ascending: true })
  if (error) throw error
  return (data ?? []) as SpItem[]
}

export async function resolverItem(input: {
  spId: string
  acao: 'confirmar' | 'ignorar' | 'reabrir'
  registroEntregaId?: string | null
  competencia?: string | null
}): Promise<SpItem> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_resolver_item', {
    p_sp_id: input.spId,
    p_acao: input.acao,
    p_registro_entrega_id: input.registroEntregaId ?? null,
    p_competencia: input.competencia ?? null,
  })
  if (error) throw error
  return data as SpItem
}

export async function vincularPasta(input: {
  pastaId: string
  tipo: 'prestador' | 'paciente'
  prestadorNome?: string | null
  pacienteNome?: string | null
  pacienteCpf?: string | null
}) {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_vincular_pasta', {
    p_pasta_id: input.pastaId,
    p_tipo: input.tipo,
    p_prestador_nome: input.prestadorNome ?? null,
    p_paciente_nome: input.pacienteNome ?? null,
    p_paciente_cpf: input.pacienteCpf ?? null,
  })
  if (error) throw error
  return data as Record<string, unknown>
}

export async function listarNomesDePrestadores(): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('remuneracao_contratos')
    .select('profissional_nome')
    .order('profissional_nome')
  if (error) throw error
  return (data ?? []).map(r => r.profissional_nome as string)
}

export async function buscarPacientes(termo: string): Promise<{ nome: string; cpf: string | null }[]> {
  const t = termo.trim()
  if (t.length < 3) return []
  const { data, error } = await getSupabaseClient()
    .from('pacientes')
    .select('nome, cpf')
    .ilike('nome', `%${t.replace(/[%_]/g, '')}%`)
    .eq('ficticio', false)
    .order('nome')
    .limit(10)
  if (error) throw error
  return (data ?? []) as { nome: string; cpf: string | null }[]
}

export async function obterSaude(): Promise<RoboSaude> {
  const r = await fetch('/api/robo-sharepoint/executar', { cache: 'no-store' })
  const corpo = await r.json().catch(() => ({}))
  if (r.status === 503) return { configurado: false }
  if (!r.ok) throw new Error(corpo?.error ?? `HTTP ${r.status}`)
  return corpo as RoboSaude
}

export async function executarAgora(): Promise<void> {
  const r = await fetch('/api/robo-sharepoint/executar', { method: 'POST' })
  if (r.status === 202) return
  const corpo = await r.json().catch(() => ({}))
  throw new Error(corpo?.error ?? `HTTP ${r.status}`)
}

// ── Entrega automática (20261002100000) ─────────────────────────────────────

/** "Desfazer" uma entrega do robô. Motivo obrigatório; vale só para mês aberto. */
export async function reverterEntregaRobo(spId: string, motivo: string): Promise<SpItem> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_reverter_entrega_robo', {
    p_sp_id: spId, p_motivo: motivo,
  })
  if (error) throw error
  return data as SpItem
}

/** Índices robô × pessoa × padrão da competência (todos os prestadores). Tolerante: [] se a view não existir. */
export async function getIndicesRobo(competencia: string): Promise<PepIndicesRobo[]> {
  const { data, error } = await getSupabaseClient()
    .from('vw_pep_indices_robo')
    .select('*')
    .eq('competencia', competencia)
  if (error) {
    console.warn('vw_pep_indices_robo indisponível:', error)
    return []
  }
  return (data ?? []) as PepIndicesRobo[]
}

export type EstadoEntregaAutomatica = { ligada: boolean; por: string | null; em: string | null }

export async function obterEntregaAutomatica(): Promise<EstadoEntregaAutomatica | null> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_estado')
    .select('entrega_automatica, entrega_automatica_por_nome, entrega_automatica_em')
    .eq('id', 1)
    .maybeSingle()
  if (error) return null // migration ainda não aplicada
  return {
    ligada: !!data?.entrega_automatica,
    por: (data?.entrega_automatica_por_nome as string | null) ?? null,
    em: (data?.entrega_automatica_em as string | null) ?? null,
  }
}

/** Só admin. Ligar já reprocessa o que está em aberto (o robô entrega na hora). */
export async function definirEntregaAutomatica(ligar: boolean): Promise<{ ligada: boolean; resultado: Record<string, unknown> }> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_definir_entrega_automatica', { p_ligar: ligar })
  if (error) throw error
  return data as { ligada: boolean; resultado: Record<string, unknown> }
}

/** Quantas evidências seguem / ferem o padrão de nome (todas as competências, sem os apagados). */
export async function contarPadrao(): Promise<{ ok: number; fora: number; duplicado: number; rep: number } | null> {
  const sb = getSupabaseClient()
  const contar = (padrao: string) => sb.from('sp_pep_itens').select('sp_id', { count: 'exact', head: true })
    .eq('tipo', 'evidencia').eq('padrao', padrao).neq('status', 'removido')
  const [ok, fora, duplicado, rep] = await Promise.all([contar('ok'), contar('fora'), contar('duplicado'), contar('rep')])
  if (ok.error || fora.error || duplicado.error || rep.error) return null // migration ainda não aplicada
  return { ok: ok.count ?? 0, fora: fora.count ?? 0, duplicado: duplicado.count ?? 0, rep: rep.count ?? 0 }
}
