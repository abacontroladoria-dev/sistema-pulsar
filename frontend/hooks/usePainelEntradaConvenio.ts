"use client"

// Lê o Painel de Entrada de Pacientes de Convênio pela rota
// /api/indicadores/entrada-convenio (a checagem de permissão é lá) e expõe o
// "Atualizar agora" de admin/diretoria.

import { useCallback, useEffect, useState } from "react"
import type { PainelEntradaResposta } from "@/lib/indicadores/entradaConvenio"

type Estado = {
  loading: boolean
  erro: string | null
  /** false = migration ainda não aplicada no banco. */
  instalado: boolean
  podeAtualizar: boolean
  painel: PainelEntradaResposta | null
}

const INICIAL: Estado = { loading: true, erro: null, instalado: true, podeAtualizar: false, painel: null }

async function lerJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function usePainelEntradaConvenio() {
  const [estado, setEstado] = useState<Estado>(INICIAL)
  const [atualizando, setAtualizando] = useState(false)

  const carregar = useCallback(async () => {
    setEstado(e => ({ ...e, loading: true, erro: null }))
    try {
      const res = await fetch("/api/indicadores/entrada-convenio/", { cache: "no-store" })
      const corpo = await lerJson(res)
      if (!res.ok || !corpo.ok) {
        throw new Error(String(corpo.mensagem ?? `Falha ao ler o painel (${res.status}).`))
      }
      setEstado({
        loading: false,
        erro: null,
        instalado: corpo.instalado !== false,
        podeAtualizar: corpo.podeAtualizar === true,
        painel: (corpo.painel ?? null) as PainelEntradaResposta | null,
      })
    } catch (e) {
      setEstado(s => ({ ...s, loading: false, erro: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  /** Copia o Doc agora. Devolve o status da Edge Function para o aviso. */
  const atualizar = useCallback(async (): Promise<{ ok: boolean; mensagem: string }> => {
    setAtualizando(true)
    try {
      const res = await fetch("/api/indicadores/entrada-convenio/atualizar/", { method: "POST" })
      const corpo = await lerJson(res)
      if (!res.ok || !corpo.ok) return { ok: false, mensagem: String(corpo.mensagem ?? `Falha (${res.status}).`) }
      const r = (corpo.resultado ?? {}) as { status?: string; erro?: string; motivo?: string }
      await carregar()
      if (r.status === "novo") return { ok: true, mensagem: "Painel atualizado com a rodada nova." }
      if (r.status === "sem_mudanca") return { ok: true, mensagem: "O Doc não mudou desde a última leitura." }
      if (r.status === "ignorado") return { ok: false, mensagem: r.motivo ?? "Leitura ignorada." }
      return { ok: false, mensagem: r.erro ?? "A leitura do Doc falhou." }
    } catch (e) {
      return { ok: false, mensagem: e instanceof Error ? e.message : String(e) }
    } finally {
      setAtualizando(false)
    }
  }, [carregar])

  return { ...estado, atualizando, recarregar: carregar, atualizar }
}
