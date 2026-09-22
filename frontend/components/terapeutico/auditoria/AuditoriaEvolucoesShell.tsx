'use client'

import React, { useState, useEffect, useTransition } from 'react'
import { 
  Sparkles, 
  Search, 
  Filter, 
  Calendar, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Users, 
  MessageSquare,
  FileSearch,
  Layers,
  ArrowUpDown
} from 'lucide-react'
import { 
  buscarEvolucoesComAuditoria, 
  calcularResumoProfissionais, 
  atualizarStatusCobranca 
} from '@/services/auditoriaEvolucoes.service'
import type { 
  EvolucaoPendenteAuditoria, 
  ResumoProfissionalAuditoria, 
  StatusRiscoEvolucao, 
  StatusCobrancaEvolucao 
} from '@/types/auditoriaEvolucoes'
import { ProfissionaisCobrancaTab } from './ProfissionaisCobrancaTab'
import { EvolucoesFeedTab } from './EvolucoesFeedTab'
import { EvolucaoSidePanel } from './EvolucaoSidePanel'
import { ModalCobrancaWhatsApp } from './ModalCobrancaWhatsApp'

export function AuditoriaEvolucoesShell() {
  const [abaAtiva, setAbaAtiva] = useState<'profissionais' | 'feed'>('profissionais')
  
  // Filtros (Padrão: A partir de setembro de 2026)
  const [dataInicio, setDataInicio] = useState('2026-09-01')
  const [dataFim, setDataFim] = useState('')
  const [busca, setBusca] = useState('')
  const [statusRisco, setStatusRisco] = useState<StatusRiscoEvolucao | 'todos'>('todos')
  const [statusCobranca, setStatusCobranca] = useState<StatusCobrancaEvolucao | 'todos'>('todos')
  
  // Estado dos Dados
  const [evolucoes, setEvolucoes] = useState<EvolucaoPendenteAuditoria[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Estado de Execução em Lote de IA
  const [auditandoLote, setAuditandoLote] = useState(false)
  const [progressoLote, setProgressoLote] = useState<{ atual: number; total: number } | null>(null)

  // Modais e Side Panel
  const [itemSelecionado, setItemSelecionado] = useState<EvolucaoPendenteAuditoria | null>(null)
  const [profSelecionadoCobranca, setProfSelecionadoCobranca] = useState<ResumoProfissionalAuditoria | null>(null)

  const carregarDados = async () => {
    setLoading(true)
    setErro(null)
    try {
      const { data, error } = await buscarEvolucoesComAuditoria({
        dataInicio,
        dataFim: dataFim || undefined,
        busca: busca || undefined,
        statusRisco,
        statusCobranca
      })
      if (error) {
        setErro(error)
      } else {
        setEvolucoes(data)
      }
    } catch (e: any) {
      setErro(e.message || 'Erro ao carregar dados')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [dataInicio, dataFim, statusRisco, statusCobranca])

  // Resumo por profissional
  const resumosProfissionais = React.useMemo(() => {
    return calcularResumoProfissionais(evolucoes)
  }, [evolucoes])

  // KPIs
  const totalEvolucoes = evolucoes.length
  const totalAuditadas = evolucoes.filter(e => e.auditoria !== null).length
  const totalSemRisco = evolucoes.filter(e => e.auditoria?.status_risco === 'sem_risco').length
  const totalRiscoEspecifico = evolucoes.filter(e => e.auditoria?.status_risco === 'risco_especifico').length
  const totalRiscoRelevante = evolucoes.filter(e => e.auditoria?.status_risco === 'risco_relevante').length
  const totalPendentesCobranca = evolucoes.filter(
    e => e.auditoria && e.auditoria.status_risco !== 'sem_risco' && e.auditoria.status_cobranca === 'pendente'
  ).length
  const taxaConformidadeGeral = totalAuditadas > 0 ? Math.round((totalSemRisco / totalAuditadas) * 100) : 0

  // Disparar Auditoria em Lote via IA
  const handleAuditarLote = async () => {
    const pendentes = evolucoes.filter(e => !e.auditoria)
    if (pendentes.length === 0) {
      alert('Todas as evoluções do período selecionado já foram auditadas!')
      return
    }

    setAuditandoLote(true)
    setProgressoLote({ atual: 0, total: pendentes.length })

    const TAMANHO_LOTE = 5
    let processados = 0

    for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
      const chunk = pendentes.slice(i, i + TAMANHO_LOTE)
      const ids = chunk.map(c => c.grade_id)

      try {
        const res = await fetch('/api/terapeutico/auditoria-evolucoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gradeIds: ids,
            dataInicio,
            dataFim: dataFim || undefined,
            limite: TAMANHO_LOTE
          })
        })

        const json = await res.json()
        if (json.success) {
          processados += json.processados || chunk.length
          setProgressoLote({ atual: Math.min(processados, pendentes.length), total: pendentes.length })
        }
      } catch (e) {
        console.error('Erro no lote de auditoria:', e)
      }
    }

    setAuditandoLote(false)
    setProgressoLote(null)
    await carregarDados()
  }

  // Reauditar item individual
  const handleReauditarItem = async (gradeId: string) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gradeIds: [gradeId],
        reauditar: true,
        limite: 1
      })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
      // Atualizar o item selecionado no sidepanel
      const atualizado = evolucoes.find(e => e.grade_id === gradeId)
      if (atualizado) {
        setItemSelecionado(atualizado)
      }
    }
  }

  // Atualizar status de cobrança
  const handleAtualizarStatusCobranca = async (
    auditoriaId: string, 
    novoStatus: StatusCobrancaEvolucao, 
    observacao?: string
  ) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditoriaId,
        novoStatus,
        observacao
      })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

  // Confirmação de cobrança em lote para o profissional no WhatsApp
  const handleConfirmarCobrancaWhatsApp = async (auditoriaIds: string[], observacao: string) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditoriaIds,
        novoStatus: 'cobrado',
        observacao
      })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

  // Filtragem da lista para o feed por busca
  const evolucoesFiltradas = React.useMemo(() => {
    if (!busca) return evolucoes
    const b = busca.toLowerCase()
    return evolucoes.filter(r => 
      r.paciente_nome.toLowerCase().includes(b) ||
      r.profissional_nome.toLowerCase().includes(b) ||
      (r.terapia_nome && r.terapia_nome.toLowerCase().includes(b)) ||
      (r.texto_original && r.texto_original.toLowerCase().includes(b))
    )
  }, [evolucoes, busca])

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-8 space-y-6">
      
      {/* Header & Ação de Auditoria */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-6 rounded-3xl border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" />
            Auditoria Clínica & Anti-Glosa de Convênios
          </div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-zinc-100">
            Auditoria de Evoluções Terapêuticas
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
            Validação técnica das 4 perguntas obrigatórias, termos proibidos, sigilo e consistência documental com IA a partir de setembro de 2026.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={carregarDados}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>

          <button
            onClick={handleAuditarLote}
            disabled={auditandoLote || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white text-xs font-bold shadow-md shadow-teal-500/20 transition disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${auditandoLote ? 'animate-spin' : ''}`} />
            {auditandoLote ? 'Auditando com IA...' : 'Auditar Novas Evoluções'}
          </button>
        </div>
      </div>

      {/* Barra de Progresso do Lote */}
      {auditandoLote && progressoLote && (
        <div className="p-4 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 rounded-2xl space-y-2 animate-in fade-in">
          <div className="flex justify-between text-xs font-semibold text-teal-900 dark:text-teal-200">
            <span>Auditando lote de evoluções com IA...</span>
            <span>{progressoLote.atual} de {progressoLote.total} processadas</span>
          </div>
          <div className="w-full bg-teal-200/60 dark:bg-teal-900/60 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-teal-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.round((progressoLote.atual / progressoLote.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        
        {/* Total */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 block">Total Evoluções</span>
          <div className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mt-1">
            {totalEvolucoes}
          </div>
          <span className="text-[11px] text-zinc-400 mt-1 block">
            {totalAuditadas} auditadas ({totalEvolucoes - totalAuditadas} pendentes)
          </span>
        </div>

        {/* Conformidade */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 block">Taxa de Conformidade</span>
          <div className="text-2xl font-black text-teal-600 dark:text-teal-400 mt-1">
            {taxaConformidadeGeral}%
          </div>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 block font-medium">
            {totalSemRisco} sem risco de glosa
          </span>
        </div>

        {/* Risco Específico */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 block">Risco em Ponto Específico</span>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {totalRiscoEspecifico}
          </div>
          <span className="text-[11px] text-amber-600/80 mt-1 block">
            Ajustes pontuais de redação
          </span>
        </div>

        {/* Risco Relevante */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-red-200/60 dark:border-red-950/60 bg-red-50/20 dark:bg-red-950/10 shadow-sm">
          <span className="text-xs font-medium text-red-600 dark:text-red-400 block">Risco Relevante (Glosa)</span>
          <div className="text-2xl font-black text-red-600 dark:text-red-400 mt-1">
            {totalRiscoRelevante}
          </div>
          <span className="text-[11px] text-red-500 mt-1 block font-medium">
            Incompletas ou termos vedados
          </span>
        </div>

        {/* Pendentes de Cobrança */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-teal-200/60 dark:border-teal-950/60 bg-teal-50/20 dark:bg-teal-950/10 shadow-sm col-span-2 lg:col-span-1">
          <span className="text-xs font-medium text-teal-700 dark:text-teal-400 block">Pendentes de Cobrança</span>
          <div className="text-2xl font-black text-teal-700 dark:text-teal-300 mt-1">
            {totalPendentesCobranca}
          </div>
          <span className="text-[11px] text-teal-600 mt-1 block">
            Cobrar do terapeuta no TiTa
          </span>
        </div>

      </div>

      {/* Barra de Filtros e Abas */}
      <div className="space-y-4">
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Seletor de Abas */}
          <div className="flex items-center p-1 bg-zinc-200/70 dark:bg-zinc-800 rounded-2xl w-fit">
            <button
              onClick={() => setAbaAtiva('profissionais')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                abaAtiva === 'profissionais'
                  ? 'bg-white dark:bg-zinc-900 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <Users className="w-4 h-4" />
              Por Profissional (Cobrança)
              {totalPendentesCobranca > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">
                  {totalPendentesCobranca}
                </span>
              )}
            </button>

            <button
              onClick={() => setAbaAtiva('feed')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                abaAtiva === 'feed'
                  ? 'bg-white dark:bg-zinc-900 text-teal-600 dark:text-teal-400 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              <FileSearch className="w-4 h-4" />
              Todas as Evoluções ({totalEvolucoes})
            </button>
          </div>

          {/* Filtros de Data e Busca */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            
            {/* Atalhos rápidos */}
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setDataInicio('2026-09-15')
                  setDataFim('2026-09-15')
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                  dataInicio === '2026-09-15' && dataFim === '2026-09-15'
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                15/09
              </button>
              <button
                type="button"
                onClick={() => {
                  const hoje = new Date().toISOString().split('T')[0]
                  setDataInicio(hoje)
                  setDataFim(hoje)
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                  dataInicio === dataFim && dataFim === new Date().toISOString().split('T')[0]
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => {
                  setDataInicio('2026-09-01')
                  setDataFim('')
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                  dataInicio === '2026-09-01' && dataFim === ''
                    ? 'bg-teal-600 text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                }`}
              >
                Mês Setembro
              </button>
            </div>

            {/* Data Início */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl">
              <Calendar className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-zinc-500">De:</span>
              <input
                type="date"
                value={dataInicio}
                onChange={e => {
                  setDataInicio(e.target.value)
                  // Se dataFim estiver vazia e o usuário alterar a data, define a data fim igual para facilitar dia único
                  if (!dataFim) {
                    setDataFim(e.target.value)
                  }
                }}
                className="bg-transparent text-zinc-800 dark:text-zinc-200 focus:outline-none"
              />
            </div>

            {/* Data Fim */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl">
              <span className="text-zinc-500">Até:</span>
              <input
                type="date"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
                className="bg-transparent text-zinc-800 dark:text-zinc-200 focus:outline-none"
              />
            </div>

            {/* Filtro Risco */}
            <select
              value={statusRisco}
              onChange={e => setStatusRisco(e.target.value as any)}
              className="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="todos">Todos os Riscos</option>
              <option value="risco_relevante">Risco Relevante</option>
              <option value="risco_especifico">Risco Específico</option>
              <option value="sem_risco">Sem Risco</option>
            </select>

            {/* Filtro Cobrança */}
            <select
              value={statusCobranca}
              onChange={e => setStatusCobranca(e.target.value as any)}
              className="px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="todos">Todas Cobranças</option>
              <option value="pendente">Pendente</option>
              <option value="cobrado">Cobrado</option>
              <option value="aguardando_correcao">Aguardando Correção</option>
              <option value="corrigido_tita">Corrigido no TiTa</option>
              <option value="ignorado">Dispensado</option>
            </select>

            {/* Input Busca */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar paciente, terapeuta..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="pl-8 pr-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-teal-500 w-48 sm:w-56"
              />
            </div>

          </div>

        </div>

      </div>

      {/* Conteúdo Principal */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-teal-600 animate-spin" />
          <p className="text-xs text-zinc-500">Carregando evoluções e auditorias...</p>
        </div>
      ) : erro ? (
        <div className="p-6 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-2xl text-center space-y-2">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Erro ao carregar dados</h3>
          <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>
        </div>
      ) : (
        <>
          {abaAtiva === 'profissionais' ? (
            <ProfissionaisCobrancaTab
              resumos={resumosProfissionais}
              onCobrarProfissional={prof => setProfSelecionadoCobranca(prof)}
              onVerEvolucoesProfissional={prof => {
                setBusca(prof.profissional_nome)
                setAbaAtiva('feed')
              }}
            />
          ) : (
            <EvolucoesFeedTab
              evolucoes={evolucoesFiltradas}
              onSelecionarEvolucao={item => setItemSelecionado(item)}
            />
          )}
        </>
      )}

      {/* Side Panel da Evolução */}
      <EvolucaoSidePanel
        item={itemSelecionado}
        isOpen={Boolean(itemSelecionado)}
        onClose={() => setItemSelecionado(null)}
        onReauditar={handleReauditarItem}
        onAtualizarStatusCobranca={handleAtualizarStatusCobranca}
      />

      {/* Modal de Cobrança WhatsApp */}
      <ModalCobrancaWhatsApp
        profissional={profSelecionadoCobranca}
        isOpen={Boolean(profSelecionadoCobranca)}
        onClose={() => setProfSelecionadoCobranca(null)}
        onConfirmarCobranca={handleConfirmarCobrancaWhatsApp}
      />

    </div>
  )
}
