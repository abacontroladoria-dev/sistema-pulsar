import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"

/**
 * Quando o TiTa foi desligado (null = ainda não). Antes da migration
 * 20261016100000 a função não existe: devolve null (o localhost usa produção).
 */
export async function lerCorteTita(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().rpc("tita_cortado_em")
  if (error) {
    if (ehMigrationPendente(error)) return null
    throw new Error(error.message)
  }
  return (data as string | null) ?? null
}
