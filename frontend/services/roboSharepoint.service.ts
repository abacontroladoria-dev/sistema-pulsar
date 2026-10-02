import { getSupabaseClient } from '@/lib/supabase/client'
import { ehMigrationPendente } from '@/lib/supabase/erro'
import { ehEstadoAtual } from '@/lib/roboSharepoint/referencias'
import type {
  ArquivoLido, ArquivoLidoCompleto, ArvorePastas, EventoEvidencia, EventoEvidenciaTipo, HistoricoEvidencias, MatrizEvidencias,
  PacienteDetalhe, RemocaoSuspensa, ResumoExecucao, RoboExecucao, RoboSaude,
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
//
// `execucaoId` = ESTADO_ATUAL (lib/roboSharepoint/referencias) lê o que está na
// pasta agora: as RPCs recebem NULL (20261003100000) e a lista sai de
// vw_sp_pep_arquivos_atuais. Antes de usar o marcador, a tela confere
// estadoAtualDisponivel() — com a migration pendente, NULL não daria erro, só
// uma lista vazia.

/** Id para as RPCs: o estado atual vai como NULL. */
const idDaLeitura = (execucaoId: string) => (ehEstadoAtual(execucaoId) ? null : execucaoId)

/**
 * A migration 20261003100000 já está no banco? (a view do estado atual existe)
 *
 * GET de verdade, nunca `head: true`: o supabase-js trata o 404 SEM corpo de
 * um HEAD como "204 sem conteúdo" (sem erro). Com a view ausente, a tela
 * achava que o estado atual existia e mostrava 0 arquivos (02/10/2026).
 */
export async function estadoAtualDisponivel(): Promise<boolean> {
  const { error } = await getSupabaseClient().from('vw_sp_pep_arquivos_atuais').select('sp_id').limit(1)
  if (error && !ehMigrationPendente(error)) console.warn('estado atual do SharePoint indisponível:', error)
  return !error
}

export async function obterResumoExecucao(execucaoId: string): Promise<ResumoExecucao> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_resumo_execucao', { p_execucao_id: idDaLeitura(execucaoId) })
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
 * para a tabela crua — a lista aparece, só sem a situação. Com ESTADO_ATUAL,
 * os arquivos que estão na pasta agora (vw_sp_pep_arquivos_atuais).
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
  const atual = ehEstadoAtual(input.execucaoId)
  const montar = (fonte: string, comSituacao: boolean) => {
    let q = getSupabaseClient().from(fonte).select('*', { count: 'exact' })
    if (!atual) q = q.eq('execucao_id', input.execucaoId)
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
  const r = await montar(atual ? 'vw_sp_pep_arquivos_atuais' : 'vw_sp_pep_arquivos_lidos', true)
  if (atual && r.error) throw r.error
  if (!r.error) return { arquivos: (r.data ?? []) as ArquivoLidoCompleto[], total: r.count ?? 0 }
  const cru = await montar('sp_pep_execucao_arquivos', false)
  if (cru.error) throw cru.error
  return { arquivos: (cru.data ?? []) as ArquivoLidoCompleto[], total: cru.count ?? 0 }
}

export async function obterArvorePastas(execucaoId: string, pastaPai: string | null): Promise<ArvorePastas> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_arvore_pastas', { p_execucao_id: idDaLeitura(execucaoId), p_pasta_pai: pastaPai })
  if (error) throw error
  return data as ArvorePastas
}

export async function obterMatrizEvidencias(execucaoId: string): Promise<MatrizEvidencias> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_matriz_evidencias', { p_execucao_id: idDaLeitura(execucaoId) })
  if (error) throw error
  return data as MatrizEvidencias
}

export async function obterPacientesDetalhe(): Promise<PacienteDetalhe[]> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_pacientes_detalhe')
  if (error) throw error
  return ((data as { pacientes?: PacienteDetalhe[] })?.pacientes ?? [])
}

