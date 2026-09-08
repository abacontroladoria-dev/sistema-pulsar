"use client"

// Ocupar Profissionais Disponíveis — visão "por Unidade, Dia e Especialidade":
// em vez de escolher um profissional, escolhe-se a categoria (unidade +
// 1-N dias/turnos + especialidade) e vê-se, numa grade de horários fixa da
// semana, quais vagas existem ali — Livre sem oportunidade / Oportunidade
// direta / Oportunidade via remanejamento — com QUALQUER profissional que já
// tenha horário "Livre" real nessa combinação. Motor em
// lib/cronograma/ocupacaoCategoria.ts, mesmas 3 modalidades e o mesmo
// cálculo já usados na visão "por Nome" (DisponibilidadeInternaView.tsx), só
// reagrupado.
//
// Quando um horário tem mais de 1 profissional/candidato disponível, o
// clique abre VagaHorarioSelector (lista os candidatos, direto e
// remanejamento em seções separadas) em vez de ir direto pro modal de
// detalhe — só pula esse passo quando há exatamente 1 candidato acionável.

import { useEffect, useMemo, useState } from "react"
import { Building2, CheckCircle2, Lock } from "lucide-react"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { calcularGaps, gapsParaMapa, type GapItem, type Turno } from "@/lib/cronograma/simulacaoNovoPrestador"
import { gerarVagasCategoria, contarOcupadosCategoria, compararUnidadesOportunidade, type VagaCategoria } from "@/lib/cronograma/ocupacaoCategoria"
import { getParametrosGerais } from "@/services/parametrosGerais.service"
import { DIAS_UTIL, HORAS_GRID, TODAS_ESP_CATEGORIA, UNID_COR, estiloUnidade } from "@/lib/cronograma/constants"
import { diaCurto, fmtName, turnoFromHora, turnoNome } from "@/lib/cronograma/helpers"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { SearchCombobox } from "@/components/cronograma/ui/SearchCombobox"
import { Button } from "@/components/ui/button"
import { RemanejamentoDetalheModal } from "./RemanejamentoDetalheModal"
import { PacienteAgendaHipoteticaModal } from "./PacienteAgendaHipoteticaModal"
import { NovoDiaDetalheModal } from "./NovoDiaDetalheModal"
import { VagaHorarioSelector } from "./VagaHorarioSelector"
import { ProjecaoOcupacaoDonut, type SegmentoOcupacao } from "./ProjecaoOcupacaoDonut"
import { OportunidadesInternasPanel } from "./OportunidadesInternasPanel"
import type { CsvRow } from "@/types/cronograma"

const UNIDADES = Object.keys(UNID_COR)
const TURNOS: Turno[] = ["manha", "tarde"]

type PeriodosSel = Record<string, { manha?: boolean; tarde?: boolean }>

// Prioridade de exibição quando há mais de 1 vaga na mesma hora: mostra
// primeiro a mais "acionável" — direto > remanejamento (mesmo dia) >
// remanejamento (outro dia) > novo dia > livre. Pedido do usuário: as 4
// modalidades de oportunidade têm ordem fixa, direto sempre primeiro, novo
// dia sempre por último (livre continua depois de tudo, por não ser uma
// oportunidade de verdade).
const PRIORIDADE: Record<VagaCategoria["status"], number> = {
  direto: 0, "remanejamento-mesmo-dia": 1, "remanejamento-outro-dia": 2, "novo-dia": 3, livre: 4,
}

const ESTILO_STATUS: Record<VagaCategoria["status"], string> = {
  livre: "border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/20",
  direto: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 cursor-pointer hover:brightness-95",
  "remanejamento-mesmo-dia": "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 cursor-pointer hover:brightness-95",
  "remanejamento-outro-dia": "border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 cursor-pointer hover:brightness-95",
  "novo-dia": "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 cursor-pointer hover:brightness-95",
}

const LABEL_STATUS: Record<VagaCategoria["status"], string> = {
  livre: "Livre",
  direto: "Ver agenda",
  "remanejamento-mesmo-dia": "Ver antes/depois",
  "remanejamento-outro-dia": "Ver antes/depois (outro dia)",
  "novo-dia": "Ver novo dia",
}

