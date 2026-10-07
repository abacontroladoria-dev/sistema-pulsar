'use client'

import React from 'react'
import { Check, CheckCheck, AlertCircle, Loader2, Trash2, Reply, Pencil } from 'lucide-react'

import { MessageDirection } from '@/types/nina'
import type { NinaMessage } from './adapters/centralToNina'
import { ChipAnexo } from './ChipAnexo'
import { textoWhatsApp } from './textoWhatsApp'

// ============================================================================
// Uma mensagem da conversa
//
// Saiu do ChatInterface quando ganhou responder, editar e citação — a bolha já
// era o maior bloco do arquivo.
//
// `primeiraDoGrupo`: mensagens seguidas da mesma pessoa ficam juntas, e só a
// primeira tem o "bico" (canto reto). É o que deixa uma rajada de cinco
// mensagens do contato legível como uma fala só.
// ============================================================================

interface Props {
  msg:             NinaMessage
  primeiraDoGrupo: boolean
  destacada:       boolean
  aoResponder:     (m: NinaMessage) => void
  aoEditar:        (m: NinaMessage) => void
  aoApagar:        (m: NinaMessage) => void
  aoIrPara:        (id: string) => void
}

const acao = 'p-0.5 rounded text-muted-foreground/70 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100'

export const BolhaMensagem: React.FC<Props> = ({
  msg, primeiraDoGrupo, destacada, aoResponder, aoEditar, aoApagar, aoIrPara,
}) => {
  const isOutgoing = msg.direction === MessageDirection.OUTGOING
  const claro = isOutgoing && !msg.isAiDraft
  const bico = primeiraDoGrupo ? (isOutgoing ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group flex ${isOutgoing ? 'justify-end' : 'justify-start'} ${primeiraDoGrupo ? 'mt-4' : 'mt-1'}`}
    >
      <div className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${isOutgoing ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl shadow-md relative text-sm leading-relaxed whitespace-pre-wrap break-words transition-shadow ${bico} ${
            destacada ? 'ring-2 ring-amber-400' : ''
          } ${
            // Rascunho da IA: silhueta diferente, não só cor.
            // Precisa ser óbvio que esta mensagem NÃO saiu.
            msg.isAiDraft
              ? 'bg-violet-500/10 text-violet-700 dark:text-violet-200 border border-dashed border-violet-500/40'
              : isOutgoing
                ? 'bg-gradient-to-br from-cyan-600 to-teal-700 text-white'
                : 'bg-muted text-foreground border border-border'
          }`}
        >
          {msg.citacao && (
            <button
              type="button"
              onClick={() => aoIrPara(msg.citacao!.id)}
              className={`mb-1.5 block w-full text-left rounded-lg border-l-4 px-2.5 py-1.5 text-xs ${
                claro
                  ? 'border-white/70 bg-white/15 hover:bg-white/20'
                  : 'border-cyan-500 bg-background/70 hover:bg-background'
              }`}
            >
              {msg.citacao.autor && (
                <span className={`block font-semibold ${claro ? 'text-white' : 'text-cyan-600 dark:text-cyan-400'}`}>
                  {msg.citacao.autor}
                </span>
              )}
              <span className={`line-clamp-2 ${claro ? 'text-white/80' : 'text-muted-foreground'}`}>
                {msg.citacao.previa}
              </span>
            </button>
          )}

          {/* Anexo primeiro, legenda depois — é a ordem do WhatsApp. */}
          {msg.anexos.length > 0 && (
            <div className={`flex flex-col gap-1.5 ${msg.content ? 'mb-2' : ''}`}>
              {msg.anexos.map(a => <ChipAnexo key={a.id} anexo={a} claro={claro} />)}
            </div>
          )}
          {msg.content && textoWhatsApp(msg.content, claro)}
        </div>

        <div className="flex items-center mt-1 gap-1.5 text-[10px] px-1">
          {msg.isAiDraft && (
            <span className="text-violet-400 font-medium">Sugestão da Maia — não enviada</span>
          )}
          {msg.editada && <span className="text-muted-foreground/70 italic">Editada</span>}
          <span className="text-muted-foreground/70 opacity-60">{msg.timestamp}</span>
          {/* Tique só quando a mensagem realmente saiu. */}
          {isOutgoing && !msg.isAiDraft && (
            msg.failed                 ? <AlertCircle className="w-3.5 h-3.5 text-rose-500" /> :
            msg.emTransito             ? <Loader2 className="w-3 h-3 text-muted-foreground/70 animate-spin" /> :
            msg.status === 'read'      ? <CheckCheck className="w-3.5 h-3.5 text-cyan-500" /> :
            msg.status === 'delivered' ? <CheckCheck className="w-3.5 h-3.5 text-muted-foreground/70" /> :
            <Check className="w-3.5 h-3.5 text-muted-foreground/70" />
          )}
          {msg.failed && <span className="text-rose-400">Não entregue</span>}
          {msg.emTransito && <span className="text-muted-foreground/70">Não confirmada</span>}

          {/* Ações no hover — fixas em toda bolha seriam ruído. Em tela de
              toque não há hover, então lá ficam sempre visíveis. */}
          {!msg.isAiDraft && !msg.failed && (
            <button
              type="button"
              onClick={() => aoResponder(msg)}
              title="Responder"
              aria-label="Responder"
              className={`${acao} hover:text-cyan-500 hover:bg-cyan-500/10`}
            >
              <Reply className="w-3.5 h-3.5" />
            </button>
          )}
          {msg.podeEditar && (
            <button
              type="button"
              onClick={() => aoEditar(msg)}
              title="Editar (até 15 min após o envio)"
              aria-label="Editar mensagem"
              className={`${acao} hover:text-foreground hover:bg-muted`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => aoApagar(msg)}
            title={msg.apagaParaTodos ? 'Apagar para todos' : 'Apagar do Pulsar'}
            aria-label="Apagar mensagem"
            className={`${acao} hover:text-rose-500 hover:bg-rose-500/10`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
