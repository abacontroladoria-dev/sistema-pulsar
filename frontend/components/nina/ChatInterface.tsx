'use client'

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import {
  Search, MessageSquare, Loader2, Info, Bot, User, Pause, ShieldAlert, WifiOff, MailX, Smartphone,
  Pin, PinOff, ArrowLeft, CheckCircle2, Archive, RotateCcw, UserRoundCog,
} from 'lucide-react'

import { ConversationStatus } from '@/types/nina'
import { useCentralInbox, type ModoIa, type AcaoConversa } from '@/hooks/nina/useCentralInbox'
import type { NinaMessage } from './adapters/centralToNina'
import { usePainelDetalhamento } from '@/hooks/nina/usePainelDetalhamento'
import { Avatar } from './Avatar'
import { CanalSeletor } from './CanalSeletor'
import { FiltrosLista, type FiltroRapido } from './FiltrosLista'
import { BolhaMensagem } from './BolhaMensagem'
import { Compositor } from './Compositor'
import { rotuloDia, mesmoDia } from './textoWhatsApp'
import { PainelDetalhamento } from './detalhamento/PainelDetalhamento'
import { ModalAgendarRetorno } from './detalhamento/ModalAgendarRetorno'
import { ModalDesignarTarefa } from './detalhamento/ModalDesignarTarefa'
import { ModalApagarMensagem } from './ModalApagarMensagem'
import { ModalEditarMensagem, ModalTransferir } from './ModaisConversa'
import { MessageDirection } from '@/types/nina'
import { toast } from 'sonner'

