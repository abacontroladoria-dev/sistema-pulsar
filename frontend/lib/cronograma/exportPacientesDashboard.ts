// Export XLSX do Dashboard de Pacientes (indicadores?tab=pacientes) — mesmo
// padrão de lib/remuneracao/exportAnaliseFutura.ts: colunas Snake_Case, uma
// aba por tema, XLSX.writeFile no clique. Segue a MESMA separação por sessão
// de calcularDashboardPacientes (pacientesDashboard.ts): Multidisciplinar =
// toda sessão que não é Processo Diagnóstico; Processo Diagnóstico = só
// Avaliação Neuropsicológica/Psiquiatra-Neurologista. As abas agregadas usam
// os mesmos denominadores da tela (d.pacientesUnicos/d.chSemanalTotal do
// bloco inteiro, não a soma das linhas — ver comentário em
// PacientesDashboardShell.tsx) para os percentuais baterem com a UI.

import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import { isAgendadoAtivo, isTerapiaDiagnostico, chDaLinha } from "./pacientesDashboard"
import { normalizarUnidadeOcupacao } from "./ocupacaoProf"
import { cleanTxt } from "./helpers"
import { dowDeDiaSemana } from "./salas"
import type { AgendaSalaRow, DashboardPacientesGeral, ResumoPacientesGrupo, ResumoPacientesDia } from "./salasTypes"

const SEGMENTO_LABEL = {
  multidisciplinar: "Tratamento Multidisciplinar",
  processoDiagnostico: "Processo Diagnóstico",
} as const
type SegmentoKey = keyof typeof SEGMENTO_LABEL

function pctVal(valor: number, total: number): number | null {
  return total > 0 ? +((valor / total) * 100).toFixed(2) : null
}

function nomeArquivo(inicio: string, fim: string): string {
  return `Dashboard_Pacientes_${inicio}_a_${fim}`.replace(/[^A-Za-z0-9_]/g, "") + ".xlsx"
}

export interface ExportarPacientesOpts {
  linhas: AgendaSalaRow[]
  dashboard: DashboardPacientesGeral
  periodo: { inicio: string; fim: string }
}

