// ─── DASHBOARD DE PACIENTES ───────────────────────────────────────────────────
// Adaptado de calcularDashboardPacientes (calculadora-remuneracao/src/views/
// OcupacaoSalas/index.jsx, linha ~637). Consome diretamente linhas já buscadas
// de csv_grades_profissionais (sem upload manual de CSV/localStorage).

import { pm, cleanTxt } from "./helpers"
import { normalizarUnidadeOcupacao } from "./ocupacaoProf"
import { PROCESSO_DIAGNOSTICO_IDS, PROCESSO_DIAGNOSTICO_NAMES } from "./constants"
import { isFakePatient } from "../remuneracao/pacientes"
import { dowDeDiaSemana } from "./salas"
import { DOW_PT } from "./ocupacaoConst"
import { convenioDaLinha, type FonteConvenio, type MapaConvenioCadastro } from "./convenioCadastro"
import type { AgendaSalaRow, ResumoPacientesSalas, ResumoPacientesGrupo, ResumoPacientesDia, DashboardPacientesGeral, PacienteDoGrupo } from "./salasTypes"

export function chDaLinha(r: AgendaSalaRow): number {
  const ini = pm(r.hora_inicial)
  const fim = pm(r.hora_final)
  if (ini === null || fim === null || fim <= ini) return 0
  return (fim - ini) / 60
}

function pacienteKey(r: AgendaSalaRow): string {
  return cleanTxt(r.paciente_nome).toLowerCase()
}

interface AgendamentoNormalizado {
  pacienteKey: string
  pacienteId: number | null
  paciente: string
  convenio: string
  convenioFonte: FonteConvenio
  convenioAgenda: string
  terapia: string
  unidade: string
  ch: number
  data: string
  dow: number | null
}

export function isAgendadoAtivo(r: AgendaSalaRow): boolean {
  const status = cleanTxt(r.status_agendamento).toLowerCase()
  const paciente = cleanTxt(r.paciente_nome)
  if (!status.includes("agendado") || !paciente) return false
  // Pacientes fictícios (placeholders administrativos como "Horário Bloqueado",
  // "Supervisora X", "Paciente Teste X" etc.) não são pacientes reais — nunca
  // devem contar em sessões/pacientes ativos nem gerar receita projetada.
  if (isFakePatient(paciente, r.paciente_id !== null && r.paciente_id !== undefined ? String(r.paciente_id) : null)) return false
  return true
}

// Terapia de "Processo Diagnóstico" (Avaliação Neuropsicológica / Psiquiatra-
// Neurologista) — casa por terapia_id (ação), caindo pra terapia_exibicao_id
// quando a ação não tem id, e só recorre a nome (terapia_nome/terapia_exibicao_nome)
// como último fallback pra linhas antigas sem nenhum id. IDs são estáveis mesmo
// quando o nome de exibição da terapia é renomeado no TITA.
export function isTerapiaDiagnostico(r: AgendaSalaRow): boolean {
  if (r.terapia_id !== null && r.terapia_id !== undefined) return PROCESSO_DIAGNOSTICO_IDS.has(r.terapia_id)
  if (r.terapia_exibicao_id !== null && r.terapia_exibicao_id !== undefined) return PROCESSO_DIAGNOSTICO_IDS.has(r.terapia_exibicao_id)
  const acao = cleanTxt(r.terapia_nome)
  if (acao) return PROCESSO_DIAGNOSTICO_NAMES.has(acao)
  return PROCESSO_DIAGNOSTICO_NAMES.has(cleanTxt(r.terapia_exibicao_nome))
}

export function semanasNoPeriodo(datas: string[]): number {
  const ordenadas = [...datas].sort()
  if (!ordenadas.length) return 1
  const inicio = new Date(`${ordenadas[0]}T12:00:00`)
  const fim = new Date(`${ordenadas[ordenadas.length - 1]}T12:00:00`)
  const diasSpan = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1)
  return Math.max(1, diasSpan / 7)
}

function resumoGrupo(
  agendamentos: AgendamentoNormalizado[],
  campo: "convenio" | "unidade",
  semanas: number,
): ResumoPacientesGrupo[] {
  const grupos = new Map<string, { pacientes: Set<string>; sessoes: number; ch: number }>()
  agendamentos.forEach(a => {
    const chave = a[campo] || "Não informado"
    if (!grupos.has(chave)) grupos.set(chave, { pacientes: new Set(), sessoes: 0, ch: 0 })
    const g = grupos.get(chave)!
    g.pacientes.add(a.pacienteKey)
    g.sessoes += 1
    g.ch += a.ch
  })
  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      pacientesUnicos: g.pacientes.size,
      sessoesTotal: g.sessoes,
      chSemanalTotal: g.ch / semanas,
      chMediaMensalTotal: (g.ch / semanas) * 4.33,
      mediaSessoesPorPaciente: g.pacientes.size ? g.sessoes / g.pacientes.size : 0,
    }))
    .sort((a, b) => b.chSemanalTotal - a.chSemanalTotal)
}

