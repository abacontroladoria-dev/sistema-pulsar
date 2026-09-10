// Migrado de calculadora-remuneracao/src/utils/relatorio.js

import { normKey } from "./constants"
import { cleanTxt, isSim } from "./formatacao"
import { isCancelado, motivoNaoRealizado } from "./rotulosExecucao"
import { dataParaISO } from "./datas"
import type { FeriadoInfo } from "@/types/remuneracao"

export type CsvGradeRow = Record<string, unknown>

export type SessaoReal = {
  id: string
  data: string
  hora: string
  profAgenda: string
  paciente: string
  convenio: string
  unidade: string
  especialidade: string
  presencaOrbita: string
  presencaTita: string
  profCsv: string
  possuiTratativa: string
  statusCsv: string
  statusFinal: string
  motivo: string
  _idx: number
  classificacao: string
  // Novos campos para o Resumo
  diaSemana: string
  idFavorecido: string
  criacaoTratativa: string
  /**
   * Quantas evoluções a TiTa tem para ESTE agendamento, e de quantas pessoas
   * diferentes. 1/1 é o normal.
   *
   * O relatório da TiTa emite uma linha por tratativa, não por agendamento —
   * evoluir duas vezes vira duas linhas com o mesmo `ID Agendamento`. Sem contar
   * isso, o upload pagava a sessão duas vezes (medido em julho/2026: 5 casos,
   * R$ 95). Contar não basta: quem evoluiu duas vezes muda o que se deve fazer.
   */
  tratativas: number
  tratativasDistintas: number
}

/** SessaoReal com campos extras injetados por calculo.ts (papel, valorPA, etc.) */
export type SessaoRealEstendida = SessaoReal & {
  papel?: string
  valorPA?: number | null
  valorPATexto?: string
  semPA?: boolean
  funcaoPA?: string
  contratoAtualPA?: string
  cadastroContratoPendente?: boolean
  explicacaoPA?: string
}


export type ValidacaoModelo = {
  ok: boolean
  tipo: string
  nome: string
  faltantes: string[]
  ausentes: string[]
  extras: string[]
  headers: string[]
}

type ModeloRelatorio = {
  nome: string
  gruposObrigatorios: string[][]
  colunasEsperadas: string[]
}

