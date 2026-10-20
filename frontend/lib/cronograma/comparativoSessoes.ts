// Comparativo de Sessões Agendadas — compara duas bases de agendamentos (ex.:
// mês anterior x mês atual) e produz os indicativos: total geral, por unidade,
// por paciente e resumo de aumento/redução. Ver planilha de referência
// "comparativo_julho_agosto_2026.xlsx" — este módulo reproduz a mesma lógica
// pra alimentar dashboards dentro do sistema (Indicadores > Comparativo de Sessões).

import { normTxt, decodeEntidadesHtml } from "@/lib/cronograma/constants"

/**
 * Ids de "paciente" fictícios/administrativos (ex.: 18565 "Horário
 * Administrativo", 20479 "Supervisora Fernanda Lima") — placeholders que o
 * sistema de origem usa pra preencher o campo Favorecido em horários
 * administrativos (ex.: terapia "Especialista Técnico de Área"), já que a
 * grade exige um "paciente" em toda linha. Do lado do PACIENTE isso nunca é
 * sessão de verdade — sempre excluído (ver excluirPacientesFicticios,
 * usado em calcularComparativo e calcularPorPacienteDaUnidade). Do lado do
 * PROFISSIONAL é carga de trabalho real (ele estava alocado naquele horário)
 * — por isso NÃO é filtrado na normalização (normalizarLinhasUpload/
 * normalizarLinhasApi) nem nas agregações por profissional
 * (agregarPorProfissional, calcularTurnoverProfissionais): filtrar ali
 * apagava sessões reais do profissional (ex.: troca de terapia registrada
 * como "Especialista Técnico de Área" desaparecia sem deixar rastro,
 * parecendo uma queda de carga que nunca existiu).
 */
export const PACIENTES_FICTICIOS_IDS = new Set<number>([
  17795, 18565, 19196, 20471, 20472, 20473, 20475, 20476, 20477, 20478, 20479,
  20725, // Paciente Teste Sanderson
])

/** Remove sessões de pacientes fictícios/administrativos — ver PACIENTES_FICTICIOS_IDS. Chamar só nas agregações do lado do PACIENTE, nunca nas do profissional. */
export function excluirPacientesFicticios(sessoes: SessaoComparativo[]): SessaoComparativo[] {
  return sessoes.filter(s => s.idFavorecido === null || !PACIENTES_FICTICIOS_IDS.has(s.idFavorecido))
}

export const UNIDADE_CONSERTAR = "Consertar Unidade no Sistema"
export const UNIDADE_AMBIENTE_NATURAL = "Ambiente Natural - Casa ou Escola"

/** Infere a Unidade a partir do texto da Sala, seguindo o mapeamento definido. */
export function mapearUnidade(sala: string | null | undefined): string {
  const s = String(sala ?? "").trim()
  if (!s) return UNIDADE_CONSERTAR
  if (/^Unid\.?\s*Realengo/i.test(s)) return "Realengo"
  if (/^Unid\.?\s*Fazendinha/i.test(s)) return "Fazendinha"
  if (/^Unid\.?\s*Padre Miguel/i.test(s)) return "Padre Miguel"
  if (normTxt(s) === normTxt("AT Externo Casa") || normTxt(s) === normTxt("AT Externo Escola")) return UNIDADE_AMBIENTE_NATURAL
  return UNIDADE_CONSERTAR
}

/**
 * Corrige "Consertar Unidade no Sistema" quando é só um buraco pontual no
 * relatório (Sala vazia numa sessão isolada), não uma unidade de fato
 * desconhecida: se ≥90% de TODAS as sessões desse paciente (nesse conjunto)
 * caem numa única unidade real, as sessões sem Sala desse mesmo paciente
 * passam a herdar essa unidade — marcadas com `unidadeInferida: true` pra
 * exibir um aviso (nunca escondido) de que aquele horário específico não
 * tinha Sala informada na origem. Sem isso, um paciente com 21 sessões em
 * Realengo e 1 sem Sala aparecia como se tivesse uma sessão "perdida" numa
 * unidade indefinida, quando na prática é óbvio que também é Realengo. Abaixo
 * de 90% (padrão inconsistente, ou paciente que de fato circula entre
 * unidades) mantém "Consertar Unidade no Sistema" sem alteração.
 */
export function corrigirUnidadesPorPaciente(sessoes: SessaoComparativo[]): SessaoComparativo[] {
  const porPaciente = new Map<string, SessaoComparativo[]>()
  for (const s of sessoes) {
    const chave = chaveDe(s)
    const grupo = porPaciente.get(chave) ?? []
    grupo.push(s)
    porPaciente.set(chave, grupo)
  }

  const out: SessaoComparativo[] = []
  for (const grupo of porPaciente.values()) {
    const contagem = new Map<string, number>()
    for (const s of grupo) {
      if (s.unidade === UNIDADE_CONSERTAR) continue
      contagem.set(s.unidade, (contagem.get(s.unidade) ?? 0) + 1)
    }
    let melhorUnidade: string | null = null
    let melhorQtd = 0
    for (const [u, qtd] of contagem) {
      if (qtd > melhorQtd) { melhorUnidade = u; melhorQtd = qtd }
    }
    const cobre90 = melhorUnidade !== null && melhorQtd / grupo.length >= 0.9
    for (const s of grupo) {
      out.push(s.unidade === UNIDADE_CONSERTAR && cobre90 ? { ...s, unidade: melhorUnidade!, unidadeInferida: true } : s)
    }
  }
  return out
}

/** Linha normalizada de sessão, já filtrada e pronta pra comparação. */
export interface SessaoComparativo {
  idFavorecido: number | null
  paciente: string
  sala: string
  unidade: string
  convenio: string
  data: string
  /** Hora inicial no formato "HH:MM" — usada só pra identificar sessões duplicadas do Assim Saúde (ver dedupAssimSaude). */
  hora: string
  idTerapia: number | null
  terapia: string
  idProfissional: number | null
  profissional: string
  /**
   * Índice do dia da semana (0 = domingo, ver DIAS_SEMANA_LABEL), de
   * preferência lido do texto "Dia da Semana"/dia_semana que a própria
   * fonte (API ou relatório) já traz — NÃO recalculado a partir de `data` via
   * `Date`, que é frágil a fuso horário (ver diaSemanaIndexDeTexto). Só cai
   * pro cálculo via data quando a fonte não informa o dia da semana.
   */
  diaSemanaIndice: number | null
  /**
   * `true` quando `unidade` não veio do texto real da Sala (que estava
   * vazio no relatório de origem) — foi inferida porque ≥90% das OUTRAS
   * sessões desse mesmo paciente caem numa única unidade (ver
   * corrigirUnidadesPorPaciente). Usado só pra mostrar um aviso discreto
   * ("sala/unidade não informada nesse horário") — nunca deve mudar o
   * cálculo em si, só a transparência sobre o dado.
   */
  unidadeInferida?: boolean
}

