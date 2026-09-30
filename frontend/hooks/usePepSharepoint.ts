'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { listarItensDoPrestador } from '@/services/roboSharepoint.service'
import type { SpItem } from '@/types/roboSharepoint'

/**
 * Sugestões do robô SharePoint para o analista e o mês abertos na tela PEP.
 * Chegam ao vivo: quando o robô grava uma sugestão (ou alguém confirma em
 * outra aba), o Realtime avisa e a lista recarrega — sem recarregar a página.
 * Uma consulta pequena (um prestador, um mês), com índice próprio.
 */
export function usePepSharepoint(prestadorNome: string, competencia: string) {
  const [itens, setItens] = useState<SpItem[]>([])
  const [carregando, setCarregando] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const carregar = useCallback(async () => {
    if (!prestadorNome || !competencia) { setItens([]); return }
    setCarregando(true)
    try {
      setItens(await listarItensDoPrestador(prestadorNome, competencia))
    } catch {
      // Tabela ainda não aplicada neste ambiente, ou sem permissão: a tela PEP
      // funciona igual sem o robô — só não mostra sugestões.
      setItens([])
    } finally {
      setCarregando(false)
    }
  }, [prestadorNome, competencia])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!prestadorNome) return
    const supabase = getSupabaseClient()
    const canal = supabase
      .channel(`pep-sharepoint-${prestadorNome}-${competencia}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sp_pep_itens' }, () => {
        if (debounce.current) clearTimeout(debounce.current)
        debounce.current = setTimeout(carregar, 300)
      })
      .subscribe()
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      supabase.removeChannel(canal)
    }
  }, [prestadorNome, competencia, carregar])

  return { itens, carregando, recarregar: carregar }
}
