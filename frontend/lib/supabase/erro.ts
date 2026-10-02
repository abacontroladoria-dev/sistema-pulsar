/**
 * Tornar legível um erro do PostgREST.
 *
 * POR QUE ISTO EXISTE
 * `console.error('falhou:', error)` num erro do supabase-js imprime **`{}`** — as
 * propriedades de `PostgrestError` não sobrevivem à serialização que o console do
 * navegador (e o overlay de erro do Next) aplica. O resultado é que a mensagem
 * mais útil possível some justamente na hora em que se precisa dela: já aconteceu
 * de um `column ... does not exist` (código 42703, migration não aplicada) chegar
 * ao console como um par de chaves vazias.
 *
 * Achatar em string resolve, porque string sempre imprime.
 */
type ErroPostgrest = {
  message?: string
  details?: string | null
  hint?: string | null
  code?: string
}

/**
 * `"42703: column x does not exist | hint: ..."` — o que for conhecido, na ordem
 * em que ajuda a diagnosticar. Nunca devolve string vazia: um erro sem nenhum
 * campo reconhecível vira o seu próprio JSON, e um irreconhecível vira o rótulo
 * genérico — sempre é melhor que `{}`.
 */
export function descreverErro(erro: unknown): string {
  if (!erro) return 'erro desconhecido'
  if (typeof erro === 'string') return erro

  const e = erro as ErroPostgrest
  const partes = [
    e.code ? `${e.code}:` : null,
    e.message || null,
    e.details ? `| details: ${e.details}` : null,
    e.hint ? `| hint: ${e.hint}` : null,
  ].filter(Boolean)

  if (partes.length) return partes.join(' ')

  // Nem PostgrestError nem Error: ao menos mostra a forma do que chegou.
  if (erro instanceof Error) return erro.message || erro.name
  try {
    const json = JSON.stringify(erro)
    return json && json !== '{}' ? json : 'erro sem mensagem (resposta vazia do PostgREST)'
  } catch {
    return 'erro nao serializavel'
  }
}

/**
 * `true` quando o erro é "coluna/tabela/função não existe" — o sintoma de
 * migration pendente.
 *
 * 42703 = undefined_column, 42P01 = undefined_table, 42883 = undefined_function.
 * O PostgREST responde antes do banco quando o próprio cache dele não conhece o
 * objeto: PGRST204 = coluna, PGRST202 = função, PGRST205 = tabela/view.
 * Vale a checagem porque a ação é completamente diferente das outras falhas: não é
 * bug de código nem permissão, é SQL que não rodou naquele ambiente
 * (reference_db_push_blast_radius).
 */
const CODIGOS_MIGRATION_PENDENTE = new Set(['42703', '42P01', '42883', 'PGRST204', 'PGRST202', 'PGRST205'])

export function ehMigrationPendente(erro: unknown): boolean {
  const code = (erro as ErroPostgrest | null)?.code
  return !!code && CODIGOS_MIGRATION_PENDENTE.has(code)
}
