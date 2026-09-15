'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Caixa } from '@/modules/atendimento/agente/caixas'
import type { Contact, Conversation } from '@/modules/atendimento/types/central.types'
import { toUIConversation, type NinaConversation } from '@/components/nina/adapters/centralToNina'

// ============================================================================
// A triagem do atendimento — quatro caixas e a lista da que está aberta.
//
// Toda a classificação acontece no SERVIDOR (/api/central/conversations/caixas).
// Este hook não decide caixa nenhuma, e isso é deliberado: a caixa depende do
// ai_mode EFETIVO, que mistura a coluna da conversa com o padrão da clínica, e
// o cliente não tem o segundo. Um filtro aqui marcaria como "Humano" justamente
// as conversas que a Maia atende por herança.
// ============================================================================

const INTERVALO_MS  = 8_000
const TETO_CONTATOS = 200

export interface Contagens {
  maia:       number
  humano:     number
  ninguem:    number
  encerradas: number
}

const CONTAGENS_ZERADAS: Contagens = { maia: 0, humano: 0, ninguem: 0, encerradas: 0 }

interface RespostaCaixas {
  conversas:  Conversation[]
  caixa:      Caixa
  modoPadrao: string
  contagens:  Contagens
  total:      number
}

export interface UseCaixasAtendimento {
  caixa:         Caixa
  abrirCaixa:    (c: Caixa) => void
  conversas:     NinaConversation[]
  contagens:     Contagens
  // O padrão da clínica. A tela avisa quando ele está 'off' — senão a caixa
  // "Maia" vazia parece falta de movimento, quando é a IA desligada.
  modoPadrao:    string
  // Conversas escaladas pela Maia que ninguém assumiu (priority 'high'). Não é
  // caixa própria: é um marcador dentro de "ninguém".
  urgentes:      Set<string>
  loading:       boolean
  erro:          string | null
}

export function useCaixasAtendimento(): UseCaixasAtendimento {
  const [caixa, setCaixa]         = useState<Caixa>('ninguem')
  const [conversas, setConversas] = useState<NinaConversation[]>([])
  const [contagens, setContagens] = useState<Contagens>(CONTAGENS_ZERADAS)
  const [modoPadrao, setModoPadrao] = useState<string>('off')
  const [urgentes, setUrgentes]   = useState<Set<string>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [erro, setErro]           = useState<string | null>(null)

  // Só a primeira carga de CADA caixa acende o loading. O polling é silencioso:
  // piscar a lista a cada 8s a tornaria inutilizável para quem está lendo.
  const primeiraCarga = useRef(true)

  const abrirCaixa = useCallback((c: Caixa) => {
    if (c === caixa) return
    primeiraCarga.current = true
    setLoading(true)
    setCaixa(c)
  }, [caixa])

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      try {
        const [resp, respContatos] = await Promise.all([
          fetch(`/api/central/conversations/caixas?caixa=${caixa}&limit=50`,
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

        // Mensagens vazias: a triagem mostra só o cabeçalho, igual à lista do
        // inbox. O histórico é do chat, que abre quando alguém clica.
        setConversas(corpo.conversas.map(c =>
          toUIConversation(c, porId.get(c.contact_id) ?? null, [])))

        setContagens(corpo.contagens ?? CONTAGENS_ZERADAS)
        setModoPadrao(corpo.modoPadrao ?? 'off')
        setUrgentes(new Set(
          corpo.conversas.filter(c => c.priority === 'high').map(c => c.id)))
        setErro(null)
      } catch (e) {
        if (!vivo || (e as Error).name === 'AbortError') return
        // A lista antiga permanece: esvaziá-la por um poll falho é pior que
        // mostrá-la um pouco desatualizada.
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
  }, [caixa])

  return { caixa, abrirCaixa, conversas, contagens, modoPadrao, urgentes, loading, erro }
}
