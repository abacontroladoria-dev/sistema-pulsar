import { getSupabaseClient } from '@/lib/supabase/client'

export type Grupo = {
  id: string
  nome: string
  descricao: string | null
  modelo_permissoes: Record<string, boolean>
  created_at?: string
}

export async function getGrupos(): Promise<Grupo[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('grupos_permissoes')
    .select('id, nome, descricao, modelo_permissoes, created_at')
    .order('nome')

  if (error) {
    console.error('Erro ao buscar grupos:', error)
    return []
  }

  return (data || []).map(g => ({ ...g, modelo_permissoes: g.modelo_permissoes || {} }))
}

// Todas as associações grupo→usuário de uma vez, igual
// getAllUsuariosPermissoes (evita N chamadas por grupo).
export async function getAllMembrosPorGrupo(): Promise<Record<string, string[]>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('grupos_permissoes_membros')
    .select('grupo_id, usuario_id')

  if (error) {
    console.error('Erro ao buscar membros dos grupos:', error)
    return {}
  }

  const map: Record<string, string[]> = {}
  for (const row of data || []) {
    if (!map[row.grupo_id]) map[row.grupo_id] = []
    map[row.grupo_id].push(row.usuario_id)
  }
  return map
}

export async function criarGrupo(nome: string, descricao?: string): Promise<Grupo | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('grupos_permissoes')
    .insert({ nome, descricao: descricao || null })
    .select('id, nome, descricao, modelo_permissoes, created_at')
    .single()

  if (error) {
    console.error('Erro ao criar grupo:', error)
    return null
  }

  return { ...data, modelo_permissoes: data.modelo_permissoes || {} }
}

export async function renomearGrupo(
  grupoId: string,
  changes: { nome?: string; descricao?: string | null }
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('grupos_permissoes')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', grupoId)

  if (error) {
    console.error('Erro ao renomear grupo:', error)
    return false
  }

  return true
}

export async function excluirGrupo(grupoId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('grupos_permissoes').delete().eq('id', grupoId)

  if (error) {
    console.error('Erro ao excluir grupo:', error)
    return false
  }

  return true
}

export async function adicionarMembro(grupoId: string, usuarioId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('grupos_permissoes_membros')
    .upsert({ grupo_id: grupoId, usuario_id: usuarioId }, { onConflict: 'grupo_id,usuario_id' })

  if (error) {
    console.error('Erro ao adicionar membro ao grupo:', error)
    return false
  }

  return true
}

export async function removerMembro(grupoId: string, usuarioId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('grupos_permissoes_membros')
    .delete()
    .eq('grupo_id', grupoId)
    .eq('usuario_id', usuarioId)

  if (error) {
    console.error('Erro ao remover membro do grupo:', error)
    return false
  }

  return true
}

export async function salvarModeloGrupo(
  grupoId: string,
  modelo: Record<string, boolean>
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('grupos_permissoes')
    .update({ modelo_permissoes: modelo, updated_at: new Date().toISOString() })
    .eq('id', grupoId)

  if (error) {
    console.error('Erro ao salvar modelo de permissões do grupo:', error)
    return false
  }

  return true
}

// Substitui os grupos de um usuário pelo conjunto informado (usada pela lista
// suspensa de grupos no Painel Administrativo). Só mexe nas diferenças pra não
// perder o created_at das associações que já existiam.
export async function sincronizarGruposDoUsuario(
  usuarioId: string,
  grupoIds: string[],
  grupoIdsAtuais: string[]
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const alvo = new Set(grupoIds)
  const atuais = new Set(grupoIdsAtuais)

  const aAdicionar = grupoIds.filter(id => !atuais.has(id))
  const aRemover = grupoIdsAtuais.filter(id => !alvo.has(id))

  if (aAdicionar.length > 0) {
    const { error } = await supabase
      .from('grupos_permissoes_membros')
      .upsert(
        aAdicionar.map(grupo_id => ({ grupo_id, usuario_id: usuarioId })),
        { onConflict: 'grupo_id,usuario_id' }
      )
    if (error) {
      console.error('Erro ao adicionar usuário aos grupos:', error)
      return false
    }
  }

  if (aRemover.length > 0) {
    const { error } = await supabase
      .from('grupos_permissoes_membros')
      .delete()
      .eq('usuario_id', usuarioId)
      .in('grupo_id', aRemover)
    if (error) {
      console.error('Erro ao remover usuário dos grupos:', error)
      return false
    }
  }

  return true
}

// Sem "aplicar modelo" desde 29/09/2026: os grupos valem ao vivo (a pessoa tem a
// união dos modelos dos grupos dela, calculada pelo banco — permissoes_efetivas,
// 20260929140000). Salvar o modelo com salvarModeloGrupo já muda as telas de
// todos os membros; entrar/sair do grupo, as da pessoa. A regra em TS, para a
// tela de Permissões, está em lib/permissions/resolver.ts (uniaoDosModelos).
