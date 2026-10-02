'use client'

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Bot, CheckCircle2, CircleHelp, FileSpreadsheet, PartyPopper, UserSearch } from 'lucide-react'
import toast from 'react-hot-toast'
import { numero } from '@/lib/roboSharepoint/rotulos'

// Kit pastel da tela Entregas PEP (nasceu no painel "O que precisa de você",
// 02/10/2026; plano em docs/PLANO_PEP_VISUAL_PASTEL.md). As cores vêm dos
// tokens .pp-* em app/globals.css (--c, --c-suave, --c-tinta, --c-sobre…).
// Toda seção que usa o kit tem .pp numa raiz acima.
//
// Sentido dos tons na PEP (DESIGN.md): robo/violeta = robô, pessoa/azul =
// pessoa, verde = feito/liberado, amber = esperando/faltando, vermelho =
// descontado, cinza = neutro, aco = ação aqui. teal/rosa/coral = motivos de
// pasta sem dono.

export type Tom =
  | 'amber' | 'aco' | 'azul' | 'rosa' | 'coral' | 'verde' | 'violeta'
  | 'teal' | 'robo' | 'pessoa' | 'vermelho' | 'cinza'
export const tom = (t: Tom) => `pp-tom pp-t-${t}`

export function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'
}

/** "Thalia Ferreira Gomes" → "Thalia G." */
export function abreviar(nome: string) {
  const p = nome.trim().split(/\s+/)
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0] || nome
}

export async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    // Navegador sem permissão de área de transferência: textarea + execCommand.
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

const semMovimento = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Confete pastel: os mesmos matizes dos tons.
const CORES_CONFETE = [75, 217, 255, 350, 22, 160, 295].map(h => `oklch(0.80 0.11 ${h})`)

/** ~16 quadradinhos saindo do elemento; some em 0,8 s. Nada com movimento reduzido. */
export function confete(origem: Element | null) {
  if (!origem || semMovimento()) return
  const r = origem.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  for (let i = 0; i < 16; i++) {
    const el = document.createElement('span')
    el.className = 'pp-confete'
    const ang = (Math.PI * 2 * i) / 16 + Math.random() * 0.4
    const dist = 50 + Math.random() * 60
    el.style.left = `${x - 4}px`
    el.style.top = `${y - 4}px`
    el.style.background = CORES_CONFETE[i % CORES_CONFETE.length]
    el.style.setProperty('--dx', `${Math.cos(ang) * dist}px`)
    el.style.setProperty('--dy', `${Math.sin(ang) * dist - 30}px`)
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 900)
  }
}

/** Pílula escura na base da tela. O Toaster já anuncia com role="status" / aria-live. */
export function avisoFeito(texto: string) {
  toast.success(texto, {
    position: 'bottom-center',
    duration: 2400,
    style: { background: '#1e293b', color: '#fff', borderRadius: 999, padding: '10px 18px', fontWeight: 700, fontSize: 14 },
    iconTheme: { primary: 'oklch(0.72 0.13 160)', secondary: '#1e293b' },
  })
}

// ── Anel de progresso ────────────────────────────────────────────────────────

export function AnelProgresso({ feitas, total, rotulo = 'feitas', texto, t = 'verde' }: {
  feitas: number
  total: number
  /** Linha pequena embaixo do número. */
  rotulo?: string
  /** No lugar de "X/Y" (ex.: "62%"). */
  texto?: string
  t?: Tom
}) {
  const R = 26
  const C = 2 * Math.PI * R
  const frac = total > 0 ? Math.min(1, Math.max(0, feitas / total)) : 0
  const principal = texto ?? `${numero(feitas)}/${numero(total)}`
  return (
    <div className={`${tom(t)} flex items-center gap-3`} role="img" aria-label={texto ? `${texto} ${rotulo}` : `${feitas} de ${total} ${rotulo}`}>
      <svg width="60" height="60" viewBox="0 0 60 60" className="pp-anel -rotate-90" aria-hidden>
        <circle cx="30" cy="30" r={R} fill="none" stroke="var(--pp-muted)" strokeWidth="8" />
        <circle
          cx="30" cy="30" r={R} fill="none" stroke={t === 'verde' ? 'var(--pp-verde)' : 'var(--c-medio)'} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="leading-none">
        <p className="text-[22px] font-extrabold tabular-nums">{principal}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--pp-ink-muted)]">{rotulo}</p>
      </div>
    </div>
  )
}

// ── "?" ao lado do título ────────────────────────────────────────────────────

export type LinhaAjuda = { t: Tom; Icone: typeof Bot; texto: React.ReactNode }

