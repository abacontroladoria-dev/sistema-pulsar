'use client'

import React, { useState, useRef, useEffect } from 'react'
import {
  Search, MessageSquare, Loader2, Info, Bot, User, Pause, Send, Check, CheckCheck, ShieldAlert, AlertCircle, WifiOff
} from 'lucide-react'
import { ConversationStatus, MessageDirection } from '@/types/nina'
import { useCentralInbox, type ModoIa } from '@/hooks/nina/useCentralInbox'
import { usePainelDetalhamento } from '@/hooks/nina/usePainelDetalhamento'
import { Avatar } from './Avatar'
import { PainelDetalhamento } from './detalhamento/PainelDetalhamento'
import { ModalAgendarRetorno } from './detalhamento/ModalAgendarRetorno'
import { ModalDesignarTarefa } from './detalhamento/ModalDesignarTarefa'
import { Button } from './Button'
import { toast } from 'sonner'

const ChatInterface: React.FC = () => {
  const {
    conversations, activeChat, selectedId, select,
    loading, erro, enviar, enviando,
    modoIa, definirModoIa, salvandoModo,
    detalhe, recarregarDetalhe,
  } = useCentralInbox()

  // Fontes do painel que não vêm no detalhe da conversa (catálogo de tags,
  // usuários, agendamentos, tarefas). Fora do polling — ver o hook.
  const painel = usePainelDetalhamento(detalhe?.contact?.id ?? null)
  const [salvandoResponsavel, setSalvandoResponsavel] = useState(false)
  const [agendando, setAgendando] = useState(false)
  const [designando, setDesignando] = useState(false)

  const [inputText, setInputText] = useState('')
  const [showProfileInfo, setShowProfileInfo] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const setSelectedChatId = select
  const selectedChatId    = selectedId

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Depende do COMPRIMENTO, não do array: o polling substitui o array a cada 5s
  // e rolar a cada tique roubaria a rolagem de quem está lendo o histórico.
  useEffect(() => {
    scrollToBottom()
  }, [activeChat?.messages.length])

  const filteredConversations = conversations.filter(chat => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      chat.contactName.toLowerCase().includes(query) ||
      chat.contactPhone.includes(query) ||
      chat.lastMessage.toLowerCase().includes(query)
    )
  })

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

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!inputText.trim() || !activeChat || enviando) return

    const texto = inputText
    try {
      await enviar(texto)
      // Limpa só DEPOIS do sucesso. O envio passa pela Meta e pode falhar
      // (janela de 24h fechada, token expirado); limpar antes faria o operador
      // reescrever a mensagem inteira.
      setInputText('')
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
      <div className="flex h-full bg-slate-950 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <ShieldAlert className="h-10 w-10 text-amber-500" />
          <h2 className="text-lg font-bold text-white">Sem acesso à Central</h2>
          <p className="text-sm text-slate-400">{erro.mensagem}</p>
          <p className="text-xs text-slate-500">
            Um administrador precisa liberar seu usuário para a Central de Atendimento.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full bg-slate-950 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-sm text-slate-500">Sincronizando conversas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-slate-950 overflow-hidden">
      <div className="w-80 lg:w-96 border-r border-slate-800 flex flex-col bg-slate-900/50 backdrop-blur-md z-20 flex-shrink-0">
        <div className="p-4 border-b border-slate-800/50">
          <h2 className="text-lg font-bold text-white mb-4 px-1">Chats Ativos</h2>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
            <input
              type="text"
              placeholder="Buscar conversa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none text-slate-200 placeholder:text-slate-600 transition-all"
            />
          </div>
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
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center">
              <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-sm">Nenhuma conversa encontrada</p>
              <p className="text-xs mt-1 opacity-70">As conversas aparecerão aqui quando receberem mensagens</p>
            </div>
          ) : (
            filteredConversations.map((chat) => (
              <div
                key={chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                className={`flex items-center p-4 cursor-pointer transition-all duration-200 border-b border-slate-800/30 hover:bg-slate-800/50 ${
                  selectedChatId === chat.id
                    ? 'bg-slate-800/80 border-l-2 border-l-cyan-500'
                    : 'border-l-2 border-l-transparent'
                }`}
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-slate-700 to-slate-900">
                    <Avatar url={chat.contactAvatar} nome={chat.contactName} />
                  </div>
                  {/* O ponto pulsante cyan sinalizava não-lidas. Não existe
                      registro de leitura por usuário no schema, então ele
                      pulsaria sempre ou nunca — fica o ponto neutro. */}
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-slate-600 border-2 border-slate-900 rounded-full"></span>
                </div>

                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <h3 className={`text-sm font-semibold truncate ${selectedChatId === chat.id ? 'text-white' : 'text-slate-300'}`}>
                      {chat.contactName}
                    </h3>
                    <span className="text-[10px] text-slate-500 font-medium">{chat.lastMessageTime}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{chat.lastMessage}</p>

                  {/* A badge numérica de não-lidas saiu: central.conversations
                      não tem registro de leitura por usuário, então o número
                      seria sempre inventado. Um "3" falso é pior que nada — o
                      operador confia nele e deixa de abrir a conversa que tem
                      mensagem nova de verdade. */}
                  <div className="flex items-center mt-2 gap-1.5">
                    {renderStatusBadge(chat.status)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {activeChat ? (
        <div className="flex-1 flex overflow-hidden bg-[#0B0E14]">
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="h-16 px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-10 shrink-0">
              <div className="flex items-center cursor-pointer hover:bg-slate-800/50 p-1.5 -ml-1.5 rounded-lg transition-colors pr-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full ring-2 ring-slate-800 overflow-hidden">
                    <Avatar url={activeChat.contactAvatar} nome={activeChat.contactName} />
                  </div>
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full"></span>
                </div>
                <div className="ml-3">
                  <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    {activeChat.contactName}
                    {/* A badge sai de `ai_mode` cru e não enxerga a herança
                        (o adapter não conhece o agent_settings). A chave ao
                        lado mostra o modo efetivo e é a fonte a acreditar;
                        suprimir a badge aqui evita as duas se contradizerem
                        numa conversa que segue o padrão da clínica. */}
                    {modoIa?.origem === 'conversa' && renderStatusBadge(activeChat.status)}
                  </h2>
                  <p className="text-xs text-cyan-500 font-medium">{activeChat.contactPhone}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <ChaveAtendimento
                  modo={modoIa}
                  salvando={salvandoModo}
                  aoTrocar={handleTrocarModo}
                />

                {/* O X do painel só escondia, e não havia como trazê-lo de
                    volta sem recarregar a página. Com seis blocos de ficha lá
                    dentro, fechar por engano custava caro demais. */}
                {!showProfileInfo && (
                  <button
                    type="button"
                    onClick={() => setShowProfileInfo(true)}
                    title="Abrir o detalhamento"
                    aria-label="Abrir o detalhamento"
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                  >
                    <Info className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative z-0">
              {activeChat.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <MessageSquare className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-sm">Nenhuma mensagem ainda</p>
                </div>
              ) : (
                activeChat.messages.map((msg) => {
                  const isOutgoing = msg.direction === MessageDirection.OUTGOING
                  return (
                    <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                      <div className={`flex flex-col max-w-[75%] ${isOutgoing ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`px-5 py-3 rounded-2xl shadow-md relative text-sm leading-relaxed whitespace-pre-wrap ${
                            // Rascunho da IA: silhueta diferente, não só cor.
                            // Precisa ser óbvio que esta mensagem NÃO saiu.
                            msg.isAiDraft
                              ? 'bg-violet-500/10 text-violet-100 border border-dashed border-violet-500/40 rounded-tr-sm'
                              : isOutgoing
                                ? 'bg-gradient-to-br from-cyan-600 to-teal-700 text-white rounded-tr-sm'
                                : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700/50'
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div className="flex items-center mt-1.5 gap-1.5 text-[10px] px-1">
                          {msg.isAiDraft && (
                            <span className="text-violet-400 font-medium">
                              Sugestão da Maia — não enviada
                            </span>
                          )}
                          <span className="text-slate-500 opacity-60">{msg.timestamp}</span>
                          {/* Tique só quando a mensagem realmente saiu.
                              Rascunho e falha não recebem: antes, o `else` final
                              desenhava um Check para QUALQUER status, então
                              'pending' e 'failed' apareciam como enviadas. */}
                          {isOutgoing && !msg.isAiDraft && (
                            msg.failed              ? <AlertCircle className="w-3.5 h-3.5 text-rose-500" /> :
                            msg.emTransito          ? <Loader2 className="w-3 h-3 text-slate-500 animate-spin" /> :
                            msg.status === 'read'   ? <CheckCheck  className="w-3.5 h-3.5 text-cyan-500" /> :
                            msg.status === 'delivered' ? <CheckCheck className="w-3.5 h-3.5 text-slate-500" /> :
                            <Check className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          {msg.failed && (
                            <span className="text-rose-400">Não entregue</span>
                          )}
                          {msg.emTransito && (
                            <span className="text-slate-500">Não confirmada</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm z-10">
              <form onSubmit={handleSendMessage} className="flex items-end gap-3 max-w-4xl mx-auto">
                <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 focus-within:ring-2 focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50 transition-all shadow-inner">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendMessage()
                      }
                    }}
                    placeholder="Digite sua mensagem..."
                    className="w-full bg-transparent border-none p-3.5 max-h-32 min-h-[48px] text-sm text-slate-200 focus:ring-0 resize-none outline-none placeholder:text-slate-600"
                    rows={1}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!inputText.trim() || enviando}
                  className={`rounded-full w-12 h-12 p-0 transition-all ${
                    inputText.trim() && !enviando
                      ? 'shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95'
                      : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  {enviando
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <Send className="w-5 h-5 ml-0.5" />}
                </Button>
              </form>
            </div>
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
              }}
              acoes={{
                salvarOrigem:        handleSalvarOrigem,
                salvarTags:          handleSalvarTags,
                trocarResponsavel:   handleTrocarResponsavel,
                salvandoResponsavel,
                agendarRetorno:      () => setAgendando(true),
                designarTarefa:      () => setDesignando(true),
                concluirTarefa:      handleConcluirTarefa,
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
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0E14] relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center p-8 text-center max-w-md">
            <div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-6 shadow-2xl border border-slate-800 relative group">
              <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl group-hover:bg-cyan-500/30 transition-all duration-1000"></div>
              <MessageSquare className="w-10 h-10 text-cyan-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Workspace</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
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
        <span className="text-[10px] text-slate-500 hidden sm:inline">
          padrão da clínica
        </span>
      )}

      {/* `group` para o trilho inteiro esmaecer enquanto o PATCH está no ar,
          sem que cada lado precise saber disso. */}
      <div
        role="group"
        aria-label="Quem atende esta conversa"
        className={`flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-800/60 border border-slate-700/60 ${
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
              ? 'bg-violet-500/25 text-violet-200'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
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
              ? 'bg-emerald-500/25 text-emerald-200'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
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
