'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CircleHelp, RefreshCw, type LucideIcon } from 'lucide-react'
import { foco } from '@/components/cadastros/pacientes/ui/campos'
import { btnSecundario } from '@/components/cronograma/grade/estilo'
import { TONE_SOFT, type Tone } from '@/components/cronograma/ui/tones'
import { numero } from '@/lib/roboSharepoint/rotulos'

// Peças do design PADRÃO do Pulsar (o da ficha do paciente,
// /cadastros/pacientes/[id]): tokens neutros, cartão rounded-lg com borda e sem
// sombra, título text-base font-semibold, cor só para estado. São as
// contrapartes neutras do kit pastel (components/ui/pastel/pecas.tsx) — mesmos
// dados, outra pele — para a PEP e a ficha do profissional saírem do pastel sem
// reescrever cálculo nenhum (decisão do usuário, 22/10/2026).

/** Moldura de uma seção — a mesma do cartão de identidade do paciente. */
export const cartaoPadrao = 'rounded-lg border border-border bg-card'

/** Cor cheia de cada tom, só para preencher barra/bolinha (nunca fundo de texto). */
export const TONE_FILL: Record<Tone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  blue: 'bg-sky-500',
  purple: 'bg-violet-500',
  red: 'bg-rose-500',
  slate: 'bg-slate-400 dark:bg-slate-500',
}

export function Cartao({ titulo, children, className = '', semPadding = false }: {
  /** id do título (aria-labelledby). */
  titulo?: string
  children: ReactNode
  className?: string
  semPadding?: boolean
}) {
  return (
    <section aria-labelledby={titulo} className={`${cartaoPadrao} ${semPadding ? '' : 'px-4 py-4'} ${className}`}>
      {children}
    </section>
  )
}

export type LinhaAjudaPadrao = { Icone: LucideIcon; texto: ReactNode; tone?: Tone }

