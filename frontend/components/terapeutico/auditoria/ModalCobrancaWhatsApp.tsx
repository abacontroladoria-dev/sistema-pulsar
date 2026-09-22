'use client'

import React, { useState } from 'react'
import { 
  X, 
  Copy, 
  Check, 
  MessageSquare, 
  AlertTriangle, 
  Send, 
  User, 
  Calendar,
  Sparkles
} from 'lucide-react'
import type { ResumoProfissionalAuditoria, RegistroAuditoriaEvolucao } from '@/types/auditoriaEvolucoes'

interface Props {
  profissional: ResumoProfissionalAuditoria | null
  isOpen: boolean
  onClose: () => void
  onConfirmarCobranca: (auditoriaIds: string[], observacao: string) => Promise<void>
}

export function ModalCobrancaWhatsApp({
  profissional,
  isOpen,
  onClose,
  onConfirmarCobranca
}: Props) {
  const [copiado, setCopiado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [observacao, setObservacao] = useState('')

  if (!isOpen || !profissional) return null

  // Apenas evoluções com risco (relevante ou específico)
  const evolucoesPendentes = profissional.evolucoes_com_risco.filter(
    e => e.status_cobranca === 'pendente' || e.status_cobranca === 'aguardando_correcao'
  )

  // Montar texto amigável e profissional para WhatsApp
  const saudacao = `Olá, *${profissional.profissional_nome.split(' ')[0]}*! Tudo bem?`
  const intro = `A coordenação terapêutica da Clínica Universo ABA realizou a revisão técnica das evoluções de atendimentos. Identificamos algumas sessões com pontos de atenção que precisam de ajuste no sistema TiTa para evitar risco de glosa junto ao convênio.`
  
  const corpo = evolucoesPendentes.map((ev, idx) => {
    const dataFormatada = new Date(ev.data_sessao + 'T12:00:00Z').toLocaleDateString('pt-BR')
    const apontamentosTexto = ev.apontamentos && ev.apontamentos.length > 0
      ? ev.apontamentos.map(a => `  • _${a.titulo}_: ${a.descricao}`).join('\n')
      : `  • Ajuste na estrutura mínima da evolução (4 perguntas obrigatórias).`

    return `📌 *${idx + 1}. Paciente:* ${ev.paciente_nome}
📅 *Data:* ${dataFormatada} | *Especialidade:* ${ev.terapia_nome || 'Geral'}
⚠️ *Pontos de atenção:*
${apontamentosTexto}

✍️ *Sugestão de texto revisado para o prontuário:*
"${ev.texto_revisado || ev.texto_original}"`
  }).join('\n\n───────────────\n\n')

  const encerramento = `Por gentileza, acesse o prontuário no sistema TiTa e atualize a evolução conforme indicado assim que possível.\n\nQualquer dúvida, a coordenação está à disposição! Obrigado(a)!`

  const mensagemCompleta = `${saudacao}\n\n${intro}\n\n${corpo}\n\n${encerramento}`

  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(mensagemCompleta)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 3000)
    } catch (e) {
      console.error('Falha ao copiar:', e)
    }
  }

  const handleSalvarCobrado = async () => {
    setSalvando(true)
    try {
      const ids = evolucoesPendentes.map(e => e.id)
      await onConfirmarCobranca(ids, observacao || 'Cobrança enviada via WhatsApp')
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-teal-500/10 via-emerald-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-lg">
                Cobrança de Evoluções - WhatsApp
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {profissional.profissional_nome} ({evolucoesPendentes.length} {evolucoesPendentes.length === 1 ? 'sessão com pendência' : 'sessões com pendências'})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          
          {/* Card Resumo do Profissional */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 text-xs">
            <div>
              <span className="text-zinc-500 block">Total com Risco</span>
              <span className="font-bold text-red-600 dark:text-red-400 text-sm">
                {profissional.risco_relevante + profissional.risco_especifico}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">Risco Relevante</span>
              <span className="font-bold text-amber-600 dark:text-amber-400 text-sm">
                {profissional.risco_relevante}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block">Taxa Conformidade</span>
              <span className="font-bold text-teal-600 dark:text-teal-400 text-sm">
                {profissional.taxa_conformidade}%
              </span>
            </div>
          </div>

          {/* Preview da Mensagem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Mensagem Formatada (Pronta para Enviar):
              </label>
              <span className="text-[11px] text-zinc-400">
                Inclui apontamentos e texto revisado
              </span>
            </div>
            <div className="relative">
              <textarea
                readOnly
                rows={12}
                value={mensagemCompleta}
                className="w-full text-xs font-mono p-4 rounded-xl bg-zinc-950 text-zinc-200 border border-zinc-800 leading-relaxed focus:outline-none resize-none selection:bg-teal-500/30"
              />
              <button
                onClick={handleCopiar}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium shadow-md transition"
              >
                {copiado ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copiar Mensagem
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Campo de Observação Opcional */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Observação interna da tratativa (opcional):
            </label>
            <input
              type="text"
              placeholder="Ex: Enviado no grupo de Fono / Avisado no plantão da manhã..."
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition"
          >
            Fechar
          </button>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopiar}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiado ? 'Copiado!' : 'Copiar Texto'}
            </button>
            
            <button
              onClick={handleSalvarCobrado}
              disabled={salvando || evolucoesPendentes.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {salvando ? 'Salvando...' : 'Marcar como Cobrado'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