export async function listarPlanilhasLidas(execucaoId: string): Promise<ArquivoLido[]> {
  const sb = getSupabaseClient()
  const { data, error } = await (ehEstadoAtual(execucaoId)
    ? sb.from('vw_sp_pep_arquivos_atuais').select('*')
    : sb.from('sp_pep_execucao_arquivos').select('*').eq('execucao_id', execucaoId))
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

/**
 * Sugestões e confirmados de um prestador num mês (gaveta da tela PEP). Os
 * 'removido' vêm para a aba "Saíram da pasta" (entrega retirada porque a
 * evidência saiu do SharePoint, 20261003100000).
 */
export async function listarItensDoPrestador(prestadorNome: string, competencia: string): Promise<SpItem[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_itens')
    .select('*')
    .eq('prestador_nome', prestadorNome)
    .eq('competencia', competencia)
    .in('status', ['sugerido', 'confirmado', 'revertido', 'removido'])
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
    // Sem a migration 20261002100000 a view não existe. O robô ainda não
    // entregava nada, então as entregas do mês são todas de pessoas: conta
    // direto em pep_registros_entrega (recorrente = quantidade; semestral = 1).
    console.warn('vw_pep_indices_robo indisponível, contando só entregas de pessoas:', error)
    const { data: regs, error: e2 } = await getSupabaseClient()
      .from('pep_registros_entrega')
      .select('prestador_nome, quantidade_entregue, status')
      .eq('competencia', competencia)
    if (e2) return []
    const porPrestador = new Map<string, number>()
    for (const r of regs ?? []) {
      const qtd = r.quantidade_entregue ?? (r.status === 'entregue' ? 1 : 0)
      porPrestador.set(r.prestador_nome as string, (porPrestador.get(r.prestador_nome as string) ?? 0) + Number(qtd))
    }
    return [...porPrestador].map(([prestador_nome, humano_aprovou]) => ({
      competencia, prestador_nome, humano_aprovou,
      robo_aprovou: 0, robo_vigentes: 0, humano_reverteu: 0, unidades_robo: 0,
      segue_padrao: 0, fora_padrao: 0, duplicados: 0, reprogramacao: 0,
    }))
  }
  return (data ?? []) as PepIndicesRobo[]
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

// ── Histórico das evidências e freio (20261003100000) ───────────────────────
// Tudo tolerante: sem a migration, a tela mostra um aviso em vez de quebrar.

/** Série do gráfico (por dia ou por mês) + totais. null = migration pendente. */
export async function obterHistoricoEvidencias(input: {
  de: string
  ate: string
  grao: 'dia' | 'mes'
  prestadores?: string[]
}): Promise<HistoricoEvidencias | null> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_historico_evidencias', {
    p_de: input.de, p_ate: input.ate, p_grao: input.grao,
    p_prestadores: input.prestadores?.length ? input.prestadores : null,
  })
  if (error) {
    if (ehMigrationPendente(error)) return null
    throw error
  }
  return data as HistoricoEvidencias
}

/** Linhas do histórico, mais recentes primeiro. `de`/`ate` em 'AAAA-MM-DD' (dia de Brasília). */
export async function listarEventosEvidencias(input: {
  de?: string | null
  ate?: string | null
  eventos?: EventoEvidenciaTipo[]
  prestadores?: string[]
  pagina: number
  tamanho?: number
}): Promise<{ eventos: EventoEvidencia[]; total: number } | null> {
  const tamanho = input.tamanho ?? 20
  const de = input.pagina * tamanho
  let q = getSupabaseClient()
    .from('sp_pep_evidencias_historico')
    .select('*', { count: 'exact' })
    .order('em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + tamanho - 1)
  // Brasília é UTC-3 o ano todo: o dia começa às 03:00 UTC.
  if (input.de) q = q.gte('em', `${input.de}T03:00:00Z`)
  if (input.ate) q = q.lt('em', new Date(Date.parse(`${input.ate}T03:00:00Z`) + 86400000).toISOString())
  if (input.eventos?.length) q = q.in('evento', input.eventos)
  if (input.prestadores?.length) q = q.in('prestador_nome', input.prestadores)
  const { data, error, count } = await q
  if (error) {
    if (ehMigrationPendente(error)) return null
    throw error
  }
  return { eventos: (data ?? []) as EventoEvidencia[], total: count ?? 0 }
}

/**
 * Os avisos da tela PEP: entrega retirada porque a evidência sumiu,
 * evidência que sumiu em mês liberado, entregue e renomeada fora do padrão.
 * [] sem a migration.
 */
export async function listarAvisosEvidencias(dias = 30): Promise<EventoEvidencia[]> {
  const { data, error } = await getSupabaseClient()
    .from('sp_pep_evidencias_historico')
    .select('*')
    .in('evento', ['entrega_desfeita', 'mes_liberado_mantido', 'saiu_do_padrao'])
    .gte('em', new Date(Date.now() - dias * 86400000).toISOString())
    .order('em', { ascending: false })
    .limit(200)
  if (error) {
    if (!ehMigrationPendente(error)) console.warn('avisos das evidências indisponíveis:', error)
    return []
  }
  return (data ?? []) as EventoEvidencia[]
}

/** Leitura completa suspensa pelo freio. Só quem tem robo_sharepoint lê sp_pep_estado. */
export async function obterRemocaoSuspensa(): Promise<RemocaoSuspensa | null> {
  const { data, error } = await getSupabaseClient().from('sp_pep_estado').select('remocao_suspensa').eq('id', 1).maybeSingle()
  if (error) return null
  return (data as { remocao_suspensa?: RemocaoSuspensa | null } | null)?.remocao_suspensa ?? null
}

/** Só admin: os sumidos sumiram mesmo — aplica as remoções suspensas. */
export async function confirmarRemocoesSuspensas(): Promise<{ aplicado: boolean; evidencias_removidas?: number; motivo?: string }> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_confirmar_remocoes_suspensas')
  if (error) throw error
  return data as { aplicado: boolean; evidencias_removidas?: number; motivo?: string }
}
