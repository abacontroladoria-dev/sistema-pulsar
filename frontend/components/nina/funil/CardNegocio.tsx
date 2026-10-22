'use client'

import React from 'react'
import { Clock, RotateCcw } from 'lucide-react'
import type { DealUI } from '@/services/crm/adapter'
import { ROTULO_DETALHE, ROTULO_TRILHA, prazoEstourado, tempoNaPosicao } from './funil'

// ============================================================================
// Card de um negócio no board.
//
// Mostra o que decide a próxima ação de quem olha: quem é, de que trilha, em
// que situação dentro da coluna (o detalhe), há quanto tempo está parado e —
// quando há — o motivo. O resto (timeline,
// mensagens) fica na gaveta.
// ============================================================================

export const TRILHA_ESTILO: Record<'particular' | 'convenio', string> = {
  particular: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  convenio:   'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? '').join('').toUpperCase() || '?'
}

export const CardNegocio: React.FC<{
  negocio:     DealUI
  responsavel: string | null
  arrastavel:  boolean
  aoAbrir:     () => void
  aoArrastar:  (e: React.DragEvent) => void
  aoSoltar:    (e: React.DragEvent) => void
}> = ({ negocio, responsavel, arrastavel, aoAbrir, aoArrastar, aoSoltar }) => {
  const nome     = negocio.contactName?.trim() || negocio.title
  // Contato sem nome vem com o telefone no lugar do nome: não repetir.
  const digitos  = (v: string) => v.replace(/\D/g, '')
  const fone     = negocio.contactPhone && digitos(negocio.contactPhone) !== digitos(nome) ? negocio.contactPhone : null
  const tempo    = tempoNaPosicao(negocio.stageChangedAt)
  const atrasado = prazoEstourado(negocio.detalhe, negocio.detalheDesde)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={arrastavel}
      onDragStart={aoArrastar}
      onDragEnd={aoSoltar}
      onClick={aoAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoAbrir() } }}
      aria-label={`${nome}${negocio.trilha ? `, ${ROTULO_TRILHA[negocio.trilha]}` : ''}${negocio.detalhe ? `, ${ROTULO_DETALHE[negocio.detalhe]}` : ''}${tempo ? `, nesta etapa ${tempo}` : ''}`}
      className="group rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-cyan-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-foreground">{nome}</p>
          {fone && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{fone}</p>
          )}
        </div>
        {responsavel && (
          <span
            title={`Responsável: ${responsavel}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
          >
            {iniciais(responsavel)}
          </span>
        )}
      </div>

      {(negocio.trilha || negocio.resgate || negocio.detalhe) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {negocio.trilha && (
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${TRILHA_ESTILO[negocio.trilha]}`}>
              {ROTULO_TRILHA[negocio.trilha]}
            </span>
          )}
          {negocio.detalhe && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                atrasado
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : 'border-border bg-muted text-foreground/80'
              }`}
            >
              {ROTULO_DETALHE[negocio.detalhe]}
            </span>
          )}
          {negocio.resgate && (
            <span className="flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
              <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" /> Resgate
            </span>
          )}
        </div>
      )}

      {(negocio.motivo || negocio.closedReason) && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {negocio.motivo || negocio.closedReason}
        </p>
      )}

      {/* Só o tempo parado: é o que decide a próxima ação. A origem
          (automática ou manual) quase sempre é automática — no card seria um
          ícone repetido em todos; fica na timeline da gaveta. */}
      {tempo && (
        <p
          className={`mt-2 flex items-center gap-1 border-t border-border pt-2 text-[11px] ${atrasado ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}
          title={atrasado ? `${ROTULO_DETALHE[negocio.detalhe!]}: passou do prazo interno` : 'Tempo nesta etapa'}
        >
          <Clock className="h-3 w-3" aria-hidden="true" />
          {tempo}{atrasado ? ' · fora do prazo' : ''}
        </p>
      )}
    </div>
  )
}
