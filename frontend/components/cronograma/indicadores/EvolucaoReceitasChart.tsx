"use client"

// EvolucaoReceitasChart — gráfico interativo de evolução, estilo Google
// Finance (área com gradiente, cabeçalho com valor + variação, hover com
// tooltip), compartilhado entre HistoricoReceitasShell (modo "cheio") e
// PrevisaoReceitasShell (modo "compacto", destacando o mês selecionado e
// permitindo navegar clicando num ponto).
//
// Fonte de cor: modo métrica única usa TONE_ACCENT (o mesmo tom já usado nos
// StatCard de cada métrica — mantém a identidade visual existente). O modo
// "Comparar" precisa de até 6 séries (todas as métricas) lado a lado
// simultaneamente distintas (inclusive as 3 métricas que hoje compartilham o
// tom "slate" no StatCard), então usa uma paleta categórica separada,
// validada com scripts/validate_palette.js (skill dataviz) — todos os 6
// checks passam em light e dark com essas 6 cores, nesta ordem (adjacent
// pairs, o caso de uso real de um gráfico de linhas).

import { useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { TONE_ACCENT } from "@/components/cronograma/ui/tones"
import { labelMesAno } from "@/lib/cronograma/helpers"
import {
  METRICAS_RECEITAS,
  ORDEM_METRICAS_PADRAO,
  formatarMetrica,
  type MetricaReceitaKey,
} from "@/lib/cronograma/previsaoReceitasMetricas"
import { classificarStatusMes, type StatusMes } from "@/lib/cronograma/previsaoReceitasHistoricoStatus"
import type { PrevisaoReceitasResumoMes } from "@/services/previsaoReceitasHistoricoResumo.service"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"

// Paleta categórica validada (light + dark) pro modo Comparar — ver
// cabeçalho do arquivo. Mesma ordem de ORDEM_METRICAS_PADRAO.
const COR_COMPARATIVO: Record<MetricaReceitaKey, string> = {
  receitaComDeducao: "#2a78d6",
  receitaSemDeducao: "#eb6834",
  deducaoFalta: "#1baf7a",
  sessoesMes: "#eda100",
  faltasMes: "#e87ba4",
  pacientesUnicos: "#4a3aa7",
}

// Faixas de período, estilo Google Finance — "1D"/"5D"/"1M"/"YTD" não fazem
// sentido pra uma série mensal (o menor grão já é 1 mês), por isso só as
// faixas que cabem nesse grão. `meses: null` = sem corte (mostra tudo).
type RangeChave = "1A" | "5A" | "MAX"
const RANGES: { key: RangeChave; label: string; meses: number | null }[] = [
  { key: "1A", label: "1A", meses: 12 },
  { key: "5A", label: "5A", meses: 60 },
  { key: "MAX", label: "Máx", meses: null },
]

/** Eixo Y abreviado — número cheio (ex.: "12069") estoura a largura reservada; acima de 1000 abrevia em "k". */
function formatarTickEixoY(v: number, formato: "moeda" | "inteiro"): string {
  const abreviado = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1).replace(".", ",")}k` : String(v)
  return formato === "moeda" ? abreviado : abreviado
}

interface EvolucaoReceitasChartProps {
  resumos: PrevisaoReceitasResumoMes[]
  modo: "cheio" | "compacto"
  mesSelecionado?: { ano: number; mes: number }
  onSelecionarMes?: (ano: number, mes: number) => void
}

interface PontoChart {
  competencia: string
  ano: number
  mes: number
  label: string
  labelCurto: string
  status: StatusMes
  /** Ainda pode mudar (mês corrente ou aguardando o fechamento do dia 5). */
  provisorio: boolean
  resumo: PrevisaoReceitasResumoMes
}

function competenciaParaAnoMes(competencia: string): { ano: number; mes: number } {
  const [ano, mes] = competencia.split("-").map(Number)
  return { ano, mes }
}

function montarPontos(resumos: PrevisaoReceitasResumoMes[]): PontoChart[] {
  return [...resumos]
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .map(r => {
      const { ano, mes } = competenciaParaAnoMes(r.competencia)
      const status = classificarStatusMes(ano, mes, r)
      return {
        competencia: r.competencia,
        ano,
        mes,
        label: labelMesAno(ano, mes),
        labelCurto: labelMesAno(ano, mes).slice(0, 3),
        status,
        provisorio: status === "em_desenvolvimento" || status === "aguardando_fechamento",
        resumo: r,
      }
    })
}

function CustomTooltip({ active, payload, metricasAtivas }: {
  active?: boolean
  payload?: { payload: PontoChart }[]
  metricasAtivas: MetricaReceitaKey[]
}) {
  if (!active || !payload?.length) return null
  const ponto = payload[0].payload
  return (
    <div className="min-w-36 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white shadow-2xl">
      <p className="mb-2 text-sm font-semibold text-slate-200">
        {ponto.label} {ponto.provisorio && <span className="ml-1 text-[10px] font-bold uppercase text-amber-300">provisório</span>}
      </p>
      {metricasAtivas.map(key => {
        const config = METRICAS_RECEITAS[key]
        const valor = config.acessor(ponto.resumo)
        return (
          <div key={key} className="flex items-center justify-between gap-4 py-0.5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_ACCENT[config.tone] }} />
              <span className="text-slate-300">{config.labelCurto}</span>
            </div>
            <span className="font-semibold text-white">{formatarMetrica(config, valor)}</span>
          </div>
        )
      })}
    </div>
  )
}

function VariacaoBadge({ atual, anterior }: { atual: number; anterior: number | null }) {
  if (anterior == null || anterior === 0) return null
  const variacao = ((atual - anterior) / Math.abs(anterior)) * 100
  const subiu = variacao >= 0
  const Icone = subiu ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${
      subiu ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
    }`}>
      <Icone size={12} />
      {subiu ? "+" : ""}{variacao.toFixed(1)}% vs. mês anterior
    </span>
  )
}

