"use client"

// EvolucaoMensalChart — evolução mês a mês em linhas, uma por série (ex.: as
// três unidades + o total), com o mesmo visual de EvolucaoReceitasChart
// (Previsão de Receitas): cabeçalho com o valor do mês, tooltip escuro,
// 1A · 5A · Máx e clique no ponto para trocar de mês. Sem "variação vs. mês
// anterior" nem selo de status no cabeçalho (retirados a pedido do usuário,
// 21/10/2026) — o status do mês fica no tooltip.
//
// Usado por Ocupação Clínica (A15) e Dashboard de Pacientes (A16).
//
// Cores (skill dataviz, validadas com scripts/validate_palette.js): as
// unidades usam a cor de identidade que já têm no sistema (UNID_COR) — a cor
// acompanha a entidade em todas as telas. Passam no CVD e no piso de visão
// normal; o laranja dá aviso de contraste (2,99:1), compensado pelos quadrados
// de unidade, que sempre trazem o nome escrito e o valor do mês. O total não é
// categoria: é a linha de referência, na cor do texto do tema
// (var(--foreground)) e mais grossa.
//
// Ordem do bloco (21/10/2026): título + segmento + Recolher → CRITÉRIO →
// divisória → mês e número → quadrados das unidades (legenda com valor e
// liga/desliga) → gráfico → 1A · 5A · Máx.
//
// Status do ponto ("aproximado" = recalculado com o mapa de salas atual;
// "parcial" = mês em andamento): as linhas são sempre CHEIAS (pedido do
// usuário, 21/10/2026 — o tracejado foi retirado); o status aparece só no
// tooltip do ponto.

import { useMemo, useState, type ReactNode } from "react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ChevronDown, ChevronUp, Info } from "lucide-react"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { fmtHDec, fmtNumBR, labelMesAno } from "@/lib/cronograma/helpers"
import {
  RANGES, competenciaParaAnoMes, filtrarPorRange, formatarTickEixoY, type AnoMes, type RangeChave,
} from "@/lib/cronograma/evolucaoMensal"

export type StatusPonto = "fechado" | "parcial" | "aproximado"

export interface PontoEvolucao {
  /** "AAAA-MM" */
  competencia: string
  status: StatusPonto
  /** serie → métrica → valor (null = sem dado). */
  valores: Record<string, Record<string, number | null>>
}

export interface SerieEvolucao {
  key: string
  label: string
  /** Cor da linha. Use "var(--foreground)" para a série de referência (total). */
  cor: string
  /** Série de referência (total): traço mais grosso e valor no cabeçalho. */
  destaque?: boolean
  /**
   * Rótulo da linha da legenda ("Unidade", "Procedimento", "Total"), na mesma
   * coluna do rótulo "Critério". Sem grupo em nenhuma série, a legenda é uma
   * linha só, sem rótulo.
   */
  grupo?: string
}

export interface MetricaEvolucao {
  key: string
  label: string
  /** pct: valor guardado como fração (0–1). */
  formato: "pct" | "int" | "horas"
  info?: string
}

interface Props {
  titulo: string
  info?: ReactNode
  pontos: PontoEvolucao[]
  series: SerieEvolucao[]
  metricas: MetricaEvolucao[]
  metricaInicial: string
  mesSelecionado?: AnoMes
  onSelecionarMes?: (ano: number, mes: number) => void
  /** Controles extras ACIMA do título (ex.: o switch de segmento do Dashboard de Pacientes). */
  controlesExtras?: ReactNode
}

interface Linha extends AnoMes {
  competencia: string
  label: string
  labelCurto: string
  status: StatusPonto
  [chave: string]: unknown
}

export function formatarValor(v: number | null | undefined, formato: MetricaEvolucao["formato"]): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—"
  if (formato === "pct") return `${fmtNumBR(v * 100, 1)}%`
  if (formato === "horas") return fmtHDec(v, 0)
  return fmtNumBR(v, 0)
}

function tickY(v: number, formato: MetricaEvolucao["formato"]): string {
  return formato === "pct" ? `${Math.round(v * 100)}%` : formatarTickEixoY(v)
}

const ROTULO_STATUS: Record<Exclude<StatusPonto, "fechado">, string> = {
  aproximado: "aproximado",
  parcial: "em andamento",
}

// Rótulo de linha ("Critério", "Unidade", "Procedimento", "Total"). Com a
// legenda em grupos, todos ocupam a mesma coluna de largura fixa (no celular,
// o rótulo fica em cima dos botões).
const ROTULO = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
const ROTULO_LINHA = `${ROTULO} w-full shrink-0 sm:w-28`

