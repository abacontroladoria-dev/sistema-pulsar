"use client"

import { useEffect, useState } from "react"
import { buscarLinhasPacientesPeriodo } from "@/services/salas.service"
import type { AgendaSalaRow } from "@/lib/cronograma/salasTypes"

/**
 * Sessões agendadas de um período, para o Dashboard de Pacientes.
 *
 * Substitui `useOcupacaoSalas()` nesta aba: aquele hook também busca salas,
 * alocações, bloqueios e exclusividades, que o dashboard não lê — custo
 * aceitável numa semana, desperdício num mês inteiro.
 *
 * Cache em memória por período (CACHE_MS): alternar entre dois meses já vistos
 * não refaz a paginação. A grade muda no máximo uma vez por dia (crons de
 * madrugada), então 10 minutos não esconde nada que importe.
 */

const CACHE_MS = 10 * 60 * 1000
const VAZIO: AgendaSalaRow[] = []
const cache = new Map<string, { em: number; promessa: Promise<AgendaSalaRow[]> }>()

function carregar(inicio: string, fim: string): Promise<AgendaSalaRow[]> {
  const chave = `${inicio}|${fim}`
  const hit = cache.get(chave)
  if (hit && Date.now() - hit.em < CACHE_MS) return hit.promessa
  const promessa = buscarLinhasPacientesPeriodo(inicio, fim)
  cache.set(chave, { em: Date.now(), promessa })
  // Falha não fica guardada: a próxima tentativa busca de novo.
  promessa.catch(() => { if (cache.get(chave)?.promessa === promessa) cache.delete(chave) })
  return promessa
}

export function usePacientesPeriodo(inicio: string, fim: string) {
  const [estado, setEstado] = useState<{ chave: string; linhas: AgendaSalaRow[]; error: string | null } | null>(null)
  const chave = `${inicio}|${fim}`

  useEffect(() => {
    let cancelado = false
    carregar(inicio, fim)
      .then(linhas => { if (!cancelado) setEstado({ chave: `${inicio}|${fim}`, linhas, error: null }) })
      .catch(err => { if (!cancelado) setEstado({ chave: `${inicio}|${fim}`, linhas: [], error: String(err?.message ?? err) }) })
    return () => { cancelado = true }
  }, [inicio, fim])

  // Enquanto o período novo carrega, nada do anterior é mostrado como se fosse dele.
  const atual = estado?.chave === chave ? estado : null
  return {
    linhas: atual?.linhas ?? VAZIO,
    loading: !atual,
    error: atual?.error ?? null,
  }
}
