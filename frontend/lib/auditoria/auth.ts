import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { temPermissao } from '@/lib/permissions/resolver'
import { carregarPermissoesEfetivas } from '@/lib/permissions/carregar'

/**
 * Permissão da tela de Auditoria de Evoluções. Dada pelos grupos de permissão
 * (Terapêutico, Diretoria…) — ver lib/permissions/carregar.ts.
 */
export const PERMISSAO_AUDITORIA_EVOLUCOES = 'terapeutico_auditoria_evolucoes'

export class NaoAutenticadoError extends Error {
  constructor(mensagem = 'Não autenticado') {
    super(mensagem)
    this.name = 'NaoAutenticadoError'
  }
}

export class SemPermissaoError extends Error {
  constructor(mensagem = 'Sem permissão para a auditoria de evoluções') {
    super(mensagem)
    this.name = 'SemPermissaoError'
  }
}

export type ContextoAuditoria = {
  supabase: SupabaseClient
  usuarioId: string
  usuarioNome: string
  role: string
}

/**
 * Resolve o usuário autenticado e exige a permissão da auditoria.
 *
 * A CHECAGEM VIVE AQUI DE PROPÓSITO — mesmo raciocínio de lib/insumos/auth.ts.
 * O `proxy.ts` protege página, não API: o matcher dele exclui `/api`
 * explicitamente. Como toda rota do módulo precisa do `supabase` e ele só sai
 * daqui, a rota que esquecer a permissão não compila.
 *
 * Antes disto, as rotas só faziam `if (!user)`: qualquer usuário logado no
 * Pulsar — inclusive quem só usa cronograma — disparava auditorias por IA e
 * alterava o status de cobrança de qualquer profissional.
 */
export async function exigirPermissaoAuditoria(): Promise<ContextoAuditoria> {
  const supabase = await createClient()

  const {
    data: { user },
    error
  } = await supabase.auth.getUser()
  if (error || !user) throw new NaoAutenticadoError()

  const { data: perfil, error: erroPerfil } = await supabase
    .from('usuarios')
    .select('role, nome, ativo')
    .eq('id', user.id)
    .maybeSingle()

  if (erroPerfil || !perfil) throw new NaoAutenticadoError('Usuário não encontrado')
  if (!perfil.ativo) throw new NaoAutenticadoError('Usuário inativo')

  const role = (perfil.role as string | null) ?? ''

  // Mesma resolução do proxy.ts: grupos + ajustes individuais, pelo banco.
  const codigos = await carregarPermissoesEfetivas(supabase)
  if (!temPermissao(role, codigos, PERMISSAO_AUDITORIA_EVOLUCOES)) {
    throw new SemPermissaoError()
  }

  return {
    supabase,
    usuarioId: user.id,
    usuarioNome: (perfil.nome as string | null) ?? 'Usuário',
    role
  }
}

/** Traduz os erros de auth no par (status, mensagem) da resposta HTTP. */
export function respostaDeErroAuth(e: unknown): { status: number; error: string } | null {
  if (e instanceof NaoAutenticadoError) return { status: 401, error: e.message }
  if (e instanceof SemPermissaoError) return { status: 403, error: e.message }
  return null
}
