'use client'

import { useEffect, useState } from 'react'

// ============================================================================
// Quantas menções a mim ainda não foram lidas — o número do item "Menções a
// mim" no menu do Connect.
//
// Polling de 30s só com a aba visível, o mesmo arranjo do contador da fila de
// autorizações no menu do Pulsar: menção não é pregão, e cada aba aberta é uma
// consulta a mais no pool do banco.
//
// Quem muda o estado (abrir a conversa, marcar lida/não lida) chama
// `avisarMencoesAlteradas()` e o número se acerta na hora, sem esperar o tique.
// ============================================================================

const INTERVALO_MS = 30_000
const EVENTO = 'mencoes:alteradas'

export function avisarMencoesAlteradas(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO))
}

export function useMencoesNaoLidas(): number {
  const [naoLidas, setNaoLidas] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    const contar = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        // Barra final: trailingSlash:true responde 308 sem ela.
        const res = await fetch('/api/central/mencoes/contagem/', { signal: controller.signal, cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json().catch(() => null)
        const n = json?.data?.naoLidas
        if (typeof n === 'number') setNaoLidas(n)
      } catch {
        // Rede, sem acesso à Central: o número só não aparece.
      }
    }

    contar()
    const t = setInterval(contar, INTERVALO_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') contar() }
    window.addEventListener(EVENTO, contar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      controller.abort()
      clearInterval(t)
      window.removeEventListener(EVENTO, contar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  return naoLidas
}
