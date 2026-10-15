// Exportação XLSX da Ocupação Clínica. Mantém as colunas que a planilha antiga
// já tinha (salas, slots, % por slot, blocos) e acrescenta as cinco situações,
// o recorte dia × turno e as pendências nominais.

import * as XLSX from "xlsx"
import { DOW_PT } from "@/lib/cronograma/ocupacaoConst"
import { normalizarUnidadeOcupacao } from "@/lib/cronograma/ocupacaoProf"
import { resumoOcupacaoDeItens } from "@/lib/cronograma/salas"
import { CAPACIDADE_LABEL_CURTO, capacidadeProjetadaSala, type SalaComOcupacao } from "@/lib/cronograma/salasTypes"
import {
  comProfissional,
  contagemVazia,
  pctAproveitamento,
  pctComPaciente,
  pctComProfissional,
  type ContagemCadeiras,
  type OcupacaoClinicaUnidade,
} from "@/lib/cronograma/ocupacaoClinica"

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10)

function colunasContagem(c: ContagemCadeiras) {
  return {
    Horarios_Cadeira: c.total,
    Com_Paciente: c.paciente,
    Agenda_Aberta: c.aberta,
    Administrativo: c.administrativo,
    A_Regularizar: c.regularizar,
    Sem_Profissional: c.vazia,
    Com_Profissional: comProfissional(c),
    Pct_Com_Profissional: pct(pctComProfissional(c)),
    Pct_Com_Paciente: pct(pctComPaciente(c)),
    Pct_Vira_Atendimento: pct(pctAproveitamento(c)),
  }
}

export function exportarOcupacaoClinica(args: {
  unidades: OcupacaoClinicaUnidade[]
  salasComOcupacao: SalaComOcupacao[]
  rotuloStatus: (codigo: string) => string
  inicio: string
  fim: string
}) {
  const { unidades, salasComOcupacao, rotuloStatus, inicio, fim } = args
  const coluna = (codigo: string) => `Salas_${rotuloStatus(codigo).replace(/[^A-Za-z0-9]+/g, "_")}`
  const statusExistentes = [...new Set(unidades.flatMap(u => Object.keys(u.porStatus)))].sort()
  const itensDaUnidade = (u: string) => salasComOcupacao.filter(i => normalizarUnidadeOcupacao(i.sala.unidade_nome) === u)

  const porUnidade = unidades.map(u => {
    const slot = resumoOcupacaoDeItens(itensDaUnidade(u.unidade))
    return {
      Unidade: u.unidade,
      Fora_do_total_da_rede: u.terceirizada ? "sim" : "",
      Salas_Total: u.salasTotal,
      Salas_Em_Uso: u.salasOperacionais,
      ...Object.fromEntries(statusExistentes.map(c => [coluna(c), u.porStatus[c] ?? 0])),
      Salas_Unico: u.salasPorCapacidade.unico,
      Salas_Duplo: u.salasPorCapacidade.duplo,
      Salas_Multiplo: u.salasPorCapacidade.multiplo,
      Cadeiras: u.cadeiras,
      ...colunasContagem(u.contagem),
      Sessoes_Fora_do_Mapa: u.foraDoMapa.sessoes,
      Profissionais_Alocados: u.profissionaisAlocados,
      Pacientes: u.pacientes,
      Conflitos_de_Sala: u.inconsistencias,
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
      Cadeiras: capacidadeProjetadaSala(sala.capacidade, sala.status),
      ...colunasContagem(situacaoPorSala.get(sala.id) ?? contagemVazia()),
      Slots_Ocupados: slot.slotsOcupados,
      Slots_Total: slot.slotsTotal,
      Pct_Slots_com_Profissional: pct(slot.pct),
      Conflitos_de_Sala: slot.inconsistencias,
    }
  }).sort((a, b) => {
    const cmp = a.Unidade.localeCompare(b.Unidade, "pt-BR")
    if (cmp !== 0) return cmp
    const na = parseInt(a.Numero_Sala, 10), nb = parseInt(b.Numero_Sala, 10)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.Numero_Sala.localeCompare(b.Numero_Sala, "pt-BR")
  })

  const ROTULO = { aberta: "Agenda aberta", administrativo: "Administrativo", regularizar: "A regularizar" } as const
  const pendencias = unidades.flatMap(u => [
    ...(Object.keys(ROTULO) as (keyof typeof ROTULO)[]).flatMap(k => u.pendencias[k].map(p => ({
      Unidade: u.unidade, Situacao: ROTULO[k], Profissional: p.profissional, Terapia: p.terapia ?? "", Quantidade: p.horarios, Medida: "horários", Salas: p.salas.join(", "),
    }))),
    ...u.foraDoMapa.profissionais.map(p => ({
      Unidade: u.unidade, Situacao: "Fora do mapa de salas", Profissional: p.profissional, Terapia: p.terapia ?? "", Quantidade: p.horarios, Medida: "sessões", Salas: "",
    })),
  ])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porUnidade), "Por unidade")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porTurno), "Por unidade e turno")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porDiaTurno), "Por dia e turno")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porSala), "Por sala")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendencias), "Pendencias")
  XLSX.writeFile(wb, `Ocupacao_Clinica_${inicio}_a_${fim}.xlsx`)
}
