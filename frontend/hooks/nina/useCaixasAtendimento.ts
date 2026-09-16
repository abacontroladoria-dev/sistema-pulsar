'use client'

import { useEffect, useRef, useState } from 'react'
import { CAIXAS, type Caixa } from '@/modules/atendimento/agente/caixas'
import type { Contact, Conversation } from '@/modules/atendimento/types/central.types'
import { toUIConversation, type NinaConversation } from '@/components/nina/adapters/centralToNina'

// ============================================================================
// A triagem do atendimento — as quatro filas, lado a lado.
//
// Toda a classificação acontece no SERVIDOR (/api/central/conversations/caixas).
// Este hook não decide caixa nenhuma, e isso é deliberado: a caixa depende do
// ai_mode EFETIVO, que mistura a coluna da conversa com o padrão da clínica, e
// o cliente não tem o segundo. Um filtro aqui marcaria como "Humano" justamente
// as conversas que a Maia atende por herança.
//
// A ordem das filas também vem do servidor (ORDER BY), não de um sort aqui: com
// a lista cortada em `limit`, ordenar no cliente reordenaria só a fatia que
// chegou, e o topo da coluna deixaria de ser quem espera há mais tempo na org
// para ser quem espera há mais tempo entre os 50 que vieram.
// ============================================================================

const INTERVALO_MS  = 8_000
const TETO_CONTATOS = 200
const POR_COLUNA    = 50

export interface Fila {
  conversas: NinaConversation[]
  // A contagem REAL da caixa, que pode passar de `conversas.length` quando a
  // fila é maior que o teto por coluna. É este número que o cabeçalho mostra.
  total:     number
  // Escaladas pela Maia que ninguém assumiu (priority 'high'), por id.
  urgentes:  Set<string>
}

export type Filas = Record<Caixa, Fila>

const FILA_VAZIA: Fila = { conversas: [], total: 0, urgentes: new Set() }

const FILAS_VAZIAS: Filas = {
  maia: FILA_VAZIA, humano: FILA_VAZIA, ninguem: FILA_VAZIA, encerradas: FILA_VAZIA,
}

interface RespostaCaixas {
  caixas:     Record<Caixa, { conversas: Conversation[]; total: number }>
  modoPadrao: string
  limit:      number
}

export interface UseCaixasAtendimento {
  filas:      Filas
  // O padrão da clínica. A tela avisa quando ele está 'off' — senão a coluna
  // "Maia" vazia parece falta de movimento, quando é a IA desligada.
  modoPadrao: string
  limitePorColuna: number
  loading:    boolean
  erro:       string | null
}

export function useCaixasAtendimento(): UseCaixasAtendimento {
  const [filas, setFilas]           = useState<Filas>(FILAS_VAZIAS)
  const [modoPadrao, setModoPadrao] = useState<string>('off')
  const [loading, setLoading]       = useState(true)
  const [erro, setErro]             = useState<string | null>(null)

  // Só a primeira carga acende o loading. O polling é silencioso: piscar as
  // quatro colunas a cada 8s tornaria a tela inutilizável para quem está lendo.
  const primeiraCarga = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      try {
        const [resp, respContatos] = await Promise.all([
          fetch(`/api/central/conversations/caixas?limit=${POR_COLUNA}`,
                { signal: controller.signal }),
          fetch(`/api/central/contacts?limit=${TETO_CONTATOS}`,
                { signal: controller.signal }),
        ])

        if (!resp.ok) throw new Error(`Falha ao carregar a triagem (${resp.status})`)

        const corpo = (await resp.json())?.data as RespostaCaixas
        const contatos = respContatos.ok
          ? ((await respContatos.json())?.data as Contact[] ?? [])
          : []

        if (!vivo) return

        const porId = new Map(contatos.map(c => [c.id, c]))

        const montadas = {} as Filas
        for (const caixa of CAIXAS) {
          const bruta = corpo.caixas?.[caixa]
          const cruas = bruta?.conversas ?? []

          montadas[caixa] = {
            // Mensagens vazias: a triagem mostra só o cabeçalho de cada conversa.
            // O histórico é do chat, que abre quando alguém clica.
            conversas: cruas.map(c =>
              toUIConversation(c, porId.get(c.contact_id) ?? null, [])),
            total: bruta?.total ?? 0,
            // Lê `priority` do CRU, nunca do convertido. NinaConversation não tem
            // o campo — o adapter não o carrega — então tirar esta linha de dentro
            // do laço sobre `cruas` faria o selo "escalada pela Maia" sumir em
            // silêncio, sem erro de tipo, porque a origem passaria a ser um objeto
            // onde `priority` é undefined.
            urgentes: new Set(cruas.filter(c => c.priority === 'high').map(c => c.id)),
          }
        }

        setFilas(montadas)
        setModoPadrao(corpo.modoPadrao ?? 'off')
        setErro(null)
      } catch (e) {
        if (!vivo || (e as Error).name === 'AbortError') return
        // As listas antigas permanecem: esvaziá-las por um poll falho é pior que
        // mostrá-las um pouco desatualizadas.
        setErro((e as Error).message || 'Não foi possível carregar a triagem')
      } finally {
        if (vivo && primeiraCarga.current) {
          primeiraCarga.current = false
          setLoading(false)
        }
      }
    }

    carregar()
    const t = setInterval(carregar, INTERVALO_MS)
    return () => { vivo = false; controller.abort(); clearInterval(t) }
  }, [])

  return { filas, modoPadrao, limitePorColuna: POR_COLUNA, loading, erro }
}
