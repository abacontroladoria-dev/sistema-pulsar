import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { temPermissao } from '@/lib/permissions/resolver'
import { carregarPermissoesEfetivas } from '@/lib/permissions/carregar'
import { NaoAutenticadoError, SemPermissaoError } from '@/lib/auditoria/auth'

// Quem pode usar as rotas da conferência de documentos: a mesma permissão que
// lê sp_pep_itens (Entregas PEP ou o painel do robô). A checagem vive aqui —
// o proxy.ts protege página, não /api.

const PERMISSOES = ['relacionamento_prestador_pep', 'robo_sharepoint', 'relacionamento_prestador_auditoria_documentos']

export type ContextoPep = { supabase: SupabaseClient; usuarioId: string; usuarioNome: string; role: string }

export async function exigirPermissaoPep(): Promise<ContextoPep> {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new NaoAutenticadoError()

  const { data: perfil } = await supabase.from('usuarios').select('role, nome, ativo').eq('id', user.id).maybeSingle()
  if (!perfil) throw new NaoAutenticadoError('Usuário não encontrado')
  if (!perfil.ativo) throw new NaoAutenticadoError('Usuário inativo')

  const role = (perfil.role as string | null) ?? ''
  const codigos = await carregarPermissoesEfetivas(supabase)
  if (!PERMISSOES.some(p => temPermissao(role, codigos, p))) {
    throw new SemPermissaoError('Sem permissão para Entregas PEP')
  }
  return { supabase, usuarioId: user.id, usuarioNome: (perfil.nome as string | null) ?? 'Usuário', role }
}
