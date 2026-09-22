'use client'

import React from 'react'
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  ChevronRight, 
  Sparkles, 
  MessageSquare,
  ShieldCheck,
  User,
  Calendar,
  FileText
} from 'lucide-react'
import type { EvolucaoPendenteAuditoria } from '@/types/auditoriaEvolucoes'

interface Props {
  evolucoes: EvolucaoPendenteAuditoria[]
  onSelecionarEvolucao: (item: EvolucaoPendenteAuditoria) => void
}

export function EvolucoesFeedTab({
  evolucoes,
  onSelecionarEvolucao
}: Props) {
  if (evolucoes.length === 0) {
    return (
      <div className="text-center py-16 px-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <FileText className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Nenhuma evolução encontrada com os filtros atuais.
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          Ajuste os filtros de busca, status ou período para visualizar os registros.
        </p>
      </div>
    )
  }

  const renderBadgeRisco = (item: EvolucaoPendenteAuditoria) => {
    const aud = item.auditoria
    if (!aud) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
          <Clock className="w-3 h-3" /> Pendente de IA
        </span>
      )
    }
    if (aud.status_risco === 'sem_risco') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-3 h-3" /> Sem Risco
        </span>
      )
    }
    if (aud.status_risco === 'risco_especifico') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-3 h-3" /> Ponto Específico
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        <XCircle className="w-3 h-3" /> Risco Relevante
      </span>
    )
  }

  const renderBadgeCobranca = (item: EvolucaoPendenteAuditoria) => {
    const aud = item.auditoria
    if (!aud) return null

    const mapStatus = {
      pendente: { label: 'Pendente', bg: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
      cobrado: { label: 'Cobrado', bg: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300' },
      aguardando_correcao: { label: 'Aguardando', bg: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
      corrigido_tita: { label: 'Corrigido', bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
      ignorado: { label: 'Dispensado', bg: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' }
    }

    const st = mapStatus[aud.status_cobranca] || mapStatus.pendente

    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${st.bg}`}>
        {st.label}
      </span>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">Status & Risco</th>
              <th className="py-3 px-4">Data</th>
              <th className="py-3 px-4">Paciente</th>
              <th className="py-3 px-4">Profissional / Terapia</th>
              <th className="py-3 px-4">Trecho da Evolução</th>
              <th className="py-3 px-4">Cobrança</th>
              <th className="py-3 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {evolucoes.map(item => {
              const dataFormatada = new Date(item.data_sessao + 'T12:00:00Z').toLocaleDateString('pt-BR')
              const aud = item.auditoria

              return (
                <tr
                  key={item.grade_id}
                  onClick={() => onSelecionarEvolucao(item)}
                  className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50 cursor-pointer transition"
                >
                  <td className="py-3 px-4 whitespace-nowrap">
                    {renderBadgeRisco(item)}
                  </td>
                  
                  <td className="py-3 px-4 whitespace-nowrap font-medium text-zinc-800 dark:text-zinc-200">
                    {dataFormatada}
                  </td>

                  <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100 max-w-[180px] truncate">
                    {item.paciente_nome}
                  </td>

                  <td className="py-3 px-4 max-w-[200px]">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                      {item.profissional_nome}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {item.terapia_nome || 'Geral'}
                    </div>
                  </td>

                  <td className="py-3 px-4 max-w-xs truncate text-zinc-600 dark:text-zinc-400 font-sans">
                    {item.texto_original || '(Sem texto)'}
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    {renderBadgeCobranca(item)}
                  </td>

                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelecionarEvolucao(item)
                      }}
                      className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:text-teal-700 font-medium text-xs p-1"
                    >
                      Detalhes
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
