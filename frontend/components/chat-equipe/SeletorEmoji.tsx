'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Briefcase, Clock, Coffee, Hand, Heart, Leaf, Search, Smile } from 'lucide-react'

import { CATEGORIAS_EMOJI, buscarEmojis, guardarRecente, lerRecentes } from '@/lib/chat/emojis'

// ============================================================================
// Seletor de emoji do Chat da equipe — no campo de escrita e no "mais
// reações" de uma mensagem. Busca em português ("joinha", "obrigado",
// "calendario"), recentes primeiro, categorias como atalhos de rolagem.
//
// Radix Popover: o conteúdo tem role="dialog" e data-state="open", que é o que
// o painel do chat confere antes de fechar no Esc — o Esc fecha só o seletor.
// ============================================================================

const ICONES: Record<string, typeof Smile> = {
  recentes: Clock, rostos: Smile, gestos: Hand, simbolos: Heart,
  trabalho: Briefcase, natureza: Leaf, comida: Coffee,
}

interface Props {
  aoEscolher: (emoji: string) => void
  children:   ReactNode
  /** Fecha ao escolher (reação) ou continua aberto (escrevendo várias). */
  fecharAoEscolher?: boolean
  side?:  'top' | 'bottom'
  align?: 'start' | 'end' | 'center'
  aberto?: boolean
  aoMudarAberto?: (v: boolean) => void
}

export default function SeletorEmoji({
  aoEscolher, children, fecharAoEscolher = false, side = 'top', align = 'start', aberto, aoMudarAberto,
}: Props) {
  const [abertoLocal, setAbertoLocal] = useState(false)
  const estaAberto = aberto ?? abertoLocal
  const mudar = (v: boolean) => { setAbertoLocal(v); aoMudarAberto?.(v) }

  return (
    <Popover.Root open={estaAberto} onOpenChange={mudar}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          // O foco vai para a busca (autoFocus); ao fechar volta ao campo da
          // mensagem pelo onCloseAutoFocus padrão do gatilho.
          className="z-50 w-76 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {estaAberto && (
            <Grade
              aoEscolher={e => {
                guardarRecente(e)
                aoEscolher(e)
                if (fecharAoEscolher) mudar(false)
              }}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function Grade({ aoEscolher }: { aoEscolher: (e: string) => void }) {
  const [termo, setTermo] = useState('')
  // Lidos uma vez por abertura: a grade não pula enquanto a pessoa escolhe.
  const [recentes] = useState(lerRecentes)
  const rolagemRef = useRef<HTMLDivElement>(null)

  const secoes = useMemo(() => {
    const base = CATEGORIAS_EMOJI.map(c => ({ id: c.id, rotulo: c.rotulo, emojis: c.emojis.map(([e]) => e) }))
    return recentes.length ? [{ id: 'recentes', rotulo: 'Usados recentemente', emojis: recentes }, ...base] : base
  }, [recentes])

  const achados = useMemo(() => buscarEmojis(termo), [termo])
  const buscando = termo.trim().length > 0

  const irPara = (id: string) => {
    const alvo = rolagemRef.current?.querySelector<HTMLElement>(`[data-secao="${id}"]`)
    if (alvo && rolagemRef.current) rolagemRef.current.scrollTop = alvo.offsetTop - 4
  }

  return (
    <div className="flex flex-col">
      <label className="m-2 flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-cyan-500/40">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={termo}
          onChange={e => setTermo(e.target.value)}
          placeholder="Buscar emoji"
          aria-label="Buscar emoji"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </label>

      {!buscando && (
        <div className="flex gap-0.5 border-b border-border px-2 pb-1.5" role="toolbar" aria-label="Categorias">
          {secoes.map(s => {
            const Icone = ICONES[s.id] ?? Smile
            return (
              <button
                key={s.id}
                type="button"
                title={s.rotulo}
                aria-label={s.rotulo}
                onClick={() => irPara(s.id)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Icone className="h-4 w-4" />
              </button>
            )
          })}
        </div>
      )}

      <div ref={rolagemRef} className="relative h-64 overflow-y-auto px-2 pb-2">
        {buscando ? (
          achados.length ? (
            <ListaEmojis emojis={achados} aoEscolher={aoEscolher} />
          ) : (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">Nenhum emoji com “{termo.trim()}”.</p>
          )
        ) : (
          secoes.map(s => (
            <section key={s.id} data-secao={s.id} aria-label={s.rotulo}>
              <h3 className="sticky top-0 z-1 bg-popover px-1 pb-1 pt-2 text-xs font-medium text-muted-foreground">{s.rotulo}</h3>
              <ListaEmojis emojis={s.emojis} aoEscolher={aoEscolher} />
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function ListaEmojis({ emojis, aoEscolher }: { emojis: string[]; aoEscolher: (e: string) => void }) {
  return (
    <div className="grid grid-cols-8">
      {emojis.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => aoEscolher(e)}
          className="flex aspect-square items-center justify-center rounded-md text-[22px] leading-none transition-transform hover:bg-muted focus-visible:bg-muted focus-visible:outline-none motion-safe:hover:scale-110"
        >
          {e}
        </button>
      ))}
    </div>
  )
}
