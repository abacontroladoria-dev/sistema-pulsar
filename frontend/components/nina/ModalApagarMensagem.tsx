'use client'

import React, { useEffect, useState } from 'react'
import { X, Loader2, Trash2 } from 'lucide-react'

// ----------------------------------------------------------------------------
// Confirmação do "Apagar" da bolha.
//
// O texto muda conforme o que vai acontecer de verdade, e é a parte que
// importa: "apagar" numa mensagem nossa recente de número Evolution tira a
// mensagem do celular do contato; em qualquer outro caso ela só some do Pulsar e
// o contato continua com ela. Um aviso único para os dois faria a atendente
// acreditar que corrigiu um envio errado quando o paciente ainda está lendo.
//
// Esc e clique fora fecham, como nos outros modais da inbox — mas não enquanto o
// pedido está no ar: fechar no meio deixaria a pessoa sem saber se apagou.
// ----------------------------------------------------------------------------

export const ModalApagarMensagem: React.FC<{
  previa:         string
  paraTodos:      boolean
  // Mensagem do contato (entrada). Só muda o texto: ela nunca sai do celular dele.
  doContato:      boolean
  aoFechar:       () => void
  aoConfirmar:    () => Promise<void>
}> = ({ previa, paraTodos, doContato, aoFechar, aoConfirmar }) => {
  const [apagando, setApagando] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !apagando) aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar, apagando])

  const confirmar = async () => {
    setApagando(true)
    try {
      await aoConfirmar()
    } finally {
      setApagando(false)
    }
  }

  const explicacao = paraTodos
    ? 'A mensagem será apagada no WhatsApp do contato e some desta conversa.'
    : doContato
      ? 'A mensagem some desta conversa no Pulsar. Ela continua no WhatsApp do contato, que foi quem a enviou.'
      : 'A mensagem some desta conversa no Pulsar, mas continua no WhatsApp do contato. O número oficial da Maia não permite apagar, e nos outros números só dá para apagar para todos até cerca de 2 dias depois do envio.'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={() => { if (!apagando) aoFechar() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="titulo-apagar-mensagem"
        aria-describedby="texto-apagar-mensagem"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 id="titulo-apagar-mensagem" className="text-sm font-bold text-foreground">
            {paraTodos ? 'Apagar para todos?' : 'Apagar do Pulsar?'}
          </h3>
          <button
            type="button"
            onClick={aoFechar}
            disabled={apagando}
            aria-label="Fechar"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {previa && (
            <p className="text-sm text-foreground bg-muted border border-border rounded-xl px-3 py-2 line-clamp-3 whitespace-pre-wrap">
              {previa}
            </p>
          )}
          <p id="texto-apagar-mensagem" className="text-sm text-muted-foreground">
            {explicacao}
          </p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-card">
          <button
            type="button"
            onClick={aoFechar}
            disabled={apagando}
            autoFocus
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={apagando}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-rose-600 text-white hover:bg-rose-500 transition-colors disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
          >
            {apagando
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
            {paraTodos ? 'Apagar para todos' : 'Apagar do Pulsar'}
          </button>
        </div>
      </div>
    </div>
  )
}
