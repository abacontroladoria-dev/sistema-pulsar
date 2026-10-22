'use client'

import { useEffect, useState } from 'react'

// Conversas em Aberto (a Maia passou e ninguém da equipe falou), para a
// bolinha do item "Atendimentos" no sidebar do Connect. Poll curto e só com a
// aba visível: é um alarme, mas uma aba esquecida não precisa perguntar.
// Falha mantém o último número — zerar a bolinha por um poll perdido diria
// "nada esperando" sem saber.

const INTERVALO_MS = 15_000

export function useConversasAbertas(): number {
  const [abertas, setAbertas] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      if (document.visibilityState === 'hidden') return
      try {
        const resp = await fetch('/api/central/conversations/contagem', { signal: controller.signal })
        if (!resp.ok) return
        const n = (await resp.json())?.data?.abertas
        if (vivo && typeof n === 'number') setAbertas(n)
      } catch {
        // Silencioso: ver acima.
      }
    }

    carregar()
    const t = setInterval(carregar, INTERVALO_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      controller.abort()
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  return abertas
}
