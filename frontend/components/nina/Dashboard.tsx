'use client'

import React, { useEffect, useState } from 'react'
import { Activity, DollarSign, MessageSquare, Users, Loader2, TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StatMetric } from '@/types/nina'
import { api } from '@/services/nina/api'
import { OnboardingBanner } from './OnboardingBanner'
import { SystemHealthCard } from './SystemHealthCard'
import { useOnboarding } from '@/contexts/OnboardingContext'

type PeriodFilter = 'today' | '7days' | '30days'

const periodLabels: Record<PeriodFilter, string> = {
  today: 'Hoje',
  '7days': '7 Dias',
  '30days': '30 Dias'
}

const periodDays: Record<PeriodFilter, number> = {
  today: 1,
  '7days': 7,
  '30days': 30
}

const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<StatMetric[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodFilter>('today')
  const { setShowOnboarding } = useOnboarding()

  // ------------------------------------------------------------------------
  // Distingue três estados que a versão anterior confundia num só:
  //   erro     → a requisição falhou; a tela precisa dizer isso
  //   semDados → carregou certo, e a resposta é que não há movimento ainda
  //   dados    → há negócios para mostrar
  //
  // Antes, todos os três apareciam como "24 atendimentos, 8 leads" — números
  // fixos no código. Um dashboard que mostra o mesmo com o banco vazio, cheio
  // ou fora do ar é pior que nenhum dashboard: alguém decide em cima dele.
  // ------------------------------------------------------------------------
  const [erro, setErro] = useState<string | null>(null)
  const [semDados, setSemDados] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setErro(null)
      try {
        const days = periodDays[period]
        const resposta = await fetch(`/api/crm/metrics/?days=${days}`)
        const corpo = await resposta.json()

        if (!resposta.ok) {
          throw new Error(corpo?.error?.message ?? 'Não foi possível carregar as métricas')
        }

        const m = corpo.data
        setSemDados(Boolean(m.semDados))

        const comoTexto = (v: number | null) => (v === null ? '—' : String(v))
        const comoMoeda = (v: number) =>
          new Intl.NumberFormat('pt-BR', {
            style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
          }).format(v)
        // Sem base de comparação não há seta — melhor um campo vazio do que
        // uma tendência inventada.
        const comoTendencia = (v: number | null) =>
          v === null ? '' : `${v > 0 ? '+' : ''}${v}%`

        setMetrics([
          {
            label: 'Novos Leads',
            value: comoTexto(m.novosLeads.valor),
            trend: comoTendencia(m.novosLeads.variacao),
            trendUp: (m.novosLeads.variacao ?? 0) >= 0,
          },
          {
            label: 'Negócios Abertos',
            value: comoTexto(m.negociosAbertos.valor),
            trend: '',
            trendUp: true,
          },
          {
            label: 'Conversões',
            value: m.taxaConversao.valor === null ? '—' : `${m.taxaConversao.valor}%`,
            trend: '',
            trendUp: true,
          },
          {
            label: 'Valor Ganho',
            value: comoMoeda(m.valorGanho.valor),
            trend: comoTendencia(m.valorGanho.variacao),
            trendUp: (m.valorGanho.variacao ?? 0) >= 0,
          },
        ])

        // O gráfico de série temporal ainda não tem fonte: exigiria agregar
        // deals por dia, o que sem dados não desenha nada de útil. Fica vazio
        // e a tela mostra o estado explicativo em vez de uma linha reta em
        // zero, que passaria por "queda".
        setChartData([])
      } catch (error) {
        console.error('Erro ao carregar dashboard:', error)
        setErro(error instanceof Error ? error.message : 'Erro ao carregar')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [period])

  const getIcon = (label: string) => {
    if (label.includes('Conversões')) return <DollarSign className="h-5 w-5 text-emerald-400" />
    if (label.includes('Atendimentos')) return <MessageSquare className="h-5 w-5 text-cyan-400" />
    if (label.includes('Leads')) return <Users className="h-5 w-5 text-violet-400" />
    return <Activity className="h-5 w-5 text-orange-400" />
  }

  const getGradient = (label: string) => {
    if (label.includes('Conversões')) return 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20'
    if (label.includes('Atendimentos')) return 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20'
    if (label.includes('Leads')) return 'from-violet-500/20 to-violet-500/5 border-violet-500/20'
    return 'from-orange-500/20 to-orange-500/5 border-orange-500/20'
  }

  const getMetricLabel = (baseLabel: string) => {
    if (baseLabel.includes('Atendimentos')) {
      return period === 'today' ? 'Atendimentos Hoje' : `Atendimentos (${periodLabels[period]})`
    }
    if (baseLabel.includes('Leads')) {
      return period === 'today' ? 'Novos Leads' : `Novos Leads (${periodLabels[period]})`
    }
    return baseLabel
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full"></div>
            <Loader2 className="h-10 w-10 animate-spin text-cyan-400 relative z-10" />
          </div>
          <p className="text-sm text-slate-400 font-medium animate-pulse">Carregando insights...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 overflow-y-auto h-full bg-slate-950 text-slate-50 custom-scrollbar">
      <OnboardingBanner onOpenWizard={() => setShowOnboarding(true)} />

      <SystemHealthCard />

      {/* Falha de carregamento: os números abaixo estão desatualizados ou
          ausentes, e quem lê precisa saber disso antes de decidir. */}
      {erro && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          <span className="font-semibold">Não foi possível carregar os indicadores.</span>{' '}
          {erro}
        </div>
      )}

      {/* Carregou bem e a resposta é zero. Dizer POR QUE está zerado evita a
          leitura de que o sistema quebrou — e aponta o que falta acontecer. */}
      {!erro && semDados && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200/90">
          <span className="font-semibold">Ainda não há negócios registrados.</span>{' '}
          Os números abaixo são reais e estão zerados porque a operação comercial
          ainda não usa o funil do Pulsar. Assim que os primeiros leads entrarem
          no Kanban, os indicadores passam a se preencher sozinhos.
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Dashboard</h2>
          <p className="text-slate-400 mt-1">
            Visão geral da performance da sua IA {period === 'today' ? 'hoje' : `nos últimos ${periodLabels[period].toLowerCase()}`}.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['today', '7days', '30days'] as PeriodFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((stat, index) => (
          <div
            key={index}
            className={`relative overflow-hidden rounded-2xl border bg-slate-900/50 backdrop-blur-sm p-6 shadow-xl transition-all duration-300 hover:translate-y-[-2px] hover:bg-slate-900 group ${getGradient(stat.label)}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="text-sm font-medium text-slate-400">{getMetricLabel(stat.label)}</div>
              <div className="p-2 rounded-lg bg-slate-800/50 border border-slate-700/50 group-hover:border-slate-600 transition-colors">
                {getIcon(stat.label)}
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-3xl font-bold text-white tracking-tight">{stat.value}</div>
              {/* Sem trend não há badge: um selo verde vazio sugeriria alta
                  onde não existe período anterior para comparar. */}
              {stat.trend ? (
                <div className={`flex items-center text-xs font-medium px-2 py-1 rounded-full ${stat.trendUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                  {stat.trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {stat.trend}
                </div>
              ) : null}
            </div>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-white/5 blur-2xl rounded-full group-hover:bg-white/10 transition-all"></div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        <div className="col-span-4 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-6 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Volume de Atendimentos</h3>
              <p className="text-sm text-slate-400">
                Interações da IA {period === 'today' ? 'hoje' : `nos últimos ${periodDays[period]} dias`}
              </p>
            </div>
            <button className="text-cyan-400 hover:text-cyan-300 transition-colors p-2 hover:bg-cyan-950/30 rounded-lg">
              <ArrowUpRight className="w-5 h-5" />
            </button>
          </div>
          <div className="h-[300px] w-full">
            {chartData.length === 0 ? (
              /* Série temporal sem fonte de dados ainda. Desenhar um gráfico
                 achatado em zero pareceria queda real — o vazio explicado é
                 mais honesto e diz o que falta acontecer. */
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <Activity className="w-8 h-8 text-slate-700 mb-3" />
                <p className="text-sm text-slate-400 font-medium">
                  Ainda não há histórico para desenhar
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  O gráfico aparece quando houver negócios movimentados no período.
                </p>
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  fontSize={12}
                  stroke="#64748b"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  stroke="#64748b"
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', color: '#f8fafc', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }}
                  itemStyle={{ color: '#06b6d4' }}
                />
                <Area
                  type="monotone"
                  dataKey="chats"
                  stroke="#06b6d4"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorChats)"
                  activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="col-span-3 rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-sm p-6 shadow-lg flex flex-col">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white">Conversões</h3>
            <p className="text-sm text-slate-400">Reuniões, vendas e ações concluídas</p>
          </div>

          <div className="flex-1 flex flex-col justify-center space-y-5">
            {chartData.length === 0 && (
              <p className="text-sm text-slate-500 text-center">
                Nenhuma conversão registrada no período.
              </p>
            )}
            {chartData.slice(0, 5).map((day, i) => (
              <div key={i} className="group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">{day.name}</span>
                  <span className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors">{day.sales} conv.</span>
                </div>
                <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-600 to-teal-500 rounded-full shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all duration-1000 ease-out group-hover:shadow-[0_0_15px_rgba(6,182,212,0.6)]"
                    style={{ width: `${Math.min((day.sales / Math.max(...chartData.map(d => d.sales), 1)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Total no período</span>
              <span className="text-emerald-400 font-bold">
                {chartData.reduce((sum, d) => sum + d.sales, 0)} conversões
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
