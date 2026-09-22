// Export XLSX do relatório operacional da Central de Terapeutas.
//
// Duas abas:
//  - "Atendimentos": uma linha por atendimento (grão da vw_central_terapeutica),
//    já com quem cobriu quando houve substituição.
//  - "Resumo por terapeuta": agregado por terapeuta+terapia, para leitura rápida.
//
// A regra de visibilidade da tela vale aqui também: terapias operacionais
// (terapiasIgnoradas) ficam de fora, senão o relatório não bate com o que a
// atendente vê em tela.

import * as XLSX from 'xlsx'
import {
  getData,
  getHorarioFinal,
  getHorarioInicial,
  getPaciente,
  getSala,
  getTerapeuta,
  getTerapia,
  getUnidade,
  normalizarStatus,
  terapiaDeveAparecer,
} from '@/components/central-terapeutas/helpers'
import type { AtendimentoTerapeutico } from '@/services/central-terapeutas.service'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  presente: 'Presente',
  faltou: 'Faltou',
  disponivel: 'Disponivel',
  indisponivel: 'Indisponivel',
  cobertura_planejada: 'Cobertura planejada',
  cobertura_confirmada: 'Cobertura confirmada',
  substituido: 'Substituido',
}

function rotuloStatus(status?: string | null) {
  const s = normalizarStatus(status)
  return STATUS_LABEL[s] || s
}

function dataBR(iso: string) {
  if (!iso) return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso
}

/** confirmado_em é timestamp; o resto do sistema lê a data local. */
function dataHoraBR(valor?: string | null) {
  if (!valor) return ''
  const d = new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR')
}

function houveSubstituicao(item: AtendimentoTerapeutico) {
  return Boolean(item.profissional_substituto_nome || item.profissional_substituto_id)
}

type LinhaAtendimento = {
  Data: string
  Hora_Inicial: string
  Hora_Final: string
  Unidade: string
  Sala: string
  Terapeuta: string
  Terapia: string
  Paciente: string
  Convenio: string
  Status: string
  Houve_Substituicao: string
  Substituto: string
  Observacao: string
  Confirmado_Por: string
  Confirmado_Em: string
  Agendamento_Id: string
}

function montarLinhas(itens: AtendimentoTerapeutico[]): LinhaAtendimento[] {
  return itens.filter(terapiaDeveAparecer).map((item) => ({
    Data: dataBR(getData(item)),
    Hora_Inicial: getHorarioInicial(item),
    Hora_Final: (getHorarioFinal(item) || '').toString().slice(0, 5),
    Unidade: getUnidade(item),
    Sala: getSala(item),
    Terapeuta: getTerapeuta(item),
    Terapia: getTerapia(item),
    Paciente: getPaciente(item),
    Convenio: (item as { convenio_nome?: string | null }).convenio_nome || '',
    Status: rotuloStatus(item.status),
    Houve_Substituicao: houveSubstituicao(item) ? 'Sim' : 'Nao',
    Substituto: item.profissional_substituto_nome || '',
    Observacao: item.observacao || '',
    Confirmado_Por: item.confirmado_por_nome || '',
    Confirmado_Em: dataHoraBR(item.confirmado_em),
    Agendamento_Id: String(item.tita_agendamento_id ?? ''),
  }))
}

type LinhaResumo = {
  Terapeuta: string
  Terapia: string
  Unidade: string
  Total_Atendimentos: number
  Disponivel: number
  Indisponivel: number
  Substituidos: number
  Pendentes: number
  Pacientes_Distintos: number
  Substitutos: string
}

function montarResumo(linhasBase: AtendimentoTerapeutico[]): LinhaResumo[] {
  const mapa = new Map<
    string,
    {
      terapeuta: string
      terapia: string
      unidades: Set<string>
      total: number
      disponivel: number
      indisponivel: number
      substituidos: number
      pendentes: number
      pacientes: Set<string>
      substitutos: Set<string>
    }
  >()

  for (const item of linhasBase.filter(terapiaDeveAparecer)) {
    const terapeuta = getTerapeuta(item)
    const terapia = getTerapia(item)
    const chave = `${terapeuta}||${terapia}`

    let linha = mapa.get(chave)
    if (!linha) {
      linha = {
        terapeuta,
        terapia,
        unidades: new Set(),
        total: 0,
        disponivel: 0,
        indisponivel: 0,
        substituidos: 0,
        pendentes: 0,
        pacientes: new Set(),
        substitutos: new Set(),
      }
      mapa.set(chave, linha)
    }

    const unidade = getUnidade(item)
    if (unidade) linha.unidades.add(unidade)

    linha.total++
    linha.pacientes.add(getPaciente(item))

    const status = normalizarStatus(item.status)
    if (status === 'disponivel') linha.disponivel++
    if (status === 'indisponivel') linha.indisponivel++
    if (status === 'pendente') linha.pendentes++

    if (houveSubstituicao(item)) {
      linha.substituidos++
      if (item.profissional_substituto_nome) {
        linha.substitutos.add(item.profissional_substituto_nome)
      }
    }
  }

  return Array.from(mapa.values())
    .map((l) => ({
      Terapeuta: l.terapeuta,
      Terapia: l.terapia,
      Unidade: Array.from(l.unidades).sort().join(' / '),
      Total_Atendimentos: l.total,
      Disponivel: l.disponivel,
      Indisponivel: l.indisponivel,
      Substituidos: l.substituidos,
      Pendentes: l.pendentes,
      Pacientes_Distintos: l.pacientes.size,
      Substitutos: Array.from(l.substitutos).sort().join(' / '),
    }))
    .sort(
      (a, b) =>
        a.Terapeuta.localeCompare(b.Terapeuta, 'pt-BR') ||
        a.Terapia.localeCompare(b.Terapia, 'pt-BR')
    )
}

function larguras(linhas: Record<string, unknown>[]) {
  if (linhas.length === 0) return []
  return Object.keys(linhas[0]).map((coluna) => {
    const maior = linhas.reduce(
      (max, linha) => Math.max(max, String(linha[coluna] ?? '').length),
      coluna.length
    )
    return { wch: Math.min(Math.max(maior + 2, 10), 45) }
  })
}

export type ResultadoExport = { linhas: number; arquivo: string }

/**
 * Monta e dispara o download do .xlsx. Retorna quantas linhas foram escritas
 * para a UI conseguir avisar quando o período veio vazio.
 */
export function exportarRelatorioCentralTerapeutas(
  itens: AtendimentoTerapeutico[],
  dataInicio: string,
  dataFim: string
): ResultadoExport {
  const atendimentos = montarLinhas(itens)
  const resumo = montarResumo(itens)

  const wb = XLSX.utils.book_new()

  const abaAtendimentos = XLSX.utils.json_to_sheet(atendimentos)
  abaAtendimentos['!cols'] = larguras(atendimentos)
  XLSX.utils.book_append_sheet(wb, abaAtendimentos, 'Atendimentos')

  const abaResumo = XLSX.utils.json_to_sheet(resumo)
  abaResumo['!cols'] = larguras(resumo)
  XLSX.utils.book_append_sheet(wb, abaResumo, 'Resumo por terapeuta')

  const sufixo =
    dataInicio === dataFim ? dataInicio : `${dataInicio}_a_${dataFim}`
  const arquivo = `Central_Terapeutas_${sufixo}.xlsx`

  XLSX.writeFile(wb, arquivo)

  return { linhas: atendimentos.length, arquivo }
}
