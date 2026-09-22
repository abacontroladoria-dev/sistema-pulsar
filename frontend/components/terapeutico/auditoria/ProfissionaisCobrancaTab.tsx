'use client'

import React from 'react'
import { 
  User, 
  MessageSquare, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  ShieldAlert,
  Search,
  Sparkles,
  Layers
} from 'lucide-react'
import type { ResumoProfissionalAuditoria } from '@/types/auditoriaEvolucoes'

interface Props {
  resumos: ResumoProfissionalAuditoria[]
  onCobrarProfissional: (prof: ResumoProfissionalAuditoria) => void
  onVerEvolucoesProfissional: (prof: ResumoProfissionalAuditoria) => void
}

export function ProfissionaisCobrancaTab({
  resumos,
  onCobrarProfissional,
  onVerEvolucoesProfissional
}: Props) {
  if (resumos.length === 0) {
    return (
      <div className="text-center py-16 px-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <Layers className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Nenhum profissional com evoluções no período selecionado.
        </h3>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
          Tente alterar o período (a partir de setembro) ou clique em &quot;Auditar Novas Evoluções&quot; para rodar a análise.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {resumos.map((prof, idx) => {
          const temRisco = prof.risco_relevante > 0 || prof.risco_especifico > 0
          const temPendenciasCobranca = prof.pendentes_cobranca > 0

          return (
            <div
              key={prof.profissional_id ? String(prof.profissional_id) : prof.profissional_nome}
              className={`relative rounded-2xl p-5 border transition-all duration-200 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md ${
                prof.risco_relevante > 0
                  ? 'border-red-200 dark:border-red-900/60 hover:border-red-300'
                  : prof.risco_especifico > 0
                  ? 'border-amber-200 dark:border-amber-900/60 hover:border-amber-300'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
              }`}
            >
              {/* Top info */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                    prof.risco_relevante > 0
                      ? 'bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300'
                      : prof.risco_especifico > 0
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300'
                  }`}>
                    {prof.profissional_nome.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm leading-snug line-clamp-1">
                      {prof.profissional_nome}
                    </h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {prof.terapia_nome || 'Especialidade não definida'}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${
                    prof.taxa_conformidade >= 85
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : prof.taxa_conformidade >= 60
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                  }`}>
                    {prof.taxa_conformidade}% conformidade
                  </span>
                </div>
              </div>

              {/* Progress bar conformidade */}
              <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-4">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    prof.taxa_conformidade >= 85 ? 'bg-emerald-500' :
                    prof.taxa_conformidade >= 60 ? 'bg-amber-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${prof.taxa_conformidade}%` }}
                />
              </div>

              {/* Grid de Métricas */}
              <div className="grid grid-cols-4 gap-2 text-center py-2 px-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl mb-4 text-xs">
                <div>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block">Total</span>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {prof.total_evolucoes}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block">Sem Risco</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                    {prof.sem_risco}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 block">Ponto Espec.</span>
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    {prof.risco_especifico}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-red-600 dark:text-red-400 block">Risco Alto</span>
                  <span className="font-bold text-red-700 dark:text-red-300">
                    {prof.risco_relevante}
                  </span>
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  onClick={() => onVerEvolucoesProfissional(prof)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition"
                >
                  Ver Sessões ({prof.total_evolucoes})
                </button>

                {temRisco && (
                  <button
                    onClick={() => onCobrarProfissional(prof)}
                    className={`flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition ${
                      temPendenciasCobranca
                        ? 'bg-teal-600 hover:bg-teal-700 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {temPendenciasCobranca ? `Cobrar (${prof.pendentes_cobranca})` : 'Cobrar WhatsApp'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
