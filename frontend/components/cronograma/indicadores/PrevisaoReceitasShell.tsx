"use client"

// PrevisaoReceitasShell — cruza as sessões reais (csv_grades_profissionais, via
// useOcupacaoSalas) com os valores cadastrados em Cadastro de Valores
// (useConvenioValores) pra projetar receita semanal/mensal por convênio. Ver
// resolverValorSessao/calcularPrevisaoReceita em lib/cronograma/faturamentoProjecao.ts
// pra entender a regra de prioridade (paciente > critério ABA > terapia >
// geral) — todo valor vem de valor_sessao, o sistema não trabalha mais com
// valor por hora — e o cálculo "dia a dia" da receita mensal (mesmo padrão de
// "Dias trabalhados" em
// Relacionamento Prestador: sessões/semana daquele dia × quantas vezes esse
// dia ocorre no mês de referência).
//
// Duas tabelas "Por convênio" — Multidisciplinar e Processo Diagnóstico —
// mesma separação do Dashboard de Pacientes (tab=pacientes), senão o nº de
// pacientes por convênio aqui não bateria com o de lá (um paciente cuja
// agenda é só avaliação/triagem não soma no Multidisciplinar).
//
// Perf: convênios como ASSIM Saúde têm ~1800 sessões em "Por sessão". Cada
// linha é um componente memoizado (SessaoRow) e a lista ordenada é useMemo —
// clicar pra selecionar/ordenar só re-renderiza as poucas linhas cujo estado
// realmente mudou, em vez de recriar a tabela inteira a cada clique.

import { Fragment, memo, useCallback, useMemo, useState } from "react"
import { Loader2, Wallet, AlertTriangle, CalendarDays, ChevronDown, ChevronRight } from "lucide-react"
import { StatCard } from "@/components/cronograma/ui/StatCard"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { SortableTh, ordenarPor, type SortDir } from "@/components/cronograma/ui/SortableTh"
import { UnidadeMultiSelect } from "@/components/cronograma/ui/UnidadeMultiSelect"
import { useOcupacaoSalas } from "@/hooks/useOcupacaoSalas"
import { useConvenioValoresCalculo } from "@/hooks/useConvenioValores"
import { useFeriados } from "@/hooks/useFeriados"
import { useLinhasMesInteiro } from "@/hooks/useLinhasMesInteiro"
import { usePrevisaoReceitasHistorico } from "@/hooks/usePrevisaoReceitasHistorico"
import { normalizarUnidadeOcupacao } from "@/lib/cronograma/ocupacaoProf"
import { getRefWeekDoMes, labelMesAno } from "@/lib/cronograma/helpers"
import { SeletorMesPrevisao } from "./SeletorMesPrevisao"
import {
  calcularPrevisaoReceita,
  enriquecerComDeducaoFalta,
  calcularSessoesMensaisPorConvenio,
  agregarSegmentoHistorico,
  type PrevisaoReceitaConvenio, type PrevisaoReceitaSessao, type PrevisaoReceitaSegmento, type PrevisaoReceitaGeral,
} from "@/lib/cronograma/faturamentoProjecao"

type VisaoDetalhe = "dia" | "terapia" | "paciente"
const SORT_PADRAO_PACIENTE = { key: "pacienteNome" as keyof PrevisaoReceitaPacienteAgregado, dir: "asc" as SortDir }