export const MODELOS_RELATORIOS: Record<"grade" | "pe", ModeloRelatorio> = {
  grade: {
    nome: "CSV grade profissionais",
    gruposObrigatorios: [
      ["Id Unidade"], ["Nome Unidade"], ["Id Profissional"], ["Profissional"],
      ["CPF do Profissional"], ["Dia da Semana"], ["Data"], ["Hora Inicial"], ["Hora Final"],
      ["Status do Agendamento"], ["Id Favorecido"], ["Nome Favorecido"], ["Convênio"],
      ["Id Terapia"], ["Terapia"], ["Id Terapia Exibição"], ["Terapia Exibicao"],
      ["Id Sala"], ["Sala"], ["ID Agendamento"], ["Status"], ["Justificativa"],
      ["Possui Tratativa"], ["Id Profissional Tratativa"], ["Nome Profissional Tratativa"],
    ],
    colunasEsperadas: [
      "Id Unidade", "Nome Unidade", "Id Profissional", "Profissional", "CPF do Profissional",
      "Telefone do Profissional", "CBO do Profissional", "Registro do Profissional",
      "Tipo Registro do Profissional", "UF Registro do Profissional", "Dia da Semana",
      "Data", "Hora Inicial", "Hora Final", "Status do Agendamento", "Id Favorecido",
      "Nome Favorecido", "Convênio", "Id Terapia", "Terapia", "Id Terapia Exibição",
      "Terapia Exibição", "Id Sala", "Sala", "Observações da Sala", "ID Agendamento",
      "Status", "Justificativa", "Data Inicial PDI/ABA", "Data Final PDI/ABA",
      "Id Criador PDI/ABA", "Nome Criador PDI/ABA", "Id Terapia(Atividade) PDI/ABA",
      "Nome Terapia(Atividade) PDI/ABA", "Possui Tratativa", "Id Profissional Tratativa",
      "Nome Profissional Tratativa", "Criação Tratativa", "Origem Tratativa",
      "Vínculo da Evolução", "Agendamento Criado Em", "Agendamento Excluído Em",
      // 43ª coluna, apareceu em setembro/2026. Sem ela aqui o upload manual de um
      // CSV baixado hoje é REJEITADO: validarModeloRelatorio exige extras.length === 0.
      "Descrição da Evolução",
    ],
  },
  pe: {
    nome: "agendamentos_profissionais",
    gruposObrigatorios: [
      ["Id Profissional"], ["Profissional"], ["Dia da Semana"],
      ["Data", "Data do Agendamento"], ["Hora Inicial"], ["Hora Final"],
      ["Status do Agendamento", "Especialidade"],
      ["Id Terapia", "Id Especialidade"], ["Terapia", "Especialidade"], ["Id Terapia Exibição", "Id Terapia Exibicao", "Id Especialidade"],
      ["Terapia Exibição", "Terapia Exibicao", "Especialidade"], ["Id Sala", "Sala"], ["Sala"],
      ["Favorecido", "Paciente", "Nome Favorecido"], ["Id Favorecido"],
      ["Convênio", "Convenio"],
    ],
    colunasEsperadas: [
      "Id Profissional", "Profissional", "Dia da Semana", "Data do Agendamento", "Data",
      "Hora Inicial", "Hora Final", "Status do Agendamento", "Id Terapia", "Terapia", "Id Especialidade", "Especialidade",
      "Id Terapia Exibição", "Terapia Exibição", "Id Sala", "Sala",
      "Data Criação do Agendamento", "NÚMERO DE CELULAR DO R.F.", "Favorecido",
      "Id Favorecido", "Id Convênio", "Convênio", "Unidade",
    ],
  },
}

export function parseHtmlTable(text: string): Record<string, string>[] {
  const doc = new DOMParser().parseFromString(text, "text/html")
  const table = doc.querySelector("table")
  if (!table) return []
  const trs = [...table.querySelectorAll("tr")]
  if (!trs.length) return []
  const headers = [...trs[0].querySelectorAll("th,td")].map(c => cleanTxt(c.textContent))
  return trs.slice(1).map(tr => {
    const cells = [...tr.querySelectorAll("td,th")].map(c => cleanTxt(c.textContent))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? "" })
    return obj
  }).filter(o => Object.values(o).some(Boolean))
}

export function getCol(row: CsvGradeRow, names: string[]): unknown {
  for (const n of names) { if (row[n] !== undefined) return row[n] }
  const keys = Object.keys(row)
  for (const n of names) {
    const nk = normKey(n)
    const k = keys.find(x => normKey(x) === nk)
    if (k) return row[k]
  }
  return ""
}

function normalizarCabecalho(h: string): string {
  return normKey(cleanTxt(h))
}

export function getCabecalhos(rows: CsvGradeRow[]): string[] {
  const primeiro = (rows || []).find(r => r && typeof r === "object")
  return primeiro ? Object.keys(primeiro).map(cleanTxt).filter(Boolean) : []
}

