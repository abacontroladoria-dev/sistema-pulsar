import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"

// Execuções da rotina diária "Carregar o Pulsar segundo o TiTa" (04:00).
// Ver supabase/migrations/20261016170000_carga_tita_rotina_diaria.sql e
// services/tita/cargaTita.server.ts. Leitura com a permissão carregar_tita.

export type EtapaCargaTita = {
  etapa: "pacientes" | "profissionais" | "disponibilidade" | "agenda"
  situacao: "sucesso" | "erro" | "pulada"
  resumo: string[]
  aviso?: string
  erro?: string
  importacao_id?: string
}

export type CargaTita = {
  id: string
  origem: "cron" | "manual"
  situacao: "rodando" | "sucesso" | "parcial" | "erro"
  etapas: EtapaCargaTita[]
  erro_mensagem: string | null
  iniciado_em: string
  finalizado_em: string | null
}

/** Últimas cargas (a mais recente primeiro). null = migration ainda não aplicada. */
export async function listarCargasTita(limite = 7): Promise<CargaTita[] | null> {
  const { data, error } = await getSupabaseClient()
    .from("tita_cargas")
    .select("id, origem, situacao, etapas, erro_mensagem, iniciado_em, finalizado_em")
    .order("iniciado_em", { ascending: false })
    .limit(limite)
  if (error) {
    if (ehMigrationPendente(error)) return null
    throw new Error(error.message)
  }
  return (data ?? []) as CargaTita[]
}