/**
 * Filtra sessões por trecho do nome do paciente (case/acento-insensitive) e/ou
 * por um conjunto de convênios selecionados (checkbox — "ou": basta bater com
 * um deles). Usado pra recalcular Por Unidade e Por Paciente com o mesmo
 * recorte de dados. `convenios` vazio = sem filtro de convênio.
 */
export function filtrarSessoesPorTexto(sessoes: SessaoComparativo[], paciente: string, convenios: string[]): SessaoComparativo[] {
  const p = normTxt(paciente)
  if (!p && convenios.length === 0) return sessoes
  const setConvenios = new Set(convenios.map(normTxt))
  return sessoes.filter(s => (!p || normTxt(s.paciente).includes(p)) && (setConvenios.size === 0 || setConvenios.has(normTxt(s.convenio))))
}

/**
 * Mesma ideia de filtrarSessoesPorTexto, só que pro lado do profissional:
 * filtra por trecho do nome do profissional e/ou por um conjunto de
 * especialidades selecionadas (checkbox — "ou"). Banco de filtros
 * independente do de pacientes — ver FilterBarProfissional: buscar "Alice"
 * aqui nunca deve recortar as sessões usadas pros indicativos de paciente,
 * e vice-versa. `especialidades` vazio = sem filtro de especialidade.
 */
export function filtrarSessoesPorProfissionalTexto(sessoes: SessaoComparativo[], profissional: string, especialidades: string[]): SessaoComparativo[] {
  const p = normTxt(profissional)
  if (!p && especialidades.length === 0) return sessoes
  const setEspecialidades = new Set(especialidades.map(normTxt))
  return sessoes.filter(s => (!p || normTxt(s.profissional).includes(p)) && (setEspecialidades.size === 0 || setEspecialidades.has(normTxt(s.terapia))))
}

/**
 * Filtro numérico aplicável a qualquer linha com p1/p2/diferenca (paciente ou
 * unidade). P1/P2 são "≥ X" (null = sem filtro). Diferença é um intervalo
 * [mín, máx] — como diferença é um valor com sinal, "≥ X" sozinho não deixa
 * isolar quedas (ex.: "≥ -1" também inclui 0 e positivos); com mín/máx dá pra
 * pedir só quedas (ex.: mín=-9, máx=-1) ou só ganhos (mín=1).
 */
export function passaFiltroNumerico(
  row: { p1: number; p2: number; diferenca: number },
  p1Min: number | null, p2Min: number | null, diferencaMin: number | null, diferencaMax: number | null,
): boolean {
  if (p1Min !== null && row.p1 < p1Min) return false
  if (p2Min !== null && row.p2 < p2Min) return false
  if (diferencaMin !== null && row.diferenca < diferencaMin) return false
  if (diferencaMax !== null && row.diferenca > diferencaMax) return false
  return true
}

function isAgendado(status: string | null | undefined): boolean {
  const n = normTxt(status)
  return !n || n === "agendado"
}

/** Extrai o primeiro valor não-vazio dentre possíveis nomes de coluna (tolerante a variações de export). */
function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim()
  }
  return ""
}

/**
 * Normaliza um valor de horário cru (texto "HH:MM[:SS]" ou serial numérico de
 * XLSX — a leitura com `raw:true` traz células de hora como fração do dia) pro
 * formato "HH:MM" — usado só como parte da chave de dedup do Assim Saúde.
 */
function parseHoraAgendamento(raw: string): string {
  const s = raw.trim()
  if (!s) return ""
  const hhmm = s.match(/^(\d{1,2}):(\d{2})/)
  if (hhmm) return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s)
    const fracDia = num - Math.floor(num)
    const totalMin = Math.round(fracDia * 24 * 60)
    return `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`
  }
  return s
}

/**
 * Normaliza linhas cruas de um XLSX/CSV importado (ex.: relatório
 * "agendamentos_profissionais"). NÃO filtra pacientes fictícios aqui de
 * propósito — ver PACIENTES_FICTICIOS_IDS: essas linhas são carga real do
 * profissional, só não são sessão de paciente de verdade. Quem consome pro
 * lado do paciente filtra explicitamente (excluirPacientesFicticios).
 */
export function normalizarLinhasUpload(raw: Record<string, unknown>[]): SessaoComparativo[] {
  const out: SessaoComparativo[] = []
  for (const row of raw) {
    const statusTxt = pick(row, ["Status do Agendamento", "Status", "status"])
    if (statusTxt && !isAgendado(statusTxt)) continue

    const idStr = pick(row, ["Id Favorecido", "IdFavorecido", "Id_Favorecido", "ID Favorecido"])
    const idFavorecido = idStr ? Number(idStr.replace(/\D/g, "")) : null

    const sala = pick(row, ["Sala", "sala"])
    const data = normalizarDataAgendamento(pick(row, ["Data do Agendamento", "Data", "data"]))
    const diaSemanaTexto = pick(row, ["Dia da Semana", "Dia Semana", "dia_semana"])
    out.push({
      idFavorecido: idFavorecido !== null && !isNaN(idFavorecido) ? idFavorecido : null,
      paciente: decodeEntidadesHtml(pick(row, ["Favorecido", "Nome Favorecido", "Paciente", "paciente"])),
      sala,
      unidade: mapearUnidade(sala),
      convenio: decodeEntidadesHtml(pick(row, ["Convênio", "Convenio", "convenio"])),
      data,
      hora: parseHoraAgendamento(pick(row, ["Hora Inicial", "Hora", "hora"])),
      idTerapia: (() => {
        const s = pick(row, ["Id Especialidade", "IdEspecialidade", "Id_Especialidade", "Id Terapia", "IdTerapia", "Id_Terapia"])
        const n = s ? Number(s.replace(/\D/g, "")) : NaN
        return isNaN(n) ? null : n
      })(),
      terapia: decodeEntidadesHtml(pick(row, ["Especialidade", "especialidade", "Terapia", "terapia"])),
      idProfissional: (() => {
        const s = pick(row, ["Id Profissional", "IdProfissional", "Id_Profissional"])
        const n = s ? Number(s.replace(/\D/g, "")) : NaN
        return isNaN(n) ? null : n
      })(),
      profissional: decodeEntidadesHtml(pick(row, ["Profissional", "profissional"])),
      diaSemanaIndice: diaSemanaIndiceDe(diaSemanaTexto, data),
    })
  }
  return out
}

/** Linha crua vinda de csv_grades_profissionais (via gradeService.buscarGradeComparativo). */
export interface GradeComparativoRaw {
  paciente_id: number | null
  paciente_nome: string | null
  sala_nome: string | null
  convenio_nome: string | null
  status_agendamento: string | null
  data: string | null
  hora_inicial: string | null
  terapia_id: number | null
  terapia_nome: string | null
  dia_semana: string | null
  profissional_id: number | null
  profissional_nome: string | null
}