// ─── Seletor de períodos (Segunda manhã/tarde/dia inteiro, Terça...) ───────
// Mesmo padrão visual de "Dias e turnos afetados" em SimulacaoNovoPrestadorTab.tsx
// (tabela com ✓ em vez de botões de texto) — as duas telas fazem a mesma
// pergunta ("quais dias/turnos?"), então usam o mesmo componente visual.
function PeriodosSelector({
  periodosSel, onChange,
}: { periodosSel: PeriodosSel; onChange: (p: PeriodosSel) => void }) {
  const alternar = (dia: string, turno: Turno) => {
    onChange({ ...periodosSel, [dia]: { ...periodosSel[dia], [turno]: !periodosSel[dia]?.[turno] } })
  }
  const alternarDiaInteiro = (dia: string) => {
    const atual = periodosSel[dia] || {}
    const todosMarcados = !!atual.manha && !!atual.tarde
    onChange({ ...periodosSel, [dia]: { manha: !todosMarcados, tarde: !todosMarcados } })
  }
  const selecionarTudo = () => onChange(Object.fromEntries(DIAS_UTIL.map(d => [d, { manha: true, tarde: true }])))
  const limparTudo = () => onChange({})

  return (
    <div className="w-full lg:w-fit rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Dias e turnos</span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="xs" onClick={selecionarTudo}>Selecionar tudo</Button>
          <Button variant="outline" size="xs" onClick={limparTudo}>Limpar</Button>
        </div>
      </div>
      <table className="table-fixed border-separate border-spacing-x-1.5 border-spacing-y-1">
        <colgroup>
          <col className="w-14" />
          <col className="w-[92px]" />
          <col className="w-[92px]" />
          <col className="w-[92px]" />
        </colgroup>
        <thead>
          <tr>
            <th className="w-14" />
            <th className="pb-1 text-[10px] font-bold text-muted-foreground">Manhã</th>
            <th className="pb-1 text-[10px] font-bold text-muted-foreground">Tarde</th>
            <th className="pb-1 text-[10px] font-bold text-muted-foreground">Dia inteiro</th>
          </tr>
        </thead>
        <tbody>
          {DIAS_UTIL.map(dia => {
            const diaInteiro = !!periodosSel[dia]?.manha && !!periodosSel[dia]?.tarde
            return (
              <tr key={dia}>
                <td className="pr-1 text-xs font-extrabold text-foreground">{diaCurto(dia)}</td>
                {TURNOS.map(turno => (
                  <td key={turno} className="p-0">
                    <button
                      type="button"
                      onClick={() => alternar(dia, turno)}
                      aria-pressed={!!periodosSel[dia]?.[turno]}
                      className={`h-8 w-full rounded-lg border text-xs font-bold transition-colors ${periodosSel[dia]?.[turno] ? "border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400" : "border-border bg-card text-muted-foreground hover:bg-muted/50"}`}
                    >
                      {periodosSel[dia]?.[turno] ? <CheckCircle2 size={14} className="mx-auto" /> : turnoNome[turno]}
                    </button>
                  </td>
                ))}
                <td className="p-0">
                  <button
                    type="button"
                    onClick={() => alternarDiaInteiro(dia)}
                    aria-pressed={diaInteiro}
                    className={`h-8 w-full rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${diaInteiro ? "border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400" : "border-border bg-card text-muted-foreground hover:bg-muted/50"}`}
                  >
                    {diaInteiro ? <CheckCircle2 size={14} className="mx-auto" /> : "Marcar"}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Altura fixa (não só mínima) de todo bloco de 40min, ocupado, livre ou vazio
// — sem isso, cartões com mais texto (ex.: "Ver quem está livre") esticavam
// a linha inteira e desalinhavam as outras colunas do mesmo horário.
const ALTURA_CELULA = "h-[64px]"

// Casa o status da vaga com o segmento do donut (ProjecaoOcupacaoDonut) — as
// 3 modalidades de oportunidade contam como um único segmento "oportunidade"
// lá. Não existe "ocupado" aqui: esta grade só lista horários "Livre" (ver
// gerarVagasCategoria) — sessões já agendadas nunca viram uma vaga, então o
// segmento "ocupado" do donut nunca casa com nenhuma célula desta grade.
function segmentoDoStatus(status: VagaCategoria["status"]): SegmentoOcupacao {
  return status === "livre" ? "livre" : "oportunidade"
}

function CelulaGrade({
  vagas, focada, destaque, onAbrirCelula,
}: { vagas: VagaCategoria[]; focada: boolean; destaque: SegmentoOcupacao | null; onAbrirCelula: (vagas: VagaCategoria[]) => void }) {
  if (!focada) {
    return <div className={`${ALTURA_CELULA} rounded-lg border border-transparent bg-sky-50/50 dark:bg-sky-950/10`} />
  }
  // Sem borda/fundo nenhum aqui parecia um "buraco" na grade ao lado de
  // cartões coloridos — pedido do usuário: nunca deixar espaço em branco puro,
  // mesmo pra um horário sem nenhuma vaga registrada. Mesma borda tracejada
  // do estado "livre" (ESTILO_STATUS.livre), só mais discreta (opacidade
  // menor), pra não competir visualmente com uma vaga "livre" de verdade.
  if (!vagas.length) return <div className={`${ALTURA_CELULA} rounded-lg border border-dashed border-border/40 transition-opacity ${destaque ? "opacity-30" : ""}`} />

  const ordenadas = [...vagas].sort((a, b) => PRIORIDADE[a.status] - PRIORIDADE[b.status])
  const principal = ordenadas[0]
  const resto = ordenadas.length - 1
  // Clicável se há algo pra fazer (direto/remanejamento) OU se há mais de 1
  // profissional na célula — mesmo só "livre", vale poder ver quem são todos
  // (sem isso, o "+N" escondia profissionais sem nenhuma forma de revelar).
  const clicavel = principal.status !== "livre" || resto > 0
  const emDestaque = !destaque || segmentoDoStatus(principal.status) === destaque

  return (
    <button
      type="button"
      disabled={!clicavel}
      onClick={() => clicavel && onAbrirCelula(vagas)}
      className={`${ALTURA_CELULA} w-full overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-opacity ${ESTILO_STATUS[principal.status]} ${emDestaque ? "" : "opacity-30"}`}
    >
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[11px] font-bold leading-tight text-foreground">{fmtName(principal.profissional)}</span>
        {resto > 0 && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">+{resto}</span>}
      </div>
      <div className="truncate text-[10px] text-muted-foreground">
        {principal.status === "livre" ? "Livre" : fmtName(principal.paciente?.pac ?? "")}
      </div>
      {clicavel && (
        <div className={`mt-0.5 truncate text-[10px] font-bold ${
          principal.status === "livre" ? "text-rose-700 dark:text-rose-400"
          : principal.status === "direto" ? "text-emerald-700 dark:text-emerald-400"
          : principal.status === "remanejamento-mesmo-dia" ? "text-sky-700 dark:text-sky-400"
          : principal.status === "remanejamento-outro-dia" ? "text-indigo-700 dark:text-indigo-400"
          : "text-amber-700 dark:text-amber-400"
        }`}>
          {resto > 0 ? "Ver quem está livre" : LABEL_STATUS[principal.status]}
        </div>
      )}
    </button>
  )
}

function GradeCategoria({
  unidade, periodosSel, especialidade, cRows, gapMap, limiteCoordenadorCaso, onAbrirCelula,
}: { unidade: string; periodosSel: PeriodosSel; especialidade: string; cRows: CsvRow[]; gapMap: Record<string, GapItem>; limiteCoordenadorCaso?: number; onAbrirCelula: (dia: string, hora: string, vagas: VagaCategoria[]) => void }) {
  const diasAtivos = useMemo(
    () => DIAS_UTIL.filter(d => periodosSel[d]?.manha || periodosSel[d]?.tarde),
    [periodosSel],
  )

  const vagasPorDia = useMemo(() => {
    const m = new Map<string, VagaCategoria[]>()
    for (const d of diasAtivos) m.set(d, gerarVagasCategoria(unidade, d, especialidade, cRows, gapMap, undefined, undefined, undefined, limiteCoordenadorCaso))
    return m
  }, [diasAtivos, unidade, especialidade, cRows, gapMap, limiteCoordenadorCaso])

  // Filtra pelo(s) turno(s) MARCADO(S) de cada dia — gerarVagasCategoria
  // sempre devolve o dia inteiro (manhã+tarde), então sem esse filtro um dia
  // com só "manhã" marcada inflava o resumo/donut com vagas da tarde que a
  // grade já mostra cinza/desativada (mesmo padrão do cálculo de `ocupado`
  // abaixo, que já respeita o turno certo).
  const todasVagas = useMemo(
    () => diasAtivos.flatMap(d => (vagasPorDia.get(d) ?? []).filter(v => !!periodosSel[d]?.[v.turno])),
    [diasAtivos, vagasPorDia, periodosSel],
  )
  const qtdDireto = todasVagas.filter(v => v.status === "direto").length
  const qtdRemanejamentoMesmoDia = todasVagas.filter(v => v.status === "remanejamento-mesmo-dia").length
  const qtdRemanejamentoOutroDia = todasVagas.filter(v => v.status === "remanejamento-outro-dia").length
  const qtdNovoDia = todasVagas.filter(v => v.status === "novo-dia").length
  const qtdLivre = todasVagas.filter(v => v.status === "livre").length

  const ocupado = useMemo(() => {
    const periodos = diasAtivos.flatMap(d => TURNOS.filter(t => periodosSel[d]?.[t]).map(turno => ({ dia: d, turno })))
    return contarOcupadosCategoria(unidade, periodos, especialidade, cRows)
  }, [diasAtivos, periodosSel, unidade, especialidade, cRows])

  const celulaAtiva = (dia: string, hora: string) => !!periodosSel[dia]?.[turnoFromHora(hora)]

  const [destaque, setDestaque] = useState<SegmentoOcupacao | null>(null)
  useEffect(() => setDestaque(null), [unidade, especialidade])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 size={14} className="text-muted-foreground" />
        <span className="text-sm font-extrabold text-foreground">{unidade} · {especialidade}</span>
        <span className="text-[11px] text-muted-foreground">
          {qtdDireto + qtdRemanejamentoMesmoDia + qtdRemanejamentoOutroDia + qtdNovoDia} oportunidade(s) — {qtdDireto} direta(s), {qtdRemanejamentoMesmoDia} via remanejamento (mesmo dia), {qtdRemanejamentoOutroDia} via remanejamento (outro dia), {qtdNovoDia} via novo dia · {qtdLivre} livre(s) sem oportunidade
        </span>
      </div>

      <div className="mb-1 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/20" /> Livre, sem oportunidade</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" /> Oportunidade direta</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30" /> Oportunidade via remanejamento (mesmo dia)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30" /> Oportunidade via remanejamento (outro dia)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30" /> Oportunidade via novo dia</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-50/50 dark:bg-sky-950/10" /> Fora do filtro de dias/turnos</span>
      </div>

      {destaque === "ocupado" && (
        <InlineNotice tone="slate">
          "Ocupado" não tem célula própria nesta grade — ela só lista horários "Livre" da unidade. Esmaecendo tudo porque nada aqui corresponde a esse segmento.
        </InlineNotice>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4 items-start">
        {!diasAtivos.length ? (
          <InlineNotice tone="slate">Selecione ao menos 1 dia/turno pra ver as vagas.</InlineNotice>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border p-3">
            <table className="table-fixed border-collapse text-[11px]" style={{ width: `${56 + DIAS_UTIL.length * 140}px` }}>
              <colgroup>
                <col style={{ width: 56 }} />
                {DIAS_UTIL.map(d => <col key={d} style={{ width: 140 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="w-14" />
                  {DIAS_UTIL.map(d => (
                    <th key={d} className={`pb-1.5 text-center text-[11px] font-bold ${diasAtivos.includes(d) ? "text-foreground" : "text-muted-foreground/60"}`}>{diaCurto(d)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HORAS_GRID.map(hora => (
                  <tr key={hora} className="border-t border-border">
                    <td className="py-1 pr-2 text-right font-mono text-[10px] font-semibold text-muted-foreground">{hora}</td>
                    {DIAS_UTIL.map(d => {
                      const ativa = celulaAtiva(d, hora)
                      const vagasCelula = ativa ? (vagasPorDia.get(d) ?? []).filter(v => v.hora === hora) : []
                      return (
                        <td key={d} className="px-0.5 py-0">
                          <CelulaGrade vagas={vagasCelula} focada={ativa} destaque={destaque} onAbrirCelula={vagas => onAbrirCelula(d, hora, vagas)} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ProjecaoOcupacaoDonut
          titulo="Ocupação da categoria" ocupado={ocupado} oportunidade={qtdDireto + qtdRemanejamentoMesmoDia + qtdRemanejamentoOutroDia + qtdNovoDia} livre={qtdLivre}
          segmentoSelecionado={destaque} onSelecionarSegmento={setDestaque}
        />
      </div>
    </div>
  )
}

// ─── Comparativo entre as 3 unidades ────────────────────────────────────────
// Equivalente a "Ou fixe numa unidade única" da Simulação de Novo Prestador
// (barras por unidade em SimulacaoNovoPrestadorTab.tsx): mesmo filtrando só
// "Realengo" acima, o usuário quer ver de relance quanto dá pra aproveitar
// internamente nas OUTRAS unidades também, pro mesmo dia/turno/especialidade
// — sem precisar trocar o filtro 3 vezes pra comparar manualmente.
function ComparativoUnidades({
  unidadeAtiva, periodos, especialidade, cRows, gapMap, limiteCoordenadorCaso, onEscolherUnidade,
}: { unidadeAtiva: string; periodos: { dia: string; turno: Turno }[]; especialidade: string; cRows: CsvRow[]; gapMap: Record<string, GapItem>; limiteCoordenadorCaso?: number; onEscolherUnidade: (u: string) => void }) {
  const comparativo = useMemo(
    () => compararUnidadesOportunidade(periodos, especialidade, cRows, gapMap, limiteCoordenadorCaso),
    [periodos, especialidade, cRows, gapMap, limiteCoordenadorCaso],
  )
  const totais = comparativo.map(u => u.qtdDireto + u.qtdRemanejamentoMesmoDia + u.qtdRemanejamentoOutroDia + u.qtdNovoDia)
  const escala = Math.max(1, ...totais)

  return (
    <div className="w-full lg:w-[300px] shrink-0 rounded-xl border border-border bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Aproveitamento nas 3 unidades
        <InfoTooltip ariaLabel="O que este comparativo mostra">
          <p>Quantas oportunidades (direto + remanejamento) existem em <strong className="text-foreground">cada unidade</strong> pros mesmos dias/turnos e especialidade escolhidos acima — mesmo com uma unidade só selecionada no filtro.</p>
          <p className="mt-2">Clique numa barra pra ver a grade daquela unidade.</p>
        </InfoTooltip>
      </div>
      <div className="flex flex-col gap-1.5">
        {comparativo.map((u, i) => {
          const cor = estiloUnidade(u.unidade)
          const total = totais[i]
          const largura = (total / escala) * 100
          const ativo = u.unidade === unidadeAtiva
          return (
            <button
              key={u.unidade}
              type="button"
              onClick={() => onEscolherUnidade(u.unidade)}
              className={`flex items-center gap-2 rounded-lg border p-1.5 text-left transition-colors ${ativo ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30" : "border-transparent hover:bg-muted/50"}`}
            >
              <span className={`w-[80px] shrink-0 truncate text-[11.5px] font-bold ${cor.text}`}>{u.unidade}</span>
              <span className="relative h-3.5 flex-1 rounded-full bg-muted">
                <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${cor.bar}`} style={{ width: `${largura}%` }} />
              </span>
              <span className="w-[64px] shrink-0 text-right text-[11.5px] font-black tabular-nums text-foreground">{total} vaga(s)</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  cRows: CsvRow[]
}

export function OcupacaoCategoriaView({ cRows }: Props) {
  const { lRows } = useCronogramaData()
  const laudosCarregados = lRows.length > 0
  const gapMap = useMemo(() => gapsParaMapa(calcularGaps(lRows, cRows)), [lRows, cRows])

  // Teto de pacientes por profissional Coordenador de Caso — mesmo parâmetro
  // configurável já usado no relatório de remuneração (cc_lim_default).
  // Quem não tem acesso a Taxas/Parâmetros de Remuneração (RLS da tabela
  // remuneracao_parametros_gerais) recebe null aqui e a tela cai no default
  // 18 (mesmo valor hoje configurado no banco).
  const [limiteCoordenadorCaso, setLimiteCoordenadorCaso] = useState<number | undefined>(undefined)
  useEffect(() => {
    let ativo = true
    getParametrosGerais().then(({ data }) => {
      if (ativo && data) setLimiteCoordenadorCaso(data.cc_lim_default)
    })
    return () => { ativo = false }
  }, [])

  const [unidade, setUnidade] = useState("")
  const [periodosSel, setPeriodosSel] = useState<PeriodosSel>({})
  const [especialidade, setEspecialidade] = useState("")
  const [celulaSelecionada, setCelulaSelecionada] = useState<{ dia: string; hora: string; vagas: VagaCategoria[] } | null>(null)
  const [detalheDireto, setDetalheDireto] = useState<{ dia: string; vaga: VagaCategoria } | null>(null)
  const [detalheRemanejamento, setDetalheRemanejamento] = useState<VagaCategoria | null>(null)
  const [detalheNovoDia, setDetalheNovoDia] = useState<VagaCategoria | null>(null)

  const diasSelecionados = useMemo(() => Object.keys(periodosSel).filter(d => periodosSel[d]?.manha || periodosSel[d]?.tarde), [periodosSel])
  const filtrosCompletos = !!unidade && !!especialidade && diasSelecionados.length > 0

  const periodosSelecionados = useMemo(
    () => diasSelecionados.flatMap(d => TURNOS.filter(t => periodosSel[d]?.[t]).map(turno => ({ dia: d, turno }))),
    [diasSelecionados, periodosSel],
  )

  const aplicarOportunidade = (u: string, periodos: { dia: string; turno: Turno }[], esp: string) => {
    setUnidade(u)
    setEspecialidade(esp)
    const novoPeriodosSel: PeriodosSel = {}
    for (const { dia, turno } of periodos) novoPeriodosSel[dia] = { ...novoPeriodosSel[dia], [turno]: true }
    setPeriodosSel(novoPeriodosSel)
  }

  // Só pula o seletor quando a célula tem exatamente 1 vaga no total (nenhuma
  // outra pra revelar) — se houver mais de 1 (mesmo que a extra seja só
  // "livre"), sempre abre o seletor, pra nunca esconder quem mais está livre.
  const abrirCelula = (dia: string, hora: string, vagas: VagaCategoria[]) => {
    if (vagas.length === 1) {
      const v = vagas[0]
      if (v.status === "direto") setDetalheDireto({ dia, vaga: v })
      else if (v.status === "remanejamento-mesmo-dia" || v.status === "remanejamento-outro-dia") setDetalheRemanejamento(v)
      else if (v.status === "novo-dia") setDetalheNovoDia(v)
      return
    }
    setCelulaSelecionada({ dia, hora, vagas })
  }

  return (
    <div className="flex flex-col gap-4">
      {!laudosCarregados ? (
        <InlineNotice tone="amber" icon={<Lock size={15} />}>
          <strong>Relatório de laudos não anexado.</strong> Sem ele não é possível calcular quem tem sessões pendentes (autorizado × ofertado) — os horários "Livre" apareceriam sempre como "sem oportunidade", mesmo quando há demanda real. Anexe o relatório de laudos para liberar esta aba.
        </InlineNotice>
      ) : (
        <>
          <OportunidadesInternasPanel cRows={cRows} gapMap={gapMap} limiteCoordenadorCaso={limiteCoordenadorCaso} onAplicar={aplicarOportunidade} />

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-1 flex items-center gap-1.5">
              <Building2 size={15} className="text-violet-600 dark:text-violet-400" />
              <span className="text-[15px] font-extrabold text-foreground">Ocupar por unidade, dia e especialidade</span>
            </div>
            <div className="mb-3 text-xs text-muted-foreground">
              Escolha uma unidade, um ou mais dias/turnos e uma especialidade pra ver todas as vagas dessa combinação — com qualquer profissional que já tenha horário "Livre" real ali — direto ou via remanejamento. Sem escrever nada na TiTa, é só visualização.
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex w-full lg:w-56 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Unidade</span>
                <SearchCombobox value={unidade} onChange={setUnidade} opcoes={UNIDADES} placeholder="Digite para buscar a unidade..." ariaLabel="Buscar unidade" />

                <span className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Especialidade</span>
                <SearchCombobox value={especialidade} onChange={setEspecialidade} opcoes={TODAS_ESP_CATEGORIA} placeholder="Digite para buscar a especialidade..." ariaLabel="Buscar especialidade" />
              </div>

              <PeriodosSelector periodosSel={periodosSel} onChange={setPeriodosSel} />

              {!!especialidade && periodosSelecionados.length > 0 && (
                <ComparativoUnidades
                  unidadeAtiva={unidade}
                  periodos={periodosSelecionados}
                  especialidade={especialidade}
                  cRows={cRows}
                  gapMap={gapMap}
                  limiteCoordenadorCaso={limiteCoordenadorCaso}
                  onEscolherUnidade={setUnidade}
                />
              )}
            </div>
          </div>

          {!filtrosCompletos ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Selecione unidade, especialidade e ao menos 1 dia/turno para ver as vagas.
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-4">
              <GradeCategoria
                unidade={unidade}
                periodosSel={periodosSel}
                especialidade={especialidade}
                cRows={cRows}
                gapMap={gapMap}
                limiteCoordenadorCaso={limiteCoordenadorCaso}
                onAbrirCelula={abrirCelula}
              />
            </div>
          )}
        </>
      )}

      {celulaSelecionada && (
        <VagaHorarioSelector
          dia={celulaSelecionada.dia}
          hora={celulaSelecionada.hora}
          vagas={celulaSelecionada.vagas}
          onEscolherDireto={v => { setDetalheDireto({ dia: celulaSelecionada.dia, vaga: v }); setCelulaSelecionada(null) }}
          onEscolherRemanejamento={v => { setDetalheRemanejamento(v); setCelulaSelecionada(null) }}
          onEscolherNovoDia={v => { setDetalheNovoDia(v); setCelulaSelecionada(null) }}
          onClose={() => setCelulaSelecionada(null)}
        />
      )}

      {detalheDireto?.vaga.paciente && (
        <PacienteAgendaHipoteticaModal
          paciente={detalheDireto.vaga.paciente.pac}
          slot={{ dia: detalheDireto.dia, turno: detalheDireto.vaga.turno, hora: detalheDireto.vaga.hora, unidade }}
          especialidade={especialidade}
          profissionalHipotetico={detalheDireto.vaga.profissional}
          cRows={cRows}
          onClose={() => setDetalheDireto(null)}
        />
      )}

      {detalheRemanejamento?.remanejamento && (
        <RemanejamentoDetalheModal
          paciente={detalheRemanejamento.paciente!.pac}
          terapiaHipotetica={detalheRemanejamento.terapia}
          profissionalHipotetico={detalheRemanejamento.profissional}
          remanejamento={detalheRemanejamento.remanejamento}
          cRows={cRows}
          onClose={() => setDetalheRemanejamento(null)}
        />
      )}

      {detalheNovoDia?.novoDia && (
        <NovoDiaDetalheModal
          oportunidade={detalheNovoDia.novoDia}
          cRows={cRows}
          onClose={() => setDetalheNovoDia(null)}
        />
      )}
    </div>
  )
}
