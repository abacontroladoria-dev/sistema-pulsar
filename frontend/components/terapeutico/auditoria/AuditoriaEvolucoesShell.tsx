'use client'

import React, { useState, useEffect } from 'react'
import {
  Sparkles,
  Search,
  RefreshCw,
  AlertTriangle,
  Users,
  FileSearch
} from 'lucide-react'
import { useToneColor } from '@/hooks/useToneColor'
import { TONE_CHIP } from '@/components/ui/tones'
import {
  buscarEvolucoesComAuditoria,
  calcularResumoProfissionais
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
import {
  tomDaConformidade,
  tomSeHouver,
  CAMPO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  FOCO
} from './vocabulario'

/** Marco em que a auditoria de evoluções entrou em operação. */
const PISO_PERIODO = '2026-09-01'

/**
 * Data no fuso de QUEM OLHA, não em UTC. `toISOString()` converte para UTC, e
 * em UTC-3 isso vira o dia seguinte a partir das 21h — a tela é usada pelas
 * atendentes à noite, então "Hoje" traria o dia errado e o campo "Até"
 * apareceria com uma data futura.
 */
const diaLocalISO = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0]

const hojeISO = () => diaLocalISO(new Date())

const ontemISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return diaLocalISO(d)
}

export function AuditoriaEvolucoesShell() {
  const toneColor = useToneColor()
  const [abaAtiva, setAbaAtiva] = useState<'profissionais' | 'feed'>('profissionais')

  // Filtros — o período começa no marco da feature e vai até hoje.
  // `dataFim` nasce preenchida com hoje para o campo "Até" não abrir vazio; o
  // recorte resultante é o mesmo, já que não há sessão futura com evolução.
  const [dataInicio, setDataInicio] = useState(PISO_PERIODO)
  const [dataFim, setDataFim] = useState(hojeISO)
  const [busca, setBusca] = useState('')
  const [statusRisco, setStatusRisco] = useState<StatusRiscoEvolucao | 'todos'>('todos')
  const [statusCobranca, setStatusCobranca] = useState<StatusCobrancaEvolucao | 'todos'>('todos')

  const [evolucoes, setEvolucoes] = useState<EvolucaoPendenteAuditoria[]>([])
  // `carregouUmaVez` separa a primeira carga (skeleton) da recarga (a lista fica
  // onde está e só aparece "Atualizando…"). Ver §3.9 do padrão: esconder o que a
  // pessoa está lendo é pior que esperar.
  const [carregando, setCarregando] = useState(true)
  const [carregouUmaVez, setCarregouUmaVez] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [auditandoLote, setAuditandoLote] = useState(false)
  const [progressoLote, setProgressoLote] = useState<{ atual: number; total: number } | null>(null)
  const [avisoLote, setAvisoLote] = useState<string | null>(null)

  const [itemSelecionado, setItemSelecionado] = useState<EvolucaoPendenteAuditoria | null>(null)
  const [profSelecionadoCobranca, setProfSelecionadoCobranca] = useState<ResumoProfissionalAuditoria | null>(null)

  const carregarDados = async () => {
    setCarregando(true)
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
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar dados')
    } finally {
      setCarregando(false)
      setCarregouUmaVez(true)
    }
  }

  useEffect(() => {
    carregarDados()
  }, [dataInicio, dataFim, statusRisco, statusCobranca])

  const resumosProfissionais = React.useMemo(() => {
    return calcularResumoProfissionais(evolucoes)
  }, [evolucoes])

  // KPIs
  const totalEvolucoes = evolucoes.length
  const totalAuditadas = evolucoes.filter(e => e.auditoria !== null).length
  const totalPendentesIA = totalEvolucoes - totalAuditadas
  const totalSemRisco = evolucoes.filter(e => e.auditoria?.status_risco === 'sem_risco').length
  const totalRiscoEspecifico = evolucoes.filter(e => e.auditoria?.status_risco === 'risco_especifico').length
  const totalRiscoRelevante = evolucoes.filter(e => e.auditoria?.status_risco === 'risco_relevante').length
  const totalPendentesCobranca = evolucoes.filter(
    e => e.auditoria && e.auditoria.status_risco !== 'sem_risco' && e.auditoria.status_cobranca === 'pendente'
  ).length
  // Sem denominador não há percentual — "—", nunca 0% (§4 do padrão).
  const taxaConformidadeGeral = totalAuditadas > 0
    ? Math.round((totalSemRisco / totalAuditadas) * 100)
    : null

  const handleAuditarLote = async () => {
    const pendentes = evolucoes.filter(e => !e.auditoria)
    if (pendentes.length === 0) {
      setAvisoLote('Todas as evoluções deste período já foram auditadas.')
      return
    }

    setAvisoLote(null)
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
      const atualizado = evolucoes.find(e => e.grade_id === gradeId)
      if (atualizado) {
        setItemSelecionado(atualizado)
      }
    }
  }

  const handleAtualizarStatusCobranca = async (
    auditoriaId: string,
    novoStatus: StatusCobrancaEvolucao,
    observacao?: string
  ) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditoriaId, novoStatus, observacao })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

  const handleConfirmarCobrancaWhatsApp = async (auditoriaIds: string[], observacao: string) => {
    const res = await fetch('/api/terapeutico/auditoria-evolucoes/cobranca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditoriaIds, novoStatus: 'cobrado', observacao })
    })

    const json = await res.json()
    if (json.success) {
      await carregarDados()
    }
  }

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

  const periodoAtivo = (ini: string, fim: string) => dataInicio === ini && dataFim === fim

  const atalhoPeriodo = (rotulo: string, ini: string, fim: string) => (
    <button
      type="button"
      onClick={() => { setDataInicio(ini); setDataFim(fim) }}
      aria-pressed={periodoAtivo(ini, fim)}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${FOCO} ${
        periodoAtivo(ini, fim)
          ? 'bg-brand-fg text-white'
          : 'text-muted-foreground hover:bg-card hover:text-foreground'
      }`}
    >
      {rotulo}
    </button>
  )

  const primeiraCarga = carregando && !carregouUmaVez

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">

      {/* Ações da tela. O título vive no header do layout (HeaderContext). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          As quatro perguntas obrigatórias, termos vedados, sigilo e consistência
          documental — conferidos por IA a partir de {new Date(PISO_PERIODO + 'T12:00:00Z').toLocaleDateString('pt-BR')}.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={carregarDados} disabled={carregando} className={BOTAO_SECUNDARIO}>
            <RefreshCw className={`h-3.5 w-3.5 ${carregando ? 'motion-safe:animate-spin' : ''}`} />
            Atualizar
          </button>

          <button onClick={handleAuditarLote} disabled={auditandoLote || carregando} className={BOTAO_PRIMARIO}>
            <Sparkles className={`h-4 w-4 ${auditandoLote ? 'motion-safe:animate-spin' : ''}`} />
            {auditandoLote ? 'Auditando…' : 'Auditar novas evoluções'}
          </button>
        </div>
      </div>

      {avisoLote && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {avisoLote}
        </p>
      )}

      {auditandoLote && progressoLote && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex justify-between text-xs font-semibold text-foreground">
            <span>Auditando evoluções com IA…</span>
            <span className="tabular-nums">
              {progressoLote.atual} de {progressoLote.total}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-border bg-muted">
            <div
              className="h-full w-full bg-brand"
              style={{
                clipPath: `inset(0 ${100 - Math.round((progressoLote.atual / progressoLote.total) * 100)}% 0 0)`,
                transition: 'clip-path 500ms cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            />
          </div>
        </div>
      )}

      {/* KPIs */}
      {primeiraCarga ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="h-3 w-24 rounded bg-muted motion-safe:animate-pulse" />
              <div className="mt-2 h-7 w-12 rounded bg-muted motion-safe:animate-pulse" />
              <div className="mt-2 h-2.5 w-28 rounded bg-muted motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi
            rotulo="Evoluções no período"
            valor={totalEvolucoes}
            nota={totalPendentesIA > 0
              ? `${totalAuditadas} auditadas · ${totalPendentesIA} aguardando IA`
              : `${totalAuditadas} auditadas`}
          />
          <Kpi
            rotulo="Conformidade"
            valor={taxaConformidadeGeral === null ? '—' : `${taxaConformidadeGeral}%`}
            cor={toneColor(tomDaConformidade(taxaConformidadeGeral))}
            nota={`${totalSemRisco} sem risco de glosa`}
          />
          <Kpi
            rotulo="Ponto específico"
            valor={totalRiscoEspecifico}
            cor={toneColor(tomSeHouver(totalRiscoEspecifico, 'amber'))}
            nota="Ajustes pontuais de redação"
          />
          <Kpi
            rotulo="Risco relevante"
            valor={totalRiscoRelevante}
            cor={toneColor(tomSeHouver(totalRiscoRelevante, 'red'))}
            nota="Incompletas ou termos vedados"
          />
          <Kpi
            rotulo="A cobrar"
            valor={totalPendentesCobranca}
            cor={toneColor(tomSeHouver(totalPendentesCobranca, 'blue'))}
            nota="Terapeuta ainda não avisado"
            className="col-span-2 lg:col-span-1"
          />
        </div>
      )}

      {/* Abas + filtros */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">

        <div role="tablist" className="flex w-fit shrink-0 items-center gap-1 rounded-lg bg-muted/60 p-1">
          <button
            role="tab"
            aria-selected={abaAtiva === 'profissionais'}
            onClick={() => setAbaAtiva('profissionais')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition ${FOCO} ${
              abaAtiva === 'profissionais'
                ? 'bg-card font-bold text-foreground shadow-sm'
                : 'font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="h-4 w-4" />
            Por profissional
            {totalPendentesCobranca > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${TONE_CHIP.blue.bg} ${TONE_CHIP.blue.text}`}>
                {totalPendentesCobranca}
              </span>
            )}
          </button>

          <button
            role="tab"
            aria-selected={abaAtiva === 'feed'}
            onClick={() => setAbaAtiva('feed')}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition ${FOCO} ${
              abaAtiva === 'feed'
                ? 'bg-card font-bold text-foreground shadow-sm'
                : 'font-semibold text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileSearch className="h-4 w-4" />
            Todas as evoluções
            <span className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums ${TONE_CHIP.gray.bg} ${TONE_CHIP.gray.text}`}>
              {totalEvolucoes}
            </span>
          </button>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">

          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-1">
            {atalhoPeriodo('Ontem', ontemISO(), ontemISO())}
            {atalhoPeriodo('Hoje', hojeISO(), hojeISO())}
            {atalhoPeriodo('Desde setembro', PISO_PERIODO, hojeISO())}
          </div>

          <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground">
            <span className="text-muted-foreground">De</span>
            <input
              type="date"
              value={dataInicio}
              onChange={e => setDataInicio(e.target.value)}
              className="bg-transparent tabular-nums focus:outline-none"
            />
          </label>

          <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground">
            <span className="text-muted-foreground">Até</span>
            <input
              type="date"
              value={dataFim}
              onChange={e => setDataFim(e.target.value)}
              className="bg-transparent tabular-nums focus:outline-none"
            />
          </label>

          <select
            value={statusRisco}
            onChange={e => setStatusRisco(e.target.value as StatusRiscoEvolucao | 'todos')}
            aria-label="Filtrar por risco"
            className={CAMPO}
          >
            <option value="todos">Todos os riscos</option>
            <option value="risco_relevante">Risco relevante</option>
            <option value="risco_especifico">Ponto específico</option>
            <option value="sem_risco">Sem risco</option>
          </select>

          <select
            value={statusCobranca}
            onChange={e => setStatusCobranca(e.target.value as StatusCobrancaEvolucao | 'todos')}
            aria-label="Filtrar por cobrança"
            className={CAMPO}
          >
            <option value="todos">Todas as cobranças</option>
            <option value="pendente">Pendente</option>
            <option value="cobrado">Cobrado</option>
            <option value="aguardando_correcao">Aguardando correção</option>
            <option value="corrigido_tita">Corrigido no TiTa</option>
            <option value="ignorado">Dispensado</option>
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Buscar paciente ou terapeuta"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className={`${CAMPO} w-52 pl-8`}
            />
          </div>

        </div>
      </div>

      {/* Recarga com dado na tela: a lista fica, o aviso é discreto (§3.9). */}
      {carregando && carregouUmaVez && (
        <p className="text-xs text-muted-foreground">Atualizando…</p>
      )}

      {erro ? (
        <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
          <AlertTriangle className="mx-auto h-8 w-8 text-rose-600 dark:text-rose-400" />
          <h3 className="text-sm font-semibold text-foreground">Não foi possível carregar as evoluções</h3>
          <p className="text-xs text-muted-foreground">{erro}</p>
          <button onClick={carregarDados} className={`${BOTAO_SECUNDARIO} mx-auto mt-1`}>
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar de novo
          </button>
        </div>
      ) : primeiraCarga ? (
        <ListaSkeleton aba={abaAtiva} />
      ) : abaAtiva === 'profissionais' ? (
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

      <EvolucaoSidePanel
        item={itemSelecionado}
        isOpen={Boolean(itemSelecionado)}
        onClose={() => setItemSelecionado(null)}
        onReauditar={handleReauditarItem}
        onAtualizarStatusCobranca={handleAtualizarStatusCobranca}
      />

      <ModalCobrancaWhatsApp
        profissional={profSelecionadoCobranca}
        isOpen={Boolean(profSelecionadoCobranca)}
        onClose={() => setProfSelecionadoCobranca(null)}
        onConfirmarCobranca={handleConfirmarCobrancaWhatsApp}
      />

    </div>
  )
}

function Kpi({ rotulo, valor, nota, cor, className = '' }: {
  rotulo: string
  valor: number | string
  nota: string
  cor?: string
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}>
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <div
        className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground"
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </div>
      <span className="mt-1.5 block text-[11px] text-muted-foreground">{nota}</span>
    </div>
  )
}

/** Skeleton no formato do layout real — §3.9: o vazio só aparece depois da carga. */
function ListaSkeleton({ aba }: { aba: 'profissionais' | 'feed' }) {
  if (aba === 'profissionais') {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted motion-safe:animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-32 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-2.5 w-20 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-muted motion-safe:animate-pulse" />
            <div className="mt-4 h-14 rounded-lg bg-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
          <div className="h-5 w-24 rounded-full bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-3 flex-1 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}
