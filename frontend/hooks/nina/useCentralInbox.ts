'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type {
  AIMode,
  Channel,
  Conversation,
  Message,
  Contact,
} from '@/modules/atendimento/types/central.types'
import {
  toUIConversation,
  type NinaConversation,
} from '@/components/nina/adapters/centralToNina'

// ============================================================================
// Dados vivos da caixa de entrada
//
// Fala com as rotas /api/central/* que já existem. Nenhuma rota nova.
//
// POR QUE POLLING, E NÃO REALTIME
//
// Nenhuma tabela do schema `central` está na publicação do Realtime — o
// `ALTER PUBLICATION` está comentado na migration 20260701000600 porque não roda
// em transação. E o schema está sob privilégio POR COLUNA desde a
// 20260810120300, então habilitar Realtime é revisar autorização, não uma linha
// de SQL. Polling de 5s resolve o caso (atendimento humano, não pregão).
//
// POR QUE UM HOOK, E NÃO DOIS
//
// Lista e conversa aberta vivem no mesmo componente. Separá-los duplicaria o
// tratamento de 401 e daria dois estados de erro para a tela conciliar.
//
// POR QUE O DETALHE É UMA CHAMADA SÓ
//
// GET /conversations/[id] já devolve contact + channel + inbox + as 20 mensagens
// mais recentes. O backend fez o join; refazê-lo aqui seria trabalho repetido.
// ============================================================================

const INTERVALO_MS = 5000

// Teto real do DTO de contatos (parseListContactsQuery). Pedir mais é clampado
// em silêncio, e contato que não vem vira "Contato sem nome" na tela sem
// nenhuma pista do motivo.
const TETO_CONTATOS = 50

const MAX_CARACTERES = 4096

export type InboxErro =
  // 401/403: a sessão é válida, o que falta é `central_role` em public.usuarios.
  // Merece tela própria — vazio silencioso não diz ao operador o que fazer.
  | { tipo: 'sem_acesso'; mensagem: string }
  | { tipo: 'rede';       mensagem: string }
  | null

class ErroApi extends Error {
  constructor(readonly status: number, readonly code: string, mensagem: string) {
    super(mensagem)
  }
}

async function buscar<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ErroApi(
      res.status,
      json?.error?.code ?? 'DESCONHECIDO',
      json?.error?.message ?? `A rota respondeu ${res.status}.`,
    )
  }
  // Envelope do repo: sempre { data } (lib/central/response.ts).
  return json.data as T
}

// A resposta de GET /conversations/[id] — conversa com os vizinhos embutidos.
//
// `channel` e `inbox` são recortes da rota, não as entidades inteiras: o SELECT
// de lá (conversations/[id]/route.ts:39,46) pede colunas nomeadas. Declarar
// Channel completo aqui prometeria campos que não vêm.
export interface DetalheConversa extends Conversation {
  contact:         Contact | null
  channel:         Pick<Channel, 'id' | 'name' | 'provider' | 'channel_type' | 'status'> | null
  inbox:           { id: string; name: string; description: string | null } | null
  recentMessages:  Message[]
  // Herança já resolvida pelo servidor. `ai_mode` da conversa pode ser NULL
  // ("ninguém decidiu, vale o padrão da clínica") e só o backend enxerga o
  // agent_settings — resolver isso aqui daria uma segunda resposta possível.
  aiModeEfetivo:   AIMode
  aiModeOrigem:    'conversa' | 'padrao'
}

function classificar(e: unknown): InboxErro {
  if (e instanceof ErroApi && (e.status === 401 || e.status === 403)) {
    return { tipo: 'sem_acesso', mensagem: e.message }
  }
  return { tipo: 'rede', mensagem: (e as Error).message }
}

// Quem responde a conversa aberta.
export interface ModoIa {
  // Já com a herança resolvida — é isto que o botão deve refletir.
  modo:       AIMode
  // 'padrao' = ninguém decidiu nesta conversa; vale o ai_mode da clínica.
  origem:     'conversa' | 'padrao'
  // O valor cru da coluna, que `origem` já resume. Fica exposto porque desligar
  // e voltar ao padrão são ações diferentes, e só quem tem o valor cru sabe
  // qual delas está em vigor.
  daConversa: AIMode | null
}

