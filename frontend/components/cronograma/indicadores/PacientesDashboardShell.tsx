"use client"

// PacientesDashboardShell — dois dashboards de pacientes ativos (CH, convênio,
// unidade), adaptados de calcularDashboardPacientes. Sessões, CH, dia e unidade
// vêm de csv_grades_profissionais via usePacientesPeriodo(); o CONVÊNIO de cada
// paciente vem do cadastro do TiTa (useConvenioCadastroPacientes, ver
// lib/cronograma/convenioCadastro.ts), caindo no da agenda quando o paciente
// não está no cadastro ou o TiTa não responde. A separação é POR SESSÃO:
//   - "Tratamento Multidisciplinar" (antes "Por convênio"): toda sessão que NÃO
//     é Avaliação Neuropsicológica nem Psiquiatra/Neurologista.
//   - "Processo Diagnóstico": só sessões de Avaliação Neuropsicológica e
//     Psiquiatra/Neurologista (ver PROCESSO_DIAGNOSTICO_NAMES em
//     lib/cronograma/constants.ts).
// Uma sessão dessas duas terapias NUNCA soma nos números do Tratamento
// Multidisciplinar, mesmo quando o paciente também faz outras terapias — só
// conta lá pelas sessões que não são diagnósticas. Um paciente cuja agenda é
// feita só dessas duas terapias não sobra nenhuma sessão no dashboard geral,
// então some dele por completo (aparece só no Processo Diagnóstico).
//
// Período (ver lib/cronograma/periodoPacientes.ts): a aba abre na "Semana"
// (a semana de referência de sempre) e a pessoa pode ver um MÊS COMPLETO —
// inclusive passados, que a grade guarda congelados. Num mês, as colunas
// "Sessões" viram total do período, as de CH semanal e as barras viram
// média por semana, e o último cartão mostra a CH somada de verdade em vez da
// estimativa ×4,33. O convênio continua sendo o do cadastro ATUAL do TiTa.

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, Users, Clock, CalendarDays, Download, ChevronLeft, ChevronRight } from "lucide-react"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { TONE_ACCENT } from "@/components/cronograma/ui/tones"
import { DatePicker } from "@/components/ui/date-picker"
import { fmtHDec, fmtNumBR } from "@/lib/cronograma/helpers"
import { useHeader } from "@/contexts/HeaderContext"
import { semanaCorrenteRange } from "@/hooks/useOcupacaoSalas"
import { usePacientesPeriodo } from "@/hooks/usePacientesPeriodo"
import { useConvenioCadastroPacientes } from "@/hooks/useConvenioCadastroPacientes"
import {
  HISTORICO_INICIO, fmtDataBR, historicoFim, mesCorrente, mesVizinho, resolverPeriodo, rotuloMes, type PeriodoResolvido,
} from "@/lib/cronograma/periodoPacientes"
import { calcularDashboardPacientes, listarPacientesDoGrupo, type SegmentoPacientes } from "@/lib/cronograma/pacientesDashboard"
import { exportarDashboardPacientesXlsx } from "@/lib/cronograma/exportPacientesDashboard"
import { PacientesGrupoDrawer, type GrupoSelecionado } from "@/components/cronograma/indicadores/PacientesGrupoDrawer"
import { AvisoConvenioCadastro } from "@/components/cronograma/indicadores/AvisoConvenioCadastro"
import type { ResumoPacientesGrupo, ResumoPacientesSalas, ResumoPacientesDia } from "@/lib/cronograma/salasTypes"

function fmtPct(valor: number, total: number): string {
  if (total <= 0) return "—"
  return `${((valor / total) * 100).toFixed(1)}%`
}