function fmtReal(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function fmtNum(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
}

function fmtData(iso: string): string {
  const [ano, mes, dia] = iso.split("-")
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso
}

const ORIGEM_LABEL: Record<string, string> = {
  paciente: "Exceção paciente",
  criterio_aba: "Critério ABA",
  terapia: "Regra por terapia",
  geral: "Regra geral",
  pacote_avaliacao: "Pacote de sessões",
  sem_valor: "Sem valor",
}

interface PrevisaoReceitaPacienteAgregado {
  chave: string
  pacienteId: number | null
  pacienteNome: string
  sessoesCount: number
  /** Quantas dessas sessões do mês estão marcadas como falta em fila_autorizacoes (não revertida). */
  faltasCount: number
  /** Soma de todos os valores das sessões desse paciente no mês (sessões sem valor não entram na soma; inclui as sessões em falta, ver deducaoFalta). */
  valorSemDeducao: number
  /** Soma do valor só das sessões em falta desse paciente — o mesmo critério usado na dedução por convênio. */
  deducaoFalta: number
  /** valorSemDeducao − deducaoFalta. */
  valorComDeducao: number
  sessoes: PrevisaoReceitaSessao[]
}

/**
 * Aglutina as sessões do mês por paciente — ID Paciente, Nome, sessões/faltas/valor do mês.
 *
 * `aplicaDeducaoFalta` deve ser true SÓ no segmento Multidisciplinar — no
 * Processo Diagnóstico (cobrado em bloco/pacote, ver enriquecerComDeducaoFalta
 * em faturamentoProjecao.ts) uma falta pontual não reduz nada, então
 * deducaoFalta/valorComDeducao ficam neutros mesmo com sessões emFalta, pra
 * não divergir do total do convênio (que nunca deduz nesse segmento).
 * faltasCount continua contando normalmente — é só informativo.
 */
function agregarPorPaciente(sessoes: PrevisaoReceitaSessao[], aplicaDeducaoFalta: boolean): PrevisaoReceitaPacienteAgregado[] {
  const map = new Map<string, PrevisaoReceitaPacienteAgregado>()
  for (const s of sessoes) {
    const chave = s.pacienteId !== null ? `id:${s.pacienteId}` : `nome:${s.pacienteNome}`
    let entry = map.get(chave)
    if (!entry) {
      entry = {
        chave, pacienteId: s.pacienteId, pacienteNome: s.pacienteNome,
        sessoesCount: 0, faltasCount: 0, valorSemDeducao: 0, deducaoFalta: 0, valorComDeducao: 0,
        sessoes: [],
      }
      map.set(chave, entry)
    }
    entry.sessoesCount += 1
    entry.valorSemDeducao += s.valor ?? 0
    if (s.emFalta) {
      entry.faltasCount += 1
      if (aplicaDeducaoFalta) entry.deducaoFalta += s.valor ?? 0
    }
    entry.sessoes.push(s)
  }
  for (const entry of map.values()) entry.valorComDeducao = entry.valorSemDeducao - entry.deducaoFalta
  return Array.from(map.values())
}

function chaveSessao(convenio: string, s: PrevisaoReceitaSessao): string {
  // agendamentoId é o ID real da fonte (tita_agendamento_id) — único de
  // verdade. Cai pro composto paciente+terapia+dia+hora só se, por algum
  // motivo, a linha não trouxe id nenhum.
  return s.agendamentoId !== null
    ? `${convenio}::agendamento:${s.agendamentoId}`
    : `${convenio}::${s.pacienteId ?? s.pacienteNome}::${s.terapiaId ?? s.terapiaNome}::${s.data}::${s.horaInicial ?? "sem-hora"}`
}

/** Aviso colapsável — mostra só "Atenção" por padrão, expande a mensagem completa ao clicar. */
function AvisoAtencao({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-bold"
      >
        <AlertTriangle size={14} className="shrink-0" />
        Atenção
        {aberto ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
      </button>
      {aberto && <div className="px-3 pb-2 text-[11px]">{children}</div>}
    </div>
  )
}

interface SessaoRowProps {
  s: PrevisaoReceitaSessao
  chave: string
  selecionada: boolean
  /** Valor à vista cadastrado pra terapia dessa sessão, quando origem é "pacote_avaliacao" (Avaliação Neuropsicológica/Psiquiatra-Neurologista) — só exibição, não é somado por sessão (o pacote é cobrado uma vez por paciente, já contabilizado à parte na receita mensal). */
  valorPacote: number | null
  onSelect: (chave: string) => void
  /** false dentro do destrinchamento "Por paciente", onde a coluna Paciente já é redundante (a linha-pai já identifica quem é). */
  mostrarPaciente?: boolean
}

/** Memoizado — só re-renderiza quando a PRÓPRIA seleção/dado muda, não a cada clique em qualquer outra linha da tabela. */
const SessaoRow = memo(function SessaoRow({ s, chave, selecionada, valorPacote, onSelect, mostrarPaciente = true }: SessaoRowProps) {
  const ehPacote = s.origem === "pacote_avaliacao"
  const valorExibido = s.valor !== null ? s.valor : (ehPacote ? valorPacote : null)
  const origemLabel = ehPacote
    ? (valorPacote !== null ? "Pacote de Sessões (À Vista)" : "Pacote de Sessões")
    : (ORIGEM_LABEL[s.origem] ?? s.origem)
  return (
    <tr
      onClick={() => onSelect(chave)}
      className={`cursor-pointer border-t border-border/40 ${selecionada ? "bg-emerald-100 dark:bg-emerald-950/50" : s.emFalta ? "bg-rose-50 dark:bg-rose-950/20" : "hover:bg-muted/40"}`}
    >
      <td className="py-1 pr-2 text-muted-foreground">{s.agendamentoId ?? "—"}</td>
      {mostrarPaciente && (
        <td className="py-1 pr-2 font-medium text-foreground">
          {s.pacienteNome}{s.pacienteId !== null && <span className="text-muted-foreground"> (ID {s.pacienteId})</span>}
        </td>
      )}
      <td className="py-1 px-2 text-muted-foreground">
        {s.terapiaNome}{s.terapiaId !== null && <span> (ID {s.terapiaId})</span>}
        {s.emFalta && (
          <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-900/40">
            Falta
          </span>
        )}
      </td>
      <td className="py-1 px-2 text-muted-foreground">{s.diaLabel} · {fmtData(s.data)}</td>
      <td className={`py-1 px-2 text-right tabular-nums font-semibold ${valorExibido === null ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {valorExibido !== null ? fmtReal(valorExibido) : "sem valor"}
      </td>
      <td className="py-1 pl-2 text-left text-muted-foreground">{origemLabel}</td>
    </tr>
  )
})

interface PacienteRowProps {
  p: PrevisaoReceitaPacienteAgregado
  convenio: string
  aberto: boolean
  onToggle: (chave: string) => void
  sessaoSelecionada: string | null
  onSelectSessao: (chave: string) => void
  valorPacotePorTerapia: Map<number, number>
}

/** Linha "Por paciente" — aglutinado por padrão; clicar no nome destrincha sessão por sessão abaixo. */
function PacienteRow({ p, convenio, aberto, onToggle, sessaoSelecionada, onSelectSessao, valorPacotePorTerapia }: PacienteRowProps) {
  const sessoesDoPaciente = useMemo(() => ordenarPor(p.sessoes, "data", "asc"), [p.sessoes])
  return (
    <Fragment>
      <tr
        onClick={() => onToggle(p.chave)}
        className="cursor-pointer border-t border-border/40 hover:bg-muted/40"
      >
        <td className="py-1 pr-2 text-muted-foreground">{p.pacienteId ?? "—"}</td>
        <td className="py-1 px-2 font-medium text-foreground">
          <span className="inline-flex items-center gap-1">
            {aberto ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
            {p.pacienteNome}
          </span>
        </td>
        <td className="py-1 px-2 text-right tabular-nums">{p.sessoesCount}</td>
        <td className={`py-1 px-2 text-right tabular-nums ${p.faltasCount > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
          {p.faltasCount > 0 ? p.faltasCount : "—"}
        </td>
        <td className="py-1 px-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">{fmtReal(p.valorSemDeducao)}</td>
        <td className={`py-1 px-2 text-right tabular-nums ${p.deducaoFalta > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
          {p.deducaoFalta > 0 ? `-${fmtReal(p.deducaoFalta)}` : "—"}
        </td>
        <td className="py-1 pl-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmtReal(p.valorComDeducao)}</td>
      </tr>
      {aberto && (
        <tr className="bg-muted/10">
          <td colSpan={7} className="p-0">
            <div className="px-3 py-2">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold">ID Agend.</th>
                    <th className="py-1 px-2 font-semibold">Terapia</th>
                    <th className="py-1 px-2 font-semibold">Dia</th>
                    <th className="py-1 px-2 text-right font-semibold">Valor</th>
                    <th className="py-1 pl-2 text-left font-semibold">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {sessoesDoPaciente.map((s, i) => {
                    const chave = chaveSessao(convenio, s)
                    return (
                      <SessaoRow
                        key={`${chave}::${i}`}
                        s={s}
                        chave={chave}
                        selecionada={sessaoSelecionada === chave}
                        valorPacote={s.terapiaId !== null ? valorPacotePorTerapia.get(s.terapiaId) ?? null : null}
                        onSelect={onSelectSessao}
                        mostrarPaciente={false}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

interface ConvenioRowProps {
  c: PrevisaoReceitaConvenio
  mesReferenciaLabel: string | null
  sessaoSelecionada: string | null
  onSelectSessao: (chave: string) => void
  /** Mostra o aviso de valor médio estimado quando este convênio é "Particular" (só faz sentido no segmento Multidisciplinar). */
  avisoParticular?: boolean
  /** Sessões REAIS do mês inteiro deste convênio (não a amostra semanal) — fonte da aba "Por paciente", pra mostrar todas as faltas do mês. */
  porSessaoMes: PrevisaoReceitaSessao[]
  /** true só no segmento Multidisciplinar — ver agregarPorPaciente. */
  aplicaDeducaoFalta: boolean
}

function ConvenioRow({ c, mesReferenciaLabel, sessaoSelecionada, onSelectSessao, avisoParticular, porSessaoMes, aplicaDeducaoFalta }: ConvenioRowProps) {
  const [aberto, setAberto] = useState(false)
  const [visao, setVisao] = useState<VisaoDetalhe>("paciente")
  const [sortPaciente, setSortPaciente] = useState(SORT_PADRAO_PACIENTE)
  const [pacienteAberto, setPacienteAberto] = useState<string | null>(null)

  // "Por paciente" usa o mês inteiro (porSessaoMes), diferente de "Por dia da
  // semana"/"Por terapia" abaixo, que continuam usando a amostra semanal (c.porDia/c.porTerapia).
  const pacientesAgregados = useMemo(
    () => ordenarPor(agregarPorPaciente(porSessaoMes, aplicaDeducaoFalta), sortPaciente.key, sortPaciente.dir),
    [porSessaoMes, aplicaDeducaoFalta, sortPaciente.key, sortPaciente.dir],
  )

  const onTogglePaciente = useCallback((chave: string) => {
    setPacienteAberto(prev => (prev === chave ? null : chave))
  }, [])

  // Valor à vista cadastrado por terapia (Avaliação Neuropsicológica/Psiquiatra-
  // Neurologista) — pra exibir na coluna "Valor" das sessões de pacote, já que
  // essas sessões não têm valor individual (o pacote é cobrado uma vez por
  // paciente, não por sessão).
  const valorPacotePorTerapia = useMemo(() => {
    const m = new Map<number, number>()
    c.pacotesTerapia.forEach(p => { if (p.valorAVista !== null) m.set(p.terapiaId, p.valorAVista) })
    return m
  }, [c.pacotesTerapia])

  function onSortClick(key: string) {
    setSortPaciente(prev => ({
      key: key as keyof PrevisaoReceitaPacienteAgregado,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }))
  }

  const mostrarAvisoParticular = !!avisoParticular && c.convenio.trim().toLowerCase() === "particular"

  return (
    <Fragment>
      <tr
        className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
        onClick={() => setAberto(v => !v)}
      >
        <td className="py-1.5 pr-2 font-medium text-foreground">
          <span className="inline-flex items-center gap-1">
            {aberto ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
            {c.convenio}
          </span>
        </td>
        <td className="py-1.5 px-2 text-right tabular-nums">{c.pacientesUnicos}</td>
        <td className="py-1.5 px-2 text-right tabular-nums">{fmtNum(c.sessoesMesProjetadas)}</td>
        <td className={`py-1.5 px-2 text-right tabular-nums ${c.sessoesSemValor > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
          {c.sessoesSemValor > 0 ? c.sessoesSemValor : "—"}
        </td>
        <td className="py-1.5 px-2 text-right tabular-nums">{fmtReal(c.receitaSemanal)}</td>
        <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400">{fmtReal(c.receitaMensalProjetada)}</td>
        <td className={`py-1.5 px-2 text-right tabular-nums ${c.deducaoFalta > 0 ? "font-semibold text-rose-600 dark:text-rose-400" : ""}`}>
          {c.deducaoFalta > 0 ? `-${fmtReal(c.deducaoFalta)}` : "—"}
        </td>
        <td className="py-1.5 pl-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmtReal(c.receitaMensalComDeducao)}</td>
      </tr>
      {mostrarAvisoParticular && (
        <tr className="border-b border-border/60 last:border-0">
          <td colSpan={8} className="px-2 pb-2 pt-1">
            <AvisoAtencao>
              Para a modalidade "Particular" foi usada uma <strong>média de valor por sessão</strong> como estimativa — não é um valor negociado por sessão objetivamente. O novo modelo de captação de receita (por sessão, mensal, trimestral etc.) ainda está em estágio de definição interna; quando a transição acontecer, isso será configurado e sistematizado corretamente no cadastro.
            </AvisoAtencao>
          </td>
        </tr>
      )}
      {aberto && (
        <tr className="border-b border-border/60 last:border-0 bg-muted/20">
          <td colSpan={8} className="p-0">
            <div className="px-4 py-3">
              <SegmentedTabs
                value={visao}
                onChange={setVisao}
                tabs={[
                  { value: "paciente", label: "Por paciente", count: pacientesAgregados.length },
                  { value: "dia", label: "Por dia da semana" },
                  { value: "terapia", label: "Por terapia" },
                ]}
                className="mb-3"
              />

              {visao === "dia" && (
                <>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-2 font-semibold">Dia</th>
                        <th className="py-1 px-2 text-right font-semibold">Sessões/sem</th>
                        <th className="py-1 px-2 text-right font-semibold">Ocorr. no mês</th>
                        <th className="py-1 px-2 text-right font-semibold">Sessões/mês</th>
                        <th className="py-1 px-2 text-right font-semibold">Receita/sem</th>
                        <th className="py-1 pl-2 text-right font-semibold">Receita/mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.porDia.length === 0 && (
                        <tr><td colSpan={6} className="py-2 text-center text-muted-foreground">Sem sessões em dia útil pra detalhar.</td></tr>
                      )}
                      {c.porDia.map(d => (
                        <tr key={d.dow} className="border-t border-border/40">
                          <td className="py-1 pr-2 font-medium text-foreground">{d.diaLabel}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{fmtNum(d.sessoesSemana)}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{d.ocorrenciasMes}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{fmtNum(d.sessoesMesProjetadas)}</td>
                          <td className="py-1 px-2 text-right tabular-nums">{fmtReal(d.receitaSemana)}</td>
                          <td className="py-1 pl-2 text-right tabular-nums font-semibold">{fmtReal(d.receitaMesProjetada)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Receita/mês de cada dia = Receita/sem × Ocorr. no mês (quantas segundas/terças/etc. {mesReferenciaLabel ?? "o mês"} tem). A soma dos 5 dias é a Receita mensal projetada da linha acima.
                  </p>
                </>
              )}

              {visao === "terapia" && (
                <>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-2 font-semibold">Terapia</th>
                        <th className="py-1 px-2 text-right font-semibold">% Sessões</th>
                        <th className="py-1 px-2 text-right font-semibold">Sessões/sem</th>
                        <th className="py-1 px-2 text-right font-semibold">Sem valor</th>
                        <th className="py-1 px-2 text-right font-semibold">Valor médio/sessão</th>
                        <th className="py-1 px-2 text-right font-semibold">Receita/sem</th>
                        <th className="py-1 pl-2 text-left font-semibold">Origem da regra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.porTerapia.length === 0 && (
                        <tr><td colSpan={7} className="py-2 text-center text-muted-foreground">Sem sessões pra detalhar.</td></tr>
                      )}
                      {(() => {
                        // % sobre o total de sessões/semana de TODAS as terapias do
                        // convênio (não c.sessoesTotal direto — este é bruto/sem
                        // normalizar por semana, e daria uma razão errada se a janela
                        // buscada cobrisse mais de 1 semana).
                        const totalSessoesSemana = c.porTerapia.reduce((s, t) => s + t.sessoesSemana, 0)
                        return c.porTerapia.map(t => (
                          <tr key={`${t.terapiaId ?? "sem-id"}-${t.terapiaNome}`} className="border-t border-border/40">
                            <td className="py-1 pr-2 font-medium text-foreground">
                              {t.terapiaNome}{t.terapiaId !== null && <span className="text-muted-foreground"> (ID {t.terapiaId})</span>}
                            </td>
                            <td className="py-1 px-2 text-right tabular-nums">
                              {totalSessoesSemana > 0 ? fmtNum((t.sessoesSemana / totalSessoesSemana) * 100) : "—"}%
                            </td>
                            <td className="py-1 px-2 text-right tabular-nums">{fmtNum(t.sessoesSemana)}</td>
                            <td className={`py-1 px-2 text-right tabular-nums ${t.sessoesSemValor > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>
                              {t.sessoesSemValor > 0 ? t.sessoesSemValor : "—"}
                            </td>
                            <td className="py-1 px-2 text-right tabular-nums font-semibold">
                              {t.valorMedioPorSessao !== null ? fmtReal(t.valorMedioPorSessao) : "—"}
                            </td>
                            <td className="py-1 px-2 text-right tabular-nums">{fmtReal(t.receitaSemana)}</td>
                            <td className="py-1 pl-2 text-left text-muted-foreground">
                              {t.origens.map(o => ORIGEM_LABEL[o] ?? o).join(" + ")}
                            </td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    "Origem" com mais de um valor (ex.: "Regra por terapia + Exceção paciente") indica que sessões da MESMA terapia tiveram valor de fontes diferentes — normalmente porque um paciente específico tem exceção cadastrada que se sobrepôs à regra geral/por terapia desse convênio.
                  </p>
                </>
              )}

              {visao === "paciente" && (
                <>
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-card">
                        <tr className="text-left text-muted-foreground">
                          <SortableTh label="ID Paciente" sortKey="pacienteId" activeKey={sortPaciente.key} dir={sortPaciente.dir} onClick={onSortClick} />
                          <SortableTh label="Paciente" sortKey="pacienteNome" activeKey={sortPaciente.key} dir={sortPaciente.dir} onClick={onSortClick} />
                          <SortableTh label="Sessões no mês" sortKey="sessoesCount" activeKey={sortPaciente.key} dir={sortPaciente.dir} align="right" onClick={onSortClick} />
                          <SortableTh label="Faltas no mês" sortKey="faltasCount" activeKey={sortPaciente.key} dir={sortPaciente.dir} align="right" onClick={onSortClick} />
                          <SortableTh label="Receita Mês Projetada Sem Deduções" sortKey="valorSemDeducao" activeKey={sortPaciente.key} dir={sortPaciente.dir} align="right" onClick={onSortClick} />
                          <SortableTh label="Deduções por Falta" sortKey="deducaoFalta" activeKey={sortPaciente.key} dir={sortPaciente.dir} align="right" onClick={onSortClick} />
                          <SortableTh label="Receita Mês Projetada Com Deduções" sortKey="valorComDeducao" activeKey={sortPaciente.key} dir={sortPaciente.dir} align="right" onClick={onSortClick} />
                        </tr>
                      </thead>
                      <tbody>
                        {pacientesAgregados.length === 0 && (
                          <tr><td colSpan={7} className="py-2 text-center text-muted-foreground">Sem sessões pra detalhar.</td></tr>
                        )}
                        {pacientesAgregados.map(p => (
                          <PacienteRow
                            key={p.chave}
                            p={p}
                            convenio={c.convenio}
                            aberto={pacienteAberto === p.chave}
                            onToggle={onTogglePaciente}
                            sessaoSelecionada={sessaoSelecionada}
                            onSelectSessao={onSelectSessao}
                            valorPacotePorTerapia={valorPacotePorTerapia}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Diferente de "Por dia da semana" e "Por terapia" (semana de referência), esta aba mostra o <strong>mês inteiro</strong> — uma linha por paciente, com todas as sessões e faltas do mês de {mesReferenciaLabel ?? "referência"}. Clique no nome do paciente pra destrinchar sessão por sessão. Clique num cabeçalho de coluna pra ordenar.
                  </p>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

interface TabelaPorConvenioProps {
  titulo: string
  segmento: PrevisaoReceitaSegmento
  mesReferenciaLabel: string | null
  /** Mostra o aviso de valor médio estimado na linha do convênio "Particular" — só faz sentido no segmento Multidisciplinar. */
  avisoParticular?: boolean
  /** Mostra o aviso de valor à vista padrão + falta de datas início/fim do processo — só faz sentido no segmento Processo Diagnóstico. */
  avisoPacote?: boolean
  /** Sessões do mês inteiro por convênio (chave = nome do convênio) — fonte da aba "Por paciente" de cada ConvenioRow. */
  sessoesMensaisPorConvenio: Map<string, PrevisaoReceitaSessao[]>
  /** true só pra Multidisciplinar — ver agregarPorPaciente. */
  aplicaDeducaoFalta?: boolean
}

function TabelaPorConvenio({ titulo, segmento, mesReferenciaLabel, avisoParticular, avisoPacote, sessoesMensaisPorConvenio, aplicaDeducaoFalta = false }: TabelaPorConvenioProps) {
  // Seleção de linha em "Por sessão" — só destaque visual pra apresentação
  // (ex.: marcar em verde o que está sendo mostrado ao vivo), não é gravado em
  // lugar nenhum, some ao dar refresh. Só uma linha por vez em todo o
  // segmento: selecionar outra desmarca a anterior, mesmo em convênio diferente.
  const [sessaoSelecionada, setSessaoSelecionada] = useState<string | null>(null)
  const onSelectSessao = useCallback((chave: string) => {
    setSessaoSelecionada(prev => (prev === chave ? null : chave))
  }, [])

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="text-sm font-bold text-foreground">{titulo}</div>
        {mesReferenciaLabel && (
          <div className="text-[11px] text-muted-foreground">
            Mês de referência da projeção: <strong className="text-foreground">{mesReferenciaLabel}</strong> — clique num convênio pra ver o detalhamento por dia da semana, terapia ou sessão
          </div>
        )}
      </div>
      {avisoPacote && (
        <AvisoAtencao>
          Para todos os convênios abaixo foi utilizado por padrão o <strong>valor à vista</strong> cadastrado, tornando o cálculo uma estimativa. Também seria interessante coletar as <strong>datas de início e fim previstas do processo</strong> para que o valor integral da Avaliação Neuropsicológica não seja imputado na previsão mensal — porque hoje ocorre de o critério ser: constar valor cheio se a semana analisada contém uma sessão daquela especialidade.
        </AvisoAtencao>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-semibold">Convênio</th>
              <th className="py-1.5 px-2 text-right font-semibold">Pacientes</th>
              <th className="py-1.5 px-2 text-right font-semibold">Sessões/mês</th>
              <th className="py-1.5 px-2 text-right font-semibold">Sem valor</th>
              <th className="py-1.5 px-2 text-right font-semibold">Receita semanal</th>
              <th className="py-1.5 px-2 text-right font-semibold">Receita Mês Projetada Sem Deduções</th>
              <th className="py-1.5 px-2 text-right font-semibold">Deduções por falta</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Receita Mês Projetada Com Deduções</th>
            </tr>
          </thead>
          <tbody>
            {segmento.porConvenio.length === 0 && (
              <tr><td colSpan={8} className="py-3 text-center text-muted-foreground">Sem sessões no período.</td></tr>
            )}
            {segmento.porConvenio.map(c => (
              <ConvenioRow
                key={c.convenio}
                c={c}
                mesReferenciaLabel={mesReferenciaLabel}
                sessaoSelecionada={sessaoSelecionada}
                onSelectSessao={onSelectSessao}
                avisoParticular={avisoParticular}
                porSessaoMes={sessoesMensaisPorConvenio.get(c.convenio) ?? []}
                aplicaDeducaoFalta={aplicaDeducaoFalta}
              />
            ))}
          </tbody>
        </table>
      </div>
      {segmento.sessoesSemValor > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          "Sem valor" = sessões desse segmento sem regra de Valor Sessão cadastrada em <strong>Cadastro de Valores</strong> pra esse convênio/terapia/paciente. Não entram na receita projetada acima.
        </p>
      )}
    </div>
  )
}

/** Mês seguinte ao atual — abertura padrão da tela, mesmo mês que getRefWeek() já usava antes de existir o seletor. */
function mesSeguinteAtual(): { ano: number; mes: number } {
  const hoje = new Date()
  const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

export function PrevisaoReceitasShell() {
  const [periodo, setPeriodo] = useState(mesSeguinteAtual)
  const semanaRef = useMemo(() => getRefWeekDoMes(periodo.ano, periodo.mes), [periodo.ano, periodo.mes])

  const { linhas, loading: loadingSalas, error: errorSalas } = useOcupacaoSalas(semanaRef.inicio, semanaRef.fim)
  const { regrasGerais, excecoesPaciente, pacotesAvaliacao, loading: loadingValores, error: errorValores } = useConvenioValoresCalculo()
  const { feriados, loading: loadingFeriados } = useFeriados()

  // Filtro por Unidade — vazio = todas. Só funciona no cálculo ao vivo (mês
  // atual/futuro); no modo histórico (ver usarHistorico abaixo) é ignorado,
  // já que o retrato congelado não guarda a unidade da sessão.
  const [unidadesFiltro, setUnidadesFiltro] = useState<string[]>([])

  // `unidade_nome` em csv_grades_profissionais é sempre o nome da clínica
  // ("CLÍNICA UNIVERSO ABA"), não a unidade física — a unidade real só existe
  // dentro do texto livre de `sala_nome` (ex.: "Unid. Realengo - Sala 5"),
  // mesmo padrão usado em pacientesDashboard.ts (Dashboard de Pacientes) e em
  // ocupacaoProf.ts (Ocupação por Profissional).
  const unidadeDaLinha = (r: { sala_nome: string | null }) => normalizarUnidadeOcupacao(r.sala_nome || "")

  // Opções vêm de linhasMes (mês inteiro) SEM aplicar o próprio filtro, senão
  // a lista de opções encolheria conforme o usuário marca unidades.
  const { linhasMes, faltas, loading: loadingMes, error: errorMes } = useLinhasMesInteiro(periodo.ano, periodo.mes)
  const unidadesDisponiveis = useMemo(
    () => [...new Set(linhasMes.map(unidadeDaLinha))].sort(),
    [linhasMes],
  )

  const linhasFiltradas = useMemo(
    () => unidadesFiltro.length ? linhas.filter(r => unidadesFiltro.includes(unidadeDaLinha(r))) : linhas,
    [linhas, unidadesFiltro],
  )
  const linhasMesFiltradas = useMemo(
    () => unidadesFiltro.length ? linhasMes.filter(r => unidadesFiltro.includes(unidadeDaLinha(r))) : linhasMes,
    [linhasMes, unidadesFiltro],
  )

  const previsaoBase = useMemo(
    () => calcularPrevisaoReceita(linhasFiltradas, regrasGerais, excecoesPaciente, pacotesAvaliacao, feriados),
    [linhasFiltradas, regrasGerais, excecoesPaciente, pacotesAvaliacao, feriados],
  )

  const previsao = useMemo(
    () => enriquecerComDeducaoFalta(previsaoBase, linhasMesFiltradas, faltas, regrasGerais, excecoesPaciente),
    [previsaoBase, linhasMesFiltradas, faltas, regrasGerais, excecoesPaciente],
  )

  // Sessões do mês inteiro por convênio, pra aba "Por paciente" mostrar TODAS
  // as sessões/faltas do mês (não só as da semana de referência) — "Por dia
  // da semana"/"Por terapia" continuam usando a amostra semanal de `previsao`.
  const sessoesMensais = useMemo(
    () => calcularSessoesMensaisPorConvenio(linhasMesFiltradas, regrasGerais, excecoesPaciente, pacotesAvaliacao, faltas),
    [linhasMesFiltradas, regrasGerais, excecoesPaciente, pacotesAvaliacao, faltas],
  )

  const mesSelecionadoLabel = labelMesAno(periodo.ano, periodo.mes)
  const hoje = new Date()
  const chaveMesSelecionado = periodo.ano * 12 + periodo.mes
  const chaveMesAtual = hoje.getFullYear() * 12 + (hoje.getMonth() + 1)
  const mesEhFuturo = chaveMesSelecionado > chaveMesAtual
  const mesEhPassado = chaveMesSelecionado < chaveMesAtual

  // Etapa 4: mês já passado usa o retrato histórico congelado (mais fiel —
  // dados reais do mês inteiro, sem depender de regras de valor que podem ter
  // mudado desde então) em vez de recalcular ao vivo. Só busca quando faz
  // sentido (mês passado) — pra outros meses o hook simplesmente não é usado.
  const competenciaSelecionada = `${periodo.ano}-${String(periodo.mes).padStart(2, "0")}`
  const historico = usePrevisaoReceitasHistorico(mesEhPassado ? competenciaSelecionada : null)
  const usarHistorico = mesEhPassado && historico.disponivel

  const previsaoHistorico = useMemo<PrevisaoReceitaGeral | null>(() => {
    if (!usarHistorico || !historico.sessoes) return null
    return {
      mesReferencia: { ano: periodo.ano, mes: periodo.mes, label: mesSelecionadoLabel },
      multidisciplinar: agregarSegmentoHistorico(historico.sessoes.multidisciplinar, true),
      processoDiagnostico: agregarSegmentoHistorico(historico.sessoes.processoDiagnostico, false),
    }
  }, [usarHistorico, historico.sessoes, periodo.ano, periodo.mes, mesSelecionadoLabel])

  const previsaoExibida = previsaoHistorico ?? previsao

  // No modo histórico, "Por paciente" usa a mesma sessão já agregada por
  // convênio em previsaoExibida (não tem distinção semana/mês — é tudo real).
  const sessoesMensaisExibidas = useMemo(() => {
    if (!previsaoHistorico) return sessoesMensais
    const paraMapa = (segmento: PrevisaoReceitaSegmento) => new Map(segmento.porConvenio.map(c => [c.convenio, c.porSessao]))
    return {
      multidisciplinar: paraMapa(previsaoHistorico.multidisciplinar),
      processoDiagnostico: paraMapa(previsaoHistorico.processoDiagnostico),
    }
  }, [previsaoHistorico, sessoesMensais])

  const loading = loadingSalas || loadingValores || loadingFeriados || loadingMes || (mesEhPassado && historico.loading)
  const error = errorSalas || errorValores || errorMes || historico.error

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando sessões e valores cadastrados...
      </div>
    )
  }
  if (error) return <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>

  const receitaMensalSemDeducao = previsaoExibida.multidisciplinar.receitaMensalProjetadaTotal + previsaoExibida.processoDiagnostico.receitaMensalProjetadaTotal
  const receitaMensalComDeducao = previsaoExibida.multidisciplinar.receitaMensalComDeducaoTotal + previsaoExibida.processoDiagnostico.receitaMensalComDeducaoTotal
  const receitaSemanalTotal = previsaoExibida.multidisciplinar.receitaSemanalTotal + previsaoExibida.processoDiagnostico.receitaSemanalTotal
  const sessoesTotal = previsaoExibida.multidisciplinar.sessoesTotal + previsaoExibida.processoDiagnostico.sessoesTotal
  const sessoesSemValor = previsaoExibida.multidisciplinar.sessoesSemValor + previsaoExibida.processoDiagnostico.sessoesSemValor

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeletorMesPrevisao ano={periodo.ano} mes={periodo.mes} onChange={(ano, mes) => setPeriodo({ ano, mes })} />
          <UnidadeMultiSelect label="Unidades" values={unidadesFiltro} options={unidadesDisponiveis} onChange={setUnidadesFiltro} disabled={usarHistorico} />
        </div>
        {usarHistorico && historico.snapshotData && (
          <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
            📅 Histórico — retrato de {fmtData(historico.snapshotData)}
          </span>
        )}
        {usarHistorico && (
          <span className="text-[11px] text-muted-foreground">
            Filtro por unidade não disponível pra meses passados (retrato histórico não guarda a unidade da sessão).
          </span>
        )}
        {mesEhPassado && !usarHistorico && (
          <span className="text-[11px] text-muted-foreground">
            {mesSelecionadoLabel} já passou e ainda não tem retrato histórico congelado — valores recalculados agora com as regras vigentes hoje.
          </span>
        )}
        {mesEhFuturo && (
          <span className="text-[11px] text-muted-foreground">
            {mesSelecionadoLabel} ainda não ocorreu — deduções por falta ficam em zero até o mês começar.
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard tone="amber" icon={<Wallet size={15} />} label="Receita Mês Projetada Sem Deduções">
          <div className="text-2xl font-black text-foreground">{fmtReal(receitaMensalSemDeducao)}</div>
        </StatCard>
        <StatCard tone="green" icon={<Wallet size={15} />} label="Receita Mês Projetada Com Deduções">
          <div className="text-2xl font-black text-foreground">{fmtReal(receitaMensalComDeducao)}</div>
        </StatCard>
        <StatCard tone="blue" icon={<Wallet size={15} />} label="Receita semanal projetada">
          <div className="text-2xl font-black text-foreground">{fmtReal(receitaSemanalTotal)}</div>
        </StatCard>
        <StatCard tone="slate" icon={<CalendarDays size={15} />} label={usarHistorico ? "Sessões no mês" : "Sessões/semana"}>
          <div className="text-2xl font-black text-foreground">{sessoesTotal}</div>
        </StatCard>
        <StatCard tone="red" icon={<AlertTriangle size={15} />} label="Sessões sem valor cadastrado">
          <div className="text-2xl font-black text-foreground">{sessoesSemValor}</div>
        </StatCard>
      </div>

      <TabelaPorConvenio
        titulo="Por Convênio (Multidisciplinar)"
        segmento={previsaoExibida.multidisciplinar}
        mesReferenciaLabel={mesSelecionadoLabel}
        sessoesMensaisPorConvenio={sessoesMensaisExibidas.multidisciplinar}
        aplicaDeducaoFalta
        avisoParticular={!usarHistorico}
      />
      <TabelaPorConvenio
        titulo="Por Convênio (Processo Diagnóstico)"
        segmento={previsaoExibida.processoDiagnostico}
        mesReferenciaLabel={mesSelecionadoLabel}
        sessoesMensaisPorConvenio={sessoesMensaisExibidas.processoDiagnostico}
        avisoPacote={!usarHistorico}
      />
    </div>
  )
}