/** As 3 linhas do "?" do painel "O que precisa de você". */
export const AJUDA_ROBO: LinhaAjuda[] = [
  { t: 'violeta', Icone: Bot, texto: 'O robô lê as pastas e libera os arquivos sozinho.' },
  { t: 'amber', Icone: FileSpreadsheet, texto: 'Sem a planilha, ele não sabe quem são os pacientes.' },
  { t: 'teal', Icone: UserSearch, texto: 'Se algo não bate, ele pergunta para você — uma vez só.' },
]

/** "?" redondo que abre um balão escuro com linhas curtas, cada uma com um ícone colorido. */
export function BotaoAjuda({ linhas = AJUDA_ROBO, rotulo = 'Por que isso acontece?', alinhar = 'esquerda' }: {
  linhas?: LinhaAjuda[]
  rotulo?: string
  /** Lado em que o balão se ancora (direita = cabeçalho com o "?" perto da borda direita). */
  alinhar?: 'esquerda' | 'direita'
}) {
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
        className="pp-iconbtn h-7 w-7"
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {aberta && (
        <div id={id} role="dialog" aria-label={rotulo} className={`pp-ajuda ${alinhar === 'direita' ? 'pp-ajuda-direita' : ''}`}>
          <ul className="space-y-3">
            {linhas.map(({ t, Icone, texto }, i) => (
              <li key={i} className={`${tom(t)} flex items-center gap-3 text-[13px] font-semibold leading-snug`}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--c)] text-[var(--c-sobre)]">
                  <Icone className="h-4 w-4" aria-hidden />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Fluxo em ícones ──────────────────────────────────────────────────────────

export type PassoFluxo = { t: Tom; Icone: typeof Bot; rotulo: string }

export function Fluxo({ passos }: { passos: PassoFluxo[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Como resolver">
      {passos.map(({ t, Icone, rotulo }, i) => (
        <Fragment key={rotulo}>
          {i > 0 && <ArrowRight className="h-4 w-4 shrink-0 text-[var(--pp-border-strong)]" aria-hidden />}
          <li className={`${tom(t)} pp-pilula`}>
            <span className="pp-pilula-bola"><Icone className="h-3.5 w-3.5" aria-hidden /></span>
            {rotulo}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

// ── Tudo resolvido ───────────────────────────────────────────────────────────

export function Comemoracao({ titulo, texto, children }: { titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className={`${tom('verde')} flex flex-col items-center gap-2 rounded-[20px] bg-[var(--c-suave)] px-4 py-8 text-center shadow-[inset_0_0_0_2px_var(--c-linha)]`}>
      <span className="pp-pop flex size-16 items-center justify-center rounded-full bg-[var(--c)] text-[var(--c-sobre)]">
        <PartyPopper className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-1 text-base font-extrabold text-[var(--c-tinta)]">{titulo}</p>
      <p className="text-sm font-semibold text-[var(--pp-ink-muted)]">{texto}</p>
      {children}
    </div>
  )
}

export function TudoEmDia() {
  return (
    <div className={`${tom('verde')} flex flex-col items-center gap-2 rounded-[20px] bg-[var(--c-suave)] px-4 py-8 text-center`}>
      <CheckCircle2 className="h-10 w-10 text-[var(--c-tinta)]" aria-hidden />
      <p className="text-base font-extrabold text-[var(--c-tinta)]">Tudo em dia</p>
      <p className="text-sm text-[var(--pp-ink-muted)]">O robô reconheceu tudo o que leu. Não há nada para você fazer agora.</p>
    </div>
  )
}

// ── Seção, cabeçalho, número, barra, filtro ──────────────────────────────────

/** A moldura de uma seção pastel (mesma borda/raio dos outros cartões da tela). */
export function SecaoPastel({ titulo, children, className = '', semPadding = false }: {
  /** id do título (aria-labelledby). */
  titulo: string
  children: ReactNode
  className?: string
  semPadding?: boolean
}) {
  return (
    <section
      aria-labelledby={titulo}
      className={`pp @container rounded-2xl border border-[var(--pp-border)] bg-[var(--pp-surface)] shadow-[var(--pp-sombra)] ${semPadding ? '' : 'p-5 sm:p-6'} ${className}`}
    >
      {children}
    </section>
  )
}

/** Título 22/800 (ou 18 no tamanho médio) + "?" + o que vai à direita (anel, número, ação). */
export function CabecalhoPastel({ id, titulo, t, Icone, ajuda, rotuloAjuda, apoio, direita, tamanho = 'grande', nivel = 'h2' }: {
  id: string
  titulo: string
  /** Tom do quadrado do ícone. Sem Icone, não há quadrado. */
  t?: Tom
  Icone?: typeof Bot
  ajuda?: LinhaAjuda[]
  rotuloAjuda?: string
  /** Uma linha curta embaixo do título. */
  apoio?: ReactNode
  direita?: ReactNode
  tamanho?: 'grande' | 'medio'
  nivel?: 'h2' | 'h3'
}) {
  const H = nivel
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icone && (
          <span className={`${tom(t ?? 'aco')} flex shrink-0 items-center justify-center rounded-[14px] bg-[var(--c)] text-[var(--c-sobre)] ${tamanho === 'grande' ? 'size-12' : 'size-10'}`} aria-hidden>
            <Icone className={tamanho === 'grande' ? 'h-6 w-6' : 'h-5 w-5'} />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <H id={id} className={`font-extrabold ${tamanho === 'grande' ? 'text-[22px] leading-7' : 'text-[18px] leading-6'}`}>{titulo}</H>
            {ajuda && <BotaoAjuda linhas={ajuda} rotulo={rotuloAjuda ?? `Sobre “${titulo}”`} />}
          </div>
          {apoio && <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold text-[var(--pp-ink-muted)]">{apoio}</p>}
        </div>
      </div>
      {direita}
    </div>
  )
}

/** Cartão de número grande: ícone em quadrado, valor 34/800, rótulo curto e uma linha de apoio. */
export function NumeroPastel({ t, Icone, valor, rotulo, apoio, title, compacto = false, apagado = false, children }: {
  t: Tom
  Icone: typeof Bot
  valor: ReactNode
  rotulo: ReactNode
  apoio?: ReactNode
  title?: string
  compacto?: boolean
  /** Valor zero: o cartão perde a cor (a palavra continua dizendo o que é). */
  apagado?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`${tom(apagado ? 'cinza' : t)} pp-numero ${compacto ? 'is-compacto' : ''}`} title={title}>
      <span className="pp-numero-marca" aria-hidden><Icone /></span>
      <span className="pp-numero-icone" aria-hidden><Icone className={compacto ? 'h-5 w-5' : 'h-6 w-6'} /></span>
      <span className="relative min-w-0 flex-1">
        <span className="pp-numero-valor">{valor}</span>
        <span className="pp-numero-rotulo">{rotulo}</span>
        {apoio && <span className="pp-numero-apoio">{apoio}</span>}
        {children}
      </span>
    </div>
  )
}

export type PartePastel = { valor: number; t: Tom; rotulo: string; Icone?: typeof Bot }

/** Barra empilhada pastel + legenda em pílulas. Segmento zero não aparece; a legenda mostra. */
export function BarraPastel({ partes, formatar = numero, legenda = true, rotulo }: {
  partes: PartePastel[]
  formatar?: (n: number) => string
  legenda?: boolean
  /** Texto para leitor de tela; padrão: as partes em sequência. */
  rotulo?: string
}) {
  const total = partes.reduce((s, p) => s + Math.max(0, p.valor), 0)
  return (
    <div>
      <div
        className="flex h-3.5 w-full gap-[3px] overflow-hidden rounded-full bg-[var(--pp-muted)]"
        role="img"
        aria-label={rotulo ?? partes.map(p => `${p.rotulo}: ${formatar(p.valor)}`).join(', ')}
      >
        {total > 0 && partes.filter(p => p.valor > 0).map(p => (
          <span key={p.rotulo} className={`${tom(p.t)} pp-barra-seg h-full`} style={{ width: `${(p.valor / total) * 100}%` }} />
        ))}
      </div>
      {legenda && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {partes.map(p => (
            <li key={p.rotulo} className={`${tom(p.valor > 0 ? p.t : 'cinza')} pp-pilula h-8 pl-1.5 text-[12px]`}>
              <span className="pp-pilula-bola size-5">{p.Icone ? <p.Icone className="h-3 w-3" aria-hidden /> : null}</span>
              {p.rotulo} <span className="tabular-nums text-[var(--c-tinta)]">{formatar(p.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Pílula que filtra: clique liga, segundo clique desliga (aria-pressed). */
export function PilulaFiltro({ t, Icone, rotulo, contagem, ativo, onClick, title }: {
  t: Tom
  Icone?: typeof Bot
  rotulo: ReactNode
  contagem?: number
  ativo: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button type="button" aria-pressed={ativo} onClick={onClick} title={title} className={`${tom(t)} pp-pilula ${Icone ? '' : 'pl-3'}`}>
      {Icone && <span className="pp-pilula-bola"><Icone className="h-3.5 w-3.5" aria-hidden /></span>}
      {rotulo}
      {contagem != null && <span className="tabular-nums">{numero(contagem)}</span>}
    </button>
  )
}
