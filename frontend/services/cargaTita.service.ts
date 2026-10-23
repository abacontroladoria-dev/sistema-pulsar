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
  fora?: boolean
}

/** Releitura ao vivo do TiTa na etapa Agendamentos. */
export type ProgressoReleitura = {
  inicio: string
  fim: string
  total: number
  conferidos: number
  desde: string
  ultimo_avanco_em: string
}

export type CargaTita = {
  id: string
  origem: "cron" | "manual"
  situacao: "rodando" | "sucesso" | "parcial" | "erro" | "parada"
  etapas: EtapaCargaTita[]
  erro_mensagem: string | null
  iniciado_em: string
  finalizado_em: string | null
  // Colunas de acompanhamento (20261023180000); ausentes antes da migration.
  passo?: string | null
  progresso?: ProgressoReleitura | null
  atualizado_em?: string | null
  parar_pedido_em?: string | null
  pedida_por_nome?: string | null
}

/** Últimas cargas (a mais recente primeiro). null = migration ainda não aplicada. */
export async function listarCargasTita(limite = 7): Promise<CargaTita[] | null> {
  const { data, error } = await getSupabaseClient()
    .from("tita_cargas")
    .select("*")
    .order("iniciado_em", { ascending: false })
    .limit(limite)
  if (error) {
    if (ehMigrationPendente(error)) return null
    throw new Error(error.message)
  }
  return (data ?? []) as CargaTita[]
}

async function chamar(url: string, corpo: unknown): Promise<{ ok: boolean; status: number; id?: string; mensagem?: string }> {
  let r: Response
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })
  } catch {
    throw new Error("Sem conexão com o servidor. Confira a internet e tente de novo.")
  }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; mensagem?: string; error?: string }
  return { ok: r.ok && !!j.ok, status: r.status, id: j.id, mensagem: j.mensagem ?? j.error }
}

/**
 * Começa a carga no servidor e devolve o id para acompanhar. Se já houver uma
 * rodando, devolve o id dela. `copiaCompleta`: relê ao vivo a janela inteira
 * da agenda (para quando a cópia das 02:00 está velha).
 */
export async function iniciarCargaTita(opcoes: { inicio?: EtapaCargaTita["etapa"]; copiaCompleta?: boolean } = {}): Promise<{ id: string; jaRodando: boolean }> {
  const r = await chamar("/api/tita/carga-manual", opcoes)
  if (r.status === 409 && r.id) return { id: r.id, jaRodando: true }
  if (!r.ok || !r.id) throw new Error(r.mensagem ?? "Não foi possível começar a carga.")
  return { id: r.id, jaRodando: false }
}

export async function pararCargaTita(id: string): Promise<void> {
  const r = await chamar("/api/tita/carga-manual/parar", { id })
  if (!r.ok) throw new Error(r.mensagem ?? "Não foi possível pedir a parada.")
}
