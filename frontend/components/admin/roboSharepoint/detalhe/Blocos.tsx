'use client'

import { createContext, useContext } from 'react'
import { X, type LucideIcon } from 'lucide-react'
import { useCountUp } from '@/components/cronograma/remuneracao/RemuneracaoRPDashboard'
import { TONE_CHIP, TONE_PANEL } from '@/components/ui/tones'
import type { Tone } from '@/hooks/useToneColor'
import { numero } from '@/lib/roboSharepoint/rotulos'

// Peças da gaveta "O que o robô leu", na mesma linguagem das telas de Laudos
// (PainelIndicadores) e da Rem. Mês - Total (RemuneracaoRPDashboard):
// ladrilhos pastel que filtram, número que conta até o valor, barras que se
// preenchem por clip-path, rótulos em caixa alta pequenos e tokens
// semânticos (bg-card / border-border / text-muted-foreground) para o tema
// escuro. Um tom = um significado em toda a gaveta (ver TOM abaixo).

/**
 * Camada dos modais abertos DE DENTRO da gaveta: sempre acima dela, esteja a
 * gaveta na camada normal ou empilhada sobre o histórico.
 */
export const CamadaModal = createContext<number>(80)
export const useCamadaModal = () => useContext(CamadaModal)

/** O tom de cada conceito, igual em ladrilho, chip, barra e lista. */
export const TOM = {
  evidencia: 'blue',
  planilha: 'gray',
  ignorado: 'gray',
  fora_padrao: 'amber',
  removido: 'gray',
  sugerido: 'blue',
  confirmado: 'green',
  ignorado_rp: 'gray',
  reconhecido: 'green',
  nao_reconhecido: 'amber',
  sugestao: 'blue',
} as const satisfies Record<string, Tone>

const TEXTO_FORTE: Record<Tone, string> = {
  green: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-rose-700 dark:text-rose-400',
  purple: 'text-purple-700 dark:text-purple-400',
  blue: 'text-sky-700 dark:text-sky-400',
  gray: 'text-foreground',
}
const BORDA: Record<Tone, { base: string; ativo: string; barra: string }> = {
  green: { base: 'border-emerald-100 dark:border-emerald-900/60', ativo: 'border-emerald-400 ring-1 ring-emerald-400/30 dark:border-emerald-700', barra: 'bg-emerald-500' },
  amber: { base: 'border-amber-100 dark:border-amber-900/60', ativo: 'border-amber-400 ring-1 ring-amber-400/30 dark:border-amber-700', barra: 'bg-amber-500' },
  red: { base: 'border-rose-100 dark:border-rose-900/60', ativo: 'border-rose-400 ring-1 ring-rose-400/30 dark:border-rose-700', barra: 'bg-rose-500' },
  purple: { base: 'border-purple-100 dark:border-purple-900/60', ativo: 'border-purple-400 ring-1 ring-purple-400/30', barra: 'bg-purple-500' },
  blue: { base: 'border-sky-100 dark:border-sky-900/60', ativo: 'border-sky-400 ring-1 ring-sky-400/30 dark:border-sky-700', barra: 'bg-sky-500' },
  gray: { base: 'border-border', ativo: 'border-slate-400 ring-1 ring-slate-400/30 dark:border-slate-500', barra: 'bg-slate-400 dark:bg-slate-500' },
}
export const corBarra = (t: Tone) => BORDA[t].barra

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[75ch] text-[15px] leading-relaxed text-foreground/90">{children}</p>
}

export function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</p>
}

/** Cabeçalho de bloco: ladrilho de ícone + título + subtítulo + contagem. */
export function Bloco({ icone: Icone, titulo, subtitulo, contagem, children }: {
  icone: LucideIcon
  titulo: string
  subtitulo?: React.ReactNode
  contagem?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
          <Icone className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold leading-tight text-foreground">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        {contagem != null && (
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">{contagem}</span>
        )}
      </header>
      {children}
    </section>
  )
}

/**
 * Ladrilho da "visão geral" (CardGrande de Laudos): pastel, número grande que
 * conta até o valor. Com `onClick`, filtra — clicar de novo desfaz.
 */
export function Ladrilho({ icone: Icone, tom, valor, rotulo, sub, ativo, apagado, onClick, formato }: {
  icone: LucideIcon
  tom: Tone
  valor: number
  rotulo: string
  sub?: string
  ativo?: boolean
  /** Outro ladrilho está selecionado: este esmaece. */
  apagado?: boolean
  onClick?: () => void
  formato?: (n: number) => string
}) {
  const animado = useCountUp(valor)
  const zero = valor === 0
  const t: Tone = zero ? 'gray' : tom
  const conteudo = (
    <>
      <Icone className={`h-5 w-5 ${zero ? 'text-muted-foreground' : TEXTO_FORTE[t]}`} aria-hidden />
      <span className={`text-2xl font-bold leading-none tabular-nums sm:text-3xl ${zero ? 'text-muted-foreground' : TEXTO_FORTE[t]}`}>
        {formato ? formato(Math.round(animado)) : numero(Math.round(animado))}
      </span>
      <span className="text-xs font-semibold leading-tight text-muted-foreground sm:text-sm">{rotulo}</span>
      {sub && <span className="text-[11px] leading-tight text-muted-foreground/80">{sub}</span>}
    </>
  )
  const base = `flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center sm:px-3 sm:py-4 ${TONE_PANEL[t].bg} ${ativo ? BORDA[t].ativo : BORDA[t].base}`
  if (!onClick || zero) return <div className={`${base} shadow-sm transition-opacity ${apagado ? 'opacity-40' : ''}`}>{conteudo}</div>
  return (
    <button type="button" aria-pressed={!!ativo} onClick={onClick}
      className={`${base} shadow-sm transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${apagado ? 'opacity-40 hover:opacity-100' : ''}`}>
      {conteudo}
    </button>
  )
}