export interface UseCentralInbox {
  conversations: NinaConversation[]
  activeChat:    NinaConversation | null
  selectedId:    string | null
  select:        (id: string | null) => void
  loading:       boolean
  loadingChat:   boolean
  erro:          InboxErro
  enviar:        (texto: string) => Promise<void>
  enviando:      boolean
  modoIa:        ModoIa | null
  definirModoIa: (modo: AIMode | null) => Promise<void>
  salvandoModo:  boolean
  // A conversa como o `central` a descreve, para o painel de detalhamento.
  // Chega na mesma resposta do chat — nenhuma requisição a mais.
  detalhe:       DetalheConversa | null
  // Para o painel refletir o que ele mesmo gravou (origem, tags, responsável)
  // sem esperar até 5s pelo próximo tique do polling.
  recarregarDetalhe: () => Promise<void>
}

export function useCentralInbox(): UseCentralInbox {
  const [conversations, setConversations] = useState<NinaConversation[]>([])
  const [activeChat, setActiveChat]       = useState<NinaConversation | null>(null)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [loading, setLoading]             = useState(true)
  const [loadingChat, setLoadingChat]     = useState(false)
  const [erro, setErro]                   = useState<InboxErro>(null)
  const [enviando, setEnviando]           = useState(false)
  const [modoIa, setModoIa]               = useState<ModoIa | null>(null)
  const [salvandoModo, setSalvandoModo]   = useState(false)
  const [detalhe, setDetalhe]             = useState<DetalheConversa | null>(null)

  // Link de fora: /connect/inbox?c=<id> abre aquela conversa. É como a triagem
  // (/connect/atendimentos) entrega a conversa ao chat em vez de duplicá-lo.
  //
  // Só na PRIMEIRA montagem, via estado inicial e nunca num efeito que observe o
  // parâmetro: depois disso quem manda é o clique do operador, e um efeito
  // reaplicaria o `?c=` a cada render, prendendo a seleção na conversa do link.
  const paramConversa = useSearchParams().get('c')
  const [selecaoInicialAplicada, setSelecaoInicialAplicada] = useState(false)
  if (!selecaoInicialAplicada) {
    setSelecaoInicialAplicada(true)
    if (paramConversa) setSelectedId(paramConversa)
  }

  // Só a PRIMEIRA carga acende `loading`. As recargas do polling são silenciosas
  // — piscar a lista a cada 5s a tornaria inutilizável.
  const primeiraCarga = useRef(true)

  // ------------------------------------------------------------------------
  // Lista

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      try {
        const [lista, contatos] = await Promise.all([
          buscar<Conversation[]>('/api/central/conversations?limit=50', controller.signal),
          buscar<Contact[]>(`/api/central/contacts?limit=${TETO_CONTATOS}`, controller.signal),
        ])

        const porId = new Map(contatos.map(c => [c.id, c]))
        if (!vivo) return

        // Mensagens ficam vazias aqui de propósito: a lista mostra só o
        // cabeçalho. O histórico vem do detalhe, quando o operador abre.
        setConversations(lista.map(c => toUIConversation(c, porId.get(c.contact_id) ?? null, [])))
        setErro(null)
      } catch (e) {
        if (!vivo || (e as Error).name === 'AbortError') return
        // A lista antiga PERMANECE na tela. Esvaziá-la por um poll falho é o
        // pior comportamento possível numa demo com wifi ruim.
        setErro(classificar(e))
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

  // ------------------------------------------------------------------------
  // Conversa aberta

  const carregarDetalhe = useCallback(async (id: string, signal: AbortSignal) => {
    const d = await buscar<DetalheConversa>(`/api/central/conversations/${id}`, signal)
    // recentMessages vem DESC (message.repository.ts usa ascending:false). A
    // tela lê de cima para baixo — a inversão acontece UMA vez, aqui na borda.
    const cronologicas = [...(d.recentMessages ?? [])].reverse()
    return {
      chat: toUIConversation(d, d.contact ?? null, cronologicas),
      // Fora do NinaConversation de propósito: são campos do `central` que a
      // tela do Nina não tem, e enfiá-los no tipo da UI misturaria os dois
      // vocabulários que o adapter existe para manter separados.
      modo: { modo: d.aiModeEfetivo, origem: d.aiModeOrigem, daConversa: d.ai_mode },
      // O painel de detalhamento fala `central`, não Nina: precisa de canal,
      // origem, responsável e tags, que o adapter não carrega. Este é o mesmo
      // objeto que já vinha da rota — antes era descartado depois do adapter.
      detalhe: d,
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setActiveChat(null)
      setLoadingChat(false)
      return
    }

    const controller = new AbortController()
    let vivo = true
    let primeira = true
    setLoadingChat(true)

    async function carregar() {
      try {
        const { chat, modo, detalhe: d } = await carregarDetalhe(selectedId!, controller.signal)
        if (!vivo) return
        setActiveChat(chat)
        setModoIa(modo)
        setDetalhe(d)
        setErro(null)
      } catch (e) {
        if (!vivo || (e as Error).name === 'AbortError') return
        setErro(classificar(e))
      } finally {
        if (vivo && primeira) { primeira = false; setLoadingChat(false) }
      }
    }

    carregar()
    const t = setInterval(carregar, INTERVALO_MS)
    return () => { vivo = false; controller.abort(); clearInterval(t) }
  }, [selectedId, carregarDetalhe])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    // Limpa o chat anterior: mostrar as mensagens de outra pessoa enquanto o
    // novo carrega já é confusão suficiente para o operador responder errado.
    setActiveChat(null)
    // Pelo mesmo motivo: o botão mostrando "Maia" da conversa anterior enquanto
    // a nova carrega convida a recepcionista a desligar a IA da pessoa errada.
    setModoIa(null)
    // E pelo mesmo motivo outra vez: o painel exibindo as tags e o responsável
    // do contato anterior faria o operador editar a ficha da pessoa errada.
    setDetalhe(null)
  }, [])

  // ------------------------------------------------------------------------
  // Envio

  const enviar = useCallback(async (texto: string) => {
    const corpo = texto.trim()
    if (!corpo || !selectedId) return

    // O backend recusa acima de 4096 com 400. Barrar aqui dá mensagem melhor.
    if (corpo.length > MAX_CARACTERES) {
      throw new Error(`A mensagem tem ${corpo.length} caracteres; o limite do WhatsApp é ${MAX_CARACTERES}.`)
    }

    setEnviando(true)
    try {
      const res = await fetch('/api/central/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conversationId: selectedId, body: corpo }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        // A mensagem do backend é a boa: para 422 WABA_JANELA_FECHADA ela
        // explica que só template aprovado passa fora das 24h.
        throw new Error(json?.error?.message ?? `O envio falhou com ${res.status}.`)
      }

      // Refetch em vez de empurrar a resposta na lista local: o poll de 5s
      // sobrescreveria o otimismo e as duas versões divergiriam por segundos.
      //
      // Aqui o refetch também atualiza o painel: enviar assume a conversa
      // (assumirAoResponder), então o bloco Responsável muda por causa deste
      // envio e precisa mostrar o novo dono sem esperar o próximo tique.
      const controller = new AbortController()
      const { chat, modo, detalhe: d } = await carregarDetalhe(selectedId, controller.signal)
      setActiveChat(chat)
      setModoIa(modo)
      setDetalhe(d)
    } finally {
      setEnviando(false)
    }
  }, [selectedId, carregarDetalhe])

  // ------------------------------------------------------------------------
  // Chave Maia / Atendente

  const definirModoIa = useCallback(async (modo: AIMode | null) => {
    if (!selectedId) return

    setSalvandoModo(true)
    try {
      const res = await fetch(`/api/central/conversations/${selectedId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'set_ai_mode', aiMode: modo }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `A troca falhou com ${res.status}.`)
      }

      // Refetch em vez de atualizar o estado local: a herança é resolvida no
      // servidor, então mandar `null` aqui não diz qual modo passou a valer —
      // só o backend sabe o que o agent_settings responde.
      //
      // O painel depende deste refetch por outro motivo: religar a Maia SOLTA o
      // responsável (setAiMode), então o bloco Responsável precisa esvaziar no
      // mesmo instante em que a chave muda de lado.
      const controller = new AbortController()
      const { chat, modo: atual, detalhe: d } = await carregarDetalhe(selectedId, controller.signal)
      setActiveChat(chat)
      setModoIa(atual)
      setDetalhe(d)
    } finally {
      setSalvandoModo(false)
    }
  }, [selectedId, carregarDetalhe])

  // ------------------------------------------------------------------------
  // Recarga sob demanda

  // Chamada pelo painel depois de gravar. Falha em silêncio de propósito: o
  // painel já reportou o erro da própria escrita, e mandar o erro de um refetch
  // para `erro` pintaria a tela inteira de "Sem acesso" por causa de um tique
  // perdido. Se este refetch falhar, o polling de 5s corrige sozinho.
  const recarregarDetalhe = useCallback(async () => {
    if (!selectedId) return
    const controller = new AbortController()
    try {
      const { chat, modo, detalhe: d } = await carregarDetalhe(selectedId, controller.signal)
      setActiveChat(chat)
      setModoIa(modo)
      setDetalhe(d)
    } catch {
      /* o polling corrige */
    }
  }, [selectedId, carregarDetalhe])

  return {
    conversations, activeChat, selectedId, select,
    loading, loadingChat, erro, enviar, enviando,
    modoIa, definirModoIa, salvandoModo,
    detalhe, recarregarDetalhe,
  }
}
