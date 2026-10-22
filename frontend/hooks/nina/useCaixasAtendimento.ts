'use client'

import { useEffect, useRef, useState } from 'react'
import type { Contact, Conversation, ConversationStatus } from '@/modules/atendimento/types/central.types'
import { toUIConversation, type NinaConversation } from '@/components/nina/adapters/centralToNina'
import { STATUS_ATENDIMENTO, motivoStatusMaia } from '@/components/nina/StatusAtendimento'

// ============================================================================
// A triagem do atendimento — uma coluna por status, lado a lado.
//
// O agrupamento acontece no SERVIDOR (/api/central/conversations/caixas), que
// devolve cada status com a contagem real e as primeiras conversas. A ordem
// também vem de lá (ORDER BY): com a lista cortada em `limit`, ordenar aqui
// reordenaria só a fatia que chegou.
// ============================================================================

const INTERVALO_MS  = 8_000
const TETO_CONTATOS = 200
const POR_COLUNA    = 50

const COM_RESPONSAVEL: readonly ConversationStatus[] = ['open', 'assigned', 'waiting']

export interface Fila {
  conversas: NinaConversation[]
  // A contagem REAL do status, que pode passar de `conversas.length` quando a
  // fila é maior que o teto por coluna. É este número que o cabeçalho mostra.
  total:     number
  // Escaladas pela Maia (priority 'high'), por id.
  urgentes:  Set<string>
  // Por que a Maia pôs a conversa neste status, por id — só quando a última
  // palavra foi dela (motivoStatusMaia).
  motivos:   Map<string, string>
  // Nome de quem está com a conversa, por id. Só nas colunas vivas com gente
  // (COM_RESPONSAVEL): na encerrada, o nome sozinho não diz se foi a pessoa
  // ou a Maia quem encerrou.
  responsaveis: Map<string, string>
}

export type Filas = Record<ConversationStatus, Fila>

const filasVazias = (): Filas => Object.fromEntries(
  STATUS_ATENDIMENTO.map(s => [s.valor, { conversas: [], total: 0, urgentes: new Set(), motivos: new Map(), responsaveis: new Map() }]),
) as unknown as Filas

interface RespostaCaixas {
  colunas:    Record<ConversationStatus, { conversas: Conversation[]; total: number }>
  responsaveis?: Record<string, string>
  modoPadrao: string
  inboxesMaiaResponde?: string[]
  limit:      number
}

export interface UseCaixasAtendimento {
  filas:      Filas
  // O padrão da clínica. A tela avisa quando ele está 'off' — senão a coluna
  // Autoatendimento vazia parece falta de movimento, quando é a IA desligada.
  modoPadrao: string
  limitePorColuna: number
  loading:    boolean
  erro:       string | null
}

export function useCaixasAtendimento(): UseCaixasAtendimento {
  const [filas, setFilas]           = useState<Filas>(filasVazias)
  const [modoPadrao, setModoPadrao] = useState<string>('off')
  const [loading, setLoading]       = useState(true)
  const [erro, setErro]             = useState<string | null>(null)

  // Só a primeira carga acende o loading. O polling é silencioso: piscar as
  // colunas a cada 8s tornaria a tela inutilizável para quem está lendo.
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
        const padrao = corpo.modoPadrao ?? 'off'
        const maiaResponde = new Set(corpo.inboxesMaiaResponde ?? [])

        const montadas = filasVazias()
        for (const { valor } of STATUS_ATENDIMENTO) {
          const bruta = corpo.colunas?.[valor]
          const cruas = bruta?.conversas ?? []
          const motivos = new Map<string, string>()
          const responsaveis = new Map<string, string>()
          for (const c of cruas) {
            const m = motivoStatusMaia(c)
            if (m) motivos.set(c.id, m)
            const nome = c.assigned_user_id && COM_RESPONSAVEL.includes(valor)
              ? corpo.responsaveis?.[c.assigned_user_id] : undefined
            if (nome) responsaveis.set(c.id, nome)
          }

          montadas[valor] = {
            // Mensagens vazias: a triagem mostra só o cabeçalho de cada conversa.
            // O histórico é do chat, que abre quando alguém clica.
            conversas: cruas.map(c =>
              toUIConversation(c, porId.get(c.contact_id) ?? null, [], padrao,
                maiaResponde.has(c.inbox_id))),
            total: bruta?.total ?? 0,
            // Lido do CRU: NinaConversation não carrega `priority` nem as
            // colunas status_ia_*.
            urgentes: new Set(cruas.filter(c => c.priority === 'high').map(c => c.id)),
            motivos,
            responsaveis,
          }
        }

        setFilas(montadas)
        setModoPadrao(padrao)
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
