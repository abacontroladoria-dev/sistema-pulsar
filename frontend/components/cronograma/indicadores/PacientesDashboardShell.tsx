"use client"

// PacientesDashboardShell — dois dashboards de pacientes ativos (CH, convênio,
// unidade), adaptados de calcularDashboardPacientes. Sessões, CH, dia e unidade
// vêm de csv_grades_profissionais via useOcupacaoSalas(); o CONVÊNIO de cada
// paciente vem do cadastro da TiTa (useConvenioCadastroPacientes, ver
// lib/cronograma/convenioCadastro.ts), caindo no da agenda quando o paciente
// não está no cadastro ou a TiTa não responde. A separação é POR SESSÃO:
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

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Users, Clock, CalendarDays, Download, ChevronRight } from "lucide-react"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { TONE_ACCENT } from "@/components/cronograma/ui/tones"
import { fmtHDec } from "@/lib/cronograma/helpers"
import { useHeader } from "@/contexts/HeaderContext"
import { useOcupacaoSalas, semanaCorrenteRange } from "@/hooks/useOcupacaoSalas"
import { useConvenioCadastroPacientes } from "@/hooks/useConvenioCadastroPacientes"
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
  titulo, linhas, totalPacientes, totalChSemanal, onAbrir,
}: {
  titulo: string
  linhas: ResumoPacientesGrupo[]
  /** Totais do bloco inteiro (ex.: d.pacientesUnicos/d.chSemanalTotal) — base das colunas de %, não a soma das linhas (que pode ter sobreposição de pacientes entre grupos). */
  totalPacientes: number
  totalChSemanal: number
  /** Clique numa linha → lista dos pacientes daquela linha (PacientesGrupoDrawer). */
  onAbrir: (chave: string) => void
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-bold text-foreground">{titulo}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-semibold"><span className="sr-only">Lista de pacientes</span></th>
              <th className="py-1.5 pr-2 font-semibold">Nome</th>
              <th className="py-1.5 px-2 text-right font-semibold">Pacientes</th>
              <th className="py-1.5 px-2 text-right font-semibold">% Pacientes</th>
              <th className="py-1.5 px-2 text-right font-semibold">Sessões</th>
              <th className="py-1.5 px-2 text-right font-semibold">CH semanal</th>
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
  titulo, linhas, valor, unidadeValor, cor, extra,
}: {
  titulo: string
  linhas: ResumoPacientesDia[]
  valor: (l: ResumoPacientesDia) => number
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
                <span className="font-bold text-foreground">{v}</span>{" "}
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
  cadastroDisponivel,
  onAbrir,
}: {
  tituloConvenio: string
  d: ResumoPacientesSalas
  cadastroDisponivel: boolean
  onAbrir: (campo: "convenio" | "unidade", chave: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard tone="slate" icon={<Users size={15} />} label="Pacientes ativos">
          <div className="text-2xl font-black text-foreground">{d.pacientesUnicos}</div>
        </StatCard>
        <StatCard tone="blue" icon={<CalendarDays size={15} />} label="Sessões/semana">
          <div className="text-2xl font-black text-foreground">{d.sessoesTotal}</div>
        </StatCard>
        <StatCard tone="purple" icon={<Clock size={15} />} label="CH semanal total">
          <div className="text-2xl font-black text-foreground">{fmtHDec(d.chSemanalTotal)}</div>
        </StatCard>
        <StatCard tone="green" icon={<Clock size={15} />} label="CH média mensal">
          <div className="text-2xl font-black text-foreground">{fmtHDec(d.chMediaMensalTotal)}</div>
        </StatCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <TabelaGrupo titulo={tituloConvenio} linhas={d.porConvenio} totalPacientes={d.pacientesUnicos} totalChSemanal={d.chSemanalTotal} onAbrir={chave => onAbrir("convenio", chave)} />
          {cadastroDisponivel && d.pacientesUnicos > 0 && (
            <div className="px-1 text-[11px] text-muted-foreground">
              Convênio pelo cadastro TiTa: {d.fonteConvenio.cadastro} {d.fonteConvenio.cadastro === 1 ? "paciente" : "pacientes"}
              {d.fonteConvenio.agenda > 0 && <> · pela agenda (sem cadastro): {d.fonteConvenio.agenda}</>}
            </div>
          )}
        </div>
        <TabelaGrupo titulo="Por unidade" linhas={d.porUnidade} totalPacientes={d.pacientesUnicos} totalChSemanal={d.chSemanalTotal} onAbrir={chave => onAbrir("unidade", chave)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BarrasPorDia
          titulo="Sessões por dia da semana"
          linhas={d.porDia}
          valor={l => l.sessoesTotal}
          unidadeValor="sess."
          cor="blue"
          extra={l => ({ valor: fmtHDec(l.chSemanalTotal), unidade: "CH" })}
        />
        <BarrasPorDia
          titulo="Pacientes por dia da semana"
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

export function PacientesDashboardShell() {
  const { linhas, loading: loadingGrade, error } = useOcupacaoSalas()
  const cadastro = useConvenioCadastroPacientes()
  const loading = loadingGrade || cadastro.loading
  const { setRightContent } = useHeader()
  const [grupoAberto, setGrupoAberto] = useState<(GrupoSelecionado & { segmento: SegmentoPacientes }) | null>(null)

  // Calculado aqui, não pelo `dashboardPacientes` de useOcupacaoSalas: só esta
  // tela recebe o mapa de convênio do cadastro, e o hook é compartilhado.
  const dashboardPacientes = useMemo(() => calcularDashboardPacientes(linhas, cadastro.mapa), [linhas, cadastro.mapa])

  const pacientesDoGrupo = useMemo(
    () => grupoAberto ? listarPacientesDoGrupo(linhas, cadastro.mapa, grupoAberto.segmento, grupoAberto.campo, grupoAberto.chave) : [],
    [grupoAberto, linhas, cadastro.mapa],
  )

  const exportar = useCallback(() => {
    exportarDashboardPacientesXlsx({ linhas, dashboard: dashboardPacientes, periodo: semanaCorrenteRange(), mapaConvenio: cadastro.mapa })
  }, [linhas, dashboardPacientes, cadastro.mapa])

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando dados de pacientes...
      </div>
    )
  }
  if (error) return <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>

  const { multidisciplinar, processoDiagnostico } = dashboardPacientes

  const cadastroDisponivel = !!cadastro.mapa
  const abrir = (segmento: SegmentoPacientes) => (campo: "convenio" | "unidade", chave: string) =>
    setGrupoAberto({ segmento, segmentoLabel: SEGMENTO_LABEL[segmento], campo, chave })

  return (
    <div className="flex flex-col gap-8">
      <AvisoConvenioCadastro cadastro={cadastro} />
      <DashboardBloco tituloConvenio={SEGMENTO_LABEL.multidisciplinar} d={multidisciplinar} cadastroDisponivel={cadastroDisponivel} onAbrir={abrir("multidisciplinar")} />
      <div className="border-t border-border" />
      <DashboardBloco tituloConvenio={SEGMENTO_LABEL.processoDiagnostico} d={processoDiagnostico} cadastroDisponivel={cadastroDisponivel} onAbrir={abrir("processoDiagnostico")} />
      {grupoAberto && (
        <PacientesGrupoDrawer grupo={grupoAberto} pacientes={pacientesDoGrupo} onClose={() => setGrupoAberto(null)} />
      )}
    </div>
  )
}
