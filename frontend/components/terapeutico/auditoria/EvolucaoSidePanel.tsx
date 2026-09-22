'use client'

import React, { useState } from 'react'
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Copy, 
  Check, 
  RefreshCw, 
  Send,
  User, 
  Calendar, 
  Tag, 
  ShieldCheck, 
  Clock,
  History,
  FileText
} from 'lucide-react'
import type { 
  EvolucaoPendenteAuditoria, 
  StatusCobrancaEvolucao,
  RegistroAuditoriaEvolucao
} from '@/types/auditoriaEvolucoes'

interface Props {
  item: EvolucaoPendenteAuditoria | null
  isOpen: boolean
  onClose: () => void
  onReauditar: (gradeId: string) => Promise<void>
  onAtualizarStatusCobranca: (auditoriaId: string, novoStatus: StatusCobrancaEvolucao, observacao?: string) => Promise<void>
}

export function EvolucaoSidePanel({
  item,
  isOpen,
  onClose,
  onReauditar,
  onAtualizarStatusCobranca
}: Props) {
  const [copiado, setCopiado] = useState(false)
  const [reauditando, setReauditando] = useState(false)
  const [salvandoStatus, setSalvandoStatus] = useState(false)
  const [novoStatus, setNovoStatus] = useState<StatusCobrancaEvolucao>('pendente')
  const [observacaoStatus, setObservacaoStatus] = useState('')

  if (!isOpen || !item) return null

  const aud = item.auditoria

  const handleCopiarTextoRevisado = async () => {
    if (!aud?.texto_revisado) return
    try {
      await navigator.clipboard.writeText(aud.texto_revisado)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch (e) {
      console.error(e)
    }
  }

  const handleReauditarClick = async () => {
    setReauditando(true)
    try {
      await onReauditar(item.grade_id)
    } finally {
      setReauditando(false)
    }
  }

  const handleSalvarStatus = async () => {
    if (!aud?.id) return
    setSalvandoStatus(true)
    try {
      await onAtualizarStatusCobranca(aud.id, novoStatus, observacaoStatus)
      setObservacaoStatus('')
    } finally {
      setSalvandoStatus(false)
    }
  }

  const getRiscoBadge = () => {
    if (!aud) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
          <Clock className="w-3.5 h-3.5" /> Não Auditado
        </span>
      )
    }
    if (aud.status_risco === 'sem_risco') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="w-3.5 h-3.5" /> Sem Risco de Glosa
        </span>
      )
    }
    if (aud.status_risco === 'risco_especifico') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-3.5 h-3.5" /> Risco em Ponto Específico
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
        <XCircle className="w-3.5 h-3.5" /> Risco Relevante de Glosa
      </span>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity duration-300">
      <div 
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 h-full shadow-2xl flex flex-col border-l border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-right duration-300 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                Auditoria Clínica & Anti-Glosa
              </span>
              {getRiscoBadge()}
            </div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {item.paciente_nome}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-3">
              <span>👤 {item.profissional_nome}</span>
              <span>📅 {new Date(item.data_sessao + 'T12:00:00Z').toLocaleDateString('pt-BR')}</span>
              <span>🏷️ {item.terapia_nome || 'Terapia'}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReauditarClick}
              disabled={reauditando}
              title="Reauditar com IA"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reauditando ? 'animate-spin' : ''}`} />
              {reauditando ? 'Auditando...' : 'Reauditar'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Checklist dos 4 Pilares Fundamentais */}
          {aud && (
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/80 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Estrutura Mínima Obrigatória (4 Perguntas)
              </h3>
              
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800">
                  {aud.checklist_perguntas?.chegou ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={aud.checklist_perguntas?.chegou ? 'text-zinc-700 dark:text-zinc-300' : 'text-red-600 dark:text-red-400 font-medium'}>
                    1. Estado na chegada
                  </span>
                </div>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800">
                  {aud.checklist_perguntas?.objetivo ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={aud.checklist_perguntas?.objetivo ? 'text-zinc-700 dark:text-zinc-300' : 'text-red-600 dark:text-red-400 font-medium'}>
                    2. Objetivo planejado
                  </span>
                </div>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800">
                  {aud.checklist_perguntas?.recursos ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={aud.checklist_perguntas?.recursos ? 'text-zinc-700 dark:text-zinc-300' : 'text-red-600 dark:text-red-400 font-medium'}>
                    3. Recursos / Materiais
                  </span>
                </div>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800">
                  {aud.checklist_perguntas?.reacao_saida ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className={aud.checklist_perguntas?.reacao_saida ? 'text-zinc-700 dark:text-zinc-300' : 'text-red-600 dark:text-red-400 font-medium'}>
                    4. Reação e saída
                  </span>
                </div>
              </div>

              {aud.resumo_justificativa && (
                <div className="pt-1 text-xs text-zinc-600 dark:text-zinc-300 italic bg-teal-500/5 p-2.5 rounded-lg border border-teal-500/10">
                  💡 {aud.resumo_justificativa}
                </div>
              )}
            </div>
          )}

          {/* Apontamentos de Risco de Glosa */}
          {aud && aud.apontamentos && aud.apontamentos.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Pontos de Atenção & Risco de Glosa ({aud.apontamentos.length})
              </h3>
              <div className="space-y-2">
                {aud.apontamentos.map((ap, idx) => (
                  <div 
                    key={idx} 
                    className="p-3 rounded-xl bg-red-50/60 dark:bg-red-950/30 border border-red-200/70 dark:border-red-900/50 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-red-900 dark:text-red-200 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        {ap.titulo}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        ap.gravidade === 'alta' ? 'bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200' :
                        ap.gravidade === 'media' ? 'bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200' :
                        'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}>
                        Gravidade {ap.gravidade}
                      </span>
                    </div>
                    <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {ap.descricao}
                    </p>
                    {ap.trecho && (
                      <div className="p-1.5 bg-white dark:bg-zinc-900 rounded font-mono text-[11px] text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                        &quot;{ap.trecho}&quot;
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comparativo: Original vs Revisado */}
          <div className="space-y-4">
            
            {/* Texto Original */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                <span>Texto Original (Escrito pelo Profissional)</span>
                <span className="text-[11px] text-zinc-400 font-normal">
                  {item.texto_original?.length || 0} caracteres
                </span>
              </label>
              <div className="p-3.5 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/80 text-xs text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 leading-relaxed font-sans whitespace-pre-wrap">
                {item.texto_original || '(Sem texto de evolução)'}
              </div>
            </div>

            {/* Texto Revisado Sugerido */}
            {aud?.texto_revisado && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Texto Revisado & Padronizado (Pronto para Prontuário)
                  </label>
                  <button
                    onClick={handleCopiarTextoRevisado}
                    className="flex items-center gap-1 text-[11px] text-teal-600 dark:text-teal-400 hover:underline font-medium"
                  >
                    {copiado ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    {copiado ? 'Copiado!' : 'Copiar Texto'}
                  </button>
                </div>
                <div className="relative group">
                  <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 text-xs text-zinc-900 dark:text-zinc-100 border border-emerald-200 dark:border-emerald-800/60 leading-relaxed font-sans whitespace-pre-wrap selection:bg-emerald-500/30">
                    {aud.texto_revisado}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Gestão de Cobrança / Tratativa */}
          {aud && (
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                <History className="w-4 h-4 text-teal-600" />
                Status de Cobrança & Histórico
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Alterar Status:</label>
                  <select
                    defaultValue={aud.status_cobranca}
                    onChange={e => setNovoStatus(e.target.value as StatusCobrancaEvolucao)}
                    className="w-full text-xs p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="pendente">Pendente de Cobrança</option>
                    <option value="cobrado">Cobrado do Profissional</option>
                    <option value="aguardando_correcao">Aguardando Correção</option>
                    <option value="corrigido_tita">Corrigido no TiTa</option>
                    <option value="ignorado">Dispensado / Ignorado</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Observação:</label>
                  <input
                    type="text"
                    placeholder="Ex: Cobrado via WhatsApp em 21/09..."
                    value={observacaoStatus}
                    onChange={e => setObservacaoStatus(e.target.value)}
                    className="w-full text-xs p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={handleSalvarStatus}
                  disabled={salvandoStatus}
                  className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium shadow-sm transition disabled:opacity-50"
                >
                  {salvandoStatus ? 'Salvando...' : 'Salvar Alteração'}
                </button>
              </div>

              {/* Log de Histórico */}
              {aud.historico_cobranca && aud.historico_cobranca.length > 0 && (
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60 space-y-1.5">
                  <span className="text-[11px] font-semibold text-zinc-500 block">Trilha de Tratativas:</span>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {aud.historico_cobranca.map((h, i) => (
                      <div key={i} className="text-[11px] text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                        <span className="font-mono text-zinc-400 text-[10px]">
                          {new Date(h.data).toLocaleString('pt-BR')}
                        </span>
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{h.usuario}:</span>
                        <span>{h.acao} {h.observacao ? `(${h.observacao})` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex justify-between items-center">
          <span className="text-xs text-zinc-400">
            {aud?.auditado_em ? `Auditado em ${new Date(aud.auditado_em).toLocaleString('pt-BR')}` : 'Não auditado'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition"
          >
            Fechar Painel
          </button>
        </div>

      </div>
    </div>
  )
}
