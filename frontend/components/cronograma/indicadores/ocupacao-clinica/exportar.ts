// Exportação XLSX da Ocupação Clínica. Mantém as colunas que a planilha antiga
// já tinha (salas, slots, % por slot) e acrescenta as cinco situações (em
// vagas de 40 min, com os mesmos nomes da tela), o recorte dia × turno e as
// pessoas de cada situação.

import * as XLSX from "xlsx"
import { DOW_PT } from "@/lib/cronograma/ocupacaoConst"
import { normalizarUnidadeOcupacao } from "@/lib/cronograma/ocupacaoProf"
import { resumoOcupacaoDeItens } from "@/lib/cronograma/salas"
import { CAPACIDADE_LABEL_CURTO, capacidadeProjetadaSala, type SalaComOcupacao } from "@/lib/cronograma/salasTypes"
import {
  comProfissional,
  contagemVazia,
  feriadoDoTurno,
  pctAproveitamento,
  pctComPaciente,
  pctComProfissional,
  type ContagemCadeiras,
  type FechamentoDia,
  type OcupacaoClinicaUnidade,
  type PendenciaProfissional,
} from "@/lib/cronograma/ocupacaoClinica"

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10)

function colunasContagem(c: ContagemCadeiras) {
  return {
    Vagas_40min: c.total,
    Com_Paciente: c.paciente,
    Livre_para_Agendar: c.aberta,
    Administrativo: c.administrativo,
    Reservada_sem_Agenda: c.regularizar,
    Sem_Profissional: c.vazia,
    Com_Profissional: comProfissional(c),
    Pct_Com_Profissional: pct(pctComProfissional(c)),
    Pct_Com_Paciente: pct(pctComPaciente(c)),
    Pct_Profissional_com_Paciente: pct(pctAproveitamento(c)),
  }
}

export function exportarOcupacaoClinica(args: {
  unidades: OcupacaoClinicaUnidade[]
  salasComOcupacao: SalaComOcupacao[]
  fechamentos: FechamentoDia[]
  rotuloStatus: (codigo: string) => string
  inicio: string
  fim: string
}) {
  const { unidades, salasComOcupacao, fechamentos, rotuloStatus, inicio, fim } = args
  const coluna = (codigo: string) => `Salas_${rotuloStatus(codigo).replace(/[^A-Za-z0-9]+/g, "_")}`
  const statusExistentes = [...new Set(unidades.flatMap(u => Object.keys(u.porStatus)))].sort()
  const itensDaUnidade = (u: string) => salasComOcupacao.filter(i => normalizarUnidadeOcupacao(i.sala.unidade_nome) === u)

  const porUnidade = unidades.map(u => {
    const slot = resumoOcupacaoDeItens(itensDaUnidade(u.unidade))
    return {
      Unidade: u.unidade,
      Fora_do_total: u.terceirizada ? "sim" : "",
      Salas_Total: u.salasTotal,
      Salas_Em_Uso: u.salasOperacionais,
      ...Object.fromEntries(statusExistentes.map(c => [coluna(c), u.porStatus[c] ?? 0])),
      Salas_Individuais: u.salasPorCapacidade.unico,
      Salas_Duplas: u.salasPorCapacidade.duplo,
      Salas_Multiplas: u.salasPorCapacidade.multiplo,
      Profissionais_ao_Mesmo_Tempo: u.atendimentosSimultaneos,
      ...colunasContagem(u.contagem),
      Reservada_sem_Agenda_no_Turno: u.regularizarPorMotivo.semAgendaNoTurno,
      Reservada_Atende_Parte_do_Turno: u.regularizarPorMotivo.foraDoHorario,
      Sessoes_sem_Sala_Definida: u.semSalaDefinida.sessoes,
      Profissionais: u.profissionaisAlocados,
      Pacientes: u.pacientes,
      Salas_com_Conflito: u.inconsistencias,
      Slots_Ocupados: slot.slotsOcupados,
      Slots_Total: slot.slotsTotal,
      Pct_Slots_com_Profissional: pct(slot.pct),
    }
  })

  const porTurno = unidades.flatMap(u => (["Manhã", "Tarde"] as const).map(t => ({
    Unidade: u.unidade,
    Turno: t,
    ...colunasContagem(u.porTurno[t]),
  })))

  const porDiaTurno = unidades.flatMap(u => {
    const dias = u.dias.length ? u.dias : [1, 2, 3, 4, 5]
    return dias.flatMap(d => (["Manhã", "Tarde"] as const).map(t => ({
      Unidade: u.unidade,
      Dia: DOW_PT[d],
      Turno: t,
      Feriado: feriadoDoTurno(fechamentos, d, t) ?? "",
      ...colunasContagem(u.porDiaTurno[`${d}|${t}`] ?? contagemVazia()),
    })))
  })

  const situacaoPorSala = new Map(unidades.flatMap(u => u.porSala.map(s => [s.salaId, s.contagem] as const)))
  const porSala = salasComOcupacao.map(item => {
    const { sala } = item
    const slot = resumoOcupacaoDeItens([item])
    return {
      Unidade: normalizarUnidadeOcupacao(sala.unidade_nome),
      Sala: sala.nome_exibicao,
      Numero_Sala: sala.numero_sala,
      Capacidade: CAPACIDADE_LABEL_CURTO[sala.capacidade],
      Status: rotuloStatus(sala.status),
      Profissionais_ao_Mesmo_Tempo: capacidadeProjetadaSala(sala.capacidade, sala.status),
      ...colunasContagem(situacaoPorSala.get(sala.id) ?? contagemVazia()),
      Slots_Ocupados: slot.slotsOcupados,
      Slots_Total: slot.slotsTotal,
      Pct_Slots_com_Profissional: pct(slot.pct),
      Conflitos: slot.inconsistencias,
    }
  }).sort((a, b) => {
    const cmp = a.Unidade.localeCompare(b.Unidade, "pt-BR")
    if (cmp !== 0) return cmp
    const na = parseInt(a.Numero_Sala, 10), nb = parseInt(b.Numero_Sala, 10)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.Numero_Sala.localeCompare(b.Numero_Sala, "pt-BR")
  })

  const linha = (unidade: string, situacao: string, medida: string) => (p: PendenciaProfissional) => ({
    Unidade: unidade, Situacao: situacao, Profissional: p.profissional, Terapia: p.terapia ?? "",
    Quantidade: p.horarios, Medida: medida, Salas: p.salas.join(", "), Turnos: p.turnos.join(", "),
  })
  const pessoas = unidades.flatMap(u => [
    ...u.pendencias.aberta.map(linha(u.unidade, "Livre para agendar", "vagas")),
    ...u.pendencias.administrativo.map(linha(u.unidade, "Administrativo", "vagas")),
    ...u.pendencias.regularizar.foraDoHorario.map(linha(u.unidade, "Atende só parte do turno", "vagas")),
    ...u.pendencias.regularizar.semAgendaNoTurno.map(linha(u.unidade, "Reservada sem nenhuma agenda no turno", "vagas")),
    ...u.semSalaDefinida.profissionais.map(linha(u.unidade, "Atende sem sala definida", "sessões")),
  ])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porUnidade), "Por unidade")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porTurno), "Por unidade e turno")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porDiaTurno), "Por dia e turno")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porSala), "Por sala")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pessoas), "Pessoas por situacao")
  XLSX.writeFile(wb, `Ocupacao_Clinica_${inicio}_a_${fim}.xlsx`)
}
