'use client'

import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { UsuarioAtribuivel } from './BlocoResponsavel'

// ----------------------------------------------------------------------------
// Designar tarefa.
//
// O prazo é opcional e a data vem separada da hora: quem atende pensa em "até
// sexta", não em um instante ISO. A junção acontece aqui, uma vez, na borda.
// ----------------------------------------------------------------------------

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const ModalDesignarTarefa: React.FC<{
  nomeContato: string
  usuarios:    UsuarioAtribuivel[]
  aoFechar:    () => void
  aoConfirmar: (dados: {
    title: string; description: string | null
    assignedUserId: string | null; dueAt: string | null
  }) => Promise<void>
}> = ({ nomeContato, usuarios, aoFechar, aoConfirmar }) => {
  const [titulo, setTitulo]           = useState('')
  const [descricao, setDescricao]     = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [data, setData]               = useState('')
  const [hora, setHora]               = useState('')
  const [salvando, setSalvando]       = useState(false)

  const podeSalvar = titulo.trim() !== '' && !salvando

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    if (!podeSalvar) return
    setSalvando(true)
    try {
      // Sem data não há prazo. Com data e sem hora, o fim do dia: "até sexta"
      // vence quando sexta acaba, não às 00:00 — que seria quinta à noite.
      //
      // O Date é construído com componentes locais (não `new Date(string)`),
      // que interpretaria 'YYYY-MM-DD' como UTC e voltaria um dia no Brasil.
      let dueAt: string | null = null
      if (data !== '') {
        const [a, m, d] = data.split('-').map(Number)
        const [h, min]  = hora !== '' ? hora.split(':').map(Number) : [23, 59]
        dueAt = new Date(a, m - 1, d, h, min, 0).toISOString()
      }

      await aoConfirmar({
        title:          titulo.trim(),
        description:    descricao.trim() === '' ? null : descricao.trim(),
        assignedUserId: responsavel === '' ? null : responsavel,
        dueAt,
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm p-4"
      onClick={aoFechar}
    >
      <form
        onSubmit={confirmar}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-foreground">Designar tarefa</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{nomeContato}</p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">O que precisa ser feito</span>
            <input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: confirmar documentação com a responsável"
              maxLength={255}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Responsável <span className="text-muted-foreground/70">(opcional)</span>
            </span>
            <select
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
            >
              <option value="">Qualquer um</option>
              {usuarios.map(u => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Prazo <span className="text-muted-foreground/70">(opcional)</span>
              </span>
              <input
                type="date"
                value={data}
                min={hojeLocal()}
                onChange={(e) => setData(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Hora <span className="text-muted-foreground/70">(opcional)</span>
              </span>
              <input
                type="time"
                value={hora}
                disabled={data === ''}
                onChange={(e) => setHora(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-40"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Detalhes <span className="text-muted-foreground/70">(opcional)</span>
            </span>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 resize-none"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border bg-card">
          <button
            type="button"
            onClick={aoFechar}
            className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!podeSalvar}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-cyan-600 text-foreground hover:bg-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Criar tarefa
          </button>
        </div>
      </form>
    </div>
  )
}