/** "?" ao lado de um título: abre um balão com linhas curtas. Fecha com Esc ou clique fora. */
export function BotaoAjudaPadrao({ linhas, rotulo = 'Ajuda' }: { linhas: LinhaAjudaPadrao[]; rotulo?: string }) {
  const [aberta, setAberta] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!aberta) return
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberta(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberta])

  return (
    <div ref={raiz} className="relative">
      <button
        type="button"
        onClick={() => setAberta(a => !a)}
        aria-expanded={aberta}
        aria-controls={id}
        aria-label={rotulo}
        title={rotulo}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {aberta && (
        <div
          id={id}
          role="dialog"
          aria-label={rotulo}
          className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <ul className="space-y-2.5">
            {linhas.map(({ Icone, texto, tone }, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${tone ? TONE_SOFT[tone].text : 'text-muted-foreground'}`} aria-hidden />
                <span>{texto}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Título de seção (text-base/600, como `Secao`) + apoio + o que vai à direita. */
export function CabecalhoSecao({ id, titulo, Icone, apoio, direita, ajuda, rotuloAjuda, nivel = 'h2', className = 'mb-4' }: {
  id?: string
  titulo: ReactNode
  Icone?: LucideIcon
  apoio?: ReactNode
  direita?: ReactNode
  ajuda?: LinhaAjudaPadrao[]
  rotuloAjuda?: string
  nivel?: 'h2' | 'h3'
  className?: string
}) {
  const H = nivel
  return (
    <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icone && <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          <H id={id} className={`${nivel === 'h2' ? 'text-base' : 'text-md'} font-semibold text-foreground`}>{titulo}</H>
          {ajuda && <BotaoAjudaPadrao linhas={ajuda} rotulo={rotuloAjuda ?? 'Ajuda'} />}
        </div>
        {apoio && <p className="mt-0.5 text-sm text-muted-foreground">{apoio}</p>}
      </div>
      {direita}
    </header>
  )
}

/** Número de destaque: rótulo pequeno, valor text-xl, apoio. Zero apaga a cor do ícone. */
export function Indicador({ rotulo, valor, apoio, Icone, tone, apagado = false, title, children, className = '' }: {
  rotulo: ReactNode
  valor: ReactNode
  apoio?: ReactNode
  Icone?: LucideIcon
  tone?: Tone
  apagado?: boolean
  title?: string
  children?: ReactNode
  className?: string
}) {
  const corIcone = tone && !apagado ? TONE_SOFT[tone].text : 'text-muted-foreground'
  return (
    <div className={`min-w-0 rounded-lg border border-border bg-card px-3 py-3 ${className}`} title={title}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {Icone && <Icone className={`h-3.5 w-3.5 shrink-0 ${corIcone}`} aria-hidden />}
        {rotulo}
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${apagado ? 'text-muted-foreground' : 'text-foreground'}`}>{valor}</p>
      {apoio && <p className="mt-0.5 text-xs text-muted-foreground">{apoio}</p>}
      {children}
    </div>
  )
}

export type Parte = { valor: number; tone: Tone; rotulo: string }

/** Barra empilhada fina + legenda em texto (bolinha, rótulo, valor e %). Zero não pinta. */
export function BarraPartes({ partes, formatar = numero, legenda = true, rotulo }: {
  partes: Parte[]
  formatar?: (n: number) => string
  legenda?: boolean
  rotulo?: string
}) {
  const total = partes.reduce((s, p) => s + Math.max(0, p.valor), 0)
  const pct = (v: number) => (total > 0 ? Math.round((Math.max(0, v) / total) * 100) : 0)
  return (
    <div>
      <div
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={rotulo ?? partes.map(p => `${p.rotulo}: ${formatar(p.valor)}`).join(', ')}
      >
        {total > 0 && partes.filter(p => p.valor > 0).map(p => (
          <span key={p.rotulo} className={`h-full ${TONE_FILL[p.tone]}`} style={{ width: `${(p.valor / total) * 100}%` }} />
        ))}
      </div>
      {legenda && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {partes.map(p => (
            <li key={p.rotulo} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.valor > 0 ? TONE_FILL[p.tone] : 'bg-muted-foreground/30'}`} aria-hidden />
              {p.rotulo}
              <span className="font-semibold tabular-nums text-foreground">{formatar(p.valor)}</span>
              {total > 0 && <span className="tabular-nums">({pct(p.valor)}%)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** "X de Y feitas" + barra fina. Substitui o anel de progresso. */
export function Progresso({ feitas, total, rotulo = 'feitas', texto, tone = 'green', className = '' }: {
  feitas: number
  total: number
  rotulo?: string
  /** No lugar de "X/Y" (ex.: "62%"). */
  texto?: string
  tone?: Tone
  className?: string
}) {
  const frac = total > 0 ? Math.min(1, Math.max(0, feitas / total)) : 0
  const principal = texto ?? `${numero(feitas)}/${numero(total)}`
  return (
    <div className={`min-w-[8rem] ${className}`}>
      <p className="text-sm text-muted-foreground">
        <span className="text-base font-semibold tabular-nums text-foreground">{principal}</span> {rotulo}
      </p>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={feitas}
        aria-label={texto ? `${texto} ${rotulo}` : `${feitas} de ${total} ${rotulo}`}
      >
        <span className={`block h-full ${TONE_FILL[tone]}`} style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  )
}

/** Botão de filtro que liga/desliga (aria-pressed), com contagem. */
export function BotaoFiltro({ rotulo, contagem, ativo, onClick, Icone, title }: {
  rotulo: ReactNode
  contagem?: number
  ativo: boolean
  onClick: () => void
  Icone?: LucideIcon
  title?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      title={title}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors sm:min-h-8 ${foco} ${
        ativo ? 'border-foreground/30 bg-muted text-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}
    >
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {rotulo}
      {contagem != null && <span className="tabular-nums text-muted-foreground">{numero(contagem)}</span>}
    </button>
  )
}

/** Caixa tracejada de "nada aqui" — a mesma das abas da ficha do paciente. */
export function EstadoVazio({ Icone, titulo, texto, acao, className = '' }: {
  Icone?: LucideIcon
  titulo: ReactNode
  texto?: ReactNode
  acao?: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center ${className}`}>
      {Icone && <Icone className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />}
      <p className={`${Icone ? 'mt-3' : ''} text-sm font-medium text-foreground`}>{titulo}</p>
      {texto && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{texto}</p>}
      {acao && <div className="mt-4 flex justify-center">{acao}</div>}
    </div>
  )
}

export function CaixaErro({ mensagem, onTentarDeNovo, className = '' }: {
  mensagem: ReactNode
  onTentarDeNovo?: () => void
  className?: string
}) {
  return (
    <div role="alert" className={`flex flex-wrap items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive ${className}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{mensagem}</span>
      {onTentarDeNovo && (
        <button type="button" onClick={onTentarDeNovo} className={`${btnSecundario} text-foreground`}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Tentar novamente
        </button>
      )}
    </div>
  )
}
