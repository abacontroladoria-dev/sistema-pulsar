'use client'

import React from 'react'
import { Copy, ChevronRight } from 'lucide-react'
import type { EvolucaoPendenteAuditoria } from '@/types/auditoriaEvolucoes'
import type { GrupoEvolucaoDuplicada } from '@/services/auditoriaEvolucoes.service'
import { FOCO } from './vocabulario'

interface Props {
  grupos: GrupoEvolucaoDuplicada[]
  onSelecionarEvolucao: (item: EvolucaoPendenteAuditoria) => void
}

/**
 * Um grupo = um texto que se repetiu, do mesmo profissional, em pacientes
 * diferentes. A lista de pacientes fica lado a lado — é o próprio indício da
 * cópia, não um detalhe que precise ser aberto para aparecer.
 */
export function EvolucoesDuplicadasTab({ grupos, onSelecionarEvolucao }: Props) {
  if (grupos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-16 text-center shadow-sm">
        <Copy className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-sm font-semibold text-foreground">
          Nenhuma evolução duplicada entre pacientes
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Nenhum profissional lançou o mesmo texto para pacientes diferentes neste período.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {grupos.map(grupo => {
        const dataFormatada = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR')
        const pacientesDistintos = new Set(
          grupo.itens.map(i => (i.paciente_id ? String(i.paciente_id) : i.paciente_nome))
        ).size

        return (
          <div key={grupo.chave} className="overflow-hidden rounded-xl border border-rose-300 bg-card shadow-sm dark:border-rose-700">
            <div className="flex items-center justify-between gap-3 bg-rose-50 px-4 py-2.5 dark:bg-rose-950/40">
              <div className="flex min-w-0 items-center gap-2">
                <Copy className="h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-300" />
                <span className="truncate text-xs font-semibold text-foreground">
                  {grupo.profissional_nome}
                </span>
                <span className="shrink-0 rounded-full bg-rose-200 px-1.5 text-[10px] font-bold tabular-nums text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                  {pacientesDistintos} pacientes · {grupo.itens.length} sessões
                </span>
              </div>
              {/* Menor similaridade do grupo — o "pior caso" entre os pares que o formam. */}
              <span
                title="Semelhança de texto entre as evoluções deste grupo"
                className="shrink-0 rounded-full bg-rose-700 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white dark:bg-rose-600"
              >
                {Math.round(grupo.similaridadeMinima * 100)}% igual
              </span>
            </div>

            <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground line-clamp-2">
              {grupo.itens[0].texto_original}
            </p>

            <div className="divide-y divide-border">
              {grupo.itens.map(item => (
                <button
                  key={item.grade_id}
                  onClick={() => onSelecionarEvolucao(item)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-muted/40 ${FOCO}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-foreground">{item.paciente_nome}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {dataFormatada(item.data_sessao)}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
