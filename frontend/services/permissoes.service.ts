import { getSupabaseClient } from '@/lib/supabase/client'

export type Permissao = {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  rota: string | null
  grupo: string | null
}

export type UsuarioPermissao = {
  id: string
  usuario_id: string
  permissao_codigo: string
  permitido: boolean
}

export async function getPermissoes(): Promise<Permissao[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('permissoes')
    .select('id, codigo, nome, descricao, rota, grupo')
    .order('grupo')
    .order('nome')

  if (error) {
    console.error('Erro ao buscar módulos de permissão:', error)
    return []
  }

  return data || []
}

export async function getUsuarioPermissoes(usuarioId: string): Promise<UsuarioPermissao[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('usuarios_permissoes')
    .select('*')
    .eq('usuario_id', usuarioId)

  if (error) {
    console.error('Erro ao buscar permissões do usuário:', error)
    return []
  }

  return data || []
}

// Todas as sobrescritas individuais, de todos os usuários — usado pela view
// "por permissão" (quem tem acesso a X), que precisa do mapa completo de uma
// vez para não fazer N chamadas. RLS libera select completo pra admin/diretoria
// (ver 20260529110000_create_permissoes_tables.sql e
// 20260713140000_diretoria_gerencia_permissoes.sql).
export async function getAllUsuariosPermissoes(): Promise<UsuarioPermissao[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('usuarios_permissoes')
    .select('*')

  if (error) {
    console.error('Erro ao buscar permissões de todos os usuários:', error)
    return []
  }

  return data || []
}

// Grava o que a pessoa deve ter, código a código, como AJUSTE em relação aos
// grupos dela (grupos ao vivo, 20260929140000): onde o desejado é igual ao que os
// grupos já dão, a linha é APAGADA; onde difere, fica gravado o ajuste. Assim
// usuarios_permissoes nunca guarda cópia do grupo — uma cópia congelaria a tela e
// sair do grupo não a tiraria mais.
//
// `uniaoDosGrupos`: códigos que os grupos da pessoa liberam (resolver.ts).
export async function salvarAjustes(
  usuarioId: string,
  desejado: Record<string, boolean>,
  uniaoDosGrupos: Set<string>
): Promise<boolean> {
  const supabase = getSupabaseClient()

  const gravar = Object.entries(desejado)
    .filter(([codigo, permitido]) => permitido !== uniaoDosGrupos.has(codigo))
    .map(([codigo, permitido]) => ({ usuario_id: usuarioId, permissao_codigo: codigo, permitido }))
  const apagar = Object.entries(desejado)
    .filter(([codigo, permitido]) => permitido === uniaoDosGrupos.has(codigo))
    .map(([codigo]) => codigo)

  if (gravar.length > 0) {
    const { error } = await supabase
      .from('usuarios_permissoes')
      .upsert(gravar, { onConflict: 'usuario_id,permissao_codigo' })
    if (error) {
      console.error('Erro ao salvar ajustes de permissão:', error)
      return false
    }
  }

  if (apagar.length > 0) {
    const { error } = await supabase
      .from('usuarios_permissoes')
      .delete()
      .eq('usuario_id', usuarioId)
      .in('permissao_codigo', apagar)
    if (error) {
      console.error('Erro ao remover ajustes de permissão:', error)
      return false
    }
  }

  return true
}

// "Voltar ao modelo": apaga todos os ajustes individuais — a pessoa fica só com
// o que os grupos dela dão.
export async function removerAjustes(usuarioId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('usuarios_permissoes').delete().eq('usuario_id', usuarioId)
  if (error) {
    console.error('Erro ao remover ajustes de permissão:', error)
    return false
  }
  return true
}
