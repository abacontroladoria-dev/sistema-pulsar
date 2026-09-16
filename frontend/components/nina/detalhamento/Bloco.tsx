'use client'

import React from 'react'

// ----------------------------------------------------------------------------
// A casca de um bloco do painel.
//
// Seis blocos empilhados só se leem como seis coisas distintas se o título, o
// espaçamento e a posição da ação forem idênticos em todos. Centralizar isso
// aqui é o que impede o painel de virar seis layouts parecidos.
//
// `acao` fica no canto direito da mesma linha do título — é o "+" e o lápis da
// referência. Quem não tem ação não desenha nada ali.
// ----------------------------------------------------------------------------

export const Bloco: React.FC<{
  titulo:   string
  icone?:   React.ReactNode
  acao?:    React.ReactNode
  children: React.ReactNode
}> = ({ titulo, icone, acao, children }) => (
  <section className="space-y-3">
    <div className="flex items-center justify-between gap-2 min-h-[24px]">
      <h4 className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
        {icone}
        {titulo}
      </h4>
      {acao}
    </div>
    {children}
  </section>
)

// O estado vazio de um bloco. Itálico e apagado para não competir com conteúdo
// real: num painel de seis blocos, metade vazia é o normal, não um defeito.
export const Vazio: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-slate-500 italic">{children}</p>
)

// Botão de ação do cabeçalho (o "+" e o lápis). Alvo de 28px, que é o mínimo
// confortável para clicar sem mirar.
export const BotaoAcao: React.FC<{
  titulo:   string
  onClick:  () => void
  children: React.ReactNode
  disabled?: boolean
}> = ({ titulo, onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={titulo}
    aria-label={titulo}
    className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
  >
    {children}
  </button>
)

// Botão largo de "adicionar", usado onde a referência mostra "+ Agendar retorno"
// e "+ Designar tarefa": a ação é o conteúdo principal do bloco quando ele está
// vazio, então ocupa a largura toda em vez de se esconder no cabeçalho.
export const BotaoAdicionar: React.FC<{
  onClick:   () => void
  children:  React.ReactNode
  disabled?: boolean
}> = ({ onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-700 text-xs font-medium text-slate-400 hover:text-cyan-300 hover:border-cyan-600/60 hover:bg-slate-800/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    {children}
  </button>
)
