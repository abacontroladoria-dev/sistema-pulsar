'use client'

import React, { useState } from 'react'
import { X, Loader2 } from 'lucide-react'

// ----------------------------------------------------------------------------
// Agendar retorno — compromisso administrativo.
//
// NÃO reserva vaga na grade do TiTa. É um lembrete de voltar a falar com esta
// pessoa ("retornar sobre a documentação"), que é o que o operador precisa no
// meio de uma conversa. Reservar sessão de terapia é outra coisa, tem outra
// tela, e exige escolher profissional, terapia e sala.
//
// Por isso o POST vai sem `profissionalId`: a rota distingue as duas formas por
// esse campo, e sem ele cai em `criarAdministrativo`, fora da guarda de vaga
// ocupada.
// ----------------------------------------------------------------------------

// 'YYYY-MM-DD' no fuso LOCAL. `toISOString()` daria UTC e, à noite no Brasil,
// proporia o dia seguinte como mínimo — bloqueando o agendamento para hoje.
function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const ModalAgendarRetorno: React.FC<{
  nomeContato: string
  aoFechar:    () => void
  aoConfirmar: (dados: { titulo: string; data: string; hora: string | null; descricao: string | null }) => Promise<void>
}> = ({ nomeContato, aoFechar, aoConfirmar }) => {
  const [titulo, setTitulo]       = useState('Retorno')
  const [data, setData]           = useState(hojeLocal())
  const [hora, setHora]           = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando]   = useState(false)

  const podeSalvar = titulo.trim() !== '' && data !== '' && !salvando

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    if (!podeSalvar) return
    setSalvando(true)
    try {
      await aoConfirmar({
        titulo:    titulo.trim(),
        data,
        // A coluna é `time` e aceita null: retorno "algum dia 12/09" é um
        // lembrete legítimo, e exigir hora faria inventarem 09:00.
        hora:      hora === '' ? null : `${hora}:00`,
        descricao: descricao.trim() === '' ? null : descricao.trim(),
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
            <h3 className="text-sm font-bold text-foreground">Agendar retorno</h3>
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
            <span className="text-xs font-medium text-muted-foreground">Assunto</span>
            <input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={255}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Data</span>
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
                onChange={(e) => setHora(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Observação <span className="text-muted-foreground/70">(opcional)</span>
            </span>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 resize-none"
            />
          </label>

          <p className="text-[11px] text-muted-foreground/70">
            Isto é um lembrete de contato. Não reserva vaga na grade de terapias.
          </p>
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
            Agendar
          </button>
        </div>
      </form>
    </div>
  )
}
