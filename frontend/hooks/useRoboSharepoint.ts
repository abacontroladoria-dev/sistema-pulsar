'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import {
  listarExecucoes,
  listarItensNaoReconhecidos,
  listarPendenciasDePasta,
  obterSaude,
} from '@/services/roboSharepoint.service'
import type { RoboExecucao, RoboSaude, SpFilaPendencias, SpItem } from '@/types/roboSharepoint'

const DEBOUNCE_MS = 250

/**
 * Estado do painel do robô. As execuções chegam AO VIVO (Realtime em
 * sp_pep_execucoes): cada etapa que o robô registra aparece sem recarregar.
 * A saúde do container (de pé? próxima execução?) vem da rota do servidor,
 * que pergunta ao próprio robô — não ao banco — a cada minuto.
 */
export function useRoboSharepoint() {
  const [execucoes, setExecucoes] = useState<RoboExecucao[]>([])
  const [pendencias, setPendencias] = useState<SpFilaPendencias>({ semPlanilha: [], pastas: [] })
  const [itensPresos, setItensPresos] = useState<SpItem[]>([])
  const [saude, setSaude] = useState<RoboSaude | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimoStatusRef = useRef<string | null>(null)

  const carregarPendencias = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([listarPendenciasDePasta(), listarItensNaoReconhecidos()])
      setPendencias(p)
      setItensPresos(i)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar pendências')
    }
  }, [])

  const carregarExecucoes = useCallback(async () => {
    try {
      const lista = await listarExecucoes(30)
      setExecucoes(lista)
      // Execução que acabou de terminar mudou a fila de pendências.
      const status = lista[0] ? `${lista[0].id}:${lista[0].status}` : null
      if (ultimoStatusRef.current && status !== ultimoStatusRef.current && lista[0]?.status !== 'executando') {
        carregarPendencias()
      }
      ultimoStatusRef.current = status
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar execuções')
    }
  }, [carregarPendencias])

  const carregarSaude = useCallback(async () => {
    try {
      setSaude(await obterSaude())
    } catch {
      setSaude({ configurado: true, online: false })
    }
  }, [])

  const recarregar = useCallback(async () => {
    await Promise.all([carregarExecucoes(), carregarPendencias(), carregarSaude()])
    setCarregando(false)
  }, [carregarExecucoes, carregarPendencias, carregarSaude])

  // Primeira carga fora do corpo síncrono do efeito (a regra
  // react-hooks/set-state-in-effect recusa setState direto aqui).
  useEffect(() => {
    const id = setTimeout(() => { void recarregar() }, 0)
    return () => clearTimeout(id)
  }, [recarregar])

  useEffect(() => {
    const supabase = getSupabaseClient()
    const canal = supabase
      .channel('robo-sharepoint-execucoes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sp_pep_execucoes' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(carregarExecucoes, DEBOUNCE_MS)
      })
      .subscribe()
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(canal)
    }
  }, [carregarExecucoes])

  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') carregarSaude() }, 60000)
    return () => clearInterval(id)
  }, [carregarSaude])

  return { execucoes, pendencias, itensPresos, saude, carregando, erro, recarregar, carregarPendencias, carregarSaude }
}
