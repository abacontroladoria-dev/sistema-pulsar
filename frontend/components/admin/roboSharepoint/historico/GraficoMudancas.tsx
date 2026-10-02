'use client'

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TONE_ACCENT } from '@/components/cronograma/ui/tones'
import { numero } from '@/lib/roboSharepoint/rotulos'
import type { PontoHistoricoEvidencias } from '@/types/roboSharepoint'

// Entradas × saídas de evidências no SharePoint, por dia ou por mês, com a
// linha de quantas estavam na pasta (retrato do dia). Mesmo vocabulário do
// gráfico da Previsão de Receitas (EvolucaoReceitasChart): grade tracejada
// leve, eixos cinza, tooltip escuro, cores de TONE_ACCENT. Saídas ficam
// ABAIXO do zero: o padrão que o usuário quer ver ("entregas surgem e depois
// são apagadas") aparece como barra para cima seguida de barra para baixo.

const COR = {
  entraram: TONE_ACCENT.green,
  sairam: TONE_ACCENT.red,
  naPasta: TONE_ACCENT.blue,
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function rotulo(periodo: string, grao: 'dia' | 'mes', longo = false) {
  const [a, m, d] = periodo.split('-')
  if (grao === 'mes') return longo ? `${MESES[Number(m) - 1]}/${a}` : `${MESES[Number(m) - 1]}/${a.slice(2)}`
  return longo ? `${d}/${m}/${a}` : `${d}/${m}`
}

type Ponto = PontoHistoricoEvidencias & { rotulo: string; saidas: number; entradas: number }

function Dica({ active, payload, grao }: { active?: boolean; payload?: { payload: Ponto }[]; grao: 'dia' | 'mes' }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const linha = (cor: string, texto: string, valor: number | null) => (
    <div className="flex items-center justify-between gap-4 py-0.5 text-xs">
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} /><span className="text-slate-300">{texto}</span></span>
      <span className="font-semibold tabular-nums text-white">{numero(valor)}</span>
    </div>
  )
  return (
    <div className="min-w-44 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white shadow-2xl">
      <p className="mb-2 text-sm font-semibold text-slate-200">{rotulo(p.periodo, grao, true)}</p>
      {linha(COR.entraram, 'Entraram', p.entradas)}
      {p.voltaram > 0 && <p className="-mt-0.5 pl-3.5 text-[11px] text-slate-400">{p.voltaram} delas voltaram depois de apagadas</p>}
      {linha(COR.sairam, 'Saíram', p.saidas)}
      {p.entregas_desfeitas > 0 && <p className="-mt-0.5 pl-3.5 text-[11px] text-slate-400">{p.entregas_desfeitas} entrega(s) retirada(s)</p>}
      {p.mantidas_mes_liberado > 0 && <p className="-mt-0.5 pl-3.5 text-[11px] text-slate-400">{p.mantidas_mes_liberado} em mês liberado (mantidas)</p>}
      {p.mudaram > 0 && <p className="mt-1 text-[11px] text-slate-400">{p.mudaram} renomeada(s) ou movida(s)</p>}
      <div className="mt-1.5 border-t border-slate-700 pt-1.5">
        {linha(COR.naPasta, grao === 'mes' ? 'Na pasta (fim do mês)' : 'Na pasta', p.na_pasta)}
      </div>
    </div>
  )
}

export function GraficoMudancas({ serie, grao }: { serie: PontoHistoricoEvidencias[]; grao: 'dia' | 'mes' }) {
  const pontos: Ponto[] = serie.map(s => ({
    ...s,
    rotulo: rotulo(s.periodo, grao),
    entradas: s.apareceram + s.voltaram,
    saidas: -s.sumiram,
  }))
  const temNaPasta = pontos.some(p => p.na_pasta != null)

  return (
    <div className="h-64 sm:h-72" role="img"
      aria-label={`Evidências que entraram e saíram das pastas ${grao === 'mes' ? 'por mês' : 'por dia'}, e quantas estavam na pasta`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={pontos} margin={{ top: 8, right: temNaPasta ? 4 : 8, left: 0, bottom: 0 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.4} vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: '#898781' }} axisLine={{ stroke: '#c3c2b7' }} tickLine={false}
            interval="preserveStartEnd" minTickGap={12} />
          <YAxis yAxisId="mov" tick={{ fontSize: 11, fill: '#898781' }} axisLine={false} tickLine={false} width={36}
            allowDecimals={false} tickFormatter={v => numero(Math.abs(Number(v)))} />
          {temNaPasta && (
            <YAxis yAxisId="pasta" orientation="right" tick={{ fontSize: 11, fill: COR.naPasta }} axisLine={false} tickLine={false}
              width={40} allowDecimals={false} />
          )}
          <ReferenceLine yAxisId="mov" y={0} stroke="#c3c2b7" />
          <Tooltip content={<Dica grao={grao} />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
          <Bar yAxisId="mov" dataKey="entradas" stackId="mov" fill={COR.entraram} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar yAxisId="mov" dataKey="saidas" stackId="mov" fill={COR.sairam} radius={[4, 4, 0, 0]} maxBarSize={28} />
          {temNaPasta && (
            <Line yAxisId="pasta" type="monotone" dataKey="na_pasta" stroke={COR.naPasta} strokeWidth={2}
              dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LegendaMudancas() {
  const item = (cor: string, texto: string, linha = false) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={linha ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: cor }} aria-hidden />
      {texto}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {item(COR.entraram, 'entraram (novas e que voltaram)')}
      {item(COR.sairam, 'saíram (apagadas ou fora do PEP)')}
      {item(COR.naPasta, 'evidências na pasta', true)}
    </div>
  )
}