/** Sessões/CH por dia útil (Seg–Sex), na mesma base recorrente semanal das demais colunas — agrupa pelo dia da grade (`dia_semana`), não pela data do registro. */
function resumoPorDia(agendamentos: AgendamentoNormalizado[], semanas: number): ResumoPacientesDia[] {
  const porDow = new Map<number, { pacientes: Set<string>; sessoes: number; ch: number }>()
  agendamentos.forEach(a => {
    if (a.dow === null) return
    if (!porDow.has(a.dow)) porDow.set(a.dow, { pacientes: new Set(), sessoes: 0, ch: 0 })
    const g = porDow.get(a.dow)!
    g.pacientes.add(a.pacienteKey)
    g.sessoes += 1
    g.ch += a.ch
  })
  return [1, 2, 3, 4, 5].map(dow => {
    const g = porDow.get(dow)
    return {
      dia: DOW_PT[dow],
      dow,
      pacientesUnicos: g?.pacientes.size ?? 0,
      sessoesTotal: g?.sessoes ?? 0,
      chSemanalTotal: (g?.ch ?? 0) / semanas,
    }
  })
}

function normalizarLinha(r: AgendaSalaRow, mapa: MapaConvenioCadastro | null | undefined): AgendamentoNormalizado {
  // Convênio pelo cadastro do TiTa quando disponível; sem mapa (ou sem o
  // paciente no cadastro) é o da agenda, como sempre foi. Ver convenioCadastro.ts.
  const conv = convenioDaLinha(r, mapa)
  return {
    pacienteKey: pacienteKey(r),
    pacienteId: r.paciente_id ?? null,
    paciente: cleanTxt(r.paciente_nome),
    convenio: conv.convenio,
    convenioFonte: conv.fonte,
    convenioAgenda: conv.convenioAgenda,
    terapia: cleanTxt(r.terapia_exibicao_nome) || cleanTxt(r.terapia_nome),
    // `unidade_nome` em csv_grades_profissionais é sempre o nome da clínica
    // ("CLÍNICA UNIVERSO ABA"), não a unidade física — a unidade real só
    // existe dentro do texto livre de `sala_nome` (ex.: "Unid. Realengo -
    // Sala 5", "AT Externo Escola"). normalizarUnidadeOcupacao já sabe
    // extrair isso por palavra-chave.
    unidade: normalizarUnidadeOcupacao(r.sala_nome || ""),
    ch: chDaLinha(r),
    data: cleanTxt(r.data),
    dow: dowDeDiaSemana(r.dia_semana),
  }
}

function montarResumo(agendamentos: AgendamentoNormalizado[]): ResumoPacientesSalas {
  const pacientesUnicos = new Set(agendamentos.map(a => a.pacienteKey)).size
  const semanas = semanasNoPeriodo(agendamentos.map(a => a.data).filter(Boolean))
  const chTotal = agendamentos.reduce((sum, a) => sum + a.ch, 0)
  const chSemanalTotal = chTotal / semanas

  // Um paciente só conta como "cadastro" se TODAS as sessões dele saíram do
  // cadastro — qualquer sessão no convênio da agenda o põe no outro balde.
  const fontePorPaciente = new Map<string, FonteConvenio>()
  agendamentos.forEach(a => {
    if (fontePorPaciente.get(a.pacienteKey) !== "agenda") fontePorPaciente.set(a.pacienteKey, a.convenioFonte)
  })
  let pacientesConvenioCadastro = 0
  fontePorPaciente.forEach(f => { if (f === "cadastro") pacientesConvenioCadastro++ })

  return {
    pacientesUnicos,
    sessoesTotal: agendamentos.length,
    chSemanalTotal,
    chMediaMensalTotal: chSemanalTotal * 4.33,
    mediaSessoesPorPaciente: pacientesUnicos ? agendamentos.length / pacientesUnicos : 0,
    porConvenio: resumoGrupo(agendamentos, "convenio", semanas),
    porUnidade: resumoGrupo(agendamentos, "unidade", semanas),
    porDia: resumoPorDia(agendamentos, semanas),
    fonteConvenio: { cadastro: pacientesConvenioCadastro, agenda: pacientesUnicos - pacientesConvenioCadastro },
  }
}