export function EvolucaoMensalChart({
  titulo, info, pontos, series, metricas, metricaInicial, mesSelecionado, onSelecionarMes, controlesExtras,
}: Props) {
  const [metricaKey, setMetricaKey] = useState(metricaInicial)
  const [ocultas, setOcultas] = useState<Set<string>>(() => new Set())
  const [colapsado, setColapsado] = useState(false)
  const [range, setRange] = useState<RangeChave>("1A")

  const metrica = metricas.find(m => m.key === metricaKey) ?? metricas[0]
  const destaque = series.find(s => s.destaque) ?? series[series.length - 1]
  const visiveis = series.filter(s => !ocultas.has(s.key))

  // Legenda em linhas por `grupo`, na ordem em que o grupo aparece. Série sem
  // grupo vai numa linha final sem rótulo (alinhada à coluna dos rótulos). Sem
  // grupo nenhum: uma linha só, como antes.
  const linhasLegenda = useMemo(() => {
    const linhas: { grupo?: string; itens: SerieEvolucao[] }[] = []
    for (const s of series) {
      if (!s.grupo) continue
      const l = linhas.find(x => x.grupo === s.grupo)
      if (l) l.itens.push(s)
      else linhas.push({ grupo: s.grupo, itens: [s] })
    }
    const soltas = series.filter(s => !s.grupo)
    if (soltas.length) linhas.push({ itens: soltas })
    return linhas
  }, [series])
  const legendaComRotulos = linhasLegenda.some(l => l.grupo)

  const ordenados = useMemo(
    () => [...pontos].sort((a, b) => a.competencia.localeCompare(b.competencia)).map(p => ({ ...p, ...competenciaParaAnoMes(p.competencia) })),
    [pontos],
  )
  const janela = useMemo(() => filtrarPorRange(ordenados, range, mesSelecionado), [ordenados, range, mesSelecionado])

  // Uma linha de dados por mês, com o valor de cada série na métrica escolhida.
  const dados = useMemo<Linha[]>(() => janela.map(p => {
    const linha: Linha = {
      competencia: p.competencia, ano: p.ano, mes: p.mes, status: p.status,
      label: labelMesAno(p.ano, p.mes), labelCurto: labelMesAno(p.ano, p.mes).slice(0, 3),
    }
    for (const s of series) linha[s.key] = p.valores[s.key]?.[metrica.key] ?? null
    return linha
  }), [janela, series, metrica.key])

  const pontoDestacado = useMemo(() => {
    if (!ordenados.length) return null
    if (!mesSelecionado) return ordenados[ordenados.length - 1]
    return ordenados.find(p => p.ano === mesSelecionado.ano && p.mes === mesSelecionado.mes) ?? ordenados[ordenados.length - 1]
  }, [ordenados, mesSelecionado])
  const valorAtual = pontoDestacado?.valores[destaque.key]?.[metrica.key] ?? null

  function alternarSerie(key: string) {
    setOcultas(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else if (series.length - n.size > 1) n.add(key) // sempre sobra pelo menos uma
      return n
    })
  }

  if (ordenados.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
        {titulo}: ainda não há meses suficientes para montar o gráfico (mínimo 2).
      </div>
    )
  }

  const botaoRecolher = (
    <button
      type="button"
      onClick={() => setColapsado(c => !c)}
      aria-expanded={!colapsado}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted/50"
    >
      {colapsado ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      {colapsado ? "Expandir" : "Recolher"}
    </button>
  )

  const mesDestacado = pontoDestacado ? labelMesAno(pontoDestacado.ano, pontoDestacado.mes) : ""

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* 1) Topo: título curto, controles extras (switch de segmento) e
          Recolher/Expandir sempre no canto superior direito. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted-foreground ${legendaComRotulos ? "w-full shrink-0 sm:w-28" : ""}`}>
            {titulo}
            {info && <InfoTooltip ariaLabel={`Sobre ${titulo}`}>{info}</InfoTooltip>}
          </span>
          {controlesExtras}
        </div>
        {botaoRecolher}
      </div>

      {!colapsado && (
        <>
          {/* 2) Escolher o que medir (antes de ler o número). */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={legendaComRotulos ? ROTULO_LINHA : ROTULO}>Critério</span>
            <div role="group" aria-label="Critério exibido" className="flex flex-wrap gap-1.5">
              {metricas.map(m => {
                const ativo = m.key === metrica.key
                // Quadrado = botão do critério + ⓘ ao lado (botão irmão, não aninhado).
                return (
                  <span
                    key={m.key}
                    className={`inline-flex min-h-8 items-center rounded-md border text-xs font-semibold transition-colors ${
                      ativo
                        ? "border-[#222847] bg-[#222847] text-white dark:border-white dark:bg-white dark:text-slate-900"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={ativo}
                      onClick={() => setMetricaKey(m.key)}
                      className={`min-h-8 rounded-md py-1 pl-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${m.info ? "pr-1" : "pr-3"}`}
                    >
                      {m.label}
                    </button>
                    {m.info && (
                      <span className="pr-2 opacity-80">
                        <InfoTooltip ariaLabel={`O que é "${m.label}"`} largura={320} icone={<Info size={13} />}>
                          <p className="leading-relaxed">{m.info}</p>
                        </InfoTooltip>
                      </span>
                    )}
                  </span>
                )
              })}
            </div>
          </div>

          <div className="my-3 border-t border-border" />

          {/* 3) Leitura: mês em cima, número grande com o nome da série de referência. */}
          {pontoDestacado && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">{mesDestacado}</p>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-black text-foreground">{formatarValor(valorAtual, metrica.formato)}</span>
                <span className="text-xs font-semibold text-muted-foreground">{destaque.label}</span>
              </div>
            </div>
          )}

          {/* 4) Séries com o valor do mês — são a legenda (nome + cor, nunca
              só a cor) e o liga/desliga de cada linha. Com grupos, uma linha
              por grupo, com o rótulo na MESMA coluna de "Critério" — os
              botões de todas as linhas começam alinhados. */}
          <div className="mt-3 flex flex-col gap-2">
            {linhasLegenda.map(({ grupo, itens }) => (
              <div key={grupo ?? "_"} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {grupo ? (
                  <span className={ROTULO_LINHA}>{grupo}</span>
                ) : legendaComRotulos && (
                  <span className={`${ROTULO_LINHA} hidden sm:block`} aria-hidden />
                )}
                <div
                  role="group"
                  aria-label={`Valores de ${mesDestacado}${grupo ? ` por ${grupo.toLowerCase()}` : ""} — clique para mostrar ou esconder a linha`}
                  className="flex flex-wrap gap-1.5"
                >
                  {itens.map(s => {
                    const ativa = !ocultas.has(s.key)
                    const v = pontoDestacado?.valores[s.key]?.[metrica.key] ?? null
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => alternarSerie(s.key)}
                        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          ativa ? "border-border bg-card text-foreground shadow-sm" : "border-dashed border-border text-muted-foreground opacity-60 hover:opacity-100"
                        }`}
                      >
                        <span className={`shrink-0 rounded-full ${s.destaque ? "h-1 w-4" : "h-2 w-2"}`} style={{ background: s.cor }} />
                        <span className={s.destaque ? "font-bold" : "font-semibold"}>{s.label}</span>
                        <span className="tabular-nums text-muted-foreground">{formatarValor(v, metrica.formato)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3" />
          <div className="h-[220px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dados} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                onClick={estado => {
                  const i = typeof estado?.activeIndex === "number" ? estado.activeIndex : Number(estado?.activeIndex)
                  const p = Number.isInteger(i) ? dados[i] : undefined
                  if (p) onSelecionarMes?.(p.ano, p.mes)
                }}
                style={{ cursor: onSelecionarMes ? "pointer" : "default" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" opacity={0.4} vertical={false} />
                <XAxis dataKey="labelCurto" tick={{ fontSize: 11, fill: "#898781" }} axisLine={{ stroke: "#c3c2b7" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#898781" }} axisLine={false} tickLine={false} width={48}
                  tickFormatter={v => tickY(v, metrica.formato)} domain={metrica.formato === "pct" ? [0, "auto"] : ["auto", "auto"]} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const linha = payload[0].payload as Linha
                  return (
                    <div className="min-w-40 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-white shadow-2xl">
                      <p className="mb-2 text-sm font-semibold text-slate-200">
                        {linha.label}
                        {linha.status !== "fechado" && <span className="ml-1 text-[10px] font-bold uppercase text-amber-300">{ROTULO_STATUS[linha.status]}</span>}
                      </p>
                      {visiveis.map(s => {
                        const v = linha[s.key] as number | null
                        return (
                          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.destaque ? "#fff" : s.cor }} />
                              <span className={s.destaque ? "font-bold text-white" : "text-slate-300"}>{s.label}</span>
                            </div>
                            <span className="font-semibold text-white">{formatarValor(v, metrica.formato)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }} />
                {visiveis.map(s => {
                  const ponto = function PontoSerie(props: { cx?: number; cy?: number; payload?: Linha; value?: unknown }) {
                    if (props.value === null || props.value === undefined || props.cx === undefined || props.cy === undefined) return <g key={`${s.key}-${props.payload?.competencia}`} />
                    const sel = mesSelecionado && props.payload?.ano === mesSelecionado.ano && props.payload?.mes === mesSelecionado.mes
                    return (
                      <circle key={`${s.key}-${props.payload?.competencia}`} cx={props.cx} cy={props.cy} r={sel ? 5 : 3}
                        fill={s.cor} stroke="var(--card)" strokeWidth={2} />
                    )
                  }
                  return (
                    <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.cor} strokeWidth={s.destaque ? 3 : 2}
                      dot={ponto} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  )
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Período exibido" className="flex items-center gap-1">
              {RANGES.map(r => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    range === r.key ? "bg-[#222847] text-white dark:bg-white dark:text-slate-900" : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
