import type { SupabaseClient } from '@supabase/supabase-js'

// Telas efetivas de um usuário, calculadas pelo banco (permissoes_efetivas(),
// migration 20260929140000): união dos modelos dos grupos + ajustes
// individuais. Um lugar só para o proxy, o menu, o useTemPermissao e as rotas de
// API — e a mesma regra que as policies aplicam em usuario_tem_permissao(), então
// tela e dado nunca discordam.
//
// Por RPC, e não lendo as tabelas: grupos_permissoes e os membros só são
// legíveis por admin/diretoria (RLS), e o cálculo precisa deles para todo mundo.
//
// Serve a qualquer client (browser, middleware, route handler): quem chama passa
// o seu. Sem `usuarioId`, calcula o próprio usuário da sessão; o de outra pessoa
// o banco só devolve para admin/diretoria (o "Visualizar como").
export async function carregarPermissoesEfetivas(
  supabase: SupabaseClient,
  usuarioId?: string
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc(
    'permissoes_efetivas',
    usuarioId ? { p_usuario_id: usuarioId } : {}
  )
  if (error) {
    console.error('Erro ao carregar permissões efetivas:', error)
    return new Set()
  }
  return new Set((data as string[] | null) ?? [])
}

// Nomes dos grupos de permissão da pessoa (grupos_do_usuario(), migration
// 20260929150000) — o que as telas mostram onde antes mostravam o nível técnico.
// `null` = não deu para ler (função ainda não aplicada, rede): quem mostra deixa
// o rótulo vazio, e nunca volta a mostrar o nível no lugar.
export async function carregarGruposDoUsuario(
  supabase: SupabaseClient,
  usuarioId?: string
): Promise<string[] | null> {
  const { data, error } = await supabase.rpc(
    'grupos_do_usuario',
    usuarioId ? { p_usuario_id: usuarioId } : {}
  )
  if (error) return null
  return (data as string[] | null) ?? []
}

/** "Recepção, Suprimentos" · "Sem grupo" · `null` quando não foi possível ler. */
export function rotuloDosGrupos(grupos: string[] | null): string | null {
  if (grupos === null) return null
  return grupos.length > 0 ? grupos.join(', ') : 'Sem grupo'
}
