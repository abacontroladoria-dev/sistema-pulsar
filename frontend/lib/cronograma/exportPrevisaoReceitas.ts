// Export XLSX da Previsão de Receitas (indicadores?tab=previsao-receitas) —
// mesmo padrão de lib/remuneracao/exportAnaliseFutura.ts: colunas Snake_Case,
// uma aba por tema, valores monetários como número cru (nunca fmtReal).
//
// "Exportar tudo" recalcula a previsão SEM o filtro de unidade, chamando as
// mesmas funções puras do motor (calcularPrevisaoReceita/
// enriquecerComDeducaoFalta/calcularSessoesMensaisPorConvenio) sobre `linhas`/
// `linhasMes` não filtradas — nenhuma delas muta os argumentos recebidos (ver
// faturamentoProjecao.ts), então isso nunca corrompe o que já está renderizado
// na tela. Em modo retrato histórico (usarHistorico) o recálculo NÃO se
// aplica: o snapshot já é "tudo" (não guarda unidade) e é sempre a fonte —
// nunca recalculamos ao vivo nesse modo, pra não divergir dos StatCards.

import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import {
  calcularPrevisaoReceita,
  enriquecerComDeducaoFalta,
  calcularSessoesMensaisPorConvenio,
  agregarPrevisaoPorPaciente,
  ORIGEM_VALOR_LABEL,
  type PrevisaoReceitaGeral,
  type PrevisaoReceitaSessao,
} from "./faturamentoProjecao"
import type { AgendaSalaRow } from "./salasTypes"
import type { ConvenioValor, ConvenioValorPaciente, ConvenioPacoteAvaliacao } from "./convenioValoresTypes"
import type { FeriadoInfo } from "@/types/feriados"

const SEGMENTO_LABEL = {
  multidisciplinar: "Multidisciplinar",
  processoDiagnostico: "Processo Diagnostico",
} as const
type SegmentoKey = keyof typeof SEGMENTO_LABEL
const SEGMENTOS: SegmentoKey[] = ["multidisciplinar", "processoDiagnostico"]

export type EscopoExport = "filtro" | "tudo"

export interface ExportarPrevisaoOpts {
  escopo: EscopoExport
  competencia: string
  mesReferenciaLabel: string | null
  periodo: { ano: number; mes: number }
  semanaRef: { inicio: string; fim: string }
  unidadesFiltro: string[]
  usarHistorico: boolean
  snapshotData: string | null
  /** Previsão já calculada — respeitando o filtro atual (o que a tela mostra). */
  previsaoExibida: PrevisaoReceitaGeral
  /** Sessões do mês inteiro por convênio — respeitando o filtro atual. */
  sessoesMensaisExibidas: { multidisciplinar: Map<string, PrevisaoReceitaSessao[]>; processoDiagnostico: Map<string, PrevisaoReceitaSessao[]> }
  /** Necessários só para recalcular no modo "tudo" (ignorados em modo histórico). */
  linhas: AgendaSalaRow[]
  linhasMes: AgendaSalaRow[]
  faltas: Set<number>
  regrasGerais: ConvenioValor[]
  excecoesPaciente: ConvenioValorPaciente[]
  pacotesAvaliacao: ConvenioPacoteAvaliacao[]
  feriados: Record<string, FeriadoInfo>
}

function nomeAba(base: string): string {
  // Limite de 31 chars do Excel — nenhum nome usado aqui chega perto, mas a
  // função existe pra centralizar a checagem caso a lista cresça.
  return base.length > 31 ? base.slice(0, 31) : base
}

function nomeArquivo(competencia: string, escopo: EscopoExport, usarHistorico: boolean): string {
  const sufixo = usarHistorico ? "_historico" : escopo === "tudo" ? "_todas_unidades" : ""
  return `Previsao_Receitas_${competencia}${sufixo}.xlsx`
}

