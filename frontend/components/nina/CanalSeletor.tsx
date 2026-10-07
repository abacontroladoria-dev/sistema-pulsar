'use client'

import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Bot, Smartphone, Check, ChevronDown, Layers, FilterX } from 'lucide-react'

import type { CanalInbox } from '@/hooks/nina/useCentralInbox'

// ============================================================================
// Seletor de números da /connect/inbox
//
// Um gatilho de uma linha que abre a lista. Era uma fileira de chips com
// rolagem horizontal, que com a Maia + cinco números Evolution escondia metade
// das opções fora da tela — e o número escondido era justamente o que ninguém
// lembrava de conferir. O gatilho tem a mesma altura com 2 ou com 15 números.
//
// Seleção vazia = todos os números que o usuário pode atender. Marcar um por um
// até completar a lista também é "todos", e o resumo diz isso.
//
// O gatilho só mostra estado de conexão quando há problema: "3 conectados"
// seria ruído permanente; "1 desconectado" é o aviso que faz alguém abrir o
// celular do número e escanear o QR de novo.
//
// Na lista, os números vêm em dois grupos — Maia (Meta) e atendimento humano
// (Evolution) — porque é a diferença que importa para quem atende: num a IA
// pode estar respondendo, no outro é sempre gente.
//
// Mesmo idioma de popover com múltipla escolha de FiltrosPdi (SuspensoDias):
// não fecha a cada clique, check à direita, "limpar" no rodapé.
//
// Não aparece para quem só tem um número: um filtro de uma opção só é ruído.
// ============================================================================

interface Props {
  canais:         CanalInbox[]
  selecionados:   string[]
  aoAlternar:     (id: string) => void
  aoMostrarTodos: () => void
}

const ESTADO: Record<string, { rotulo: string; ponto: string; texto: string }> = {
  active:       { rotulo: 'Conectado',    ponto: 'bg-emerald-500', texto: 'text-emerald-600 dark:text-emerald-400' },
  connecting:   { rotulo: 'Conectando',   ponto: 'bg-amber-500',   texto: 'text-amber-700 dark:text-amber-400' },
  disconnected: { rotulo: 'Desconectado', ponto: 'bg-rose-500',    texto: 'text-rose-600 dark:text-rose-400' },
  error:        { rotulo: 'Com erro',     ponto: 'bg-rose-500',    texto: 'text-rose-600 dark:text-rose-400' },
  suspended:    { rotulo: 'Suspenso',     ponto: 'bg-rose-500',    texto: 'text-rose-600 dark:text-rose-400' },
}
const ESTADO_DESCONHECIDO = { rotulo: 'Sem estado', ponto: 'bg-slate-400', texto: 'text-muted-foreground' }

function estado(status: string) {
  return ESTADO[status] ?? ESTADO_DESCONHECIDO
}

// O aviso do gatilho: o pior estado presente, com a contagem. Desconectado pesa
// mais que "conectando" — um pede ação, o outro só espera.
//
// "Desconectado" conta só o status `disconnected`: é o que se resolve
// escaneando o QR de novo. Erro, suspensão e status desconhecido não se
// resolvem assim, então viram "com problema" — chamar de desconectado mandaria
// a atendente ao celular à toa.
function avisoDeConexao(canais: CanalInbox[]): { texto: string; cor: string } | null {
  const rosa = 'text-rose-600 dark:text-rose-400'
  const desconectados = canais.filter(c => c.status === 'disconnected').length
  const comProblema   = canais.filter(c => !['active', 'connecting', 'disconnected'].includes(c.status)).length
  if (desconectados > 0 && comProblema > 0) {
    return { texto: `${desconectados + comProblema} com problema`, cor: rosa }
  }
  if (desconectados > 0) {
    return { texto: desconectados === 1 ? '1 desconectado' : `${desconectados} desconectados`, cor: rosa }
  }
  if (comProblema > 0) {
    return { texto: `${comProblema} com problema`, cor: rosa }
  }
  const conectando = canais.filter(c => c.status === 'connecting').length
  if (conectando > 0) {
    return { texto: `${conectando} conectando`, cor: 'text-amber-700 dark:text-amber-400' }
  }
  return null
}