export function EvolucaoReceitasChart({ resumos, modo, mesSelecionado, onSelecionarMes }: EvolucaoReceitasChartProps) {
  const [metricaAtiva, setMetricaAtiva] = useState<MetricaReceitaKey>("receitaComDeducao")
  const [comparar, setComparar] = useState(false)
  const [metricasComparadas, setMetricasComparadas] = useState<MetricaReceitaKey[]>(["receitaComDeducao", "receitaSemDeducao"])
  const [colapsado, setColapsado] = useState(false)
  const [range, setRange] = useState<RangeChave>("1A")

  const pontos = useMemo(() => montarPontos(resumos), [resumos])

  // Variação/valor do cabeçalho é sempre "mês selecionado vs mês anterior",
  // independente da janela de zoom escolhida — igual ao Google Finance, o
  // range só afeta o que é desenhado, não o número em destaque.
  const pontoDestacado = useMemo(() => {
    if (!mesSelecionado) return pontos[pontos.length - 1] ?? null
    return pontos.find(p => p.ano === mesSelecionado.ano && p.mes === mesSelecionado.mes) ?? pontos[pontos.length - 1] ?? null
  }, [pontos, mesSelecionado])

  const idxDestacado = pontoDestacado ? pontos.indexOf(pontoDestacado) : -1
  const pontoAnterior = idxDestacado > 0 ? pontos[idxDestacado - 1] : null

  const configPrincipal = METRICAS_RECEITAS[metricaAtiva]

  // Janela visível do gráfico — nunca corta o mês selecionado de fora, mesmo
  // que ele fique mais antigo que o corte do range escolhido.
  const pontosFiltrados = useMemo(() => {
    const meses = RANGES.find(r => r.key === range)?.meses ?? null
    if (meses === null || pontos.length === 0) return pontos
    const ultimo = pontos[pontos.length - 1]
    let corteChave = ultimo.ano * 12 + ultimo.mes - meses + 1
    if (mesSelecionado) corteChave = Math.min(corteChave, mesSelecionado.ano * 12 + mesSelecionado.mes)
    return pontos.filter(p => p.ano * 12 + p.mes >= corteChave)
  }, [pontos, range, mesSelecionado])

  const metricasAtivas = comparar ? metricasComparadas : [metricaAtiva]

  // Média do período visível — exclui o mês corrente (o valor ainda não é
  // definitivo e pode mudar pra cima ou pra baixo até o mês terminar) mas inclui meses
  // passados aguardando fechamento (já ocorreram por inteiro, só falta o job
  // administrativo do dia 5 carimbar como definitivo).
  const mediaPeriodo = useMemo(() => {
    const base = pontosFiltrados.filter(p => p.status !== "em_desenvolvimento")
    if (base.length === 0) return null
    const soma = base.reduce((s, p) => s + configPrincipal.acessor(p.resumo), 0)
    return soma / base.length
  }, [pontosFiltrados, configPrincipal])

  const dadosComparativo = useMemo(() => {
    if (!comparar || pontosFiltrados.length === 0) return []
    const base: Record<MetricaReceitaKey, number> = {} as any
    for (const key of metricasComparadas) base[key] = METRICAS_RECEITAS[key].acessor(pontosFiltrados[0].resumo)
    return pontosFiltrados.map(p => {
      const linha: Record<string, unknown> = { competencia: p.competencia, labelCurto: p.labelCurto }
      for (const key of metricasComparadas) {
        const valor = METRICAS_RECEITAS[key].acessor(p.resumo)
        linha[key] = base[key] === 0 ? 0 : ((valor - base[key]) / Math.abs(base[key])) * 100
      }
      return linha
    })
  }, [comparar, metricasComparadas, pontosFiltrados])

  function toggleMetricaComparada(key: MetricaReceitaKey) {
    setMetricasComparadas(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key)
      if (prev.length >= ORDEM_METRICAS_PADRAO.length) return prev
      return [...prev, key]
    })
  }

  if (pontos.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
        Ainda não há meses suficientes pra montar o gráfico (mínimo 2).
      </div>
    )
  }

  const valorAtual = pontoDestacado ? configPrincipal.acessor(pontoDestacado.resumo) : 0
  const valorAnterior = pontoAnterior ? configPrincipal.acessor(pontoAnterior.resumo) : null

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {comparar ? "Comparar métricas (%)" : configPrincipal.label}
          </span>
          {!comparar && (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-foreground">
                  {mediaPeriodo !== null ? formatarMetrica(configPrincipal, mediaPeriodo) : "—"}
                </span>
                <span className="text-[11px] font-semibold text-muted-foreground">média do período</span>
              </div>
              {pontoDestacado && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{pontoDestacado.label}:</span>
                  <span className="font-semibold text-foreground">{formatarMetrica(configPrincipal, valorAtual)}</span>
                  <VariacaoBadge atual={valorAtual} anterior={valorAnterior} />
                  {pontoDestacado.provisorio && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Em fechamento
                      <InfoTooltip ariaLabel={`Por que ${pontoDestacado.label} ainda está em fechamento`}>
                        <p>
                          {pontoDestacado.status === "em_desenvolvimento"
                            ? `${pontoDestacado.label} é o mês corrente — este número ainda pode mudar (pra cima ou pra baixo) com os atendimentos do dia a dia até o mês terminar.`
                            : `${pontoDestacado.label} já terminou, mas o job de fechamento (dia 5 do mês seguinte) ainda não carimbou o número final — o valor mostrado é o último parcial calculado.`}
                        </p>
                      </InfoTooltip>
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {modo === "compacto" && (
          <button
            type="button"
            onClick={() => setColapsado(c => !c)}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50"
          >
            {colapsado ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {colapsado ? "Expandir" : "Recolher"}
          </button>
        )}
      </div>

      {!colapsado && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SegmentedTabs
              value={comparar ? "__comparar__" : metricaAtiva}
              onChange={v => {
                if (v === "__comparar__") { setComparar(true); return }
                setComparar(false)
                setMetricaAtiva(v as MetricaReceitaKey)
              }}
              ariaLabel="Métrica exibida"
              tabs={[
                ...ORDEM_METRICAS_PADRAO.map(key => ({ value: key, label: METRICAS_RECEITAS[key].labelCurto })),
                { value: "__comparar__", label: "Comparar" },
              ]}
            />
          </div>

          {comparar && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {ORDEM_METRICAS_PADRAO.map(key => {
                const ativo = metricasComparadas.includes(key)
                const cor = COR_COMPARATIVO[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleMetricaComparada(key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      ativo ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                    style={ativo ? { background: cor } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: ativo ? "#fff" : cor }} />
                    {METRICAS_RECEITAS[key].labelCurto}
                  </button>
                )
              })}
            </div>
          )}

          <div className={modo === "compacto" ? "h-[200px]" : "h-[220px] sm:h-[280px]"}>
            <ResponsiveContainer width="100%" height="100%">
              {comparar ? (
                <LineChart data={dadosComparativo} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.4} vertical={false} />
                  <XAxis dataKey="labelCurto" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={44} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="min-w-36 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white shadow-2xl">
                        <p className="mb-2 text-sm font-semibold text-slate-200">{label}</p>
                        {payload.map(p => (
                          <div key={p.dataKey as string} className="flex items-center justify-between gap-4 py-0.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                              <span className="text-slate-300">{METRICAS_RECEITAS[p.dataKey as MetricaReceitaKey].labelCurto}</span>
                            </div>
                            <span className="font-semibold text-white">{Number(p.value).toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    )
                  }} />
                  {metricasComparadas.map(key => (
                    <Line key={key} type="monotone" dataKey={key} stroke={COR_COMPARATIVO[key]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              ) : (
                <AreaChart data={pontosFiltrados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-evolucao-receitas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TONE_ACCENT[configPrincipal.tone]} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={TONE_ACCENT[configPrincipal.tone]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.4} vertical={false} />
                  <XAxis dataKey="labelCurto" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={56}
                    tickFormatter={v => formatarTickEixoY(v, configPrincipal.formato)} />
                  <Tooltip content={<CustomTooltip metricasAtivas={metricasAtivas} />} />
                  <Area
                    type="monotone"
                    dataKey={(p: PontoChart) => configPrincipal.acessor(p.resumo)}
                    stroke={TONE_ACCENT[configPrincipal.tone]}
                    strokeWidth={2}
                    fill="url(#grad-evolucao-receitas)"
                    dot={(props: any) => {
                      const p: PontoChart = props.payload
                      const destacado = mesSelecionado && p.ano === mesSelecionado.ano && p.mes === mesSelecionado.mes
                      return (
                        <circle
                          key={p.competencia}
                          cx={props.cx}
                          cy={props.cy}
                          r={destacado ? 5 : 3}
                          fill={TONE_ACCENT[configPrincipal.tone]}
                          stroke="#fff"
                          strokeWidth={destacado ? 2 : 1}
                          strokeDasharray={p.provisorio ? "2 2" : undefined}
                          style={{ cursor: onSelecionarMes ? "pointer" : "default" }}
                          onClick={() => onSelecionarMes?.(p.ano, p.mes)}
                        />
                      )
                    }}
                    activeDot={{
                      r: 6,
                      style: { cursor: onSelecionarMes ? "pointer" : "default" },
                      onClick: (props: any) => {
                        const p: PontoChart | undefined = props?.payload
                        if (p) onSelecionarMes?.(p.ano, p.mes)
                      },
                    }}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          <div role="group" aria-label="Período exibido" className="mt-2 flex items-center gap-1">
            {RANGES.map(r => (
              <button
                key={r.key}
                type="button"
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  range === r.key
                    ? "bg-[#222847] text-white dark:bg-white dark:text-slate-900"
                    : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
