'use client'

import React from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Clock, ChevronRight, FileText } from 'lucide-react'
import { StatusChip } from '@/components/ui/tones'
import type { EvolucaoPendenteAuditoria } from '@/types/auditoriaEvolucoes'
import { TOM_RISCO, ROTULO_RISCO, TOM_COBRANCA, ROTULO_COBRANCA, FOCO } from './vocabulario'
import { Paginacao, usePaginacao } from './Paginacao'

interface Props {
  evolucoes: EvolucaoPendenteAuditoria[]
  onSelecionarEvolucao: (item: EvolucaoPendenteAuditoria) => void
}

/*
 * 50 linhas por página. Cada linha traz o texto da evolução, e com o período
 * inteiro aberto eram ~400 de uma vez — o custo não estava na consulta, estava
 * no React montar tudo antes de pintar qualquer coisa.
 */
const POR_PAGINA = 50

const ICONE_RISCO = {
  sem_risco: CheckCircle2,
  risco_especifico: AlertTriangle,
  risco_relevante: XCircle
} as const

export function EvolucoesFeedTab({ evolucoes, onSelecionarEvolucao }: Props) {
  // Antes do early return: hook não pode ficar atrás de condicional.
  const { pagina, setPagina, totalPaginas, fatia } = usePaginacao(evolucoes, POR_PAGINA)

  if (evolucoes.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-16 text-center shadow-sm">
        <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-sm font-semibold text-foreground">
          Nenhuma evolução com estes filtros
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajuste o período, o risco ou a busca para ver os registros.
        </p>
      </div>
    )
  }

  const badgeRisco = (item: EvolucaoPendenteAuditoria) => {
    const aud = item.auditoria
    if (!aud) {
      return (
        <StatusChip tone="gray">
          <Clock className="h-3 w-3" /> Aguardando IA
        </StatusChip>
      )
    }
    const Icone = ICONE_RISCO[aud.status_risco]
    return (
      <StatusChip tone={TOM_RISCO[aud.status_risco]}>
        <Icone className="h-3 w-3" /> {ROTULO_RISCO[aud.status_risco]}
      </StatusChip>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* min-w-215 faz rolar de lado em tela estreita em vez de espremer as
          células em três linhas cada (§9 do padrão). O `min-w-0` é o que prende
          essa largura DENTRO do container: sem ele a tabela empurra o card e a
          página inteira ganha scroll horizontal no mobile. */}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-215 text-left text-xs">
          <thead className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-bold">Risco</th>
              <th scope="col" className="px-4 py-3 font-bold">Data</th>
              <th scope="col" className="px-4 py-3 font-bold">Paciente</th>
              <th scope="col" className="px-4 py-3 font-bold">Profissional</th>
              <th scope="col" className="px-4 py-3 font-bold">Trecho da evolução</th>
              <th scope="col" className="px-4 py-3 font-bold">Cobrança</th>
              <th scope="col" className="px-4 py-3 text-right font-bold">
                <span className="sr-only">Abrir detalhe</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {fatia.map(item => {
              const dataFormatada = new Date(item.data_sessao + 'T12:00:00Z').toLocaleDateString('pt-BR')
              const aud = item.auditoria

              return (
                <tr
                  key={item.grade_id}
                  onClick={() => onSelecionarEvolucao(item)}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                >
                  <td className="whitespace-nowrap px-4 py-3">{badgeRisco(item)}</td>

                  <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-foreground">
                    {dataFormatada}
                  </td>

                  <td className="max-w-45 truncate px-4 py-3 font-medium text-foreground" title={item.paciente_nome}>
                    {item.paciente_nome}
                  </td>

                  <td className="max-w-50 px-4 py-3">
                    <div className="truncate font-medium text-foreground">
                      {item.profissional_nome}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {item.terapia_nome || 'Terapia não informada'}
                    </div>
                  </td>

                  {/* Evolução em branco é a falha mais grave que existe aqui —
                      não pode se parecer com um trecho comum em cinza. */}
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                    {item.texto_original
                      ? item.texto_original
                      : <span className="font-semibold text-rose-700 dark:text-rose-300">Sem texto registrado</span>}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3">
                    {aud && (
                      <StatusChip tone={TOM_COBRANCA[aud.status_cobranca]} dense>
                        {ROTULO_COBRANCA[aud.status_cobranca]}
                      </StatusChip>
                    )}
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        onSelecionarEvolucao(item)
                      }}
                      aria-label={`Abrir evolução de ${item.paciente_nome} em ${dataFormatada}`}
                      className={`inline-flex items-center gap-1 rounded p-1 text-xs font-semibold text-sky-700 transition hover:underline dark:text-sky-300 ${FOCO}`}
                    >
                      Detalhes
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Paginacao
        pagina={pagina}
        totalPaginas={totalPaginas}
        total={evolucoes.length}
        porPagina={POR_PAGINA}
        onMudar={setPagina}
        rotuloItem={['evolução', 'evoluções']}
      />
    </div>
  )
}
