import { getSupabaseClient } from '@/lib/supabase/client'
import type { ParagrafoComparado } from '@/lib/pepDocumentos/semelhanca'
import type { RevisaoStatus, SemelhancaPep } from '@/lib/pepDocumentos/tipos'

// Conferência do conteúdo dos documentos da PEP (20261014110000). Leitura
// direta das tabelas (RLS: Entregas PEP ou robô); o TEXTO nunca vem por aqui —
// só pela rota /api/relacionamento-prestador/pep/documentos/comparar, que confere a
// permissão e devolvem trechos.

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