export function Ladrilhos({ children, colunas = 4 }: { children: React.ReactNode; colunas?: 3 | 4 }) {
  return <div className={`grid grid-cols-2 gap-2 sm:gap-3 ${colunas === 3 ? 'sm:grid-cols-3' : 'lg:grid-cols-4'}`}>{children}</div>
}

/** Barra que se preenche (clip-path, mola suave) — composição ou ranking. */
export function Barra({ pct, cor, alta = false }: { pct: number; cor: string; alta?: boolean }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <span className={`block w-full overflow-hidden rounded-full bg-muted ${alta ? 'h-2.5' : 'h-2'}`}>
      <span className={`block h-full w-full rounded-full ${cor}`}
        style={{ clipPath: `inset(0 ${100 - p}% 0 0)`, transition: 'clip-path 500ms cubic-bezier(0.16,1,0.3,1)' }} />
    </span>
  )
}

/** "4 de 14" com barra e % — o tom sobe com o acerto (≥80 verde, ≥50 âmbar, senão vermelho). */
export function Progresso({ feitos, total, rotulo }: { feitos: number; total: number; rotulo: string }) {
  const pct = total ? Math.round((feitos / total) * 100) : 0
  const tom: Tone = pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{rotulo}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{numero(feitos)} de {numero(total)}</span>
        </div>
        <Barra pct={pct} cor={BORDA[tom].barra} alta />
      </div>
      <span className={`w-12 text-right text-sm font-black tabular-nums ${TEXTO_FORTE[tom]}`}>{pct}%</span>
    </div>
  )
}

/** Uma categoria e sua contagem, barra na escala da maior (mínimo 3%). */
export function LinhaRanking({ marca, rotulo, detalhe, n, max, tom, ativa, apagada, onClick }: {
  marca?: React.ReactNode
  rotulo: React.ReactNode
  detalhe?: string
  n: number
  max: number
  tom: Tone
  ativa?: boolean
  apagada?: boolean
  onClick?: () => void
}) {
  const pct = max > 0 && n > 0 ? Math.max((n / max) * 100, 3) : 0
  const corpo = (
    <>
      <span className="flex min-w-0 items-center gap-2.5 sm:w-[18rem] sm:shrink-0">
        {marca}
        <span className="min-w-0">
          <span className={`block truncate text-sm font-semibold ${n ? 'text-foreground' : 'text-muted-foreground'}`}>{rotulo}</span>
          {detalhe && <span className="block truncate text-[11px] text-muted-foreground">{detalhe}</span>}
        </span>
      </span>
      <span className="flex flex-1 items-center gap-3">
        <Barra pct={pct} cor={BORDA[tom].barra} />
        <span className={`w-10 text-right text-lg font-black leading-none tabular-nums ${n ? 'text-foreground' : 'text-muted-foreground/60'}`}>{numero(n)}</span>
      </span>
    </>
  )
  const base = `flex w-full flex-col gap-2 rounded-lg px-2.5 py-2.5 text-left transition-opacity sm:flex-row sm:items-center sm:gap-4 ${apagada ? 'opacity-35' : ''}`
  return onClick && n > 0 ? (
    <button type="button" aria-pressed={!!ativa} onClick={onClick}
      className={`${base} min-h-11 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ativa ? 'bg-muted/60' : ''}`}>
      {corpo}
    </button>
  ) : (
    <div className={base}>{corpo}</div>
  )
}

export function Sigla({ sigla, className = '' }: { sigla: string | null; className?: string }) {
  if (!sigla) return null
  return (
    <span className={`inline-flex w-10 shrink-0 justify-center rounded-md py-0.5 text-[11px] font-bold ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text} ${className}`}>
      {sigla}
    </span>
  )
}

export function Aviso({ tom = 'neutro', children }: { tom?: 'neutro' | 'atencao'; children: React.ReactNode }) {
  const estilo = tom === 'atencao'
    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
    : 'border-border bg-muted/40 text-foreground/80'
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${estilo}`}>{children}</div>
}

/** Faixa "Mostrando: … ×" quando algo está filtrado. */
export function Mostrando({ rotulo, total, onLimpar }: { rotulo: string; total?: number; onLimpar: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mostrando</span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-xs font-semibold text-foreground shadow-sm">
        {rotulo}
        <button type="button" onClick={onLimpar} aria-label="Limpar filtro"
          className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </span>
      {total != null && <span className="ml-auto text-sm font-bold tabular-nums text-foreground">{numero(total)}</span>}
    </div>
  )
}