export function validarModeloRelatorio(tipo: string, rowsOrHeaders: CsvGradeRow[] | string[]): ValidacaoModelo {
  const modelo = MODELOS_RELATORIOS[tipo as "grade" | "pe"]
  if (!modelo) return { ok: true, tipo, nome: tipo, faltantes: [], ausentes: [], extras: [], headers: [] }
  const headers = Array.isArray(rowsOrHeaders) && rowsOrHeaders.every(x => typeof x === "string")
    ? (rowsOrHeaders as string[]).map(cleanTxt).filter(Boolean)
    : getCabecalhos(rowsOrHeaders as CsvGradeRow[])
  const headerKeys = headers.map(normalizarCabecalho)
  const faltantes = modelo.gruposObrigatorios
    .filter(grupo => !grupo.some(alias => headerKeys.includes(normalizarCabecalho(alias))))
    .map(grupo => grupo[0])
  const gruposPorEsperada = new Map<string, string[]>()
  modelo.gruposObrigatorios.forEach(grupo => {
    grupo.forEach(alias => gruposPorEsperada.set(normalizarCabecalho(alias), grupo))
  })
  const ausentes = modelo.colunasEsperadas.filter(col => {
    const key = normalizarCabecalho(col)
    const grupo = gruposPorEsperada.get(key)
    if (grupo) return !grupo.some(alias => headerKeys.includes(normalizarCabecalho(alias)))
    return !headerKeys.includes(key)
  })
  const aceitos = new Set([
    ...modelo.colunasEsperadas,
    ...modelo.gruposObrigatorios.flat(),
  ].map(normalizarCabecalho))
  const extras = headers.filter(h => !aceitos.has(normalizarCabecalho(h)))
  return {
    ok: faltantes.length === 0 && ausentes.length === 0 && extras.length === 0,
    tipo,
    nome: modelo.nome,
    faltantes,
    ausentes,
    extras,
    headers,
  }
}

export function classificarSessaoReal(
  r: Pick<SessaoReal, "id" | "data" | "profAgenda" | "profCsv" | "possuiTratativa" | "presencaOrbita" | "statusFinal" | "statusCsv">
    & Partial<Pick<SessaoReal, "tratativas" | "tratativasDistintas">>,
  feriados?: Record<string, FeriadoInfo>
): string {
  const agenda = cleanTxt(r.profAgenda)
  const csv = cleanTxt(r.profCsv)
  const possui = isSim(r.possuiTratativa)
  const presenca = isSim(r.presencaOrbita)
  const cancelado = isCancelado(r.statusFinal) || isCancelado(r.statusCsv)
  // Evolução registrada (Possui Tratativa = Sim) sem ID Agendamento correspondente:
  // não há sessão real no sistema para essa tratativa. Precisa checagem manual
  // antes de pagar — não pode ser silenciosamente descartada nem tratada como
  // evolução normal.
  if (possui && !cleanTxt(r.id)) return "Evolução sem agendamento"
  // Duas PESSOAS evoluíram o mesmo agendamento. Só uma atendeu, e o sistema não
  // tem como saber qual: ninguém recebe até alguém decidir. Vem antes de tudo
  // porque a dúvida é sobre a autoria, que é o que decide o pagamento.
  if (possui && (r.tratativasDistintas ?? 1) > 1) return "Evolução em conflito"
  if (cancelado && possui) return "Cancelado evoluído"
  if (!presenca && possui) return "Evolução sem presença"
  if (possui && agenda && csv && normKey(agenda) !== normKey(csv)) return "Substituição"
  // Mesma pessoa salvou a evolução mais de uma vez. Não há dúvida de quem
  // trabalhou, então PAGA — uma vez só, porque as cópias já foram descartadas em
  // normalizarGradeParaSessao. Fica com nome próprio para aparecer na conferência:
  // duplo clique é ruído de sistema, e ruído que ninguém vê não é corrigido.
  // Deliberadamente depois de "Substituição": ali o rótulo precisa dizer quem
  // recebe, que é informação mais urgente que a duplicidade.
  if (possui && (r.tratativas ?? 1) > 1) return "Evolução duplicada"
  if (possui) return "Evolução normal"
  if (presenca && !possui && !cancelado) return "Pendente retroativa"
  if (cancelado) return feriados?.[dataParaISO(r.data)] ? "Feriado/Ponto Fac." : "Cancelado"
  return "Não evoluído"
}

