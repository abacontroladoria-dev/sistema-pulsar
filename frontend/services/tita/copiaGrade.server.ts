import "server-only"

// Pede ao sync (Edge Function sync-grade-csv, modo "grade") uma leitura nova da
// grade do TiTa para o período. SÓ LEITURA do TiTa: o sync grava a cópia local
// e carimba cada dia em grade_sync_dia. A Edge Function exige a chave de
// serviço — por isso só roda no servidor. Quem chama confere a permissão.
//
// A primeira fatia responde em até ~30 s e encadeia as seguintes; se a
// resposta demorar mais, o pedido já foi feito (acompanha-se pelos carimbos).

export async function pedirCopiaGradeTita(de: string, ate: string): Promise<{ ok: true } | { ok: false; mensagem: string }> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return { ok: false, mensagem: "Servidor sem a configuração do Supabase." }

  try {
    const r = await fetch(`${url}/functions/v1/sync-grade-csv`, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "grade", data_inicio: de, data_fim: ate }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) {
      console.error("[copia-grade-tita] sync respondeu", r.status, (await r.text()).slice(0, 300))
      return { ok: false, mensagem: "O sync do TiTa recusou o pedido. Tente de novo em alguns minutos." }
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "TimeoutError")) {
      console.error("[copia-grade-tita]", e)
      return { ok: false, mensagem: "Não foi possível falar com o sync do TiTa." }
    }
  }
  return { ok: true }
}
