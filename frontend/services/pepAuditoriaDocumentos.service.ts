import { getSupabaseClient } from '@/lib/supabase/client'
import type { DocumentoPep, SemelhancaPep } from '@/lib/pepDocumentos/tipos'

// Auditoria de Documentos PEP (15/10/2026). Leitura direta das tabelas pelo
// navegador (RLS: Entregas PEP, robô ou a permissão da tela); o TEXTO nunca
// vem por aqui. Auditar passa pela rota do servidor (confere a permissão e põe
// na fila); publicar régua é a RPC sp_pep_regua_publicar (o banco confere
// rp/admin).
//
// PostgREST corta em 1000 linhas SEM erro: tudo pagina com range().

const PAGINA = 1000

/** Campos do arquivo que a tela usa — sem CPF (sp_pep_auditoria_lista). */
export type ItemDoDocumento = {
  nome: string
  sigla: string | null
  competencia: string | null
  prestador_nome: string | null
  prestador_pasta_id: string | null
  paciente_nome: string | null
  paciente_pasta_id: string | null
  web_url: string | null
  status: string
  motivo: string | null
  /** Etapa 1 (nome): ok | fora | duplicado | rep | null. */
  padrao: string | null
  padrao_motivo?: string | null
  /** Número lido do nome (TAP, STC, ETC). */
  nome_seq?: string | null
  paciente_pasta_nome?: string | null
}

/** A pasta do prestador: nome e se o robô a reconheceu. */
export type PrestadorDoDocumento = { nome_pasta: string | null; status: string | null; motivo: string | null }

export type DocAuditoria = DocumentoPep & {
  analise_versao: string | null
  auditoria_lote: string | null
  auditoria_pedida_por_nome: string | null
  auditoria_pedida_em: string | null
  item: ItemDoDocumento
  prestador: PrestadorDoDocumento
}

export type ReguaVersao = {
  id: string
  sigla: string
  versao: number
  conteudo: string
  nota: string | null
  publicado_por_nome: string
  publicado_em: string
}

export type DadosAuditoria = {
  disponivel: boolean
  docs: DocAuditoria[]
  pares: SemelhancaPep[]
  reguas: ReguaVersao[]
}

function tabelaAusente(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || /does not exist|schema cache|Could not find the function/i.test(e.message ?? ''))
}

async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    const linhas = (data ?? []) as T[]
    out.push(...linhas)
    if (linhas.length < PAGINA) return out
  }
}

export async function carregarAuditoria(): Promise<DadosAuditoria> {
  const supabase = getSupabaseClient()
  try {
    // Documentos + arquivo + pasta numa RPC só, sem CPF (as tabelas do robô
    // guardam CPF e não são lidas por quem tem só esta tela).
    const [lista, pares, reguas] = await Promise.all([
      supabase.rpc('sp_pep_auditoria_lista').then(r => {
        if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code })
        return (r.data ?? []) as DocAuditoria[]
      }),
      todas<SemelhancaPep>((de, ate) => supabase.from('sp_pep_documentos_semelhancas')
        .select('a_sp_id, b_sp_id, tipo, similaridade, relacao, nivel, revisao_status, revisao_obs, revisao_por_nome, revisao_em, detectado_em')
        .order('a_sp_id').order('b_sp_id').range(de, ate)),
      todas<ReguaVersao>((de, ate) => supabase.from('pep_reguas_versoes')
        .select('id, sigla, versao, conteudo, nota, publicado_por_nome, publicado_em').order('sigla').order('versao', { ascending: false }).range(de, ate)),
    ])
    return {
      disponivel: true,
      docs: lista,
      pares: pares.map(p => ({ ...p, similaridade: Number(p.similaridade) })),
      reguas,
    }
  } catch (e) {
    if (tabelaAusente(e as { code?: string; message?: string })) {
      return { disponivel: false, docs: [], pares: [], reguas: [] }
    }
    throw e
  }
}

/** RP/admin? Decide o botão "Publicar régua" e "Auditar de novo" (o banco confere de novo). */
export async function podeEscreverPep(): Promise<boolean> {
  const { data } = await getSupabaseClient().rpc('sp_pep_pode_escrever')
  return data === true
}

export async function publicarRegua(sigla: string, conteudo: string, nota: string): Promise<{ versao: number }> {
  const { data, error } = await getSupabaseClient().rpc('sp_pep_regua_publicar', { p_sigla: sigla, p_conteudo: conteudo, p_nota: nota })
  if (error) throw new Error(error.code === '42501' ? 'Só RP e administradores publicam réguas.' : error.message)
  return data as { versao: number }
}

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store' })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((corpo as { error?: string }).error ?? `Erro ${r.status}`)
  return corpo as T
}

const ROTA = '/api/relacionamento-prestador/auditoria-documentos/auditar'

export type Enfileirado = { lote: string | null; enfileirados: number; ignorados: number }
export type Progresso = { total: number; pendentes: number; feitos: number; falhas: number; cancelados: number }

export function auditarDocumentos(spIds: string[], forcar = false) {
  return chamar<Enfileirado>(ROTA, { method: 'POST', body: JSON.stringify({ spIds, forcar }) })
}

export function progressoDoLote(lote: string) {
  return chamar<Progresso>(`${ROTA}?lote=${encodeURIComponent(lote)}`)
}

export function cancelarLote(lote: string) {
  return chamar<{ cancelados: number }>(`${ROTA}?lote=${encodeURIComponent(lote)}`, { method: 'DELETE' })
}
