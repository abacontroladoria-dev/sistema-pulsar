'use client'

import React, { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, SlidersHorizontal, FilterX } from 'lucide-react'

import type { VisaoLista } from '@/hooks/nina/useCentralInbox'
import type { TagDefinition } from '@/modules/atendimento/types/central.types'

// ============================================================================
// Filtros da lista de conversas
//
// Um gatilho de uma linha que abre o popover, no mesmo idioma do CanalSeletor:
// chips com rolagem horizontal escondiam metade das opções. Três grupos:
//
//   • Mostrar — Todas, Não lidas, Minhas, Maia, Humano (uma de cada vez);
//   • Situação — Ativas ou Encerradas (resolvidas + arquivadas), que muda o
//     que o servidor devolve;
//   • Etiquetas — as tags do CONTATO; várias marcadas = qualquer uma delas.
// ============================================================================

export type FiltroRapido = 'todas' | 'nao_lidas' | 'minhas' | 'maia' | 'humano'

const ROTULO_RAPIDO: Record<FiltroRapido, string> = {
  todas:     'Todas',
  nao_lidas: 'Não lidas',
  minhas:    'Minhas',
  maia:      'Maia atendendo',
  humano:    'Atendimento humano',
}

interface Props {
  rapido:       FiltroRapido
  aoRapido:     (f: FiltroRapido) => void
  podeMinhas:   boolean
  visao:        VisaoLista
  aoVisao:      (v: VisaoLista) => void
  tags:         string[]
  aoTags:       (t: string[]) => void
}

const item = 'flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50'

export function FiltrosLista({ rapido, aoRapido, podeMinhas, visao, aoVisao, tags, aoTags }: Props) {
  const [aberto, setAberto] = useState(false)
  const [catalogo, setCatalogo] = useState<TagDefinition[] | null>(null)

  // Catálogo só quando o popover abre pela primeira vez.
  useEffect(() => {
    if (!aberto || catalogo) return
    fetch('/api/central/tag-definitions/', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setCatalogo(((j?.data ?? []) as TagDefinition[]).filter(t => t.is_active)))
      .catch(() => setCatalogo([]))
  }, [aberto, catalogo])

  const ativos = (rapido !== 'todas' ? 1 : 0) + (visao !== 'ativas' ? 1 : 0) + tags.length
  const partes = [
    rapido !== 'todas' ? ROTULO_RAPIDO[rapido] : null,
    visao === 'encerradas' ? 'Encerradas' : null,
    tags.length ? `${tags.length} etiqueta${tags.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  const resumo = partes.length ? partes.join(' · ') : 'Todas as conversas ativas'

  const limpar = () => { aoRapido('todas'); aoVisao('ativas'); aoTags([]) }
  const opcoes = (Object.keys(ROTULO_RAPIDO) as FiltroRapido[]).filter(f => f !== 'minhas' || podeMinhas)

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Filtros: ${resumo}`}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-cyan-500/50 data-[state=open]:border-cyan-500/50"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          <span className={`min-w-0 flex-1 truncate ${ativos ? 'font-medium text-cyan-700 dark:text-cyan-400' : 'text-foreground'}`}>
            {resumo}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none in-data-[state=open]:rotate-180" aria-hidden="true" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-100 w-(--radix-popover-trigger-width) min-w-64 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <div className="max-h-[min(28rem,65vh)] overflow-y-auto custom-scrollbar p-1">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">Mostrar</p>
            <div role="radiogroup" aria-label="Mostrar">
              {opcoes.map(f => (
                <button key={f} type="button" role="radio" aria-checked={rapido === f} onClick={() => aoRapido(f)} className={item}>
                  <span className="flex-1">{ROTULO_RAPIDO[f]}</span>
                  <Check className={`h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 ${rapido === f ? '' : 'invisible'}`} aria-hidden="true" />
                </button>
              ))}
            </div>

            <div role="radiogroup" aria-label="Situação" className="mt-1 border-t border-border pt-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">Situação</p>
              {(['ativas', 'encerradas'] as VisaoLista[]).map(v => (
                <button key={v} type="button" role="radio" aria-checked={visao === v} onClick={() => aoVisao(v)} className={item}>
                  <span className="flex-1">{v === 'ativas' ? 'Ativas' : 'Encerradas e arquivadas'}</span>
                  <Check className={`h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 ${visao === v ? '' : 'invisible'}`} aria-hidden="true" />
                </button>
              ))}
            </div>

            <div role="group" aria-label="Etiquetas" className="mt-1 border-t border-border pt-1">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">Etiquetas</p>
              {catalogo === null ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">Carregando…</p>
              ) : catalogo.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
              ) : catalogo.map(t => {
                const marcada = tags.includes(t.key)
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={marcada}
                    onClick={() => aoTags(marcada ? tags.filter(x => x !== t.key) : [...tags, t.key])}
                    className={item}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400"
                      style={t.color ? { backgroundColor: t.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{t.label}</span>
                    <Check className={`h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 ${marcada ? '' : 'invisible'}`} aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          </div>

          {ativos > 0 && (
            <div className="border-t border-border p-1">
              <button type="button" onClick={limpar} className={`${item} text-muted-foreground`}>
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Limpar filtros
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