/** Normaliza linhas vindas da API (csv_grade_profissionais). NÃO filtra pacientes fictícios aqui — mesmo motivo de normalizarLinhasUpload (ver PACIENTES_FICTICIOS_IDS e excluirPacientesFicticios). */
export function normalizarLinhasApi(raw: GradeComparativoRaw[]): SessaoComparativo[] {
  const out: SessaoComparativo[] = []
  for (const row of raw) {
    if (!isAgendado(row.status_agendamento)) continue
    const data = normalizarDataAgendamento(row.data ?? "")
    out.push({
      idFavorecido: row.paciente_id,
      paciente: row.paciente_nome ?? "",
      sala: row.sala_nome ?? "",
      unidade: mapearUnidade(row.sala_nome),
      convenio: row.convenio_nome ?? "",
      data,
      hora: (row.hora_inicial ?? "").slice(0, 5),
      idTerapia: row.terapia_id,
      terapia: row.terapia_nome ?? "",
      idProfissional: row.profissional_id,
      profissional: row.profissional_nome ?? "",
      diaSemanaIndice: diaSemanaIndiceDe(row.dia_semana, data),
    })
  }
  return out
}

export interface UnidadeComparativo {
  unidade: string
  p1: number
  p2: number
  diferenca: number
  variacaoPct: number | null
  /** Nº de pacientes distintos com ao menos uma sessão nessa unidade, em qualquer um dos dois períodos. */
  qtdPacientes: number
  /** Soma das sessões ganhas pelos pacientes que aumentaram nessa unidade (só a parte positiva) — explica quando a diferença líquida (ex.: +10) esconde movimentos maiores em direções opostas (ex.: +30 de uns, -20 de outros). */
  sessoesAumentadas: number
  /** Nº de pacientes dessa unidade cujas sessões aumentaram de P1 pra P2. */
  pacientesComAumento: number
  /** Soma das sessões perdidas pelos pacientes que reduziram nessa unidade (só a parte negativa, em módulo). */
  sessoesReduzidas: number
  /** Nº de pacientes dessa unidade cujas sessões reduziram de P1 pra P2. */
  pacientesComReducao: number
}

export interface PacienteComparativo {
  idFavorecido: number | null
  paciente: string
  convenio: string
  p1: number
  p2: number
  diferenca: number
}

export interface ResumoAumentoReducao {
  /** Pacientes que já tinham sessão em P1 e aumentaram (não inclui novos captados). */
  pacientesAumentaram: number
  sessoesAumentadas: number
  /** Pacientes que já tinham sessão em P1 e reduziram sem zerar (não inclui desligados). */
  pacientesReduziram: number
  sessoesReduzidas: number
  pacientesSemAlteracao: number
  /** Pacientes com 0 sessões em P1 e ≥1 em P2. */
  pacientesNovosCaptados: number
  sessoesNovosCaptados: number
  /** Pacientes com ≥1 sessão em P1 e 0 em P2. */
  pacientesDesligados: number
  sessoesDesligados: number
}

/**
 * Parseia a data de um agendamento em qualquer um dos formatos que a coluna
 * "Data do Agendamento" pode assumir: ISO ("2026-09-07", vindo da API),
 * brasileiro ("07/09/2026", texto no XLSX) ou serial do Excel (número de dias
 * desde 1899-12-30, quando a célula não vem formatada como texto/data no XLSX).
 */
function parseDataAgendamento(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    // new Date("aaaa-mm-dd") sem hora é interpretado como UTC — em fuso
    // negativo (Brasil, UTC-3) .getDay() then volta pro dia anterior. Construir
    // a partir dos componentes evita isso: fica sempre meia-noite local.
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return isNaN(d.getTime()) ? null : d
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) {
    const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]))
    return isNaN(d.getTime()) ? null : d
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    // Serial do Excel é só uma contagem de dias (sem fuso) — a aritmética do
    // epoch é inerentemente UTC, então extrai ano/mês/dia via getUTC* e
    // reconstrói em hora LOCAL. Só usar Date.UTC(...) direto (sem esse passo)
    // reproduz o mesmo bug da branch ISO: .getDay() convertendo pro fuso do
    // navegador e voltando um dia (Brasil, UTC-3).
    const serial = Math.floor(Number(s))
    const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
    const d = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate())
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Normaliza a data de agendamento pro formato canônico ISO "aaaa-mm-dd",
 * independente do formato de origem (ISO, brasileiro ou serial do Excel) —
 * garante comparação estável de data entre linhas (ex.: dedupAssimSaude),
 * mesmo quando duas linhas da mesma sessão (dois profissionais, mesmo
 * horário) saem do XLSX com formatos de data diferentes (célula mesclada
 * formatada como texto numa linha e como serial na outra, por exemplo).
 */