export function exportarDashboardPacientesXlsx(opts: ExportarPacientesOpts): void {
  const { linhas, dashboard, periodo } = opts
  const ativos = (linhas || []).filter(isAgendadoAtivo)
  if (!ativos.length) {
    toast.error("Nenhuma sessão ativa no período para exportar.")
    return
  }

  const wb = XLSX.utils.book_new()
  const geradoEm = new Date()

  // ── Parametros ──────────────────────────────────────────────────────────
  const parametros = [
    { Parametro: "Periodo_Inicio", Valor: periodo.inicio },
    { Parametro: "Periodo_Fim", Valor: periodo.fim },
    { Parametro: "Gerado_Em", Valor: geradoEm.toISOString() },
    { Parametro: "Segmentacao", Valor: "Por SESSAO (nao por paciente) — ver Tratamento Multidisciplinar vs Processo Diagnostico" },
    { Parametro: "Limitacao_Convenio_Unidade", Valor: "csv_grades_profissionais nao guarda convenio_id/unidade_id — Convenio e Unidade sao texto; Unidade e derivada de sala_nome (unidade_nome na fonte e sempre CLINICA UNIVERSO ABA)" },
    { Parametro: "Limitacao_Pacientes_Unicos", Valor: "Pacientes_Unicos conta por NOME normalizado, nao por Paciente_ID — quando divergirem, o total da tela segue o nome" },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parametros), "Parametros")

  // ── Resumo por segmento ──────────────────────────────────────────────────
  const segmentos: SegmentoKey[] = ["multidisciplinar", "processoDiagnostico"]
  const resumoSegmento = segmentos.map(seg => {
    const d = dashboard[seg]
    return {
      Segmento: SEGMENTO_LABEL[seg],
      Pacientes_Unicos: d.pacientesUnicos,
      Sessoes_Total: d.sessoesTotal,
      CH_Semanal: +d.chSemanalTotal.toFixed(2),
      CH_Media_Mensal: +d.chMediaMensalTotal.toFixed(2),
      Sessoes_Por_Paciente: +d.mediaSessoesPorPaciente.toFixed(2),
    }
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoSegmento), "Resumo por segmento")

  // ── Por convenio / Por unidade ───────────────────────────────────────────
  function linhasGrupo(campo: "porConvenio" | "porUnidade", colunaChave: "Convenio" | "Unidade") {
    const linhas: Record<string, unknown>[] = []
    segmentos.forEach(seg => {
      const d = dashboard[seg]
      const grupos: ResumoPacientesGrupo[] = d[campo]
      grupos.forEach(g => {
        linhas.push({
          Segmento: SEGMENTO_LABEL[seg],
          [colunaChave]: g.chave,
          Pacientes_Unicos: g.pacientesUnicos,
          Pacientes_pct: pctVal(g.pacientesUnicos, d.pacientesUnicos),
          Sessoes_Total: g.sessoesTotal,
          CH_Semanal: +g.chSemanalTotal.toFixed(2),
          CH_Semanal_pct: pctVal(g.chSemanalTotal, d.chSemanalTotal),
          CH_Media_Mensal: +g.chMediaMensalTotal.toFixed(2),
          Sessoes_Por_Paciente: +g.mediaSessoesPorPaciente.toFixed(2),
        })
      })
    })
    return linhas
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasGrupo("porConvenio", "Convenio")), "Por convenio")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasGrupo("porUnidade", "Unidade")), "Por unidade")

  // ── Por dia da semana ────────────────────────────────────────────────────
  const porDiaLinhas: Record<string, unknown>[] = []
  segmentos.forEach(seg => {
    const d = dashboard[seg]
    d.porDia.forEach((linha: ResumoPacientesDia) => {
      porDiaLinhas.push({
        Segmento: SEGMENTO_LABEL[seg],
        Dow: linha.dow,
        Dia: linha.dia,
        Pacientes_Unicos: linha.pacientesUnicos,
        Sessoes_Total: linha.sessoesTotal,
        CH_Semanal: +linha.chSemanalTotal.toFixed(2),
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porDiaLinhas), "Por dia da semana")

  // ── Detalhe granular (com ids), derivado das linhas cruas ───────────────
  interface LinhaNormalizada {
    segmento: SegmentoKey
    r: AgendaSalaRow
    convenio: string
    unidade: string
    ch: number
    dow: number | null
  }
  const normalizadas: LinhaNormalizada[] = ativos.map(r => ({
    segmento: isTerapiaDiagnostico(r) ? "processoDiagnostico" : "multidisciplinar",
    r,
    convenio: cleanTxt(r.convenio_nome) || "Não informado",
    unidade: normalizarUnidadeOcupacao(r.sala_nome || ""),
    ch: chDaLinha(r),
    dow: dowDeDiaSemana(r.dia_semana),
  }))

  // Por paciente: uma linha por segmento × paciente × convênio × unidade —
  // chave composta pra manter toda célula atômica (sem juntar convênios/
  // unidades diferentes do mesmo paciente numa única linha).
  const porPacienteMap = new Map<string, {
    segmento: SegmentoKey
    pacienteId: number | null
    pacienteNome: string
    convenio: string
    unidade: string
    sessoes: number
    ch: number
  }>()
  normalizadas.forEach(n => {
    const pacienteNome = cleanTxt(n.r.paciente_nome) || "Não informado"
    const chave = `${n.segmento}::${n.r.paciente_id ?? `nome:${pacienteNome}`}::${n.convenio}::${n.unidade}`
    let entry = porPacienteMap.get(chave)
    if (!entry) {
      entry = {
        segmento: n.segmento, pacienteId: n.r.paciente_id ?? null, pacienteNome,
        convenio: n.convenio, unidade: n.unidade, sessoes: 0, ch: 0,
      }
      porPacienteMap.set(chave, entry)
    }
    entry.sessoes += 1
    entry.ch += n.ch
  })
  const porPacienteLinhas = Array.from(porPacienteMap.values()).map(e => ({
    Segmento: SEGMENTO_LABEL[e.segmento],
    Paciente_ID: e.pacienteId,
    Paciente_Nome: e.pacienteNome,
    Convenio: e.convenio,
    Unidade: e.unidade,
    Sessoes_Total: e.sessoes,
    CH_Total_Horas: +e.ch.toFixed(2),
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porPacienteLinhas), "Por paciente")

  // Sessoes (detalhe): uma linha por sessão, com todos os ids.
  const sessoesLinhas = normalizadas.map(n => ({
    Segmento: SEGMENTO_LABEL[n.segmento],
    Agendamento_ID: n.r.tita_agendamento_id,
    Paciente_ID: n.r.paciente_id,
    Paciente_Nome: cleanTxt(n.r.paciente_nome) || "Não informado",
    Convenio: n.convenio,
    Unidade: n.unidade,
    Sala: cleanTxt(n.r.sala_nome) || null,
    Profissional_ID: n.r.profissional_id,
    Profissional_Nome: cleanTxt(n.r.profissional_nome) || null,
    Terapia_ID: n.r.terapia_id,
    Terapia_Nome: cleanTxt(n.r.terapia_nome) || null,
    Terapia_Exibicao_ID: n.r.terapia_exibicao_id,
    Terapia_Exibicao_Nome: cleanTxt(n.r.terapia_exibicao_nome) || null,
    Dia_Semana: cleanTxt(n.r.dia_semana) || null,
    Dow: n.dow,
    Data: cleanTxt(n.r.data) || null,
    Hora_Inicial: cleanTxt(n.r.hora_inicial) || null,
    Hora_Final: cleanTxt(n.r.hora_final) || null,
    CH_Horas: +n.ch.toFixed(2),
    Status_Agendamento: cleanTxt(n.r.status_agendamento) || null,
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessoesLinhas), "Sessoes (detalhe)")

  XLSX.writeFile(wb, nomeArquivo(periodo.inicio, periodo.fim))
}
