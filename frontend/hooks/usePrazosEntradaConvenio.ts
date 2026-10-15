"use client"

// Prazos das etapas do Painel de Entrada: lê vigentes + histórico pela rota
// /api/indicadores/entrada-convenio/prazos e altera um prazo (só Direção e
// Admin; a rota e o banco conferem). Carrega quando a tela de prazos abre.

import { useCallback, useEffect, useState } from "react"
import type { PrazosResposta } from "@/lib/indicadores/entradaConvenio"

async function lerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function usePrazosEntradaConvenio(ativo: boolean) {
  const [dados, setDados] = useState<PrazosResposta | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch("/api/indicadores/entrada-convenio/prazos/", { cache: "no-store" })
      const corpo = await lerJson(res)
      if (!res.ok || !corpo.ok) throw new Error(String(corpo.mensagem ?? `Falha ao ler os prazos (${res.status}).`))
      setDados(corpo as unknown as PrazosResposta)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (ativo) void carregar()
  }, [ativo, carregar])

  const alterar = useCallback(
    async (etapa: string, prazo: number, motivo: string): Promise<{ ok: boolean; mensagem: string }> => {
      setSalvando(true)
      try {
        const res = await fetch("/api/indicadores/entrada-convenio/prazos/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ etapa, prazo, motivo }),
        })
        const corpo = await lerJson(res)
        if (!res.ok || !corpo.ok) return { ok: false, mensagem: String(corpo.mensagem ?? `Falha (${res.status}).`) }
        await carregar()
        const r = (corpo.resultado ?? {}) as { resumo?: string }
        return { ok: true, mensagem: r.resumo ? `Prazo alterado. ${r.resumo}` : "Prazo alterado." }
      } catch (e) {
        return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
      } finally {
        setSalvando(false)
      }
    },
    [carregar],
  )

  return { dados, loading, erro, salvando, recarregar: carregar, alterar }
}