function normalizarDataAgendamento(raw: string): string {
  const d = parseDataAgendamento(raw)
  if (!d) return raw.trim()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmtDataCurta(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Formata a data de uma sessão (qualquer formato aceito por parseDataAgendamento) como "dd/mm/aaaa" pra exibição — usado no drill-down "Por Paciente". Retorna o valor cru se não for parseável. */
export function formatarDataSessao(raw: string): string {
  const d = parseDataAgendamento(raw)
  if (!d) return raw
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

function parseIsoLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function diasCorridosEntre(isoInicio: string, isoFim: string): number {
  const inicio = parseIsoLocal(isoInicio)
  const fim = parseIsoLocal(isoFim)
  if (!inicio || !fim) return 0
  return Math.round((fim.getTime() - inicio.getTime()) / 86400000) + 1
}

/**
 * Alguns relatórios exportam a mesma grade semanal recorrente repetida por
 * várias semanas/meses (ex.: agenda fixa do profissional). Se o upload tiver
 * mais de 7 dias corridos de intervalo, isso é sinal de repetição — nesse
 * caso considera-se só a primeira ocorrência de cada dia da semana presente
 * no arquivo (a primeira segunda, a primeira terça etc.), descartando as
 * repetições das semanas seguintes. Uploads com até 7 dias corridos (uma
 * semana) passam intactos.
 */
export function limitarPrimeirasOcorrenciasSemana(rows: SessaoComparativo[]): SessaoComparativo[] {
  const datas = rows.map(r => r.data).filter(Boolean).sort()
  if (datas.length === 0) return rows
  if (diasCorridosEntre(datas[0], datas[datas.length - 1]) <= 7) return rows

  const primeiraDataPorDiaSemana = new Map<number, string>()
  for (const r of rows) {
    if (r.diaSemanaIndice === null || !r.data) continue
    const atual = primeiraDataPorDiaSemana.get(r.diaSemanaIndice)
    if (!atual || r.data < atual) primeiraDataPorDiaSemana.set(r.diaSemanaIndice, r.data)
  }

  return rows.filter(r => r.diaSemanaIndice === null || !r.data || r.data === primeiraDataPorDiaSemana.get(r.diaSemanaIndice))
}

/**
 * A partir de 18/01/2026 o relatório "agendamentos_profissionais" passou a
 * separar corretamente as duas clínicas que antes vinham misturadas no mesmo
 * arquivo (bug de origem só do início de janeiro/2026) — datas anteriores a
 * essa não são confiáveis pra este comparativo. Bloqueia o upload de qualquer
 * arquivo que contenha sessão anterior a essa data (ver validarDataMinimaUpload).
 */
export const DATA_MINIMA_UPLOAD = "2026-01-18"

/** Rejeita o upload (lançando erro) se alguma linha tiver data anterior a DATA_MINIMA_UPLOAD — ver o motivo lá. */
export function validarDataMinimaUpload(rows: SessaoComparativo[]): void {
  let maisAntiga: string | null = null
  for (const r of rows) {
    if (r.data && r.data < DATA_MINIMA_UPLOAD && (!maisAntiga || r.data < maisAntiga)) maisAntiga = r.data
  }
  if (maisAntiga) {
    throw new Error(
      `Arquivo contém sessão em ${formatarDataSessao(maisAntiga)} — datas anteriores a 18/01/2026 não são permitidas (relatório misturava duas clínicas antes dessa data).`,
    )
  }
}

/** Nomes dos dias da semana, indexados como Date.getDay() (0 = domingo). */
export const DIAS_SEMANA_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

/** Índice do dia da semana (0 = domingo, ver DIAS_SEMANA_LABEL) de uma data de sessão. Usado pra montar a visão em formato de agenda no drill-down "Por Paciente". */
export function diaSemanaIndex(raw: string): number | null {
  const d = parseDataAgendamento(raw)
  return d ? d.getDay() : null
}

const DIA_SEMANA_TEXTO_PARA_INDICE: Record<string, number> = {
  domingo: 0, "segunda-feira": 1, segunda: 1, "terca-feira": 2, terca: 2,
  "quarta-feira": 3, quarta: 3, "quinta-feira": 4, quinta: 4, "sexta-feira": 5, sexta: 5, sabado: 6,
}

/**
 * Índice do dia da semana a partir do texto que a própria fonte já informa
 * ("Dia da Semana" do relatório, `dia_semana` da API) — evita recalcular via
 * `Date`, que se mostrou frágil a fuso horário mesmo depois de corrigido em
 * duas frentes (ISO e serial do Excel, ver parseDataAgendamento). Só cai pro
 * cálculo via data (`diaSemanaIndex`) quando a fonte não informa o dia.
 */
export function diaSemanaIndiceDe(diaSemanaTexto: string | null | undefined, data: string): number | null {
  if (diaSemanaTexto) {
    const idx = DIA_SEMANA_TEXTO_PARA_INDICE[normTxt(diaSemanaTexto)]
    if (idx !== undefined) return idx
  }
  return diaSemanaIndex(data)
}

/** Intervalo (data mais antiga a mais recente) das sessões de um período, pra exibir junto ao total. Retorna null se nenhuma data for parseável. */
export function rangeDatas(sessoes: SessaoComparativo[]): string | null {
  let min: Date | null = null
  let max: Date | null = null
  for (const s of sessoes) {
    const d = parseDataAgendamento(s.data)
    if (!d) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  if (!min || !max) return null
  if (min.getTime() === max.getTime()) return fmtDataCurta(min)
  const mesmoAno = min.getFullYear() === max.getFullYear()
  return mesmoAno ? `${fmtDataCurta(min)} a ${fmtDataCurta(max)}/${max.getFullYear()}` : `${fmtDataCurta(min)}/${min.getFullYear()} a ${fmtDataCurta(max)}/${max.getFullYear()}`
}

/** Categoria de movimento de um paciente entre P1 e P2 — usada tanto no resumo quanto no filtro da tabela "Por Paciente". */
export type CategoriaMovimento = "aumento" | "novos" | "reducao" | "desligados" | "semAlteracao"

export function classificarMovimento(p: Pick<PacienteComparativo, "p1" | "p2" | "diferenca">): CategoriaMovimento {
  if (p.diferenca > 0) return p.p1 === 0 ? "novos" : "aumento"
  if (p.diferenca < 0) return p.p2 === 0 ? "desligados" : "reducao"
  return "semAlteracao"
}

export interface ComparativoResultado {
  totalP1: number
  totalP2: number
  diferenca: number
  variacaoPct: number | null
  porUnidade: UnidadeComparativo[]
  porPaciente: PacienteComparativo[]
  resumo: ResumoAumentoReducao
}

function variacao(p1: number, p2: number): number | null {
  return p1 > 0 ? (p2 - p1) / p1 : null
}

const ORDEM_UNIDADES = ["Realengo", "Fazendinha", "Padre Miguel", UNIDADE_AMBIENTE_NATURAL, UNIDADE_CONSERTAR]

/** Chave estável de paciente: Id Favorecido quando disponível, senão nome normalizado. */
function chaveDe(s: Pick<SessaoComparativo, "idFavorecido" | "paciente">): string {
  return s.idFavorecido !== null ? `id:${s.idFavorecido}` : `nome:${normTxt(s.paciente)}`
}

const CONVENIO_ASSIM_SAUDE = normTxt("Assim Saúde")

function isAssimSaude(convenio: string): boolean {
  return normTxt(convenio) === CONVENIO_ASSIM_SAUDE
}

/**
 * Mudança de regra de negócio (início de 2026): pacientes do convênio Assim
 * Saúde podem ter, na mesma Data & Hora, dois agendamentos com
 * profissionais/terapias diferentes — isso é 1 sessão só pro paciente, não 2.
 * Sem esse dedup, uma queda causada só por essa duplicidade sumindo (ex.: 11
 * pra 10) apareceria como redução real de atendimento.
 *
 * O convênio é decidido pelo PACIENTE, não linha a linha, e olhando os DOIS
 * períodos — não só o array que está sendo deduplicado. No relatório é comum
 * o campo Convênio só vir preenchido em algumas linhas (ex.: falta nas linhas
 * "Coordenador de Caso", ou até em todo um período do upload) mesmo quando o
 * paciente inteiro é Assim Saúde. Se a detecção olhasse só o array de um
 * período isolado (P1 sozinho, ou P2 sozinho) e esse período específico não
 * tivesse NENHUMA linha com o convênio marcado, o paciente nunca seria
 * reconhecido ali, mesmo aparecendo como Assim Saúde no outro período — por
 * isso o parâmetro `contexto` (a união de P1+P2) deve ser sempre passado
 * quando disponível; sem ele, cai no próprio array recebido.
 */
export function dedupAssimSaude(sessoes: SessaoComparativo[], contexto: SessaoComparativo[] = sessoes): SessaoComparativo[] {
  const pacientesAssimSaude = new Set<string>()
  for (const s of contexto) {
    if (isAssimSaude(s.convenio)) pacientesAssimSaude.add(chaveDe(s))
  }

  const grupos = new Map<string, SessaoComparativo[]>()
  for (const s of sessoes) {
    const chave = `${chaveDe(s)}|||${s.data}|||${s.hora}`
    const grupo = grupos.get(chave) ?? []
    grupo.push(s)
    grupos.set(chave, grupo)
  }
  const out: SessaoComparativo[] = []
  for (const grupo of grupos.values()) {
    if (grupo.length > 1 && pacientesAssimSaude.has(chaveDe(grupo[0]))) {
      // Conta como 1 sessão, mas sem esconder qual terapia/profissional
      // estava junto — junta os nomes na mesma linha (ex.: "Coordenador de
      // Caso + Aplicador ABA (AV)") em vez de descartar uma delas.
      const base = grupo.find(s => isAssimSaude(s.convenio)) ?? grupo[0]
      const terapias = [...new Set(grupo.map(s => s.terapia).filter(Boolean))]
      out.push({ ...base, terapia: terapias.join(" + ") || base.terapia })
    } else {
      out.push(...grupo)
    }
  }
  return out
}

/** Agrega sessões por paciente (Id Favorecido, com fallback pro nome normalizado). Reaproveitado tanto pelo total geral quanto pelo drill-down por unidade. */
function agregarPorPaciente(sessoesP1: SessaoComparativo[], sessoesP2: SessaoComparativo[]): PacienteComparativo[] {
  interface Acc { paciente: string; convenioP1: string; convenioP2: string; p1: number; p2: number }
  const pacientes = new Map<string, Acc>()

  for (const s of sessoesP1) {
    const k = chaveDe(s)
    const acc = pacientes.get(k) ?? { paciente: s.paciente, convenioP1: "", convenioP2: "", p1: 0, p2: 0 }
    acc.p1 += 1
    acc.convenioP1 = s.convenio || acc.convenioP1
    if (s.paciente) acc.paciente = s.paciente
    pacientes.set(k, acc)
  }
  for (const s of sessoesP2) {
    const k = chaveDe(s)
    const acc = pacientes.get(k) ?? { paciente: s.paciente, convenioP1: "", convenioP2: "", p1: 0, p2: 0 }
    acc.p2 += 1
    acc.convenioP2 = s.convenio || acc.convenioP2
    if (s.paciente) acc.paciente = s.paciente
    pacientes.set(k, acc)
  }

  return [...pacientes.entries()]
    .map(([k, acc]) => ({
      idFavorecido: k.startsWith("id:") ? Number(k.slice(3)) : null,
      paciente: acc.paciente,
      // Prioriza o convênio do período mais recente (P2); cai pro de P1 se o paciente não teve sessão em P2.
      convenio: acc.convenioP2 || acc.convenioP1,
      p1: acc.p1,
      p2: acc.p2,
      diferenca: acc.p2 - acc.p1,
    }))
    .sort((a, b) => a.paciente.localeCompare(b.paciente, "pt-BR"))
}

/**
 * Drill-down do indicativo "Por Unidade": agrega por paciente só as sessões
 * daquela unidade específica — explica por que o total líquido da unidade
 * (ex.: +10) pode esconder pacientes que aumentaram bem mais e outros que
 * reduziram na mesma unidade.
 */
export function calcularPorPacienteDaUnidade(
  sessoesP1Raw: SessaoComparativo[], sessoesP2Raw: SessaoComparativo[], unidade: string,
): PacienteComparativo[] {
  const sessoesP1 = excluirPacientesFicticios(sessoesP1Raw)
  const sessoesP2 = excluirPacientesFicticios(sessoesP2Raw)
  const contexto = [...sessoesP1, ...sessoesP2]
  return agregarPorPaciente(
    dedupAssimSaude(sessoesP1.filter(s => s.unidade === unidade), contexto),
    dedupAssimSaude(sessoesP2.filter(s => s.unidade === unidade), contexto),
  )
}

/**
 * Drill-down do indicativo "Por Paciente": lista as sessões individuais
 * (id terapia, terapia, data, hora) daquele paciente num período, aplicando o
 * mesmo dedup do Assim Saúde pra ficar consistente com o total exibido na
 * linha. `contexto` deve ser a união de P1+P2 desse paciente, pra detectar o
 * convênio Assim Saúde mesmo se o período sendo listado não tiver nenhuma
 * linha com o campo preenchido (ver dedupAssimSaude). Ordenado por data+hora.
 */
export function sessoesDoPaciente(
  sessoes: SessaoComparativo[], paciente: Pick<SessaoComparativo, "idFavorecido" | "paciente">, contexto: SessaoComparativo[] = sessoes,
): SessaoComparativo[] {
  const chave = chaveDe(paciente)
  const filtradas = dedupAssimSaude(sessoes.filter(s => chaveDe(s) === chave), contexto.filter(s => chaveDe(s) === chave))
  return [...filtradas].sort((a, b) => {
    const da = parseDataAgendamento(a.data)?.getTime() ?? 0
    const db = parseDataAgendamento(b.data)?.getTime() ?? 0
    if (da !== db) return da - db
    return a.hora.localeCompare(b.hora)
  })
}

/**
 * "Psicologia ABA": conjunto de Id Terapia que o toggle "Agrupar Psicologia
 * ABA" combina numa linha só, nos indicativos por especialidade e no
 * turnover de profissionais. Fixo por Id (não por nome) — texto de terapia
 * pode ser renomeado, o Id não.
 */
export const ROTULO_PSICOLOGIA_ABA = "Psicologia ABA"
/**
 * Ids Terapia que o relatório usa pra variantes de "Aplicador ABA" e papéis
 * ligados (Coordenador de Caso, Supervisão ABA) — todos o mesmo trabalho de
 * fato, só cotados sob especialidades diferentes. NÃO inclui 2283 (Aplicador
 * ABA (HS) = "Habilidades Sociais", tratado como especialidade própria em
 * constants.ts) nem 2252 (Psicoeducação, sem relação com ABA — estava aqui
 * por erro e inflava o grupo com sessões de outra especialidade).
 */
export const IDS_PSICOLOGIA_ABA = new Set([2261, 2317, 2260, 2353, 2248, 2263, 2269, 2262, 2264])

/** Chave estável de profissional: Id Profissional quando disponível, senão nome normalizado — mesmo padrão de chaveDe (pacientes). */
function chaveProfissional(s: Pick<SessaoComparativo, "idProfissional" | "profissional">): string {
  return s.idProfissional !== null ? `id:${s.idProfissional}` : `nome:${normTxt(s.profissional)}`
}

/**
 * Terapias em que 2+ sessões do MESMO profissional no MESMO horário são
 * atendimentos individuais de verdade (não dupla/trio na mesma vaga) — cada
 * linha continua contando 1 sessão em dedupSessaoDuplaProfissional. Fora
 * dessas, 2+ sessões nesse padrão são pacientes atendidos JUNTOS na mesma
 * vaga (comum em Terapia Ocupacional, por exemplo).
 */
const IDS_SEM_DEDUP_HORARIO_PROFISSIONAL = new Set([2251 /* Musicoterapia */, 2269 /* Aplicador ABA (EF) */])

/**
 * Colapsa sessões simultâneas do profissional (mesmo profissional, mesma
 * data, mesma hora, mesma terapia) numa só — mede horários ocupados, não
 * pacientes atendidos. Sem isso, um profissional que atende sempre em
 * dupla/trio tem o total de sessões inflado 2x/3x: uma redução real de carga
 * (ex.: parou de atender uma sala de dupla) parece maior do que é, ou uma
 * mudança de dupla pra trio parece "aumento" sem ter aumentado nada de
 * verdade. Mesma ideia de dedupAssimSaude, mas do lado do profissional (ali
 * é sobre o PACIENTE ter 2 linhas pra 1 sessão só; aqui é sobre o
 * PROFISSIONAL atender N pacientes na mesma vaga) — e aqui o critério é
 * sempre por horário (não depende de convênio), exceto nas terapias em
 * IDS_SEM_DEDUP_HORARIO_PROFISSIONAL, onde cada sessão é atendimento
 * individual real. Usada em todo cálculo "por profissional" (agregarPorProfissional,
 * calcularTurnoverProfissionais) — nunca na exibição da agenda em si, que
 * continua mostrando cada paciente (ver AgendaGridProps.agruparRepetidos).
 */
export function dedupSessaoDuplaProfissional(sessoes: SessaoComparativo[]): SessaoComparativo[] {
  const grupos = new Map<string, SessaoComparativo[]>()
  for (const s of sessoes) {
    const chaveTerapia = s.idTerapia !== null ? `id:${s.idTerapia}` : `nome:${normTxt(s.terapia)}`
    const chave = `${chaveProfissional(s)}|||${s.data}|||${s.hora}|||${chaveTerapia}`
    const grupo = grupos.get(chave) ?? []
    grupo.push(s)
    grupos.set(chave, grupo)
  }
  const out: SessaoComparativo[] = []
  for (const grupo of grupos.values()) {
    const semDedup = grupo[0].idTerapia !== null && IDS_SEM_DEDUP_HORARIO_PROFISSIONAL.has(grupo[0].idTerapia)
    if (grupo.length > 1 && !semDedup) out.push(grupo[0])
    else out.push(...grupo)
  }
  return out
}

/** Movimento de sessões de um profissional entre P1 e P2, somando TODAS as terapias — mesma forma de PacienteComparativo, mas por profissional. Base do turnover "de verdade" (por cabeça): ver calcularResumoMovimentoProfissionais. A visão por especialidade (quem saiu/entrou EM CADA terapia) é outra pergunta — ver calcularTurnoverProfissionais. */
export interface ProfissionalMovimento {
  idProfissional: number | null
  profissional: string
  p1: number
  p2: number
  diferenca: number
}

/** Agrega o total de sessões por profissional (todas as terapias somadas) — mesma lógica de agregarPorPaciente, por Id Profissional em vez de Id Favorecido. Resolve o caso do profissional com 2 terapias (ex.: Coordenador de Caso + Aplicador ABA) que aumentou numa e reduziu na outra: aqui ele entra uma vez só, no saldo líquido — não aparece ao mesmo tempo em "ganhos" e "perdas". */
export function agregarPorProfissional(sessoesP1: SessaoComparativo[], sessoesP2: SessaoComparativo[]): ProfissionalMovimento[] {
  interface Acc { profissional: string; p1: number; p2: number }
  const mapa = new Map<string, Acc>()
  function registrar(sessoes: SessaoComparativo[], lado: "p1" | "p2") {
    for (const s of sessoes) {
      if (s.idProfissional === null && !s.profissional) continue
      const k = chaveProfissional(s)
      const acc = mapa.get(k) ?? { profissional: s.profissional, p1: 0, p2: 0 }
      acc[lado] += 1
      if (s.profissional) acc.profissional = s.profissional
      mapa.set(k, acc)
    }
  }
  registrar(sessoesP1, "p1")
  registrar(sessoesP2, "p2")
  return [...mapa.entries()]
    .map(([k, acc]) => ({
      idProfissional: k.startsWith("id:") ? Number(k.slice(3)) : null,
      profissional: acc.profissional,
      p1: acc.p1, p2: acc.p2, diferenca: acc.p2 - acc.p1,
    }))
    .sort((a, b) => a.profissional.localeCompare(b.profissional, "pt-BR"))
}

/**
 * Drill-down "Ver agendamentos" do "Por Profissional": sessões individuais
 * (qualquer terapia) daquele profissional num período — mesma ideia de
 * sessoesDoPaciente, mas sem o dedup do Assim Saúde (que é sobre o paciente
 * ter 2 linhas pra 1 sessão só; não se aplica olhando do lado do
 * profissional). Ordenado por data+hora.
 */
export function sessoesDoProfissional(
  sessoes: SessaoComparativo[], profissional: Pick<SessaoComparativo, "idProfissional" | "profissional">,
): SessaoComparativo[] {
  const chave = chaveProfissional(profissional)
  const filtradas = sessoes.filter(s => chaveProfissional(s) === chave)
  return [...filtradas].sort((a, b) => {
    const da = parseDataAgendamento(a.data)?.getTime() ?? 0
    const db = parseDataAgendamento(b.data)?.getTime() ?? 0
    if (da !== db) return da - db
    return a.hora.localeCompare(b.hora)
  })
}

export interface ResumoMovimentoProfissionais {
  profissionaisAumentaram: number
  sessoesAumentadas: number
  profissionaisReduziram: number
  sessoesReduzidas: number
  profissionaisSemAlteracao: number
  /** Zero sessões (nenhuma terapia) em P1 e ≥1 em P2 — profissional novo de fato, não só numa especialidade nova. */
  profissionaisNovos: number
  sessoesNovos: number
  /** Zero sessões (nenhuma terapia) em P2 apesar de ter em P1 — profissional que realmente não está mais atendendo, não só saiu de uma especialidade específica (ver calcularTurnoverProfissionais pra esse recorte). */
  profissionaisDesligados: number
  sessoesDesligados: number
}

/** Resumo de aumento/redução/novos/desligados por profissional (headcount, soma de todas as terapias) — mesma ideia do resumo de pacientes (ComparativoResultado.resumo), reaproveitando classificarMovimento. Alimenta os cards "Ganhos/Perdas de profissionais". */
export function calcularResumoMovimentoProfissionais(movimento: ProfissionalMovimento[]): ResumoMovimentoProfissionais {
  let profissionaisAumentaram = 0, sessoesAumentadas = 0
  let profissionaisReduziram = 0, sessoesReduzidas = 0
  let profissionaisSemAlteracao = 0
  let profissionaisNovos = 0, sessoesNovos = 0
  let profissionaisDesligados = 0, sessoesDesligados = 0
  for (const p of movimento) {
    switch (classificarMovimento(p)) {
      case "novos": profissionaisNovos++; sessoesNovos += p.diferenca; break
      case "aumento": profissionaisAumentaram++; sessoesAumentadas += p.diferenca; break
      case "desligados": profissionaisDesligados++; sessoesDesligados += -p.diferenca; break
      case "reducao": profissionaisReduziram++; sessoesReduzidas += -p.diferenca; break
      case "semAlteracao": profissionaisSemAlteracao++; break
    }
  }
  return {
    profissionaisAumentaram, sessoesAumentadas, profissionaisReduziram, sessoesReduzidas, profissionaisSemAlteracao,
    profissionaisNovos, sessoesNovos, profissionaisDesligados, sessoesDesligados,
  }
}

/** Chave de agrupamento por terapia pro turnover — por Id Terapia (nunca por nome, que pode ser renomeado), com o bucket sintético de Psicologia ABA quando `agrupar` está ativo. */
function chaveGrupoTerapia(s: Pick<SessaoComparativo, "idTerapia" | "terapia">, agrupar: boolean): string {
  if (agrupar && s.idTerapia !== null && IDS_PSICOLOGIA_ABA.has(s.idTerapia)) return "grupo:psicologia-aba"
  return s.idTerapia !== null ? `terapia-id:${s.idTerapia}` : `terapia-nome:${normTxt(s.terapia)}`
}

export interface ProfissionalTurnover {
  chave: string
  idProfissional: number | null
  profissional: string
  sessoes: number
  /**
   * Só setado nos profissionais de `saida`: `true` quando o profissional
   * continua com sessão em P2 em ALGUMA OUTRA especialidade — ele não saiu da
   * clínica, só parou de atender essa terapia específica. `false` = não tem
   * mais nenhuma sessão em P2 (turnover real, ver calcularResumoMovimentoProfissionais).
   */
  aindaAtivo?: boolean
}

/** Movimento de um profissional dentro de um grupo de terapia — p1/p2/diferença, mesma ideia de PacienteComparativo. Base pra saida/entrada e pro resumo geral (aumento/redução/etc.). */
export interface ProfissionalMovimentoTerapia {
  chave: string
  idProfissional: number | null
  profissional: string
  p1: number
  p2: number
  diferenca: number
}

export interface TurnoverTerapia {
  /** Chave de agrupamento (ver chaveGrupoTerapia) — usar como key de lista/lookup, não pra exibir. */
  chave: string
  idTerapia: number | null
  terapia: string
  profissionaisP1: number
  profissionaisP2: number
  /** Todos os profissionais (união P1+P2) dessa terapia, com p1/p2/diferença — base do resumo geral. */
  movimento: ProfissionalMovimentoTerapia[]
  /** Profissionais com sessão dessa terapia em P1 e nenhuma em P2 (saíram DESSA terapia — podem continuar noutra). */
  saida: ProfissionalTurnover[]
  /** Profissionais com sessão dessa terapia em P2 sem nenhuma em P1 (novos nessa terapia). */
  entrada: ProfissionalTurnover[]
}

/**
 * Turnover de profissionais por terapia: pra cada Id Terapia (ou o bucket
 * "Psicologia ABA", se `agruparPsicologiaAba`), quais profissionais atendiam
 * em P1 e não atendem mais em P2 (e o inverso), com o total de sessões que
 * cada um tinha/passou a ter. Sempre por Id Terapia/Id Profissional — nomes
 * podem ser renomeados sem quebrar a identidade.
 */
export function calcularTurnoverProfissionais(
  sessoesP1: SessaoComparativo[], sessoesP2: SessaoComparativo[], agruparPsicologiaAba = false,
): TurnoverTerapia[] {
  interface GrupoAcc { idTerapia: number | null; terapiaP1: string; terapiaP2: string; p1: Map<string, ProfissionalTurnover>; p2: Map<string, ProfissionalTurnover> }
  const grupos = new Map<string, GrupoAcc>()

  function acc(chave: string, idTerapia: number | null): GrupoAcc {
    let g = grupos.get(chave)
    if (!g) { g = { idTerapia, terapiaP1: "", terapiaP2: "", p1: new Map(), p2: new Map() }; grupos.set(chave, g) }
    return g
  }

  function registrar(sessoes: SessaoComparativo[], lado: "p1" | "p2") {
    for (const s of sessoes) {
      if (s.idTerapia === null && !s.terapia) continue
      const chaveG = chaveGrupoTerapia(s, agruparPsicologiaAba)
      const g = acc(chaveG, chaveG === "grupo:psicologia-aba" ? null : s.idTerapia)
      if (lado === "p1") g.terapiaP1 = s.terapia || g.terapiaP1
      else g.terapiaP2 = s.terapia || g.terapiaP2
      const cp = chaveProfissional(s)
      const mapa = g[lado]
      const prof = mapa.get(cp) ?? { chave: cp, idProfissional: s.idProfissional, profissional: s.profissional || "—", sessoes: 0 }
      prof.sessoes += 1
      mapa.set(cp, prof)
    }
  }
  registrar(sessoesP1, "p1")
  registrar(sessoesP2, "p2")

  // Quem ainda tem QUALQUER sessão em P2 (em qualquer terapia) — usado só pra
  // marcar `aindaAtivo` em `saida` (ver ProfissionalTurnover): distingue quem
  // saiu de fato da clínica de quem só parou de atender essa terapia específica.
  const ativosP2Geral = new Set(sessoesP2.map(s => chaveProfissional(s)))

  const out: TurnoverTerapia[] = []
  for (const [chave, g] of grupos) {
    const terapia = chave === "grupo:psicologia-aba" ? ROTULO_PSICOLOGIA_ABA : (g.terapiaP2 || g.terapiaP1 || "—")
    const chavesProfissionais = new Set([...g.p1.keys(), ...g.p2.keys()])
    const movimento: ProfissionalMovimentoTerapia[] = [...chavesProfissionais].map(cp => {
      const em1 = g.p1.get(cp)
      const em2 = g.p2.get(cp)
      const base = em1 ?? em2!
      const p1 = em1?.sessoes ?? 0
      const p2 = em2?.sessoes ?? 0
      return { chave: cp, idProfissional: base.idProfissional, profissional: base.profissional, p1, p2, diferenca: p2 - p1 }
    })
    const saida = movimento
      .filter(m => m.p1 > 0 && m.p2 === 0)
      .map(m => ({ chave: m.chave, idProfissional: m.idProfissional, profissional: m.profissional, sessoes: m.p1, aindaAtivo: ativosP2Geral.has(m.chave) }))
      .sort((a, b) => b.sessoes - a.sessoes)
    const entrada = movimento
      .filter(m => m.p1 === 0 && m.p2 > 0)
      .map(m => ({ chave: m.chave, idProfissional: m.idProfissional, profissional: m.profissional, sessoes: m.p2 }))
      .sort((a, b) => b.sessoes - a.sessoes)
    out.push({ chave, idTerapia: g.idTerapia, terapia, profissionaisP1: g.p1.size, profissionaisP2: g.p2.size, movimento, saida, entrada })
  }
  return out.sort((a, b) => a.terapia.localeCompare(b.terapia, "pt-BR"))
}

/**
 * Drill-down do turnover: sessões de um profissional específico dentro de um
 * grupo de terapia específico (mesma chave de calcularTurnoverProfissionais),
 * num período — pra mostrar a agenda de quem saiu/entrou (reaproveita
 * AgendaGrid). Ordenado por data+hora.
 */
export function sessoesDoProfissionalNoGrupo(
  sessoes: SessaoComparativo[], profissional: Pick<SessaoComparativo, "idProfissional" | "profissional">,
  chaveGrupo: string, agruparPsicologiaAba: boolean,
): SessaoComparativo[] {
  const cp = chaveProfissional(profissional)
  const filtradas = sessoes.filter(s => chaveProfissional(s) === cp && chaveGrupoTerapia(s, agruparPsicologiaAba) === chaveGrupo)
  return [...filtradas].sort((a, b) => {
    const da = parseDataAgendamento(a.data)?.getTime() ?? 0
    const db = parseDataAgendamento(b.data)?.getTime() ?? 0
    if (da !== db) return da - db
    return a.hora.localeCompare(b.hora)
  })
}

/** Calcula os 4 indicativos comparando as sessões normalizadas de dois períodos. */
export function calcularComparativo(sessoesP1Bruto: SessaoComparativo[], sessoesP2Bruto: SessaoComparativo[]): ComparativoResultado {
  // Exclui pacientes fictícios/administrativos aqui, não na normalização —
  // ver PACIENTES_FICTICIOS_IDS: essas sessões são carga real do
  // profissional (fora do escopo deste cálculo, que é 100% do lado paciente).
  const sessoesP1Raw = excluirPacientesFicticios(sessoesP1Bruto)
  const sessoesP2Raw = excluirPacientesFicticios(sessoesP2Bruto)
  const contexto = [...sessoesP1Raw, ...sessoesP2Raw]
  const sessoesP1 = dedupAssimSaude(sessoesP1Raw, contexto)
  const sessoesP2 = dedupAssimSaude(sessoesP2Raw, contexto)
  const totalP1 = sessoesP1.length
  const totalP2 = sessoesP2.length

  // ─── Por unidade ───
  const unidades = new Map<string, { p1: number; p2: number; pacientes: Set<string> }>()
  function unidadeAcc(u: string) {
    let acc = unidades.get(u)
    if (!acc) { acc = { p1: 0, p2: 0, pacientes: new Set() }; unidades.set(u, acc) }
    return acc
  }
  for (const s of sessoesP1) { const acc = unidadeAcc(s.unidade); acc.p1 += 1; acc.pacientes.add(chaveDe(s)) }
  for (const s of sessoesP2) { const acc = unidadeAcc(s.unidade); acc.p2 += 1; acc.pacientes.add(chaveDe(s)) }

  // Agrupa as sessões por unidade pra poder contar, por paciente, quantos
  // aumentaram/reduziram dentro de cada unidade (a diferença líquida da
  // unidade sozinha pode esconder isso, ex.: +30 de uns e -20 de outros = +10).
  const sessoesP1PorUnidade = new Map<string, SessaoComparativo[]>()
  const sessoesP2PorUnidade = new Map<string, SessaoComparativo[]>()
  for (const s of sessoesP1) { const arr = sessoesP1PorUnidade.get(s.unidade) ?? []; arr.push(s); sessoesP1PorUnidade.set(s.unidade, arr) }
  for (const s of sessoesP2) { const arr = sessoesP2PorUnidade.get(s.unidade) ?? []; arr.push(s); sessoesP2PorUnidade.set(s.unidade, arr) }

  const porUnidade: UnidadeComparativo[] = [...unidades.entries()]
    .map(([unidade, v]) => {
      const pacientesDaUnidade = agregarPorPaciente(sessoesP1PorUnidade.get(unidade) ?? [], sessoesP2PorUnidade.get(unidade) ?? [])
      let sessoesAumentadas = 0, pacientesComAumento = 0
      let sessoesReduzidas = 0, pacientesComReducao = 0
      for (const p of pacientesDaUnidade) {
        if (p.diferenca > 0) { sessoesAumentadas += p.diferenca; pacientesComAumento++ }
        else if (p.diferenca < 0) { sessoesReduzidas += -p.diferenca; pacientesComReducao++ }
      }
      return {
        unidade, p1: v.p1, p2: v.p2, diferenca: v.p2 - v.p1, variacaoPct: variacao(v.p1, v.p2),
        qtdPacientes: v.pacientes.size,
        sessoesAumentadas, pacientesComAumento, sessoesReduzidas, pacientesComReducao,
      }
    })
    .sort((a, b) => {
      const ia = ORDEM_UNIDADES.indexOf(a.unidade)
      const ib = ORDEM_UNIDADES.indexOf(b.unidade)
      if (ia === -1 && ib === -1) return a.unidade.localeCompare(b.unidade)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })

  // ─── Por paciente ───
  const porPaciente = agregarPorPaciente(sessoesP1, sessoesP2)

  // ─── Resumo aumento/redução ───
  // "Aumento"/"Redução" só contam pacientes que já tinham sessão no outro
  // período (senão duplicariam com Novos Captados/Desligados abaixo).
  let pacientesAumentaram = 0, sessoesAumentadas = 0
  let pacientesReduziram = 0, sessoesReduzidas = 0
  let pacientesSemAlteracao = 0
  let pacientesNovosCaptados = 0, sessoesNovosCaptados = 0
  let pacientesDesligados = 0, sessoesDesligados = 0
  for (const p of porPaciente) {
    switch (classificarMovimento(p)) {
      case "novos": pacientesNovosCaptados++; sessoesNovosCaptados += p.diferenca; break
      case "aumento": pacientesAumentaram++; sessoesAumentadas += p.diferenca; break
      case "desligados": pacientesDesligados++; sessoesDesligados += -p.diferenca; break
      case "reducao": pacientesReduziram++; sessoesReduzidas += -p.diferenca; break
      case "semAlteracao": pacientesSemAlteracao++; break
    }
  }

  return {
    totalP1,
    totalP2,
    diferenca: totalP2 - totalP1,
    variacaoPct: variacao(totalP1, totalP2),
    porUnidade,
    porPaciente,
    resumo: {
      pacientesAumentaram, sessoesAumentadas, pacientesReduziram, sessoesReduzidas, pacientesSemAlteracao,
      pacientesNovosCaptados, sessoesNovosCaptados, pacientesDesligados, sessoesDesligados,
    },
  }
}