/** true quando a sessão conta em "sessões sem valor" — pacote com valor à vista cadastrado NÃO conta, mesmo com valor por-sessão nulo. */
function contaSemValor(s: PrevisaoReceitaSessao): boolean {
  return s.semValor ?? (s.valor === null && s.origem !== "pacote_avaliacao")
}

export function exportarPrevisaoReceitasXlsx(opts: ExportarPrevisaoOpts): void {
  const {
    escopo, competencia, mesReferenciaLabel, unidadesFiltro, usarHistorico, snapshotData,
    previsaoExibida, sessoesMensaisExibidas,
    linhas, linhasMes, faltas, regrasGerais, excecoesPaciente, pacotesAvaliacao, feriados,
  } = opts

  // Em modo histórico o recálculo nunca se aplica — o snapshot já é "tudo" e
  // é sempre a única fonte (o retrato não guarda unidade da sessão).
  const recalcularTudo = escopo === "tudo" && !usarHistorico

  let previsao = previsaoExibida
  let sessoesMensais = sessoesMensaisExibidas
  if (recalcularTudo) {
    const base = calcularPrevisaoReceita(linhas, regrasGerais, excecoesPaciente, pacotesAvaliacao, feriados)
    previsao = enriquecerComDeducaoFalta(base, linhasMes, faltas, regrasGerais, excecoesPaciente)
    sessoesMensais = calcularSessoesMensaisPorConvenio(linhasMes, regrasGerais, excecoesPaciente, pacotesAvaliacao, faltas)
  }

  const totalSessoes = SEGMENTOS.reduce((s, seg) => s + previsao[seg].sessoesTotal, 0)
  if (!totalSessoes) {
    toast.error("Nenhuma sessão no período selecionado para exportar.")
    return
  }

  const wb = XLSX.utils.book_new()
  const geradoEm = new Date()

  // ── Parametros ──────────────────────────────────────────────────────────
  const parametros: { Parametro: string; Valor: string }[] = [
    { Parametro: "Competencia", Valor: competencia },
    { Parametro: "Mes_Referencia", Valor: mesReferenciaLabel ?? "" },
    { Parametro: "Modo", Valor: usarHistorico ? `Retrato historico (snapshot de ${snapshotData ?? "data desconhecida"})` : "Calculado ao vivo" },
    { Parametro: "Escopo_Selecionado", Valor: escopo === "tudo" ? "Todas as unidades do mes selecionado" : "Conforme o filtro ativo na tela" },
    { Parametro: "Gerado_Em", Valor: geradoEm.toISOString() },
    {
      Parametro: "Limitacao_Pacote_Avaliacao",
      Valor: "Sessoes de Avaliacao Neuropsicologica/Psiquiatra tem Valor vazio no detalhe — o pacote e cobrado 1x por paciente (ver aba Pacotes avaliacao), nao por sessao",
    },
  ]
  if (usarHistorico) {
    parametros.push({ Parametro: "Aviso_Unidade", Valor: "Retrato historico nao guarda unidade/profissional da sessao — colunas Unidade/Profissional do detalhe ficam vazias" })
  }
  if (!unidadesFiltro.length) {
    parametros.push({ Parametro: "Unidade_Filtrada", Valor: "Todas (nenhum filtro ativo na tela)" })
  } else {
    unidadesFiltro.forEach(u => parametros.push({ Parametro: "Unidade_Filtrada", Valor: u }))
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parametros), nomeAba("Parametros"))

  // ── Resumo geral ─────────────────────────────────────────────────────────
  const resumoGeral: { Segmento: string; Sessoes_Total: number; Sessoes_Sem_Valor: number; Receita_Semanal: number; Receita_Mes_Projetada: number; Receita_Mes_Com_Deducao: number }[] = SEGMENTOS.map(seg => {
    const s = previsao[seg]
    return {
      Segmento: SEGMENTO_LABEL[seg],
      Sessoes_Total: s.sessoesTotal,
      Sessoes_Sem_Valor: s.sessoesSemValor,
      Receita_Semanal: +s.receitaSemanalTotal.toFixed(2),
      Receita_Mes_Projetada: +s.receitaMensalProjetadaTotal.toFixed(2),
      Receita_Mes_Com_Deducao: +s.receitaMensalComDeducaoTotal.toFixed(2),
    }
  })
  resumoGeral.push({
    Segmento: "Total geral",
    Sessoes_Total: resumoGeral.reduce((s, r) => s + r.Sessoes_Total, 0),
    Sessoes_Sem_Valor: resumoGeral.reduce((s, r) => s + r.Sessoes_Sem_Valor, 0),
    Receita_Semanal: +resumoGeral.reduce((s, r) => s + r.Receita_Semanal, 0).toFixed(2),
    Receita_Mes_Projetada: +resumoGeral.reduce((s, r) => s + r.Receita_Mes_Projetada, 0).toFixed(2),
    Receita_Mes_Com_Deducao: +resumoGeral.reduce((s, r) => s + r.Receita_Mes_Com_Deducao, 0).toFixed(2),
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoGeral), nomeAba("Resumo geral"))

  // ── Por convenio ─────────────────────────────────────────────────────────
  const porConvenioLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    previsao[seg].porConvenio.forEach(c => {
      porConvenioLinhas.push({
        Segmento: SEGMENTO_LABEL[seg],
        Convenio: c.convenio,
        Pacientes_Unicos: c.pacientesUnicos,
        Sessoes_Total: c.sessoesTotal,
        Sessoes_Mes_Projetadas: +c.sessoesMesProjetadas.toFixed(2),
        Sessoes_Sem_Valor: c.sessoesSemValor,
        Receita_Semanal: +c.receitaSemanal.toFixed(2),
        Receita_Mes_Projetada: +c.receitaMensalProjetada.toFixed(2),
        Deducao_Falta: +c.deducaoFalta.toFixed(2),
        Receita_Mes_Com_Deducao: +c.receitaMensalComDeducao.toFixed(2),
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porConvenioLinhas), nomeAba("Por convenio"))

  // ── Por dia da semana ────────────────────────────────────────────────────
  const porDiaLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    previsao[seg].porConvenio.forEach(c => {
      c.porDia.forEach(d => {
        porDiaLinhas.push({
          Segmento: SEGMENTO_LABEL[seg],
          Convenio: c.convenio,
          Dow: d.dow,
          Dia: d.diaLabel,
          Sessoes_Semana: +d.sessoesSemana.toFixed(2),
          Ocorrencias_Mes: d.ocorrenciasMes,
          Sessoes_Mes_Projetadas: +d.sessoesMesProjetadas.toFixed(2),
          Receita_Semana: +d.receitaSemana.toFixed(2),
          Receita_Mes_Projetada: +d.receitaMesProjetada.toFixed(2),
        })
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porDiaLinhas), nomeAba("Por dia da semana"))

  // ── Por terapia / Origens da regra ───────────────────────────────────────
  const porTerapiaLinhas: Record<string, unknown>[] = []
  const origensLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    previsao[seg].porConvenio.forEach(c => {
      const totalSessoesSemana = c.porTerapia.reduce((s, t) => s + t.sessoesSemana, 0)
      c.porTerapia.forEach(t => {
        porTerapiaLinhas.push({
          Segmento: SEGMENTO_LABEL[seg],
          Convenio: c.convenio,
          Terapia_ID: t.terapiaId,
          Terapia_Nome: t.terapiaNome,
          Sessoes_Semana: +t.sessoesSemana.toFixed(2),
          Sessoes_pct: totalSessoesSemana > 0 ? +((t.sessoesSemana / totalSessoesSemana) * 100).toFixed(2) : null,
          Sessoes_Sem_Valor: t.sessoesSemValor,
          Valor_Medio_Sessao: t.valorMedioPorSessao !== null ? +t.valorMedioPorSessao.toFixed(2) : null,
          Receita_Semana: +t.receitaSemana.toFixed(2),
          Qtd_Origens: t.origens.length,
        })
        t.origens.forEach(o => {
          origensLinhas.push({
            Segmento: SEGMENTO_LABEL[seg],
            Convenio: c.convenio,
            Terapia_ID: t.terapiaId,
            Terapia_Nome: t.terapiaNome,
            Origem_Codigo: o,
            Origem_Label: ORIGEM_VALOR_LABEL[o] ?? o,
          })
        })
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porTerapiaLinhas), nomeAba("Por terapia"))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(origensLinhas), nomeAba("Origens da regra"))

  // ── Por paciente (mês inteiro) ───────────────────────────────────────────
  const porPacienteLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    const aplicaDeducaoFalta = seg === "multidisciplinar"
    previsao[seg].porConvenio.forEach(c => {
      const porSessaoMes = sessoesMensais[seg].get(c.convenio) ?? []
      agregarPrevisaoPorPaciente(porSessaoMes, aplicaDeducaoFalta).forEach(p => {
        porPacienteLinhas.push({
          Segmento: SEGMENTO_LABEL[seg],
          Convenio: c.convenio,
          Paciente_ID: p.pacienteId,
          Paciente_Nome: p.pacienteNome,
          Sessoes_Mes: p.sessoesCount,
          Faltas_Mes: p.faltasCount,
          Receita_Sem_Deducao: +p.valorSemDeducao.toFixed(2),
          Deducao_Falta: +p.deducaoFalta.toFixed(2),
          Receita_Com_Deducao: +p.valorComDeducao.toFixed(2),
        })
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porPacienteLinhas), nomeAba("Por paciente"))

  // ── Sessoes (detalhe) / Sessoes sem valor ────────────────────────────────
  const sessoesLinhas: Record<string, unknown>[] = []
  const semValorLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    previsao[seg].porConvenio.forEach(c => {
      const porSessaoMes = sessoesMensais[seg].get(c.convenio) ?? []
      porSessaoMes.forEach(s => {
        const linha = {
          Segmento: SEGMENTO_LABEL[seg],
          Convenio: c.convenio,
          Agendamento_ID: s.agendamentoId,
          Paciente_ID: s.pacienteId,
          Paciente_Nome: s.pacienteNome,
          Terapia_ID: s.terapiaId,
          Terapia_Nome: s.terapiaNome,
          Dia: s.diaLabel,
          Data: s.data,
          Hora_Inicial: s.horaInicial,
          Hora_Final: s.horaFinal ?? null,
          Valor: s.valor,
          Valor_Origem_Codigo: s.origem,
          Valor_Origem_Label: ORIGEM_VALOR_LABEL[s.origem] ?? s.origem,
          Em_Falta: s.emFalta ? "Sim" : "Não",
          Profissional_ID: s.profissionalId ?? null,
          Profissional_Nome: s.profissionalNome ?? null,
          Sala: s.salaNome ?? null,
          Unidade: s.unidade ?? null,
        }
        sessoesLinhas.push(linha)
        if (contaSemValor(s)) semValorLinhas.push(linha)
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessoesLinhas), nomeAba("Sessoes (detalhe)"))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(semValorLinhas), nomeAba("Sessoes sem valor"))

  // ── Pacotes avaliacao ────────────────────────────────────────────────────
  const pacotesLinhas: Record<string, unknown>[] = []
  SEGMENTOS.forEach(seg => {
    previsao[seg].porConvenio.forEach(c => {
      c.pacotesTerapia.forEach(p => {
        pacotesLinhas.push({
          Segmento: SEGMENTO_LABEL[seg],
          Convenio: c.convenio,
          Terapia_ID: p.terapiaId,
          Terapia_Nome: p.terapiaNome,
          Pacientes: p.pacientes,
          Valor_A_Vista: p.valorAVista,
          Receita: +p.receita.toFixed(2),
        })
      })
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pacotesLinhas), nomeAba("Pacotes avaliacao"))

  XLSX.writeFile(wb, nomeArquivo(competencia, escopo, usarHistorico))
}
