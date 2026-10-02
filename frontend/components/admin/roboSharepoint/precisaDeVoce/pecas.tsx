'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { ArrowRight, Bot, CheckCircle2, CircleHelp, FileSpreadsheet, PartyPopper, UserSearch } from 'lucide-react'
import toast from 'react-hot-toast'
import { numero } from '@/lib/roboSharepoint/rotulos'

// Peças do painel "O que precisa de você". As cores vêm dos tokens .pp-* em
// app/globals.css (tons pastéis: --c, --c-suave, --c-tinta, --c-sobre…).

export type Tom = 'amber' | 'aco' | 'azul' | 'rosa' | 'coral' | 'verde' | 'violeta'
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

export function AnelProgresso({ feitas, total }: { feitas: number; total: number }) {
  const R = 26
  const C = 2 * Math.PI * R
  const frac = total > 0 ? Math.min(1, feitas / total) : 0
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${feitas} de ${total} feitas`}>
      <svg width="60" height="60" viewBox="0 0 60 60" className="pp-anel -rotate-90" aria-hidden>
        <circle cx="30" cy="30" r={R} fill="none" stroke="var(--pp-muted)" strokeWidth="8" />
        <circle
          cx="30" cy="30" r={R} fill="none" stroke="var(--pp-verde)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="leading-none">
        <p className="text-[22px] font-extrabold tabular-nums">{numero(feitas)}/{numero(total)}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--pp-ink-muted)]">feitas</p>
      </div>
    </div>
  )
}

// ── "?" ao lado do título ────────────────────────────────────────────────────

const LINHAS_AJUDA: { t: Tom; Icone: typeof Bot; texto: string }[] = [
  { t: 'violeta', Icone: Bot, texto: 'O robô lê as pastas e libera os arquivos sozinho.' },
  { t: 'amber', Icone: FileSpreadsheet, texto: 'Sem a planilha, ele não sabe quem são os pacientes.' },
  { t: 'azul', Icone: UserSearch, texto: 'Se algo não bate, ele pergunta para você — uma vez só.' },
]

export function BotaoAjuda() {
  const [aberta, setAberta] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)

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
        aria-controls="pp-ajuda"
        aria-label="Por que isso acontece?"
        title="Por que isso acontece?"
        className="pp-iconbtn h-7 w-7"
      >
        <CircleHelp className="h-4 w-4" aria-hidden />
      </button>
      {aberta && (
        <div id="pp-ajuda" role="dialog" aria-label="Por que isso acontece?" className="pp-ajuda">
          <ul className="space-y-3">
            {LINHAS_AJUDA.map(({ t, Icone, texto }) => (
              <li key={texto} className={`${tom(t)} flex items-center gap-3 text-[13px] font-semibold leading-snug`}>
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
