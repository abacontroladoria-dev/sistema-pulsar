'use client'

import React, { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'

import type { UsuarioAtribuivel } from './detalhamento/BlocoResponsavel'

// ============================================================================
// Modais pequenos da conversa: editar mensagem e transferir.
// Mesma moldura do ModalApagarMensagem — Esc e clique fora fecham, mas não
// enquanto o pedido está no ar.
// ============================================================================

const Moldura: React.FC<{
  titulo:   string
  ocupado:  boolean
  aoFechar: () => void
  children: React.ReactNode
}> = ({ titulo, ocupado, aoFechar, children }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar, ocupado])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={() => { if (!ocupado) aoFechar() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">{titulo}</h3>
          <button
            type="button"
            onClick={aoFechar}
            disabled={ocupado}
            aria-label="Fechar"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const botaoPrimario = 'px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-600 to-teal-600 text-white hover:from-cyan-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2'
const botaoSecundario = 'px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50'

export const ModalEditarMensagem: React.FC<{
  textoAtual:  string
  aoFechar:    () => void
  aoConfirmar: (texto: string) => Promise<void>
}> = ({ textoAtual, aoFechar, aoConfirmar }) => {
  const [texto, setTexto] = useState(textoAtual)
  const [salvando, setSalvando] = useState(false)
  const mudou = texto.trim() !== textoAtual.trim() && texto.trim().length > 0

  const salvar = async () => {
    if (!mudou) return
    setSalvando(true)
    try { await aoConfirmar(texto.trim()) } finally { setSalvando(false) }
  }

  return (
    <Moldura titulo="Editar mensagem" ocupado={salvando} aoFechar={aoFechar}>
      <div className="p-5 space-y-3">
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void salvar() }
          }}
          autoFocus
          rows={4}
          maxLength={4096}
          className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-cyan-500/30 resize-none"
        />
        <p className="text-xs text-muted-foreground">
          O texto muda também no WhatsApp do contato, com a marca &quot;Editada&quot;.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
        <button type="button" onClick={aoFechar} disabled={salvando} className={botaoSecundario}>Cancelar</button>
        <button type="button" onClick={() => void salvar()} disabled={!mudou || salvando} className={botaoPrimario}>
          {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      </div>
    </Moldura>
  )
}

export const ModalTransferir: React.FC<{
  usuarios:    UsuarioAtribuivel[]
  atualId:     string | null
  aoFechar:    () => void
  aoConfirmar: (toUserId: string, motivo: string) => Promise<void>
}> = ({ usuarios, atualId, aoFechar, aoConfirmar }) => {
  const [destino, setDestino] = useState<string>('')
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const opcoes = usuarios.filter(u => u.id !== atualId)

  const salvar = async () => {
    if (!destino) return
    setSalvando(true)
    try { await aoConfirmar(destino, motivo.trim()) } finally { setSalvando(false) }
  }

  return (
    <Moldura titulo="Transferir conversa" ocupado={salvando} aoFechar={aoFechar}>
      <div className="p-5 space-y-3">
        <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
          {opcoes.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Ninguém mais para receber a conversa.</p>
          ) : opcoes.map(u => (
            <label key={u.id} className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer hover:bg-muted">
              <input
                type="radio"
                name="destino-transferencia"
                value={u.id}
                checked={destino === u.id}
                onChange={() => setDestino(u.id)}
                className="accent-cyan-600"
              />
              <span className="text-foreground">{u.nome}</span>
            </label>
          ))}
        </div>
        <input
          type="text"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Motivo (opcional)"
          maxLength={200}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-cyan-500/30"
        />
      </div>
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
        <button type="button" onClick={aoFechar} disabled={salvando} className={botaoSecundario}>Cancelar</button>
        <button type="button" onClick={() => void salvar()} disabled={!destino || salvando} className={botaoPrimario}>
          {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
          Transferir
        </button>
      </div>
    </Moldura>
  )
}
