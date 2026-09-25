'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { diasUteisDe } from '@/components/auditoria-assim/reconciliacao/datas'
import {
  idDaSessao,
  type SessaoConferencia,
} from '@/components/conferencia-guias/folhas'
import { listarConferenciaDia, listarFaltasDia } from '@/services/conferencia-guias.service'

/**
 * As sessões das semanas da Conferência de Guias (hoje a tela pede uma).
 *
 * Uma chamada por dia: uma semana inteira passa das 1.000 linhas que o
 * PostgREST devolve por resposta, e o corte seria calado. Em lotes de uma
 * semana (5 em paralelo), nunca mais que isso de uma vez: o pool do
 * PostgREST é de 10 conexões, e 10 RPCs pesadas simultâneas o esgotam para o
 * sistema todo (o 504 geral de 24/08).
 *
 * Sem Realtime de propósito — o Realtime já é ~1/4 do orçamento de Disk IO do
 * projeto. A tela recarrega quando a aba volta a ter foco (a Silvana sai para
 * falar com a recepção e volta) e depois de cada gravação que precise.
 */
export function useConferenciaGuias(segundas: string[]) {
  // Texto, e não o array, como dependência: o chamador cria um array novo a
  // cada render e isso recarregaria a tela em laço.
  const chaveSemanas = segundas.join(',')
  const [sessoes, setSessoesEstado] = useState<SessaoConferencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const geracao = useRef(0)

  // Espelho síncrono do estado: o instantâneo para desfazer um otimismo tem de
  // ser o de AGORA, não o do objeto que a linha tinha quando foi clicada.
  const atual = useRef<SessaoConferencia[]>([])
  const setSessoes = useCallback((lista: SessaoConferencia[]) => {
    atual.current = lista
    setSessoesEstado(lista)
  }, [])

  // Escritas em voo e mudanças locais. Uma recarga que leu o banco antes de
  // uma gravação commitar traria a linha de volta a "pendente": ela é
  // descartada e refeita depois que a última escrita termina.
  const emVoo = useRef(0)
  const versaoLocal = useRef(0)
  const recargaAdiada = useRef(false)
  const refCarregar = useRef<(silencioso?: boolean) => Promise<void>>(async () => {})
  /** De que semanas são as sessões em `atual`. */
  const naTela = useRef<string | null>(null)

  const carregar = useCallback(
    async (silencioso = false) => {
      const minha = ++geracao.current
      const versao = versaoLocal.current
      if (!silencioso) setCarregando(true)
      // Outra semana: a anterior sai da tela já, senão as folhas dela ficam
      // sob o rótulo da nova até a resposta chegar (e dá para marcá-las).
      if (naTela.current !== chaveSemanas) {
        naTela.current = chaveSemanas
        setSessoes([])
      }
      setErro(null)
      try {
        const todas: SessaoConferencia[] = []
        for (const segunda of chaveSemanas.split(',')) {
          const dias = await Promise.all(diasUteisDe(segunda).map((d) => listarConferenciaDia(d)))
          if (minha !== geracao.current) return
          // As faltas ocupam linha no papel. Depois das sessões, e não junto,
          // para nunca passar de 5 RPCs ao mesmo tempo.
          const faltas = await Promise.all(diasUteisDe(segunda).map((d) => listarFaltasDia(d)))
          if (minha !== geracao.current) return
          todas.push(...dias.flat(), ...faltas.flat())
        }
        if (emVoo.current > 0) {
          recargaAdiada.current = true
          return
        }
        if (versao !== versaoLocal.current) {
          // Uma escrita começou e terminou durante a leitura: não dá para saber
          // se a leitura já a via. Lê de novo.
          void refCarregar.current(true)
          return
        }
        setSessoes(todas)
      } catch (e) {
        if (minha !== geracao.current) return
        const msg = (e as { message?: string; code?: string })?.code === '42501'
          ? 'Seu usuário não tem permissão para a Conferência de Guias.'
          : 'Não foi possível carregar a semana. Tente de novo.'
        setErro(msg)
        if (!silencioso) setSessoes([])
      } finally {
        if (minha === geracao.current) setCarregando(false)
      }
    },
    [chaveSemanas, setSessoes]
  )
  useEffect(() => {
    refCarregar.current = carregar
  }, [carregar])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    function aoFocar() {
      if (document.visibilityState === 'visible') void carregar(true)
    }
    document.addEventListener('visibilitychange', aoFocar)
    return () => document.removeEventListener('visibilitychange', aoFocar)
  }, [carregar])

  /**
   * Atualização otimista de um conjunto de sessões, por identidade. Devolve
   * como elas estavam ANTES — o que `restaurar` recebe se a gravação falhar.
   */
  const aplicarLocal = useCallback(
    (ids: Set<string>, patch: Partial<SessaoConferencia>): SessaoConferencia[] => {
      versaoLocal.current++
      const antes = atual.current.filter((s) => ids.has(idDaSessao(s)))
      setSessoes(atual.current.map((s) => (ids.has(idDaSessao(s)) ? { ...s, ...patch } : s)))
      return antes
    },
    [setSessoes]
  )

  /** Desfaz um otimismo que falhou, com o instantâneo de `aplicarLocal`. */
  const restaurar = useCallback(
    (anteriores: SessaoConferencia[]) => {
      versaoLocal.current++
      const porId = new Map(anteriores.map((s) => [idDaSessao(s), s]))
      setSessoes(atual.current.map((s) => porId.get(idDaSessao(s)) ?? s))
    },
    [setSessoes]
  )

  /** Toda gravação passa por aqui, para a recarga saber que há uma em voo. */
  const escrever = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    emVoo.current++
    versaoLocal.current++
    try {
      return await fn()
    } finally {
      emVoo.current--
      if (emVoo.current === 0 && recargaAdiada.current) {
        recargaAdiada.current = false
        void refCarregar.current(true)
      }
    }
  }, [])

  return { sessoes, carregando, erro, recarregar: carregar, aplicarLocal, restaurar, escrever }
}