// role="menu" promete setas: ↑/↓ andam entre os itens, Home/End vão às pontas.
// O Tab continua funcionando como antes.
function navegarPorSetas(e: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const itens = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'))
  if (itens.length === 0) return
  e.preventDefault()
  const atual = itens.indexOf(document.activeElement as HTMLElement)
  const proximo =
    e.key === 'Home' ? 0
    : e.key === 'End' ? itens.length - 1
    : e.key === 'ArrowDown' ? (atual + 1) % itens.length
    : (atual - 1 + itens.length) % itens.length
  itens[proximo].focus()
}

export function CanalSeletor({ canais, selecionados, aoAlternar, aoMostrarTodos }: Props) {
  const [aberto, setAberto] = useState(false)

  if (canais.length <= 1) return null

  const marcados = canais.filter(c => selecionados.includes(c.id))
  const todos    = marcados.length === 0 || marcados.length === canais.length

  const resumo = todos
    ? 'Todos os números'
    : marcados.length === 1
      ? marcados[0].name
      : `${marcados.length} números`

  const IconeResumo = todos || marcados.length > 1
    ? Layers
    : marcados[0].provider === 'evolution' ? Smartphone : Bot

  const aviso = avisoDeConexao(canais)

  const grupos = [
    { titulo: 'Maia',               itens: canais.filter(c => c.provider !== 'evolution') },
    { titulo: 'Atendimento humano', itens: canais.filter(c => c.provider === 'evolution') },
  ].filter(g => g.itens.length > 0)

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Números exibidos: ${resumo}${aviso ? `, ${aviso.texto}` : ''}`}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-cyan-500/50 data-[state=open]:border-cyan-500/50"
        >
          <IconeResumo className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          <span className={`min-w-0 flex-1 truncate ${todos ? 'text-foreground' : 'font-medium text-cyan-700 dark:text-cyan-400'}`}>
            {resumo}
          </span>
          {aviso && (
            <span className={`shrink-0 text-[11px] font-medium ${aviso.cor}`}>{aviso.texto}</span>
          )}
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
          <div role="menu" aria-label="Números exibidos" onKeyDown={navegarPorSetas} className="max-h-[min(24rem,60vh)] overflow-y-auto custom-scrollbar p-1">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={todos}
              onClick={aoMostrarTodos}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
            >
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
              <span className="flex-1 font-medium">Todos os números</span>
              <Check className={`h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 ${todos ? '' : 'invisible'}`} aria-hidden="true" />
            </button>

            {grupos.map(grupo => (
              <div key={grupo.titulo} role="group" aria-label={grupo.titulo} className="mt-1 border-t border-border pt-1">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">
                  {grupo.titulo}
                </p>
                {grupo.itens.map(canal => {
                  // Com "todos" valendo, nenhum número aparece marcado: o check
                  // de cada um diria que o filtro está restrito, e não está.
                  const marcado = !todos && selecionados.includes(canal.id)
                  const e = estado(canal.status)
                  const Icone = canal.provider === 'evolution' ? Smartphone : Bot
                  return (
                    <button
                      key={canal.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={marcado}
                      onClick={() => aoAlternar(canal.id)}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    >
                      <Icone className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                      <span className={`min-w-0 flex-1 truncate text-sm ${marcado ? 'font-medium text-foreground' : 'text-foreground/90'}`}>
                        {canal.name}
                      </span>
                      {/* Mesma regra do gatilho: conectado é o normal e não
                          se escreve; só o que pede atenção aparece. */}
                      {canal.status !== 'active' && (
                        <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${e.texto}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${e.ponto}`} aria-hidden="true" />
                          {e.rotulo}
                        </span>
                      )}
                      <Check
                        className={`h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400 ${marcado ? '' : 'invisible'}`}
                        aria-hidden="true"
                      />
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {!todos && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={aoMostrarTodos}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              >
                <FilterX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Mostrar todos
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
