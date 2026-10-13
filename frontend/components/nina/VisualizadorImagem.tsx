'use client'

import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink } from 'lucide-react'

// ============================================================================
// Foto em tamanho real — a do contato (lupa do avatar) e as imagens da conversa.
//
// Em portal no <body>: o avatar mora dentro de molduras com `overflow-hidden` e
// `rounded-full`, que cortariam um overlay renderizado no lugar.
//
// `role="dialog"` não é só acessibilidade: é por ele que o Esc da conversa
// (ChatInterface) sabe que há algo por cima e deixa este Esc fechar só a foto.
// ============================================================================

export const VisualizadorImagem: React.FC<{
  url:      string
  titulo:   string
  aoFechar: () => void
}> = ({ url, titulo, aoFechar }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      onClick={aoFechar}
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 p-4 sm:p-8"
    >
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          title="Abrir em nova aba"
          aria-label="Abrir em nova aba"
          className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={titulo}
        onClick={e => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
      />
    </div>,
    document.body,
  )
}

export default VisualizadorImagem
