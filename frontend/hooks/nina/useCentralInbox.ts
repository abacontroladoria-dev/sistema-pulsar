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

// 16 MiB — o teto da Meta para áudio e vídeo, e o do bucket. Duplicado aqui de
// propósito: o módulo do backend é `server-only` e importá-lo puxaria o
// service inteiro para o bundle do cliente.
const MAX_BYTES_ANEXO = 16 * 1024 * 1024

// Onde a seleção de números sobrevive entre visitas. Por navegador, de
// propósito: é conveniência de quem atende, não dado do sistema.
const CHAVE_CANAIS = 'connect.inbox.canais.v1'

// Um número que este usuário pode atender (GET /channels/acessiveis).
export interface CanalInbox {
  id:       string
  name:     string
  provider: Channel['provider']
  status:   Channel['status']
}

function lerSelecaoSalva(): string[] {
  try {
    const bruto = window.localStorage.getItem(CHAVE_CANAIS)
    const lista = bruto ? JSON.parse(bruto) : []
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function salvarSelecao(ids: string[]): void {
  try {
    window.localStorage.setItem(CHAVE_CANAIS, JSON.stringify(ids))
  } catch {
    // navegador sem storage (aba anônima, bloqueio): a seleção só não persiste
  }
}

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

// O corpo inteiro, para quem precisa do que vem ao lado de `data`.
async function buscarCorpo(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ErroApi(
      res.status,
      json?.error?.code ?? 'DESCONHECIDO',
      json?.error?.message ?? `A rota respondeu ${res.status}.`,
    )
  }
  return json ?? {}
}

async function buscar<T>(url: string, signal: AbortSignal): Promise<T> {
  // Envelope do repo: sempre { data } (lib/central/response.ts).
  return (await buscarCorpo(url, signal)).data as T
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
  // Manda um arquivo. A legenda é o texto que estiver no compositor — a mesma
  // convenção do WhatsApp, onde o que você digitou vira legenda do anexo.
  enviarMidia:   (arquivo: File, legenda?: string) => Promise<void>
  enviandoMidia: boolean
  modoIa:        ModoIa | null
  definirModoIa: (modo: AIMode | null) => Promise<void>
  salvandoModo:  boolean
  // A conversa como o `central` a descreve, para o painel de detalhamento.
  // Chega na mesma resposta do chat — nenhuma requisição a mais.
  detalhe:       DetalheConversa | null
  // Para o painel refletir o que ele mesmo gravou (origem, tags, responsável)
  // sem esperar até 5s pelo próximo tique do polling.
  recarregarDetalhe: () => Promise<void>
  // "Isto ainda precisa de retorno." Recua a marca d'água e deixa a conversa
  // acesa na lista. Lança em caso de falha — ver o comentário na implementação.
  marcarComoNaoLida: (id: string) => Promise<void>
  // Os números que este usuário pode atender e quais estão à mostra. Seleção
  // vazia = todos.
  canais:              CanalInbox[]
  canaisSelecionados:  string[]
  alternarCanal:       (id: string) => void
  mostrarTodosCanais:  () => void
}

export function useCentralInbox(): UseCentralInbox {
  const [conversations, setConversations] = useState<NinaConversation[]>([])
  const [activeChat, setActiveChat]       = useState<NinaConversation | null>(null)
  const [selectedId, setSelectedId]       = useState<string | null>(null)
  const [loading, setLoading]             = useState(true)
  const [loadingChat, setLoadingChat]     = useState(false)
  const [erro, setErro]                   = useState<InboxErro>(null)
  const [enviando, setEnviando]           = useState(false)
  const [enviandoMidia, setEnviandoMidia] = useState(false)
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
  // Números (canais)
  //
  // Carregados uma vez: número novo é evento raro, e um F5 o traz. A seleção
  // salva é filtrada pelos números que ainda existem para este usuário — um id
  // de número removido (ou de outro usuário no mesmo navegador) filtraria a
  // lista para zero conversas sem explicação.

  const [canais, setCanais] = useState<CanalInbox[]>([])
  const [canaisSelecionados, setCanaisSelecionados] = useState<string[]>([])

  useEffect(() => {
    const controller = new AbortController()
    buscar<CanalInbox[]>('/api/central/channels/acessiveis', controller.signal)
      .then(lista => {
        setCanais(lista)
        const validos = new Set(lista.map(c => c.id))
        setCanaisSelecionados(lerSelecaoSalva().filter(id => validos.has(id)))
      })
      .catch(() => {
        // Sem a lista de números a tela segue com todos — que é o que a RLS
        // já deixa ver. O erro de acesso, se for o caso, aparece pela lista.
      })
    return () => controller.abort()
  }, [])

  const alternarCanal = useCallback((id: string) => {
    setCanaisSelecionados(atual => {
      const proximo = atual.includes(id) ? atual.filter(x => x !== id) : [...atual, id]
      salvarSelecao(proximo)
      return proximo
    })
  }, [])

  const mostrarTodosCanais = useCallback(() => {
    salvarSelecao([])
    setCanaisSelecionados([])
  }, [])

  // String estável para o efeito da lista reagir à seleção, e não à identidade
  // do array.
  const filtroCanais = canaisSelecionados.join(',')

  // ------------------------------------------------------------------------
  // Lista

  useEffect(() => {
    const controller = new AbortController()
    let vivo = true

    async function carregar() {
      // Aba escondida não consulta: com vários números e várias atendentes, o
      // polling de quem nem está olhando era carga pura no pool do banco.
      if (!primeiraCarga.current && document.visibilityState === 'hidden') return
      try {
        const urlLista = filtroCanais
          ? `/api/central/conversations?limit=50&channelIds=${filtroCanais}`
          : '/api/central/conversations?limit=50'
        const [corpo, contatos] = await Promise.all([
          buscarCorpo(urlLista, controller.signal),
          buscar<Contact[]>(`/api/central/contacts?limit=${TETO_CONTATOS}`, controller.signal),
        ])

        const lista = (corpo.data ?? []) as Conversation[]
        // Vem ao lado de `data`. Sem ele a badge não sabe resolver a herança do
        // ai_mode; 'off' é a falha fechada, a mesma do servidor.
        const modoPadrao = (corpo.modoPadrao as string) ?? 'off'

        const porId = new Map(contatos.map(c => [c.id, c]))
        if (!vivo) return

        // Mensagens ficam vazias aqui de propósito: a lista mostra só o
        // cabeçalho. O histórico vem do detalhe, quando o operador abre.
        setConversations(lista.map(c =>
          toUIConversation(c, porId.get(c.contact_id) ?? null, [], modoPadrao)))
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
  }, [filtroCanais])

  // ------------------------------------------------------------------------
  // Conversa aberta

  const carregarDetalhe = useCallback(async (id: string, signal: AbortSignal) => {
    const d = await buscar<DetalheConversa>(`/api/central/conversations/${id}`, signal)
    // recentMessages vem DESC (message.repository.ts usa ascending:false). A
    // tela lê de cima para baixo — a inversão acontece UMA vez, aqui na borda.
    const cronologicas = [...(d.recentMessages ?? [])].reverse()
    return {
      // O detalhe não precisa do padrão da clínica: a rota já devolve o modo
      // EFETIVO desta conversa. Passá-lo como "padrão" dá o mesmo resultado em
      // mapStatus — resolverModoEfetivo só consulta o padrão quando a coluna é
      // NULL, que é exatamente o caso em que aiModeEfetivo JÁ é o padrão.
      chat: toUIConversation(d, d.contact ?? null, cronologicas, d.aiModeEfetivo),
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

  // Declarado aqui, acima de `select`, porque é ele quem libera a trava. Ver o
  // bloco "Marca d'água de leitura" mais abaixo para o que ela protege.
  const naoRemarcar = useRef<string | null>(null)

  const select = useCallback((id: string | null) => {
    // Trocar de conversa encerra a decisão de "deixar pendente": ao voltar, a
    // abertura marca como lida normalmente. Sem isto, uma conversa marcada como
    // não lida nunca mais seria marcada como lida nesta sessão.
    naoRemarcar.current = null
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

    // Responder é tratar. Se o operador tinha marcado como não lida e mudou de
    // ideia, a resposta desfaz aquilo — manter a conversa pendente depois de
    // responder faria a lista cobrar retorno de algo que acabou de ser
    // respondido. O refetch logo abaixo traz `naoLida` e o efeito marca.
    naoRemarcar.current = null

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

  const enviarMidia = useCallback(async (arquivo: File, legenda?: string) => {
    if (!selectedId) return

    // Barrado aqui ANTES de subir: descobrir o limite depois de esperar 16 MB
    // atravessarem a rede é a pior forma de aprender que ele existe. O backend
    // valida de novo — esta checagem é sobre a espera, não sobre segurança.
    if (arquivo.size > MAX_BYTES_ANEXO) {
      const mb = (arquivo.size / 1_048_576).toFixed(1).replace('.', ',')
      throw new Error(`O arquivo tem ${mb} MB e o limite do WhatsApp é 16 MB.`)
    }
    if (arquivo.size === 0) {
      throw new Error('O arquivo está vazio.')
    }

    // Mandar arquivo é responder. Ver o mesmo trecho em `enviar`.
    naoRemarcar.current = null

    const form = new FormData()
    form.append('conversationId', selectedId)
    form.append('arquivo', arquivo)
    if (legenda?.trim()) form.append('legenda', legenda.trim())

    setEnviandoMidia(true)
    try {
      // A BARRA FINAL É OBRIGATÓRIA: `trailingSlash: true` faz o POST sem ela
      // virar 308, e o corpo multipart não sobrevive ao redirecionamento.
      // Ver reference_trailing_slash_post_api_interna.
      const res = await fetch('/api/central/messages/midia/', {
        method: 'POST',
        // Sem Content-Type: o fetch o define com o boundary do multipart.
        body:   form,
      })

      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `O envio falhou com ${res.status}.`)
      }

      const controller = new AbortController()
      const { chat, modo, detalhe: d } = await carregarDetalhe(selectedId, controller.signal)
      setActiveChat(chat)
      setModoIa(modo)
      setDetalhe(d)
    } finally {
      setEnviandoMidia(false)
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
  // Marca d'água de leitura
  //
  // Abrir a conversa marca como lida. Isso roda num efeito próprio, e não
  // dentro do efeito de carga, por dois motivos: a carga se repete a cada 5s
  // (um PATCH por tique seria absurdo) e marcar leitura não pode participar do
  // tratamento de erro da carga — um PATCH que falhe não pode pintar a tela de
  // "Sem acesso".
  //
  // A TRAVA, E POR QUE ELA DURA ENQUANTO A CONVERSA ESTIVER ABERTA
  //
  // `marcarComoNaoLida` recua `last_read_at`, e o refetch traz a conversa de
  // volta como não lida — com ela ainda selecionada. Sem trava, este efeito
  // veria `naoLida: true` numa conversa aberta e marcaria como lida de novo.
  //
  // Uma trava de UM disparo (que é o que o repo de referência usa) não basta
  // aqui, e a diferença é o polling: lá o efeito só reage à mudança do contador;
  // aqui ele reage a `activeChat`, que é SUBSTITUÍDO a cada 5s. O primeiro
  // tique seria travado e o segundo desfaria a ação sozinho — o operador veria
  // a conversa que acabou de marcar apagar em cinco segundos, sem ter tocado em
  // nada.
  //
  // Então a trava vale até a seleção MUDAR. Enquanto o operador estiver com a
  // conversa aberta, a decisão dele de deixá-la pendente é respeitada; ao sair e
  // voltar, a abertura volta a marcar como lida, que é o comportamento esperado.
  //
  // Mensagem NOVA que chegue durante isso também não remarca — e está certo:
  // ele marcou como "precisa de retorno" e continua sem ter respondido.
  //
  // O ref está declarado lá em cima, junto de `select`, que é quem o libera.

  useEffect(() => {
    if (!selectedId) return
    if (naoRemarcar.current === selectedId) return

    // Só quando há o que marcar. Sem esta guarda, o PATCH sairia a cada
    // seleção, inclusive ao reabrir uma conversa já lida — escrita à toa numa
    // tabela quente.
    if (!activeChat?.naoLida) return

    const controller = new AbortController()
    fetch(`/api/central/conversations/${selectedId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'mark_read' }),
      signal:  controller.signal,
    }).catch(() => {
      // Silêncio deliberado: falhar em marcar como lida não atrapalha o
      // atendimento — a conversa continua acesa e a próxima abertura tenta de
      // novo. Um toast de erro aqui interromperia quem só queria ler.
    })

    return () => controller.abort()
  }, [selectedId, activeChat?.naoLida])

  const marcarComoNaoLida = useCallback(async (id: string) => {
    const res = await fetch(`/api/central/conversations/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'mark_unread' }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      // Diferente de `mark_read`, esta LANÇA. A leitura falha em silêncio
      // porque ninguém pediu nada; esta é um pedido explícito do operador, e um
      // "não lida" que não pegou deixaria a conversa parecendo tratada quando
      // ele acredita tê-la reaberto.
      throw new Error(json?.error?.message ?? `A marcação falhou com ${res.status}.`)
    }

    // Trava o efeito acima ANTES do refetch, que vai trazer a conversa já não
    // lida e dispararia a remarcação. Vale enquanto esta conversa continuar
    // selecionada — ver o comentário da trava.
    naoRemarcar.current = id

    if (id === selectedId) {
      const controller = new AbortController()
      try {
        const { chat, modo, detalhe: d } = await carregarDetalhe(id, controller.signal)
        setActiveChat(chat)
        setModoIa(modo)
        setDetalhe(d)
      } catch {
        /* o polling corrige */
      }
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
    enviarMidia, enviandoMidia,
    modoIa, definirModoIa, salvandoModo,
    detalhe, recarregarDetalhe, marcarComoNaoLida,
    canais, canaisSelecionados, alternarCanal, mostrarTodosCanais,
  }
}