/**
 * Calcula os dois dashboards de pacientes ativos (CH, convênio, unidade) a
 * partir das linhas já buscadas de csv_grades_profissionais. A separação é por
 * SESSÃO (agendamento), não por paciente — uma sessão de Avaliação
 * Neuropsicológica ou Psiquiatra/Neurologista SEMPRE vai só pro "Processo
 * Diagnóstico", nunca soma nos totais/contadores do "Tratamento
 * Multidisciplinar", mesmo quando o paciente também faz outras terapias:
 *   - "Tratamento Multidisciplinar" (dashboard geral): todas as sessões QUE NÃO
 *     SÃO do grupo "Processo Diagnóstico". Um paciente cuja agenda inteira é
 *     feita só dessas duas terapias não sobra nenhuma sessão aqui, então some
 *     do dashboard geral por completo — exatamente o caso do exemplo (paciente
 *     do convênio X com só Avaliação Neuropsicológica/Psiquiatra não conta nos
 *     números do convênio X aqui, só no Processo Diagnóstico).
 *   - "Processo Diagnóstico": só as sessões de Avaliação Neuropsicológica /
 *     Psiquiatra-Neurologista, de QUALQUER paciente que as tenha — inclusive
 *     quem também aparece no dashboard multidisciplinar por causa de outras
 *     terapias (a sessão diagnóstica dele conta aqui, nunca lá).
 */
export function calcularDashboardPacientes(rows: AgendaSalaRow[], mapa?: MapaConvenioCadastro | null): DashboardPacientesGeral {
  const { multidisciplinar, processoDiagnostico } = normalizarPorSegmento(rows, mapa)
  return {
    multidisciplinar: montarResumo(multidisciplinar),
    processoDiagnostico: montarResumo(processoDiagnostico),
  }
}

function normalizarPorSegmento(rows: AgendaSalaRow[], mapa: MapaConvenioCadastro | null | undefined) {
  const ativos = (rows || []).filter(isAgendadoAtivo)
  return {
    multidisciplinar: ativos.filter(r => !isTerapiaDiagnostico(r)).map(r => normalizarLinha(r, mapa)),
    processoDiagnostico: ativos.filter(isTerapiaDiagnostico).map(r => normalizarLinha(r, mapa)),
  }
}

export type SegmentoPacientes = keyof DashboardPacientesGeral

/**
 * Pacientes de UMA linha das tabelas "convênio" / "Por unidade" (o clique em
 * "Ver pacientes"). Mesmo pipeline e mesma chave de `calcularDashboardPacientes`
 * — filtro, segmento por sessão, `pacienteKey` por nome normalizado — para a
 * lista ter exatamente o número da coluna "Pacientes" daquela linha. CH semanal
 * usa as semanas do BLOCO inteiro, como a tabela.
 */
export function listarPacientesDoGrupo(
  rows: AgendaSalaRow[],
  mapa: MapaConvenioCadastro | null | undefined,
  segmento: SegmentoPacientes,
  campo: "convenio" | "unidade",
  chave: string,
): PacienteDoGrupo[] {
  const doSegmento = normalizarPorSegmento(rows, mapa)[segmento]
  const semanas = semanasNoPeriodo(doSegmento.map(a => a.data).filter(Boolean))

  const porPaciente = new Map<string, {
    ids: Set<number>; nome: string; sessoes: number; ch: number
    terapias: Set<string>; outros: Set<string>; conveniosAgenda: Set<string>; fontes: Set<FonteConvenio>
  }>()
  doSegmento.forEach(a => {
    if ((a[campo] || "Não informado") !== chave) return
    let e = porPaciente.get(a.pacienteKey)
    if (!e) {
      e = { ids: new Set(), nome: a.paciente, sessoes: 0, ch: 0, terapias: new Set(), outros: new Set(), conveniosAgenda: new Set(), fontes: new Set() }
      porPaciente.set(a.pacienteKey, e)
    }
    if (a.pacienteId != null) e.ids.add(a.pacienteId)
    e.sessoes += 1
    e.ch += a.ch
    if (a.terapia) e.terapias.add(a.terapia)
    e.outros.add(campo === "convenio" ? a.unidade : a.convenio)
    e.conveniosAgenda.add(a.convenioAgenda)
    e.fontes.add(a.convenioFonte)
  })

  const ordenar = (s: Set<string>) => [...s].filter(Boolean).sort((x, y) => x.localeCompare(y, "pt-BR"))
  return [...porPaciente.values()]
    .map(e => {
      const conveniosAgenda = ordenar(e.conveniosAgenda)
      return {
        ids: [...e.ids].sort((x, y) => x - y),
        nome: e.nome,
        sessoes: e.sessoes,
        chSemanal: e.ch / semanas,
        terapias: ordenar(e.terapias),
        outraDimensao: ordenar(e.outros),
        conveniosAgenda,
        // Só faz sentido na lista por convênio: o cadastro deu um convênio
        // diferente do que a agenda registra para este paciente.
        atualizadoPeloCadastro: campo === "convenio" && e.fontes.has("cadastro") && conveniosAgenda.some(c => c !== chave),
      }
    })
    .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"))
}