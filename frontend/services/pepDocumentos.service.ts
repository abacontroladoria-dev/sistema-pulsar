import { getSupabaseClient } from '@/lib/supabase/client'
import type { ParagrafoComparado } from '@/lib/pepDocumentos/semelhanca'
import type { DocumentoPep, RevisaoStatus, SemelhancaPep } from '@/lib/pepDocumentos/tipos'

// Conferência do conteúdo dos documentos da PEP (20261014110000). Leitura
// direta das tabelas (RLS: Entregas PEP ou robô); o TEXTO nunca vem por aqui —
// só pelas rotas /api/relacionamento-prestador/pep/documentos/*, que conferem a
// permissão e devolvem trechos.

const LOTE = 150

/** Tabela ainda não criada neste ambiente (localhost usa o banco de produção). */
function tabelaAusente(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? ''))
}

export async function listarDocumentos(spIds: string[]): Promise<{ documentos: DocumentoPep[]; disponivel: boolean }> {
  if (spIds.length === 0) return { documentos: [], disponivel: true }
  const supabase = getSupabaseClient()
  const documentos: DocumentoPep[] = []
  for (let i = 0; i < spIds.length; i += LOTE) {
    const { data, error } = await supabase.from('sp_pep_documentos')
      .select('sp_id, e_tag, sha256, extensao, tamanho, paginas, caracteres, extracao_status, extracao_detalhe, extraido_em, analise_status, analise_erro, analisado_em, achados, ia_status, ia_achados, ia_resumo, ia_erro, ia_modelo, ia_regua, veredito, revisao_status, revisao_obs, revisao_por_nome, revisao_em, historico')
      .in('sp_id', spIds.slice(i, i + LOTE))
    if (error) {
      if (tabelaAusente(error)) return { documentos: [], disponivel: false }
      throw new Error(error.message)
    }
    documentos.push(...((data ?? []) as DocumentoPep[]))
  }
  return { documentos, disponivel: true }
}

export type OutroDocumento = {
  sp_id: string
  nome: string
  sigla: string | null
  competencia: string | null
  prestador_nome: string | null
  paciente_nome: string | null
  web_url: string | null
}

/** Pares de cópia que envolvem estes documentos, com o "outro lado" de cada par. */
export async function listarSemelhancas(spIds: string[]): Promise<{ pares: SemelhancaPep[]; outros: Map<string, OutroDocumento> }> {
  const outros = new Map<string, OutroDocumento>()
  if (spIds.length === 0) return { pares: [], outros }
  const supabase = getSupabaseClient()
  const pares: SemelhancaPep[] = []
  for (let i = 0; i < spIds.length; i += LOTE) {
    const lista = spIds.slice(i, i + LOTE).map(s => `"${s.replace(/"/g, '')}"`).join(',')
    const { data, error } = await supabase.from('sp_pep_documentos_semelhancas')
      .select('a_sp_id, b_sp_id, tipo, similaridade, relacao, nivel, revisao_status, revisao_obs, revisao_por_nome, revisao_em, detectado_em')
      .or(`a_sp_id.in.(${lista}),b_sp_id.in.(${lista})`)
    if (error) {
      if (tabelaAusente(error)) return { pares: [], outros }
      throw new Error(error.message)
    }
    for (const p of (data ?? []) as SemelhancaPep[]) {
      if (!pares.some(x => x.a_sp_id === p.a_sp_id && x.b_sp_id === p.b_sp_id)) pares.push({ ...p, similaridade: Number(p.similaridade) })
    }
  }
  const ids = [...new Set(pares.flatMap(p => [p.a_sp_id, p.b_sp_id]))]
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data } = await supabase.from('sp_pep_itens')
      .select('sp_id, nome, sigla, competencia, prestador_nome, paciente_nome, web_url')
      .in('sp_id', ids.slice(i, i + LOTE))
    for (const o of (data ?? []) as OutroDocumento[]) outros.set(o.sp_id, o)
  }
  return { pares, outros }
}

export async function revisarDocumento(spId: string, status: RevisaoStatus, obs: string | null) {
  const { error } = await getSupabaseClient().rpc('sp_pep_documento_revisar', { p_sp_id: spId, p_status: status, p_obs: obs })
  if (error) throw new Error(error.code === '42501' ? 'Só RP e administradores revisam documentos do PEP.' : error.message)
}

export async function revisarSemelhanca(a: string, b: string, status: 'pendente' | 'problema_confirmado' | 'falso_positivo', obs: string | null) {
  const { error } = await getSupabaseClient().rpc('sp_pep_semelhanca_revisar', { p_a: a, p_b: b, p_status: status, p_obs: obs })
  if (error) throw new Error(error.code === '42501' ? 'Só RP e administradores revisam documentos do PEP.' : error.message)
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((corpo as { error?: string }).error ?? `Erro ${r.status}`)
  return corpo as T
}

export type ResumoAnalise = { analisados: number; falhas: number; ia: number; pares: number; restantes: boolean }

/** Analisa os pendentes entre estes documentos (não gasta IA com o que já foi analisado). */
export function analisarPendentes(spIds: string[]) {
  return chamar<ResumoAnalise>('/api/relacionamento-prestador/pep/documentos/analisar', { method: 'POST', body: JSON.stringify({ spIds }) })
}

export function reanalisarDocumento(spId: string) {
  return chamar<ResumoAnalise>('/api/relacionamento-prestador/pep/documentos/analisar', { method: 'POST', body: JSON.stringify({ reanalisar: spId }) })
}

export type LadoComparado = {
  sp_id: string
  nome: string | null
  sigla: string | null
  competencia: string | null
  prestador: string | null
  paciente: string | null
  web_url: string | null
  paragrafos?: ParagrafoComparado[]
}

export type Comparacao = {
  par: Pick<SemelhancaPep, 'a_sp_id' | 'b_sp_id' | 'similaridade' | 'tipo' | 'relacao' | 'nivel'>
  expirado: boolean
  a: LadoComparado
  b: LadoComparado
}

export function compararDocumentos(a: string, b: string) {
  return chamar<Comparacao>(`/api/relacionamento-prestador/pep/documentos/comparar?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
}