function TabelaGrupo({
  titulo, linhas, totalPacientes, totalChSemanal, longo, onAbrir,
}: {
  titulo: string
  linhas: ResumoPacientesGrupo[]
  /** Totais do bloco inteiro (ex.: d.pacientesUnicos/d.chSemanalTotal) — base das colunas de %, não a soma das linhas (que pode ter sobreposição de pacientes entre grupos). */
  totalPacientes: number
  totalChSemanal: number
  /** Período maior que uma semana: "Sessões" é o total do período e o CH semanal é média. */
  longo: boolean
  /** Clique numa linha → lista dos pacientes daquela linha (PacientesGrupoDrawer). */
  onAbrir: (chave: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-bold text-foreground">{titulo}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="whitespace-nowrap border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-semibold"><span className="sr-only">Lista de pacientes</span></th>
              <th className="py-1.5 pr-2 font-semibold">Nome</th>
              <th className="py-1.5 px-2 text-right font-semibold">Pacientes</th>
              <th className="py-1.5 px-2 text-right font-semibold">% Pacientes</th>
              <th className="py-1.5 px-2 text-right font-semibold">{longo ? "Sessões no mês" : "Sessões"}</th>
              <th className="py-1.5 px-2 text-right font-semibold">{longo ? "CH semanal (média)" : "CH semanal"}</th>
              <th className="py-1.5 px-2 text-right font-semibold">% CH semanal</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Sessões/pac.</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && (
              <tr><td colSpan={8} className="py-3 text-center text-muted-foreground">Sem dados no período.</td></tr>
            )}
            {linhas.map(l => (
              <tr
                key={l.chave}
                role="button"
                tabIndex={0}
                aria-label={`${l.chave}: ver os ${l.pacientesUnicos} pacientes`}
                onClick={() => onAbrir(l.chave)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(l.chave) } }}
                className="group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <td className="w-px py-1.5 pr-3 align-middle">
                  <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-wide text-sky-600 dark:text-sky-400">
                    Ver pacientes
                    <ChevronRight size={11} className="shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
                  </span>
                </td>
                <td className="py-1.5 pr-2 align-middle font-medium text-foreground">{l.chave}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{l.pacientesUnicos}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{fmtPct(l.pacientesUnicos, totalPacientes)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{l.sessoesTotal}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{fmtHDec(l.chSemanalTotal)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{fmtPct(l.chSemanalTotal, totalChSemanal)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{l.mediaSessoesPorPaciente.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Componente genérico de barras Seg–Sex — usado tanto para sessões quanto
// para pacientes únicos por dia (mesma forma, medidas diferentes, então dois
// gráficos separados em vez de dividir eixo/cor dentro de um só). A cor da
// barra usa TONE_ACCENT — o mesmo tom pastel dos StatCard do dashboard.
function BarrasPorDia({
  titulo, linhas, valor, formatar = v => String(v), unidadeValor, cor, extra,
}: {
  titulo: string
  linhas: ResumoPacientesDia[]
  valor: (l: ResumoPacientesDia) => number
  /** Média por semana vem fracionada — sem isto apareceriam 12 casas decimais. */
  formatar?: (v: number) => string
  unidadeValor: string
  cor: "blue" | "purple"
  extra?: (l: ResumoPacientesDia) => { valor: string; unidade: string }
}) {
  const max = Math.max(1, ...linhas.map(valor))
  const accent = TONE_ACCENT[cor]

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-bold text-foreground">{titulo}</div>
      <div className="flex flex-col gap-2.5">
        {linhas.map(l => {
          const v = valor(l)
          const pct = Math.round((v / max) * 100)
          return (
            <div key={l.dow} className="flex items-center gap-3">
              <div className="w-8 shrink-0 text-xs font-semibold text-muted-foreground">{l.dia}</div>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted/60">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
              </div>
              <div className="w-36 shrink-0 whitespace-nowrap text-right text-xs tabular-nums">
                <span className="font-bold text-foreground">{formatar(v)}</span>{" "}
                <span className="text-muted-foreground">{unidadeValor}</span>
                {extra && (() => {
                  const e = extra(l)
                  return (
                    <span className="ml-1.5">
                      <span className="text-muted-foreground">· </span>
                      <span className="font-bold text-foreground">{e.valor}</span>{" "}
                      <span className="text-muted-foreground">{e.unidade}</span>
                    </span>
                  )
                })()}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// `tituloConvenio` é o nome do dashboard (ex.: "Tratamento Multidisciplinar",
// "Processo Diagnóstico") — vai DIRETO no título da tabela por convênio, sem
// header separado por cima. "Por unidade" continua com o mesmo nome nos dois.
function DashboardBloco({
  tituloConvenio,
  d,
  longo,
  cadastroDisponivel,
  onAbrir,
}: {
  tituloConvenio: string
  d: ResumoPacientesSalas
  /** Período maior que uma semana — ver cabeçalho do arquivo. */
  longo: boolean
  cadastroDisponivel: boolean
  onAbrir: (campo: "convenio" | "unidade", chave: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard tone="slate" icon={<Users size={15} />} label="Pacientes ativos">
          <div className="text-2xl font-black text-foreground">{d.pacientesUnicos}</div>
        </StatCard>
        <StatCard tone="blue" icon={<CalendarDays size={15} />} label={longo ? "Sessões no mês" : "Sessões/semana"}>
          <div className="text-2xl font-black text-foreground">{d.sessoesTotal}</div>
          {longo && <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtMedia(d.sessoesPorSemana)} por semana, em média</div>}
        </StatCard>
        <StatCard tone="purple" icon={<Clock size={15} />} label={longo ? "CH semanal (média)" : "CH semanal total"}>
          <div className="text-2xl font-black text-foreground">{fmtHDec(d.chSemanalTotal)}</div>
        </StatCard>
        {longo ? (
          <StatCard tone="green" icon={<Clock size={15} />} label="CH no mês">
            <div className="text-2xl font-black text-foreground">{fmtHDec(d.chTotalPeriodo)}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Soma real do mês{d.semanas > 1 ? ` (${fmtMedia(d.semanas)} semanas)` : ""}
            </div>
          </StatCard>
        ) : (
          <StatCard tone="green" icon={<Clock size={15} />} label="CH média mensal">
            <div className="text-2xl font-black text-foreground">{fmtHDec(d.chMediaMensalTotal)}</div>
          </StatCard>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <TabelaGrupo titulo={tituloConvenio} linhas={d.porConvenio} totalPacientes={d.pacientesUnicos} totalChSemanal={d.chSemanalTotal} longo={longo} onAbrir={chave => onAbrir("convenio", chave)} />
          {cadastroDisponivel && d.pacientesUnicos > 0 && (
            <div className="px-1 text-[11px] text-muted-foreground">
              Convênio pelo cadastro TiTa: {d.fonteConvenio.cadastro} {d.fonteConvenio.cadastro === 1 ? "paciente" : "pacientes"}
              {d.fonteConvenio.agenda > 0 && <> · pela agenda (sem cadastro): {d.fonteConvenio.agenda}</>}
            </div>
          )}
        </div>
        <TabelaGrupo titulo="Por unidade" linhas={d.porUnidade} totalPacientes={d.pacientesUnicos} totalChSemanal={d.chSemanalTotal} longo={longo} onAbrir={chave => onAbrir("unidade", chave)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarrasPorDia
          titulo={longo ? "Sessões por dia da semana (média semanal)" : "Sessões por dia da semana"}
          linhas={d.porDia}
          valor={l => (longo ? l.sessoesPorSemana : l.sessoesTotal)}
          formatar={longo ? fmtMedia : undefined}
          unidadeValor="sess."
          cor="blue"
          extra={l => ({ valor: fmtHDec(l.chSemanalTotal), unidade: "CH" })}
        />
        <BarrasPorDia
          titulo={longo ? "Pacientes por dia da semana (no mês)" : "Pacientes por dia da semana"}
          linhas={d.porDia}
          valor={l => l.pacientesUnicos}
          unidadeValor="pac."
          cor="purple"
        />
      </div>
    </div>
  )
}

const SEGMENTO_LABEL: Record<SegmentoPacientes, string> = {
  multidisciplinar: "Tratamento Multidisciplinar",
  processoDiagnostico: "Processo Diagnóstico",
}

/** Médias semanais (sessões, semanas) — uma casa, padrão pt-BR. */
function fmtMedia(v: number): string {
  return fmtNumBR(v, 1)
}

// Pílulas no mesmo padrão ativo/inativo do SegmentedTabs (navy da marca). Não
// usa o SegmentedTabs porque a 2ª opção É o calendário de mês: escolher um mês
// já é escolher "ver o mês completo" — sem um passo intermediário.
//
// Os rótulos dizem a MEDIDA ("Semana" × "Mês completo"), não só a data: são
// grandezas diferentes (uma semana × um mês somado), e a pessoa precisa saber
// qual está lendo antes de comparar números. Pedido do usuário em 13/10/2026.
const PILULA = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
const PILULA_ATIVA = "bg-[#222847] text-white border-[#222847] dark:bg-white dark:text-slate-900 dark:border-white"
const PILULA_INATIVA = "bg-transparent text-foreground border-border hover:bg-muted/50"
const SETA = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"

/** "dd/mm" — o ano já está claro pelo contexto da pílula. */
function diaMes(data: string): string {
  return fmtDataBR(data).slice(0, 5)
}

function rotuloPeriodo(p: PeriodoResolvido): string {
  return p.modo === "mes" && p.mes ? `Mês completo: ${rotuloMes(p.mes)}` : "Semana"
}

/**
 * De onde vêm os números — atrás do ícone, não na tela: o usuário pediu para
 * tirar o texto corrido ("ninguém vai ler"), mas quem precisar entender
 * faltas, convênio ou o recorte de janeiro encontra aqui.
 */
function explicacaoPeriodo(p: PeriodoResolvido, notas: string[]): string[] {
  const linhas = p.modo === "atual"
    ? [`Semana de ${fmtDataBR(p.inicio)} a ${fmtDataBR(p.fim)}: como a agenda está montada hoje para uma semana inteira do próximo mês.`]
    : [`Mês completo: pacientes com pelo menos uma sessão agendada entre ${fmtDataBR(p.inicio)} e ${fmtDataBR(p.fim)}. Sessões e CH somam o mês; CH semanal e barras são a média por semana.`]
  if (p.ajuste) linhas.push(p.ajuste)
  return [...linhas, ...notas]
}

function PeriodoBar({ periodo, notas, onMudar }: {
  periodo: PeriodoResolvido
  notas: string[]
  /** `null` = semana (agenda atual); "AAAA-MM-01" = mês completo. */
  onMudar: (mes: string | null) => void
}) {
  const semana = periodo.modo === "atual"
  const anterior = periodo.mes ? mesVizinho(periodo.mes, -1) : null
  const seguinte = periodo.mes ? mesVizinho(periodo.mes, 1) : null
  // A data da semana fica no botão mesmo com o mês escolhido: é a semana que a
  // pessoa volta a ver ao clicar nele.
  const semanaRef = semanaCorrenteRange()

  return (
    <div role="group" aria-label="Medida dos números" className="flex flex-wrap items-center gap-2">
      <button type="button" aria-pressed={semana} onClick={() => onMudar(null)} className={`${PILULA} ${semana ? PILULA_ATIVA : PILULA_INATIVA}`}>
        Semana
        <span className={`font-normal ${semana ? "opacity-80" : "text-muted-foreground"}`}>
          {diaMes(semanaRef.inicio)} a {diaMes(semanaRef.fim)}
        </span>
      </button>
      <div className="flex items-center gap-1.5">
        {!semana && (
          <button type="button" aria-label="Mês anterior" disabled={!anterior} onClick={() => anterior && onMudar(anterior)} className={SETA}>
            <ChevronLeft size={16} />
          </button>
        )}
        <DatePicker
          apenasMes
          value={periodo.mes ?? ""}
          onChange={v => { if (v) onMudar(v) }}
          min={HISTORICO_INICIO}
          max={historicoFim()}
          classeGatilho={`${PILULA} ${semana ? PILULA_INATIVA : PILULA_ATIVA}`}
          rotuloGatilho={semana ? "Ver um mês completo" : `Mês completo: ${rotuloMes(periodo.mes ?? mesCorrente())}. Trocar o mês`}
          conteudoGatilho={
            <>
              <CalendarDays size={15} />
              Mês completo
              {!semana && periodo.mes && (
                <span className="font-normal opacity-80">{rotuloMes(periodo.mes)}</span>
              )}
            </>
          }
        />
        {!semana && (
          <button type="button" aria-label="Mês seguinte" disabled={!seguinte} onClick={() => seguinte && onMudar(seguinte)} className={SETA}>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      <InfoTooltip ariaLabel="De onde vêm estes números" largura={320}>
        <ul className="flex flex-col gap-1.5">
          {explicacaoPeriodo(periodo, notas).map(l => <li key={l}>{l}</li>)}
        </ul>
      </InfoTooltip>
    </div>
  )
}

export function PacientesDashboardShell() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const qs = searchParams.toString()
  const periodo = useMemo(() => resolverPeriodo(new URLSearchParams(qs), semanaCorrenteRange), [qs])
  const longo = periodo.modo === "mes"
  const chavePeriodo = `${periodo.inicio}|${periodo.fim}`

  const { linhas, loading: loadingGrade, error } = usePacientesPeriodo(periodo.inicio, periodo.fim)
  const cadastro = useConvenioCadastroPacientes()
  const loading = loadingGrade || cadastro.loading
  const { setRightContent } = useHeader()
  const [grupoAberto, setGrupoAberto] = useState<(GrupoSelecionado & { segmento: SegmentoPacientes; chavePeriodo: string }) | null>(null)

  const mudarPeriodo = useCallback((mes: string | null) => {
    const novos = new URLSearchParams(qs)
    if (mes) novos.set("mes", mes.slice(0, 7))
    else novos.delete("mes")
    // push, não replace: o "Voltar" do navegador volta ao período anterior.
    router.push(`${pathname}?${novos.toString()}`, { scroll: false })
  }, [qs, pathname, router])

  // Calculado aqui, não pelo `dashboardPacientes` de useOcupacaoSalas: só esta
  // tela recebe o mapa de convênio do cadastro e o período escolhido.
  const dashboardPacientes = useMemo(
    () => calcularDashboardPacientes(linhas, cadastro.mapa, periodo),
    [linhas, cadastro.mapa, periodo],
  )

  // Uma gaveta aberta num período não sobrevive à troca de período: a lista e
  // o rótulo seriam de períodos diferentes.
  const grupoVisivel = grupoAberto?.chavePeriodo === chavePeriodo ? grupoAberto : null

  const pacientesDoGrupo = useMemo(
    () => grupoVisivel ? listarPacientesDoGrupo(linhas, cadastro.mapa, grupoVisivel.segmento, grupoVisivel.campo, grupoVisivel.chave, periodo) : [],
    [grupoVisivel, linhas, cadastro.mapa, periodo],
  )

  const exportar = useCallback(() => {
    exportarDashboardPacientesXlsx({
      linhas,
      dashboard: dashboardPacientes,
      periodo: { inicio: periodo.inicio, fim: periodo.fim },
      periodoRotulo: rotuloPeriodo(periodo),
      mapaConvenio: cadastro.mapa,
    })
  }, [linhas, dashboardPacientes, periodo, cadastro.mapa])

  useEffect(() => {
    setRightContent(
      <button
        type="button"
        onClick={exportar}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 active:scale-95 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={13} />
        Exportar XLSX
      </button>,
    )
    return () => setRightContent(null)
  }, [exportar, loading, setRightContent])

  const hoje = new Date().toLocaleDateString("sv-SE")
  const notas: string[] = []
  if (longo && periodo.inicio < hoje) {
    notas.push("Faltas e cancelamentos contam: o que vale é a sessão ter sido agendada.")
    notas.push("O convênio é o do cadastro de hoje no TiTa. Quem trocou de convênio aparece no atual.")
  }
  if (longo && periodo.fim >= hoje) notas.push("A partir de hoje, os números são da agenda planejada.")

  const barra = <PeriodoBar periodo={periodo} notas={notas} onMudar={mudarPeriodo} />

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {barra}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando dados de pacientes...
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {barra}
        <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>
      </div>
    )
  }

  const { multidisciplinar, processoDiagnostico } = dashboardPacientes

  const cadastroDisponivel = !!cadastro.mapa
  const abrir = (segmento: SegmentoPacientes) => (campo: "convenio" | "unidade", chave: string) =>
    setGrupoAberto({
      segmento,
      segmentoLabel: SEGMENTO_LABEL[segmento],
      campo,
      chave,
      chavePeriodo,
      periodoRotulo: `${rotuloPeriodo(periodo)} · ${fmtDataBR(periodo.inicio)} a ${fmtDataBR(periodo.fim)}`,
      periodoLongo: longo,
    })

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        {barra}
        <AvisoConvenioCadastro cadastro={cadastro} />
      </div>
      <DashboardBloco tituloConvenio={SEGMENTO_LABEL.multidisciplinar} d={multidisciplinar} longo={longo} cadastroDisponivel={cadastroDisponivel} onAbrir={abrir("multidisciplinar")} />
      <div className="border-t border-border" />
      <DashboardBloco tituloConvenio={SEGMENTO_LABEL.processoDiagnostico} d={processoDiagnostico} longo={longo} cadastroDisponivel={cadastroDisponivel} onAbrir={abrir("processoDiagnostico")} />
      {grupoVisivel && (
        <PacientesGrupoDrawer grupo={grupoVisivel} pacientes={pacientesDoGrupo} onClose={() => setGrupoAberto(null)} />
      )}
    </div>
  )
}
