import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"

export type CategoriaRegistro = "paciente" | "profissional" | "convenio" | "terapia"

export type ResultadoRegistro = {
  categoria: CategoriaRegistro
  id: number
  titulo: string
  subtitulo: string | null
  inativo: boolean
}

/** O servidor só busca a partir disto (a função recusa menos). */
export const MIN_LETRAS_REGISTROS = 3

/**
 * Pacientes, profissionais, convênios e terapias pelo nome — RPC busca_mestre.
 * O banco já devolve SÓ as categorias que a pessoa pode ver; nada é filtrado
 * aqui por segurança.
 *
 * Migration ainda não aplicada (o localhost usa o banco de produção): devolve
 * vazio em vez de erro, e a busca continua só com as telas do menu.
 */
export async function buscarRegistros(termo: string): Promise<ResultadoRegistro[]> {
  const { data, error } = await getSupabaseClient().rpc("busca_mestre", { p_termo: termo })
  if (error) {
    if (ehMigrationPendente(error)) return []
    throw new Error(error.message)
  }
  return ((data ?? []) as ResultadoRegistro[]).map((r) => ({ ...r, id: Number(r.id) }))
}