const ChatInterface: React.FC = () => {
  const {
    conversations, activeChat, selectedId, select,
    loading, loadingChat, erro, enviar, enviando,
    modoIa, definirModoIa, salvandoModo,
    detalhe, recarregarDetalhe, marcarComoNaoLida,
    enviarMidia, enviandoMidia,
    canais, canaisSelecionados, alternarCanal, mostrarTodosCanais,
    atualizandoLista, apagarMensagem,
    editarMensagem, carregarAntigas, carregandoAntigas, temMaisAntigas,
    acaoConversa, visao, setVisao, fixadas, alternarFixada, meuUserId,
  } = useCentralInbox()

  // Nome do número por id, para a badge da lista. Só aparece quando o usuário
  // atende mais de um número — com um só, a badge repetiria a mesma coisa em
  // toda linha.
  const nomeDoCanal = new Map(canais.map(c => [c.id, c]))
  const variosCanais = canais.length > 1

  // O item da lista que acabou de ser clicado, para o "Abrindo a conversa…"
  // dizer com quem enquanto o detalhe não chega.
  const conversaSelecionada = conversations.find(c => c.id === selectedId) ?? null

  // Número Evolution é atendimento humano: a Maia não existe nele (trigger
  // trg_evolution_sem_ia). A chave Maia/Atendente some, e no lugar fica dito
  // por qual número a conversa chega.
  const canalHumano = detalhe?.channel?.provider === 'evolution'

  // Fontes do painel que não vêm no detalhe da conversa (catálogo de tags,
  // usuários, agendamentos, tarefas). Fora do polling — ver o hook.
  const painel = usePainelDetalhamento(detalhe?.contact?.id ?? null)
  const [salvandoResponsavel, setSalvandoResponsavel] = useState(false)
  const [agendando, setAgendando] = useState(false)
  const [designando, setDesignando] = useState(false)
  const [apagando, setApagando] = useState<NinaMessage | null>(null)

  const [respondendo, setRespondendo] = useState<NinaMessage | null>(null)
  const [editando, setEditando] = useState<NinaMessage | null>(null)
  const [transferindo, setTransferindo] = useState(false)
  const [destacada, setDestacada] = useState<string | null>(null)
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>('todas')
  const [filtroTags, setFiltroTags] = useState<string[]>([])
  // Fechado de início em tela estreita: no celular o painel cobriria a conversa.
  const [showProfileInfo, setShowProfileInfo] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1280,
  )
  const [searchQuery, setSearchQuery] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const rolagemRef     = useRef<HTMLDivElement>(null)
  // Altura antes de carregar as antigas, para devolver o olho ao mesmo ponto.
  const alturaAntes    = useRef<number | null>(null)

  const setSelectedChatId = select
  const selectedChatId    = selectedId

  // Trocar de conversa descarta a resposta em andamento: citar a mensagem de
  // outra pessoa seria pior que perder a citação.
  useEffect(() => { setRespondendo(null) }, [selectedId])

  // Rola para o fim quando chega mensagem NOVA (a última mudou). Pelo id, e não
  // pelo comprimento: carregar as antigas também aumenta o comprimento, e
  // descer ali jogaria fora o histórico que a pessoa acabou de pedir.
  const ultimaId = activeChat?.messages.at(-1)?.id
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [ultimaId])

  useLayoutEffect(() => {
    const el = rolagemRef.current
    if (el && alturaAntes.current !== null) {
      el.scrollTop = el.scrollHeight - alturaAntes.current
      alturaAntes.current = null
    }
  }, [activeChat?.messages.length])

  const pedirAntigas = () => {
    if (carregandoAntigas || !temMaisAntigas) return
    alturaAntes.current = rolagemRef.current?.scrollHeight ?? null
    carregarAntigas().catch(err => {
      alturaAntes.current = null
      toast.error((err as Error).message)
    })
  }

  // Leva até a mensagem citada e a acende por um instante. Se ela é mais antiga
  // que o histórico carregado, avisa em vez de rolar para lugar nenhum.
  const irPara = (id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) {
      toast.info('A mensagem citada é mais antiga. Use "Carregar anteriores" no topo da conversa.')
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setDestacada(id)
    setTimeout(() => setDestacada(atual => (atual === id ? null : atual)), 1600)
  }

  const filteredConversations = conversations
    .filter(chat => {
      if (!searchQuery) return true
      const query = searchQuery.toLowerCase()
      return (
        chat.contactName.toLowerCase().includes(query) ||
        chat.contactPhone.includes(query) ||
        chat.lastMessage.toLowerCase().includes(query)
      )
    })
    .filter(chat => {
      switch (filtroRapido) {
        case 'nao_lidas': return chat.naoLida
        case 'minhas':    return !!meuUserId && chat.assignedUserId === meuUserId
        case 'maia':      return chat.status === 'nina'
        case 'humano':    return chat.status !== 'nina'
        default:          return true
      }
    })
    .filter(chat => filtroTags.length === 0 || chat.tagsContato.some(t => filtroTags.includes(t)))
    // Fixadas no topo, na ordem em que foram fixadas; o resto mantém a ordem
    // do servidor (última mensagem primeiro).
    .sort((a, b) => {
      const ia = fixadas.indexOf(a.id), ib = fixadas.indexOf(b.id)
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

  const handleFixar = async (id: string) => {
    try {
      await alternarFixada(id)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const MSG_ACAO: Record<AcaoConversa['action'], string> = {
    resolve:  'Conversa encerrada.',
    archive:  'Conversa arquivada.',
    reopen:   'Conversa reaberta.',
    transfer: 'Conversa transferida.',
  }
  const handleAcaoConversa = async (acao: AcaoConversa) => {
    try {
      await acaoConversa(acao)
      toast.success(MSG_ACAO[acao.action])
    } catch (err) {
      toast.error((err as Error).message)
      throw err
    }
  }

  const statusCentral = detalhe?.status ?? null
  const encerrada = statusCentral === 'resolved' || statusCentral === 'archived'

  const renderStatusBadge = (status: ConversationStatus) => {
    const config = {
      nina: { label: 'Maia', icon: Bot, color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
      human: { label: 'Humano', icon: User, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      paused: { label: 'Pausado', icon: Pause, color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' }
    }
    const { label, icon: Icon, color } = config[status]
    return (
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 ${color}`}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
    )
  }

  // A chave Maia / Atendente. Grava SEMPRE um valor explícito na conversa, nos
  // dois sentidos — nunca `null`.
  //
  // `null` existe e significa "seguir o padrão da clínica", mas não é o que um
  // clique quer dizer. Quem clica em "Maia" quer a Maia atendendo ESTA pessoa;
  // se isso gravasse null e o agent_settings estivesse em 'off', o botão voltaria
  // sozinho para Atendente e pareceria quebrado. A herança serve para a conversa
  // que ninguém tocou, e é só isso.
  const handleTrocarModo = async (ligar: boolean) => {
    try {
      await definirModoIa(ligar ? 'autonomous' : 'off')
      toast.success(ligar ? 'A Maia voltou a atender esta conversa.' : 'A Maia parou. O atendimento é seu.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // --------------------------------------------------------------------------
  // Escritas do painel de detalhamento
  //
  // Todas seguem a mesma forma: grava, recarrega o detalhe, avisa. Nenhuma
  // atualiza estado local com o valor enviado — o que vale é o que o servidor
  // devolve. Isso importa porque estas três coisas mudam por caminhos que não
  // passam pelo painel (responder assume a conversa; religar a Maia a solta).
  // --------------------------------------------------------------------------

  const patchContato = async (corpo: Record<string, unknown>) => {
    const contatoId = detalhe?.contact?.id
    if (!contatoId) throw new Error('Esta conversa não tem contato.')

    const res = await fetch(`/api/central/contacts/${contatoId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(corpo),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      throw new Error(json?.error?.message ?? `A gravação falhou com ${res.status}.`)
    }
    await recarregarDetalhe()
  }

  const handleSalvarOrigem = async (valor: string | null) => {
    try {
      await patchContato({ source: valor })
      toast.success(valor ? 'Origem registrada.' : 'Origem apagada.')
    } catch (err) {
      toast.error((err as Error).message)
      // Repropaga para o bloco manter o campo aberto com o texto digitado:
      // fechar depois de falhar faria a pessoa redigitar do zero.
      throw err
    }
  }

  const handleSalvarTags = async (chaves: string[]) => {
    try {
      await patchContato({ tags: chaves })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleTrocarResponsavel = async (userId: string | null) => {
    if (!selectedId) return
    setSalvandoResponsavel(true)
    try {
      // 'assign' com toUserId null devolve a conversa à fila. É a mesma ação do
      // caminho de volta da chave Maia, e reusa a auditoria que já existe.
      const res = await fetch(`/api/central/conversations/${selectedId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'assign', toUserId: userId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `A atribuição falhou com ${res.status}.`)
      }
      await recarregarDetalhe()
      toast.success(userId ? 'Responsável atualizado.' : 'Conversa devolvida à fila.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvandoResponsavel(false)
    }
  }

  const handleAgendarRetorno = async (dados: {
    titulo: string; data: string; hora: string | null; descricao: string | null
  }) => {
    const contatoId = detalhe?.contact?.id
    if (!contatoId) return

    try {
      const res = await fetch('/api/central/appointments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Sem `profissionalId`: a rota distingue reserva de vaga real de
        // compromisso administrativo por esse campo. Este é um lembrete de
        // contato, não uma sessão na grade.
        body: JSON.stringify({
          titulo:         dados.titulo,
          data:           dados.data,
          hora:           dados.hora,
          descricao:      dados.descricao,
          tipo:           'followup',
          contactId:      contatoId,
          conversationId: selectedId,
        }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `O agendamento falhou com ${res.status}.`)
      }
      await painel.recarregarListas()
      setAgendando(false)
      toast.success('Retorno agendado.')
    } catch (err) {
      // O modal fica ABERTO: os campos preenchidos continuam lá para corrigir
      // e tentar de novo, em vez de obrigar a redigitar tudo.
      toast.error((err as Error).message)
    }
  }

  const handleDesignarTarefa = async (dados: {
    title: string; description: string | null
    assignedUserId: string | null; dueAt: string | null
  }) => {
    const contatoId = detalhe?.contact?.id
    if (!contatoId) return

    try {
      const res = await fetch('/api/central/tasks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Os dois vínculos: o contato é por quem o painel busca (a pendência é
        // da pessoa e sobrevive à conversa ser resolvida), a conversa é o link
        // de volta ao contexto em que a tarefa nasceu.
        body: JSON.stringify({ ...dados, contactId: contatoId, conversationId: selectedId }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `A criação falhou com ${res.status}.`)
      }
      await painel.recarregarListas()
      setDesignando(false)
      toast.success('Tarefa criada.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleConcluirTarefa = async (id: string) => {
    try {
      const res = await fetch(`/api/central/tasks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'complete' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `A conclusão falhou com ${res.status}.`)
      }
      await painel.recarregarListas()
      toast.success('Tarefa concluída.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // O modal fica ABERTO se falhar, com o texto digitado, para tentar de novo.
  const handleEditarMensagem = async (texto: string) => {
    if (!editando) return
    try {
      await editarMensagem(editando.id, texto)
      setEditando(null)
      toast.success('Mensagem editada.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // Sugestão da Maia: sai pelo envio normal (é a atendente quem envia e assume),
  // e só depois o rascunho é apagado. Se o envio falhar, a sugestão fica.
  const [enviandoSugestao, setEnviandoSugestao] = useState<string | null>(null)
  const handleEnviarSugestao = async (m: NinaMessage) => {
    if (!m.content || enviandoSugestao) return
    setEnviandoSugestao(m.id)
    try {
      await enviar(m.content)
      await apagarMensagem(m.id).catch(() => {})
      toast.success('Sugestão enviada.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviandoSugestao(null)
    }
  }

  // O modal fica ABERTO se falhar: o motivo vai no toast (ex.: o WhatsApp não
  // apagou), e a pessoa decide ali mesmo se tenta de novo ou desiste.
  const handleApagarMensagem = async () => {
    if (!apagando) return
    try {
      const { apagadaNoWhatsapp } = await apagarMensagem(apagando.id)
      setApagando(null)
      toast.success(apagadaNoWhatsapp
        ? 'Mensagem apagada para todos.'
        : 'Mensagem apagada do Pulsar.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleMarcarNaoLida = async () => {
    if (!selectedId) return
    try {
      await marcarComoNaoLida(selectedId)
      toast.success('Conversa marcada como não lida.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // Sessão válida, mas o usuário não tem `central_role` em public.usuarios.
  // Tela própria em vez de lista vazia: vazio ambíguo faz o operador procurar
  // problema onde não há. Não redirecionar para /login — a sessão está boa, e
  // redirecionar criaria laço com o gate do layout do /connect.
  if (erro?.tipo === 'sem_acesso') {
    return (
      <div className="flex h-full bg-background items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <ShieldAlert className="h-10 w-10 text-amber-500" />
          <h2 className="text-lg font-bold text-foreground">Sem acesso à Central</h2>
          <p className="text-sm text-muted-foreground">{erro.mensagem}</p>
          <p className="text-xs text-muted-foreground/70">
            Um administrador precisa liberar seu usuário para a Central de Atendimento.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full bg-background items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-sm text-muted-foreground/70">Sincronizando conversas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* No celular, lista OU conversa — as duas lado a lado não cabem. */}
      <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96 border-r border-border flex-col bg-card backdrop-blur-md z-20 shrink-0`}>
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground mb-4 px-1 flex items-center gap-2">
            Chats Ativos
            {/* A lista já foi recortada no clique; isto só diz que o servidor
                ainda vai completar com o que estava fora das 50 em mãos. */}
            {atualizandoLista && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/70" aria-label="Atualizando a lista" />
            )}
          </h2>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-cyan-400 transition-colors" />
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-background border border-border rounded-xl text-sm focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none text-foreground placeholder:text-muted-foreground/70 transition-all"
            />
          </div>
          <CanalSeletor
            canais={canais}
            selecionados={canaisSelecionados}
            aoAlternar={alternarCanal}
            aoMostrarTodos={mostrarTodosCanais}
          />
          <FiltrosLista
            rapido={filtroRapido}
            aoRapido={setFiltroRapido}
            podeMinhas={!!meuUserId}
            visao={visao}
            aoVisao={setVisao}
            tags={filtroTags}
            aoTags={setFiltroTags}
          />
        </div>

        {/* Falha de rede NÃO esvazia a lista — os dados de antes continuam na
            tela com este aviso em cima. Esvaziar por um poll falho é o pior
            comportamento possível quando o wifi oscila. */}
        {erro?.tipo === 'rede' && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Sem conexão — tentando novamente</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/70 p-8 text-center">
              <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-sm">Nenhuma conversa encontrada</p>
              <p className="text-xs mt-1 opacity-70">As conversas aparecerão aqui quando receberem mensagens</p>
            </div>
          ) : (
            filteredConversations.map((chat) => (
              <div
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                className={`group/linha relative flex items-center p-4 cursor-pointer transition-all duration-200 border-b border-border hover:bg-muted ${
                  selectedChatId === chat.id
                    ? 'bg-muted border-l-2 border-l-cyan-500'
                    : 'border-l-2 border-l-transparent'
                }`}
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-slate-700 to-slate-900">
                    <Avatar url={chat.contactAvatar} nome={chat.contactName} />
                  </div>
                  {/* O ponto voltou a significar algo: `last_read_at` existe
                      desde 20260921140000, e não-lido é a comparação com ele.
                      Antes, sem registro de leitura, ele pulsaria sempre ou
                      nunca — por isso era neutro. */}
                  <span
                    className={`absolute bottom-0 right-0 w-3.5 h-3.5 border-2 border-border rounded-full ${
                      chat.naoLida ? 'bg-cyan-500 animate-pulse' : 'bg-slate-600'
                    }`}
                    title={chat.naoLida ? 'Mensagem não lida' : undefined}
                  ></span>
                </div>

                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    {/* Não lida pesa mais que selecionada: quem varre a lista
                        procura o que falta responder, e o negrito é o que o
                        olho encontra antes de ler qualquer nome. */}
                    <h3 className={`text-sm truncate ${
                      chat.naoLida
                        ? 'font-bold text-foreground'
                        : selectedChatId === chat.id
                          ? 'font-semibold text-foreground'
                          : 'font-semibold text-muted-foreground'
                    }`}>
                      {chat.contactName}
                    </h3>
                    <span className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground/70 font-medium">
                      {fixadas.includes(chat.id) && (
                        <Pin className="w-3 h-3 text-cyan-500" aria-label="Fixada" />
                      )}
                      {chat.lastMessageTime}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/70 truncate">{chat.lastMessage}</p>

                  {/* Continua SEM badge numérica, e agora por outro motivo: a
                      lista não carrega mensagens (o hook passa `[]` de
                      propósito), então o número exato não existe aqui — só
                      dentro da conversa aberta. O ponto e o negrito respondem
                      a pergunta que a lista consegue responder ("tem?"), e um
                      "3" que viesse de outro lugar seria tão inventado quanto o
                      que foi removido antes. */}
                  <div className="flex items-center mt-2 gap-1.5 min-w-0">
                    {renderStatusBadge(chat.status)}
                    {variosCanais && nomeDoCanal.get(chat.canalId) && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border text-muted-foreground flex items-center gap-1 min-w-0">
                        {nomeDoCanal.get(chat.canalId)!.provider === 'evolution'
                          ? <Smartphone className="w-3 h-3 shrink-0" />
                          : <Bot className="w-3 h-3 shrink-0" />}
                        <span className="truncate">{nomeDoCanal.get(chat.canalId)!.name}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Fixar pela própria linha, no hover (sempre visível no toque). */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); void handleFixar(chat.id) }}
                  title={fixadas.includes(chat.id) ? 'Desafixar' : 'Fixar no topo'}
                  aria-label={fixadas.includes(chat.id) ? 'Desafixar conversa' : 'Fixar conversa'}
                  className="absolute right-2 bottom-2 p-1 rounded-md text-muted-foreground/70 hover:text-cyan-500 hover:bg-background opacity-0 group-hover/linha:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 transition-opacity"
                >
                  {fixadas.includes(chat.id) ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* A tela da conversa (e o vazio, mais abaixo) é a superfície MAIS FUNDA
          da página: as bolhas (bg-card) precisam se destacar dela. No escuro
          isso era #0B0E14 fixo, mais fundo que o --background; no claro o
          equivalente é o cinza do --muted, porque o branco do --background
          deixaria a bolha branca invisível. Daí o par explícito, não um token. */}
      {activeChat ? (
        <div className="flex-1 flex overflow-hidden bg-muted dark:bg-[#0B0E14]">
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="h-16 px-2 sm:px-6 flex items-center justify-between gap-2 bg-card backdrop-blur-md border-b border-border z-10 shrink-0">
              <div className="flex items-center min-w-0 p-1.5 -ml-1.5 rounded-lg pr-3">
                <button
                  type="button"
                  onClick={() => select(null)}
                  aria-label="Voltar para a lista"
                  className="md:hidden mr-1 p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full ring-2 ring-border overflow-hidden">
                    <Avatar url={activeChat.contactAvatar} nome={activeChat.contactName} />
                  </div>
                </div>
                <div className="ml-3 min-w-0">
                  <h2 className="text-sm font-bold text-foreground flex items-center gap-2 min-w-0">
                    <span className="truncate">{activeChat.contactName}</span>
                    {encerrada && (
                      <span className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium border border-border text-muted-foreground">
                        {statusCentral === 'archived' ? 'Arquivada' : 'Encerrada'}
                      </span>
                    )}
                    {/* A badge sai de `ai_mode` cru e não enxerga a herança
                        (o adapter não conhece o agent_settings). A chave ao
                        lado mostra o modo efetivo e é a fonte a acreditar;
                        suprimir a badge aqui evita as duas se contradizerem
                        numa conversa que segue o padrão da clínica. */}
                    {!canalHumano && modoIa?.origem === 'conversa' && renderStatusBadge(activeChat.status)}
                  </h2>
                  <p className="text-xs text-cyan-500 font-medium">{activeChat.contactPhone}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {canalHumano ? (
                  <span
                    className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    title="Número de atendimento humano — a Maia não responde por ele"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Atendimento humano · {detalhe?.channel?.name}
                  </span>
                ) : (
                  <ChaveAtendimento
                    modo={modoIa}
                    salvando={salvandoModo}
                    aoTrocar={handleTrocarModo}
                  />
                )}

                {/* "Isto ainda precisa de retorno." Recua a marca d'água para
                    antes da última mensagem do contato — a conversa volta a
                    acender na lista com UMA não lida, que é o sinal honesto.
                    Não ressuscita o histórico inteiro de não-lidas. */}
                <button
                  type="button"
                  onClick={handleMarcarNaoLida}
                  title="Marcar como não lida"
                  aria-label="Marcar como não lida"
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <MailX className="w-5 h-5" />
                </button>

                {selectedId && (
                  <button
                    type="button"
                    onClick={() => void handleFixar(selectedId)}
                    title={fixadas.includes(selectedId) ? 'Desafixar' : 'Fixar no topo'}
                    aria-label={fixadas.includes(selectedId) ? 'Desafixar conversa' : 'Fixar conversa'}
                    aria-pressed={fixadas.includes(selectedId)}
                    className={`p-1.5 rounded-lg hover:bg-muted transition-colors ${
                      fixadas.includes(selectedId) ? 'text-cyan-500' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {fixadas.includes(selectedId) ? <PinOff className="w-5 h-5" /> : <Pin className="w-5 h-5" />}
                  </button>
                )}

                {encerrada ? (
                  <button
                    type="button"
                    onClick={() => void handleAcaoConversa({ action: 'reopen' }).catch(() => {})}
                    title="Reabrir conversa"
                    aria-label="Reabrir conversa"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setTransferindo(true)}
                      title="Transferir para outra pessoa"
                      aria-label="Transferir conversa"
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <UserRoundCog className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAcaoConversa({ action: 'resolve' }).catch(() => {})}
                      title="Encerrar atendimento"
                      aria-label="Encerrar atendimento"
                      className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-600 transition-colors"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAcaoConversa({ action: 'archive' }).catch(() => {})}
                      title="Arquivar conversa"
                      aria-label="Arquivar conversa"
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Archive className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* O X do painel só escondia, e não havia como trazê-lo de
                    volta sem recarregar a página. Com seis blocos de ficha lá
                    dentro, fechar por engano custava caro demais. */}
                {!showProfileInfo && (
                  <button
                    type="button"
                    onClick={() => setShowProfileInfo(true)}
                    title="Abrir o detalhamento"
                    aria-label="Abrir o detalhamento"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Info className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            <div
              ref={rolagemRef}
              onScroll={e => { if (e.currentTarget.scrollTop < 80) pedirAntigas() }}
              className="flex-1 overflow-y-auto px-3 py-4 sm:p-6 custom-scrollbar relative z-0"
            >
              {activeChat.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground/70">
                  <MessageSquare className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-sm">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                <>
                  {/* Rolar ao topo já pede; o botão é para quem não rola
                      (teclado, leitor de tela) e para dizer que há mais. */}
                  {temMaisAntigas && (
                    <div className="flex justify-center mb-2">
                      <button
                        type="button"
                        onClick={pedirAntigas}
                        disabled={carregandoAntigas}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground bg-card border border-border hover:text-foreground disabled:cursor-wait"
                      >
                        {carregandoAntigas && <Loader2 className="w-3 h-3 animate-spin" />}
                        Carregar anteriores
                      </button>
                    </div>
                  )}
                  {activeChat.messages.map((msg, i) => {
                    const anterior = activeChat.messages[i - 1]
                    const novoDia = !anterior || !mesmoDia(anterior.quandoIso, msg.quandoIso)
                    const primeiraDoGrupo = novoDia || anterior.autorId !== msg.autorId
                    return (
                      <React.Fragment key={msg.id}>
                        {novoDia && (
                          <div className="flex justify-center my-4" role="separator">
                            <span className="px-3 py-1 rounded-full bg-card border border-border text-[11px] font-medium text-muted-foreground shadow-sm">
                              {rotuloDia(msg.quandoIso)}
                            </span>
                          </div>
                        )}
                        <BolhaMensagem
                          msg={msg}
                          primeiraDoGrupo={primeiraDoGrupo}
                          destacada={destacada === msg.id}
                          aoResponder={setRespondendo}
                          aoEditar={setEditando}
                          aoApagar={setApagando}
                          aoIrPara={irPara}
                          aoEnviarSugestao={handleEnviarSugestao}
                          enviandoSugestao={enviandoSugestao === msg.id}
                        />
                      </React.Fragment>
                    )
                  })}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            <Compositor
              key={selectedId ?? ''}
              enviando={enviando}
              enviandoMidia={enviandoMidia}
              bloqueado={encerrada ? 'Conversa encerrada. Reabra pelo botão no topo para responder.' : null}
              respondendo={respondendo}
              nomeContato={activeChat.contactName}
              aoCancelarResposta={() => setRespondendo(null)}
              enviarTexto={enviar}
              enviarArquivo={enviarMidia}
            />
          </div>

          {showProfileInfo && (
            <PainelDetalhamento
              detalhe={detalhe}
              maiaAtendendo={modoIa?.modo === 'autonomous' || modoIa?.modo === 'assisted'}
              dados={{
                catalogoTags:     painel.catalogoTags,
                usuarios:         painel.usuarios,
                agendamentos:     painel.agendamentos,
                tarefas:          painel.tarefas,
                carregandoListas: painel.carregandoListas,
                sentimento:           painel.sentimento,
                carregandoSentimento: painel.carregandoSentimento,
                analisandoSentimento: painel.analisandoSentimento,
                erroSentimento:       painel.erroSentimento,
                ficha:           painel.ficha,
                carregandoFicha: painel.carregandoFicha,
                erroFicha:       painel.erroFicha,
              }}
              acoes={{
                salvarOrigem:        handleSalvarOrigem,
                salvarTags:          handleSalvarTags,
                trocarResponsavel:   handleTrocarResponsavel,
                salvandoResponsavel,
                agendarRetorno:      () => setAgendando(true),
                designarTarefa:      () => setDesignando(true),
                concluirTarefa:      handleConcluirTarefa,
                // `void`: o bloco não espera a promessa — o estado de
                // "analisando" já vive no hook e é ele que desenha o spinner.
                reanalisarSentimento: () => { void painel.reanalisarSentimento() },
                // Aqui a promessa É esperada: o bloco desenha o spinner do
                // botão de salvar enquanto ela não resolve, e fecha a edição
                // inline só depois que o servidor confirmou.
                salvarCampoFicha:     painel.salvarCampoFicha,
              }}
              aoFechar={() => setShowProfileInfo(false)}
            />
          )}

          {/* Montado só quando aberto: o modal semeia os campos no primeiro
              render, e mantê-lo montado guardaria o formulário de um contato
              anterior. */}
          {agendando && detalhe?.contact && (
            <ModalAgendarRetorno
              nomeContato={detalhe.contact.name?.trim() || 'Contato sem nome'}
              aoFechar={() => setAgendando(false)}
              aoConfirmar={handleAgendarRetorno}
            />
          )}

          {designando && detalhe?.contact && (
            <ModalDesignarTarefa
              nomeContato={detalhe.contact.name?.trim() || 'Contato sem nome'}
              usuarios={painel.usuarios}
              aoFechar={() => setDesignando(false)}
              aoConfirmar={handleDesignarTarefa}
            />
          )}

          {apagando && (
            <ModalApagarMensagem
              previa={apagando.content || apagando.anexos.map(a => a.nome ?? a.rotulo).join(', ')}
              paraTodos={apagando.apagaParaTodos}
              doContato={apagando.direction === MessageDirection.INCOMING}
              aoFechar={() => setApagando(null)}
              aoConfirmar={handleApagarMensagem}
            />
          )}

          {editando && (
            <ModalEditarMensagem
              textoAtual={editando.content}
              aoFechar={() => setEditando(null)}
              aoConfirmar={handleEditarMensagem}
            />
          )}

          {transferindo && (
            <ModalTransferir
              usuarios={painel.usuarios}
              atualId={detalhe?.assigned_user_id ?? null}
              aoFechar={() => setTransferindo(false)}
              aoConfirmar={async (toUserId, motivo) => {
                try {
                  await handleAcaoConversa({ action: 'transfer', toUserId, ...(motivo ? { reason: motivo } : {}) })
                  setTransferindo(false)
                } catch { /* toast já saiu; o modal fica aberto */ }
              }}
            />
          )}
        </div>
      ) : selectedId && loadingChat ? (
        // Entre o clique e a chegada do detalhe. Antes este intervalo mostrava o
        // vazio "Selecione uma conversa ao lado" — parecia que o clique não
        // tinha pegado, e quem clica de novo só reinicia a espera.
        <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-muted dark:bg-[#0B0E14]">
          <Loader2 className="h-7 w-7 animate-spin text-cyan-500" />
          <p className="text-sm text-muted-foreground/70">
            Abrindo a conversa{conversaSelecionada ? ` com ${conversaSelecionada.contactName}` : ''}...
          </p>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-muted dark:bg-[#0B0E14] relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center p-8 text-center max-w-md">
            <div className="w-24 h-24 bg-card rounded-full flex items-center justify-center mb-6 shadow-2xl border border-border relative group">
              <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl group-hover:bg-cyan-500/30 transition-all duration-1000"></div>
              <MessageSquare className="w-10 h-10 text-cyan-500" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Workspace</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {conversations.length === 0
                ? 'Aguardando novas conversas. Configure o webhook do WhatsApp para começar a receber mensagens.'
                : 'Selecione uma conversa ao lado para iniciar o atendimento inteligente.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Chave Maia / Atendente
//
// Quem responde ESTA conversa. Dois estados, porque é a pergunta que a
// recepcionista faz ao assumir um atendimento: continua a máquina, ou sou eu?
//
// Os DOIS lados ficam visíveis, num trilho só, em vez de um botão que alterna.
// Um botão que alterna obriga a ler o rótulo e adivinhar se ele diz o estado
// atual ou a ação — a dúvida mais cara possível num controle que decide se a IA
// fala com o paciente. Com os dois lados na tela, o pintado é o que vale e o
// apagado é para onde se vai.
//
// `assisted` (a IA escreve, um humano envia) existe no banco e o worker o
// respeita, mas o trilho não o produz: o rascunho ainda não tem lugar nesta
// tela, e oferecer um estado cujo resultado não aparece em canto nenhum seria
// pior que não oferecer. Quando ele estiver em vigor, cai no lado "Maia" —
// quem conduz é a IA.
//
// O lado pintado é o modo EFETIVO, já com a herança resolvida pelo servidor —
// uma conversa que ninguém tocou segue o padrão da clínica, e é esse padrão que
// precisa aparecer aqui. Ver 20260915220000.
// ----------------------------------------------------------------------------
const ChaveAtendimento: React.FC<{
  modo:     ModoIa | null
  salvando: boolean
  aoTrocar: (ligar: boolean) => void
}> = ({ modo, salvando, aoTrocar }) => {
  // Enquanto o detalhe não chegou não há o que mostrar. Um trilho desenhado com
  // palpite pisca para o outro lado quando a resposta chega.
  if (!modo) return null

  const ativa = modo.modo === 'autonomous' || modo.modo === 'assisted'

  const base = 'px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors disabled:cursor-wait'

  return (
    <div className="flex items-center gap-2 shrink-0">
      {modo.origem === 'padrao' && (
        <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
          padrão da clínica
        </span>
      )}

      {/* `group` para o trilho inteiro esmaecer enquanto o PATCH está no ar,
          sem que cada lado precise saber disso. */}
      <div
        role="group"
        aria-label="Quem atende esta conversa"
        className={`flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border border-border ${
          salvando ? 'opacity-60' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => !ativa && aoTrocar(true)}
          disabled={salvando}
          aria-pressed={ativa}
          title="A Maia responde esta conversa automaticamente."
          className={`${base} ${
            ativa
              ? 'bg-violet-500/25 text-violet-700 dark:text-violet-200'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {salvando && !ativa
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Bot className="w-3.5 h-3.5" />}
          Maia
        </button>

        <button
          type="button"
          onClick={() => ativa && aoTrocar(false)}
          disabled={salvando}
          aria-pressed={!ativa}
          title="A Maia para. O atendimento passa a ser humano."
          className={`${base} ${
            !ativa
              ? 'bg-emerald-500/25 text-emerald-700 dark:text-emerald-200'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
          }`}
        >
          {salvando && ativa
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <User className="w-3.5 h-3.5" />}
          Atendente
        </button>
      </div>
    </div>
  )
}

export default ChatInterface
