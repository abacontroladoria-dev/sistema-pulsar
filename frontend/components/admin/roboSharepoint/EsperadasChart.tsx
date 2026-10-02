'use client'

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TONE_ACCENT } from '@/components/cronograma/ui/tones'
import { nomeCurtoPrestador, numero } from '@/lib/roboSharepoint/rotulos'
import type { EsperadasAnalista } from '@/lib/remuneracao/situacaoEntregasPep'

// Evidências esperadas no mês × as que já estão na pasta, por analista.
// Barra horizontal EMPILHADA: o comprimento total é o que se espera; a parte
// verde já está na pasta no padrão de nome e a cinza ainda falta. Barra
// horizontal porque o nome do analista é longo e a pergunta é "quem está
// mais longe de completar". Mesmo vocabulário do gráfico da Previsão de
// Receitas: grade tracejada leve, eixos cinza, tooltip escuro.

const COR = { naPasta: TONE_ACCENT.green, faltam: '#cbd5e1' }
const ALTURA_LINHA = 30
const INICIAIS = 12

type Linha = EsperadasAnalista & { rotulo: string }

function Dica({ active, payload }: { active?: boolean; payload?: { payload: Linha }[] }) {
  if (!active || !payload?.length) return null
  const l = payload[0].payload
  const linha = (cor: string, texto: string, valor: number) => (
    <div className="flex items-center justify-between gap-4 py-0.5 text-xs">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: cor }} /><span className="text-slate-300">{texto}</span></span>
      <span className="font-semibold tabular-nums text-white">{numero(valor)}</span>
    </div>
  )
  return (
    <div className="min-w-48 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white shadow-2xl">
      <p className="mb-2 text-sm font-semibold text-slate-200">{l.nome}</p>
      {linha('#94a3b8', 'Esperadas no mês', l.esperadas)}
      {linha(COR.naPasta, 'Na pasta, no padrão', l.naPasta)}
      {linha(COR.faltam, 'Ainda faltam', l.faltam)}
      {l.foraDoPadrao > 0 && <p className="mt-1.5 text-[11px] text-amber-300">{l.foraDoPadrao} na pasta fora do padrão de nome (não contam)</p>}
    </div>
  )
}

export function EsperadasChart({ analistas }: { analistas: EsperadasAnalista[] }) {
  const [todos, setTodos] = useState(false)
  // Quem está mais longe de completar primeiro.
  const ordenados = useMemo<Linha[]>(
    () => analistas.filter(a => a.esperadas > 0)
      .map(a => ({ ...a, rotulo: nomeCurtoPrestador(a.nome) }))
      .sort((x, y) => y.faltam - x.faltam || y.esperadas - x.esperadas || x.nome.localeCompare(y.nome)),
    [analistas],
  )
  if (ordenados.length === 0) return null
  const visiveis = todos ? ordenados : ordenados.slice(0, INICIAIS)
  const max = Math.max(...ordenados.map(a => a.esperadas), 1)

  return (
    <div>
      <div style={{ height: visiveis.length * ALTURA_LINHA + 28 }} role="img"
        aria-label={`Evidências esperadas no mês e quantas já estão na pasta, por analista: ${visiveis.map(a => `${a.nome} ${a.naPasta} de ${a.esperadas}`).join('; ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={visiveis} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.4} horizontal={false} />
            <XAxis type="number" domain={[0, max]} allowDecimals={false} tick={{ fontSize: 11, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false} />
            <YAxis type="category" dataKey="rotulo" width={112} interval={0} tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} />
            <Tooltip content={<Dica />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
            <Bar dataKey="naPasta" stackId="a" fill={COR.naPasta} maxBarSize={18} />
            <Bar dataKey="faltam" stackId="a" fill={COR.faltam} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.naPasta }} aria-hidden />na pasta, no padrão de nome</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR.faltam }} aria-hidden />ainda falta (o comprimento total é o esperado)</span>
        </div>
        {ordenados.length > INICIAIS && (
          <button type="button" onClick={() => setTodos(v => !v)} aria-expanded={todos}
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {todos ? 'Mostrar só os 12 mais longe de completar' : `Ver os ${ordenados.length} analistas`}
          </button>
        )}
      </div>
    </div>
  )
}
