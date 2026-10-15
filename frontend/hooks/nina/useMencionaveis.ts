'use client'

import { useEffect, useState } from 'react'
import type { PessoaMencionavel } from '@/components/nina/Compositor'

// ============================================================================
// Quem pode ser @mencionado na nota interna da conversa aberta.
//
// Por conversa, e não a lista de usuários do painel: só entra quem enxerga a
// caixa (número) desta conversa — admin/director ou membro dela. É o mesmo
// recorte que a RLS usa para mostrar a nota, e o POST confere de novo.
//
// Uma vez por conversa, sem polling: quem tem acesso a um número muda quando o
// administrador mexe na configuração, não a cada 5s.
// ============================================================================

export function useMencionaveis(conversationId: string | null): PessoaMencionavel[] {
  const [lista, setLista] = useState<{ de: string | null; pessoas: PessoaMencionavel[] }>({ de: null, pessoas: [] })

  useEffect(() => {
    if (!conversationId) return
    const controller = new AbortController()
    fetch(`/api/central/conversations/${conversationId}/mencionaveis/`, { signal: controller.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const pessoas = Array.isArray(j?.data)
          ? (j.data as { id: string; nome: string }[]).map(u => ({ id: u.id, nome: u.nome }))
          : []
        setLista({ de: conversationId, pessoas })
      })
      // Sem a lista, o "@" só não abre sugestões; a nota ainda grava.
      .catch(() => {})
    return () => controller.abort()
  }, [conversationId])

  // A lista de outra conversa não vale para esta.
  return lista.de === conversationId ? lista.pessoas : []
}