/**
 * Agrupa as linhas por `ID Agendamento` para descobrir evolução repetida.
 *
 * Duas fontes, um resultado. No upload a repetição É a repetição de linhas: o
 * relatório da TiTa emite uma por tratativa. No banco a linha já vem colapsada
 * (uma por `tita_agendamento_id`), e a contagem chega pronta nas colunas
 * "Tratativas" / "Tratativas Distintas", que o sync preenche — sem elas o banco
 * não teria como saber que houve duas, porque guardou só a última.
 *
 * Devolve, por id: quantas evoluções e de quantas pessoas, mais a linha que
 * sobrevive (a de tratativa mais recente). O resto é descartado — um agendamento
 * é uma sessão, e contar duas paga duas.
 */
function agruparPorAgendamento(rows: CsvGradeRow[]) {
  const porId = new Map<string, { linhas: CsvGradeRow[]; pessoas: Set<string> }>()
  for (const r of rows) {
    const id = cleanTxt(getCol(r, ["ID Agendamento"]))
    if (!id) continue
    const g = porId.get(id) ?? { linhas: [], pessoas: new Set<string>() }
    g.linhas.push(r)
    // Id quando existe; nome normalizado quando não. O que importa é distinguir
    // "a mesma pessoa salvou de novo" de "outra pessoa evoluiu a mesma sessão".
    const quem = cleanTxt(getCol(r, ["Id Profissional Tratativa"]))
      || normKey(getCol(r, ["Nome Profissional Tratativa"]))
    if (quem) g.pessoas.add(quem)
    porId.set(id, g)
  }

  const sobrevivente = new Map<string, CsvGradeRow>()
  const contagem = new Map<string, { tratativas: number; distintas: number }>()
  for (const [id, g] of porId) {
    // A mais recente vence, mesmo critério que o sync usa ao escrever no banco —
    // é o que mantém os dois caminhos com a mesma resposta.
    const escolhida = g.linhas.reduce((a, b) =>
      cleanTxt(getCol(b, ["Criação Tratativa"])) > cleanTxt(getCol(a, ["Criação Tratativa"])) ? b : a)
    sobrevivente.set(id, escolhida)

    // Do banco a contagem vem pronta; do upload ela é o número de linhas.
    const doBanco = Number(getCol(escolhida, ["Tratativas"]))
    const distintasBanco = Number(getCol(escolhida, ["Tratativas Distintas"]))
    contagem.set(id, {
      tratativas: Math.max(g.linhas.length, Number.isFinite(doBanco) ? doBanco : 0) || 1,
      distintas: Math.max(g.pessoas.size, Number.isFinite(distintasBanco) ? distintasBanco : 0) || 1,
    })
  }
  return { sobrevivente, contagem }
}

/**
 * Menor e maior data (ISO) de uma grade ainda CRUA. `null` quando nenhuma linha
 * traz data legível.
 *
 * Lê da linha crua, e não de `SessaoReal`, para que a busca de presença em
 * fila_autorizacoes possa sair JUNTO com a grade em vez de depois dela. O índice
 * de presença precisa entrar no estado no mesmo instante que as linhas: até ele
 * chegar, toda sessão vale como presente (ver `presencaOrbita` mais abaixo) e a
 * tela exibe um total mais alto que o correto. Ver useRemunRP.
 */
export function janelaDeDatasDaGrade(rows: CsvGradeRow[]): { min: string; max: string } | null {
  let min = ""
  let max = ""
  for (const r of rows) {
    const iso = dataParaISO(getCol(r, ["Data"]))
    if (!iso) continue
    if (!min || iso < min) min = iso
    if (!max || iso > max) max = iso
  }
  return min && max ? { min, max } : null
}

