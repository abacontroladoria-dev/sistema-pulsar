'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Conversation,
  Message,
  Contact,
  TagDefinition,
} from '@/modules/atendimento/types/central.types'

// ============================================================================
// Dados vivos da Central
//
// Um único lugar que fala com as rotas REST que já existem
// (GET /api/central/conversations, /contacts, /messages). Antes disso a
// ConversationSidebar e o ChatPane tinham arrays MOCK hardcoded: a mensagem
// do responsável chegava no banco e a tela continuava mostrando "Maria Silva".
//
// POR QUE POLLING, E NÃO REALTIME
//
// Nenhuma tabela do schema `central` está na publicação do Realtime, e colocá-la
// lá exige revisar autorização (o schema está sob privilégio POR COLUNA desde a
// 20260810120300 — não é só um `alter publication`). Polling de 5s resolve o
// caso de uso — atendimento humano, não trading — sem tocar em autorização.
//
// POR QUE DUAS REQUISIÇÕES PARA A LISTA
//
// `central.conversations` guarda `contact_id`, não o nome. A sidebar precisa do
// nome. A alternativa seria um join no ConversationRepository, mas coluna nova
// no `select` do schema `central` nasce ilegível (403) até receber grant
// explícito — não é mudança para fazer em cima da demo. Duas chamadas: as
// conversas, depois os contatos dessas conversas.
// ============================================================================

const INTERVALO_MS = 5000

interface Envelope<T> { data: T }

async function buscar<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`)
  const json = (await res.json()) as Envelope<T>
  return json.data
}

// ----------------------------------------------------------------------------
// Conversas + o contato de cada uma

export interface ConversaComContato {
  conversa: Conversation
  contato:  Contact | null
}

export function useConversas() {
  const [conversas, setConversas] = useState<ConversaComContato[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Só a PRIMEIRA carga mostra estado de carregamento. As recargas do polling
  // são silenciosas: piscar a lista a cada 5s tornaria a tela inutilizável.
  const primeiraCarga = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      try {
        const lista = await buscar<Conversation[]>(
          '/api/central/conversations?limit=50',
          controller.signal
        )

        const ids = [...new Set(lista.map(c => c.contact_id))]
        const contatos = ids.length
          ? await buscar<Contact[]>(
              `/api/central/contacts?limit=${ids.length + 20}`,
              controller.signal
            )
          : []

        const porId = new Map(contatos.map(c => [c.id, c]))

        if (!vivo) return
        setConversas(lista.map(conversa => ({
          conversa,
          contato: porId.get(conversa.contact_id) ?? null,
        })))
        setErro(null)
      } catch (e) {
        // AbortError é desmontagem, não falha — não vira mensagem de erro.
        if (!vivo || (e as Error).name === 'AbortError') return
        setErro((e as Error).message)
      } finally {
        if (vivo && primeiraCarga.current) {
          primeiraCarga.current = false
          setCarregando(false)
        }
      }
    }

    carregar()
    const t = setInterval(carregar, INTERVALO_MS)
    return () => { vivo = false; controller.abort(); clearInterval(t) }
  }, [])

  return { conversas, carregando, erro }
}

// ----------------------------------------------------------------------------
// Catálogo de tags — carrega uma vez, não faz polling.
//
// Ao contrário de conversas/mensagens, o catálogo (central.tag_definitions)
// não muda a cada 5s: alguém precisaria editar o cadastro de tags pela mão,
// algo raro. Fica fixo pela vida do componente que o monta.

export function useTagCatalogo() {
  const [catalogo, setCatalogo] = useState<TagDefinition[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    const controller = new AbortController()

    buscar<TagDefinition[]>('/api/central/tag-definitions', controller.signal)
      .then((dados) => { if (vivo) setCatalogo(dados) })
      // Degrada para leitura sem rótulo/cor — a tela mostra a chave crua em
      // vez de travar o painel inteiro por causa do catálogo.
      .catch(() => {})
      .finally(() => { if (vivo) setCarregando(false) })

    return () => { vivo = false; controller.abort() }
  }, [])

  return { catalogo, carregando }
}

// ----------------------------------------------------------------------------
// Mensagens de uma conversa

export function useMensagens(conversationId: string | null) {
  const [mensagens, setMensagens] = useState<Message[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const recarregar = useCallback(() => setMensagens(m => m), [])

  useEffect(() => {
    if (!conversationId) {
      setMensagens([])
      setCarregando(false)
      return
    }

    const controller = new AbortController()
    let vivo = true
    let primeira = true
    setCarregando(true)

    async function carregar() {
      try {
        const lista = await buscar<Message[]>(
          `/api/central/messages?conversationId=${conversationId}&limit=50`,
          controller.signal
        )
        if (!vivo) return
        // A rota devolve created_at DESC (cursor de scroll infinito).
        // A tela lê de cima para baixo, então invertemos aqui — uma vez, no
        // ponto onde a ordem do banco vira ordem de leitura.
        setMensagens([...lista].reverse())
        setErro(null)
      } catch (e) {
        if (!vivo || (e as Error).name === 'AbortError') return
        setErro((e as Error).message)
      } finally {
        if (vivo && primeira) { primeira = false; setCarregando(false) }
      }
    }

    carregar()
    const t = setInterval(carregar, INTERVALO_MS)
    return () => { vivo = false; controller.abort(); clearInterval(t) }
  }, [conversationId])

  return { mensagens, carregando, erro, recarregar }
}

// ----------------------------------------------------------------------------
// Formatação

// Hoje → hora. Esta semana → dia da semana. Antes → data curta.
export function horaCurta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const agora = new Date()
  const mesmoDia = d.toDateString() === agora.toDateString()
  if (mesmoDia) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const dias = (agora.getTime() - d.getTime()) / 86_400_000
  if (dias < 7) {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'short' })
    return s.charAt(0).toUpperCase() + s.slice(1, 3)
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function horaDoRelogio(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function iniciais(nome: string | null | undefined): string {
  if (!nome) return '?'
  return nome.trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}