export function normalizarGradeParaSessao(rows: CsvGradeRow[], feriados?: Record<string, FeriadoInfo>): SessaoReal[] {
  const { sobrevivente, contagem } = agruparPorAgendamento(rows)

  return rows
    .filter(r => {
      // Linha repetida do mesmo agendamento: só a sobrevivente segue. Sem isto,
      // "pagar uma vez" seria impossível — as duas cópias somam.
      const id = cleanTxt(getCol(r, ["ID Agendamento"]))
      if (id && sobrevivente.get(id) !== r) return false
      return true
    })
    .filter(r => {
      const statusAgendamento = cleanTxt(getCol(r, ["Status do Agendamento"]))
      if (statusAgendamento === "Agendado") return true
      // Horário sem agendamento real (ex.: "Livre"), mas com evolução registrada
      // (Possui Tratativa = Sim) — mantém a linha para virar inconsistência
      // "Evolução sem agendamento" em vez de desaparecer silenciosamente.
      return isSim(getCol(r, ["Possui Tratativa"]))
    })
    .map((r, idx) => {
      const status = cleanTxt(getCol(r, ["Status"]))
      const justificativa = cleanTxt(getCol(r, ["Justificativa"]))
      // Motivo lido das DUAS colunas por tolerância, embora na prática ele more
      // sempre em `Justificativa` (Status é só 'Cancelado', antes e depois de
      // 24/08/2026 — ver rotulosExecucao.ts). 'Falta do Paciente' e o rótulo
      // novo 'Não realizado — paciente' são lidos da mesma forma.
      const naoAconteceu = isCancelado(status)
      const motivo = motivoNaoRealizado(justificativa, status)
      const id = cleanTxt(getCol(r, ["ID Agendamento"]))
      // Sem ID Agendamento não existe sessão real na grade — não há o que a
      // recepção/TiTa tenham confirmado presença, então não assumimos "Sim"
      // (evita sugerir que um paciente compareceu a um horário que nunca existiu).
      const obj: SessaoReal = {
        id,
        data: cleanTxt(getCol(r, ["Data"])),
        hora: cleanTxt(getCol(r, ["Hora Inicial"])),
        profAgenda: cleanTxt(getCol(r, ["Profissional"])),
        paciente: cleanTxt(getCol(r, ["Nome Favorecido"])),
        convenio: cleanTxt(getCol(r, ["Convênio", "Convenio"])),
        unidade: cleanTxt(getCol(r, ["Nome Unidade"])),
        especialidade: cleanTxt(getCol(r, ["Terapia"])),
        presencaOrbita: id ? "Sim" : "",
        // Três respostas, não duas: "Não" quando o paciente é quem faltou, ""
        // quando a sessão não aconteceu e o motivo é ilegível, "Sim" no resto.
        //
        // O "" é novo e não muda nada do que existe: nas 187.079 linhas medidas
        // em 24/08/2026 não há uma única sessão não realizada sem motivo
        // declarado. Ele existe para a próxima mudança de vocabulário, quando
        // dizer "Sim" (o paciente compareceu) seria afirmar sobre a presença de
        // alguém um fato que a grade não sustenta.
        // "outro" é justamente o motivo ilegível — cai no "" junto com o null.
        presencaTita: !id
          ? ""
          : !naoAconteceu ? "Sim"
          : motivo === "paciente" ? "Não"
          : motivo === "prestador" || motivo === "clinica" || motivo === "ambos" ? "Sim"
          : "",
        profCsv: cleanTxt(getCol(r, ["Nome Profissional Tratativa"])),
        possuiTratativa: cleanTxt(getCol(r, ["Possui Tratativa"])),
        statusCsv: status,
        statusFinal: status,
        motivo: justificativa,
        _idx: idx + 1,
        classificacao: "",
        diaSemana: cleanTxt(getCol(r, ["Dia da Semana"])),
        idFavorecido: cleanTxt(getCol(r, ["Id Favorecido"])),
        criacaoTratativa: cleanTxt(getCol(r, ["Criação Tratativa"])),
        tratativas: contagem.get(id)?.tratativas ?? 1,
        tratativasDistintas: contagem.get(id)?.distintas ?? 1,
      }
      obj.classificacao = classificarSessaoReal(obj, feriados)
      return obj
    }).filter(r => r.profAgenda || r.profCsv || r.paciente)
}
