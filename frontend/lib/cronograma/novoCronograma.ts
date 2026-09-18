import { DIA_COLS_DISP, DIAS_LIST, DIAS_ORD, ESP_CLINICO, EXCLUIR_OCUP, TERAPIA_TO_ESP } from "./constants"
import { isLaudoComAlta, pm } from "./helpers"
import type { CsvRow, DispRow, LaudoRow } from "@/types/cronograma"

// Referência estável para quando `suspensaoSet` não é passado — `new Set()`
// inline como default recriaria a cada chamada.
const SUSPENSAO_SET_VAZIO = new Set<string>()

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface EspEntry {
  sol: number
  aut: number
  of: number
  vigente: boolean
}

export interface SessEntry {
  tP: string
  esp: string
  prof: string
  /**
   * UUID da linha "Livre" de csv_grades_profissionais que originou esta sessão —
   * é o que permite implantar o cronograma na TiTa (ver AceiteSessao.csvGradeId).
   * Ausente quando o slot de origem não trouxe o campo (ex.: simulação de
   * Orçamento sobre grade não sincronizada).
   */
  csvGradeId?: string
  /** Unidade do slot de origem — necessária quando o cronograma mistura unidades. */
  unidade?: string
}

/** Faixas de horário de cada turno, em minutos desde a meia-noite (start da sessão). */
export const TURNOS: Record<"manha" | "tarde", AvailWindow> = {
  // 08:00 → 12:00 (última sessão começa 11:20 e termina 12:00)
  manha: { inicio: 480, fim: 720 },
  // 13:00 → 17:40 (última sessão começa 17:00 e termina 17:40)
  tarde: { inicio: 780, fim: 1060 },
}

export interface AvailWindow {
  inicio: number
  fim: number
}

export interface Alerta {
  tipo: "error" | "warn" | "info"
  msg: string
}

export interface NovoCronogramaResult {
  schedule: Record<string, Record<string, SessEntry>>
  espTable: Record<string, EspEntry>
  alertas: Alerta[]
  availWindows: Record<string, AvailWindow>
  turnoClinico: "manha" | "tarde" | null
}

// ─── ALGORITMO ────────────────────────────────────────────────────────────────

export function buildNewCronograma(
  paciente: string,
  unidade: string,
  dispRows: DispRow[] | null | undefined,
  laudosRows: LaudoRow[] | null | undefined,
  livreSlots: CsvRow[],
  suspensaoSet: Set<string> = SUSPENSAO_SET_VAZIO,
): NovoCronogramaResult {
  const dispRow = (dispRows || []).find(
    r => String(r["Nome Paciente"] || "").trim().toLowerCase() === paciente.trim().toLowerCase(),
  )

  const availWindows: Record<string, AvailWindow> = {}
  if (dispRow) {
    for (const [dia, [ic, fc]] of Object.entries(DIA_COLS_DISP)) {
      const ini = String(dispRow[ic] || "").trim()
      const fim = String(dispRow[fc] || "").trim()
      if (ini && fim && ini !== "—" && fim !== "—") {
        const hi = pm(ini)
        const hf = pm(fim)
        if (hi !== null && hf !== null) availWindows[dia] = { inicio: hi, fim: hf }
      }
    }
  }

  const escolaIni = pm(String(dispRow?.["Escola Início"] || "").trim())
  const turnoClinico: "manha" | "tarde" | null =
    escolaIni === null ? null : escolaIni < 780 ? "tarde" : "manha"

  const espTable = construirEspTable(paciente, laudosRows, true, suspensaoSet)

  const inWindow = (dia: string, hi: number) => {
    const w = availWindows[dia]
    return w ? hi >= w.inicio && hi < w.fim : false
  }
  const inTurno = (hi: number) =>
    turnoClinico === null ? true : turnoClinico === "manha" ? hi < 780 : hi >= 780

  const eligible = (livreSlots || []).filter(r => {
    const hiVal = Number(r.HI ?? r["HI"] ?? null)
    return (
      String(r.Unidade || r["Unidade"] || "") === unidade &&
      r.HI !== null && !isNaN(hiVal) &&
      !EXCLUIR_OCUP.has(r["Terapia"]) &&
      inWindow(r["Dia da Semana"], hiVal) &&
      inTurno(hiVal)
    )
  })

  const schedule = posicionarSessoes(espTable, eligible)

  const alertas: Alerta[] = []
  if (!dispRow) alertas.push({ tipo: "error", msg: "Paciente não encontrado no relatório de disponibilidade — carregue o CSV do Órbita" })
  if (!turnoClinico) alertas.push({ tipo: "info", msg: "Escola não informada: todos os horários da disponibilidade foram considerados" })
  alertas.push(...alertasPosicionamento(schedule, espTable))

  return { schedule, espTable, alertas, availWindows, turnoClinico }
}

/**
 * Variante de buildNewCronograma para quando NÃO existe relatório de
 * disponibilidade da família: o usuário informa turno e unidade(s) à mão. Usada
 * pelas modalidades "Criar Novo Cronograma" (paciente com laudo mas zero sessões
 * agendadas) e "Orçamento" (paciente ainda não cadastrado, laudo digitado na
 * tela) da página de Ocupação de Paciente.
 *
 * Difere de buildNewCronograma em três pontos, e só neles:
 *  - a janela de cada dia é o turno escolhido, igual para todos os dias, em vez
 *    de vir das colunas por dia de DispRow;
 *  - aceita mais de uma unidade (o usuário pode permitir dias em unidades
 *    distintas), em vez de uma só;
 *  - conta a quantidade autorizada de qualquer laudo do paciente, vigente ou
 *    não — aqui a decisão de negócio é só "tem terapia com quantidade > 0"
 *    (regra confirmada pelo usuário para esta tela).
 * O posicionamento em si (ordem das especialidades, contiguidade de 40 min,
 * contagem ofertado × autorizado) é exatamente o mesmo código.
 */
export function buildNovoCronogramaManual(
  paciente: string,
  unidades: string[],
  turno: "manha" | "tarde",
  laudosRows: LaudoRow[] | null | undefined,
  livreSlots: CsvRow[],
  suspensaoSet: Set<string> = SUSPENSAO_SET_VAZIO,
): NovoCronogramaResult {
  const janela = TURNOS[turno]
  const unidadesPermitidas = new Set(unidades)

  // Mesma janela em todos os dias úteis — é o que a grade renderiza como
  // "disponível, não preenchido" (ver availWindows em NovoCronogramaTab). Sábado
  // fica fora: a operação clínica destas modalidades é de segunda a sexta (mesmo
  // corte de DIAS_UTIL em OcupPacMode). Um slot livre de sábado que porventura
  // exista ainda pode ser alocado — a grade passa a exibir o dia por causa do
  // schedule, não da janela.
  const availWindows: Record<string, AvailWindow> = {}
  for (const dia of DIAS_LIST.slice(0, 5)) availWindows[dia] = { ...janela }

  const espTable = construirEspTable(paciente, laudosRows, false, suspensaoSet)

  const eligible = (livreSlots || []).filter(r => {
    const hiVal = Number(r.HI ?? r["HI"] ?? null)
    return (
      unidadesPermitidas.has(String(r.Unidade || r["Unidade"] || "")) &&
      r.HI !== null && !isNaN(hiVal) &&
      !EXCLUIR_OCUP.has(r["Terapia"]) &&
      hiVal >= janela.inicio && hiVal < janela.fim
    )
  })

  const schedule = posicionarSessoes(espTable, eligible)

  const alertas: Alerta[] = []
  if (unidadesPermitidas.size === 0) {
    alertas.push({ tipo: "error", msg: "Selecione ao menos uma unidade" })
  }
  if (Object.keys(espTable).length === 0) {
    alertas.push({ tipo: "error", msg: "Nenhuma terapia com quantidade autorizada para este paciente" })
  }
  alertas.push(...alertasPosicionamento(schedule, espTable))

  return { schedule, espTable, alertas, availWindows, turnoClinico: turno }
}

// ─── TIPOS PARA GERAÇÃO EXPLORATÓRIA (Modos 2 e 3) ───────────────────────────

export interface ProfAlt {
  tP: string
  prof: string
  unidade: string
  csvGradeId?: string
}

export interface EspAltManual {
  esp: string
  tP: string
  prof: string
  unidade: string
  csvGradeId?: string
  profAlts: ProfAlt[]
}

export interface SugestaoManual {
  /** Identificador único: "dia|||hora|||esp" */
  id: string
  dia: string
  hora: string
  esp: string
  tP: string
  prof: string
  unidade: string
  csvGradeId?: string
  profAlts: ProfAlt[]
  espAlts: EspAltManual[]
}

export interface SugestoesManualResult {
  sugestoes: SugestaoManual[]
  espTable: Record<string, EspEntry>
  alertas: Alerta[]
}

// ─── GERADOR EXPLORATÓRIO (Modos 2 e 3) ──────────────────────────────────────

/**
 * Gerador exploratório para "Criar Novo Cronograma" e "Orçamento": em vez de
 * alocar exatamente `aut` sessões (como buildNovoCronogramaManual), devolve
 * **toda vaga livre elegível** para que o operador clínico escolha quais quer.
 *
 * Para cada slot (dia + hora), agrupa por especialidade e retorna:
 *  - Uma especialidade default (maior `aut`, desempate por ESP_ORD).
 *  - `espAlts[]`: especialidades alternativas disponíveis naquele horário.
 *  - `profAlts[]`: profissionais alternativos para cada especialidade.
 *
 * Não impõe contiguidade nem limite de quantidade — todo controle de excesso
 * (quantidade selecionada > autorizada) e de unidade por dia é feito na UI.
 */
export function buildSugestoesManual(
  paciente: string,
  unidades: string[],
  turno: "manha" | "tarde",
  laudosRows: LaudoRow[] | null | undefined,
  livreSlots: CsvRow[],
  suspensaoSet: Set<string> = SUSPENSAO_SET_VAZIO,
): SugestoesManualResult {
  const janela = TURNOS[turno]
  const unidadesPermitidas = new Set(unidades)

  const espTable = construirEspTable(paciente, laudosRows, false, suspensaoSet)

  // Especialidades com autorização > 0 — única condição de elegibilidade.
  const espsValidas = new Set(
    Object.entries(espTable).filter(([, v]) => v.aut > 0).map(([e]) => e),
  )

  // Terapias correspondentes às esps válidas.
  const terapiasValidas = new Set<string>()
  for (const esp of espsValidas) {
    for (const t of (ESP_CLINICO[esp] || [])) {
      if (!EXCLUIR_OCUP.has(t)) terapiasValidas.add(t)
    }
  }

  // Filtra vagas elegíveis: turno + unidade + terapia válida.
  const eligible = (livreSlots || []).filter(r => {
    const hiVal = Number(r.HI ?? r["HI"] ?? null)
    return (
      unidadesPermitidas.has(String(r.Unidade || r["Unidade"] || "")) &&
      r.HI !== null && !isNaN(hiVal) &&
      terapiasValidas.has(r["Terapia"]) &&
      hiVal >= janela.inicio && hiVal < janela.fim
    )
  })

  // Agrupa por dia + hora → por esp → lista de profissionais.
  // Chave: "dia|||horaStr"
  type SlotEntry = {
    tP: string; prof: string; unidade: string; csvGradeId?: string
  }
  const slotMap: Record<string, Record<string, SlotEntry[]>> = {}
  const seenSlots = new Set<string>()

  for (const r of eligible) {
    const dia = r["Dia da Semana"]
    const hiStr = String(r.HI_str || r["HI_str"] || "")
    const tP = r["Terapia"]
    const prof = r["Profissional"]
    const unidade = String(r.Unidade || r["Unidade"] || "")

    // Deduplica mesma combinação dia+hora+terapia+profissional.
    const dedup = `${dia}|||${hiStr}|||${tP}|||${prof}`
    if (seenSlots.has(dedup)) continue
    seenSlots.add(dedup)

    const esp = TERAPIA_TO_ESP[tP]
    if (!esp || !espsValidas.has(esp)) continue

    const slotKey = `${dia}|||${hiStr}`
    if (!slotMap[slotKey]) slotMap[slotKey] = {}
    if (!slotMap[slotKey][esp]) slotMap[slotKey][esp] = []
    slotMap[slotKey][esp].push({
      tP, prof, unidade,
      csvGradeId: r.CsvGradeId ? String(r.CsvGradeId) : undefined,
    })
  }

  // Ordena especialidades pela ordem clínica, desempate por aut desc.
  const ordIdx = (esp: string) => {
    const i = ESP_ORD.indexOf(esp)
    return i >= 0 ? i : ESP_ORD.length
  }
  const espSort = (a: string, b: string) => {
    const oi = ordIdx(a) - ordIdx(b)
    if (oi !== 0) return oi
    return (espTable[b]?.aut ?? 0) - (espTable[a]?.aut ?? 0)
  }

  const sugestoes: SugestaoManual[] = []

  for (const [slotKey, porEsp] of Object.entries(slotMap)) {
    const [dia, hora] = slotKey.split("|||")
    const espsOrdenadas = Object.keys(porEsp).sort(espSort)
    if (espsOrdenadas.length === 0) continue

    const [defaultEsp, ...altEsps] = espsOrdenadas

    // Constrói a entrada default.
    const defaultEntries = porEsp[defaultEsp]
    const [primary, ...restProfs] = defaultEntries
    const profAlts: ProfAlt[] = restProfs.map(e => ({
      tP: e.tP, prof: e.prof, unidade: e.unidade, csvGradeId: e.csvGradeId,
    }))

    // Constrói espAlts.
    const espAlts: EspAltManual[] = altEsps.map(esp => {
      const entries = porEsp[esp]
      const [altPrimary, ...altRest] = entries
      return {
        esp,
        tP: altPrimary.tP,
        prof: altPrimary.prof,
        unidade: altPrimary.unidade,
        csvGradeId: altPrimary.csvGradeId,
        profAlts: altRest.map(e => ({
          tP: e.tP, prof: e.prof, unidade: e.unidade, csvGradeId: e.csvGradeId,
        })),
      }
    })

    sugestoes.push({
      id: `${dia}|||${hora}|||${defaultEsp}`,
      dia, hora,
      esp: defaultEsp,
      tP: primary.tP,
      prof: primary.prof,
      unidade: primary.unidade,
      csvGradeId: primary.csvGradeId,
      profAlts,
      espAlts,
    })
  }

  // Ordena por dia (ordem clínica) → hora (ascendente).
  sugestoes.sort((a, b) =>
    (DIAS_ORD[a.dia] ?? 9) - (DIAS_ORD[b.dia] ?? 9) ||
    (pm(a.hora) ?? 0) - (pm(b.hora) ?? 0),
  )

  const alertas: Alerta[] = []
  if (unidadesPermitidas.size === 0) {
    alertas.push({ tipo: "error", msg: "Selecione ao menos uma unidade" })
  }
  if (espsValidas.size === 0) {
    alertas.push({ tipo: "error", msg: "Nenhuma terapia com quantidade autorizada para este paciente" })
  }

  return { sugestoes, espTable, alertas }
}

// ─── NÚCLEO COMPARTILHADO ─────────────────────────────────────────────────────

/**
 * Consolida o laudo do paciente em quantidade solicitada/autorizada por
 * especialidade, descartando as que já tiveram alta. `somenteVigenteConta`
 * distingue as duas regras de negócio em uso: o fluxo com disponibilidade da
 * família só considera autorização de laudo vigente, enquanto as modalidades da
 * tela de Ocupação de Paciente contam qualquer laudo com quantidade > 0.
 */
function construirEspTable(
  paciente: string,
  laudosRows: LaudoRow[] | null | undefined,
  somenteVigenteConta: boolean,
  suspensaoSet: Set<string> = SUSPENSAO_SET_VAZIO,
): Record<string, EspEntry> {
  const espTable: Record<string, EspEntry> = {}
  // "Alta" (laudo) e "Suspensão Temporária" (cadastro do paciente) — duas
  // fontes, mesmo efeito: a especialidade não entra na tabela.
  const excluidosEsp = new Set<string>()

  for (const r of laudosRows || []) {
    if (String(r["Paciente"] || "").trim() !== paciente) continue
    const esp = String(r["Especialidade"] || "").trim()
    if (!esp) continue
    if (isLaudoComAlta(r as Record<string, unknown>) || suspensaoSet.has(`${paciente}|||${esp}`)) {
      excluidosEsp.add(esp)
      continue
    }
    const sol = parseFloat(String(r["Qtd laudo"] || "0")) || 0
    const aut = parseFloat(String(r["Qtd autorizada"] || "0")) || 0
    const vigente = String(r["Situação"] || "").toLowerCase() === "vigente"
    if (!espTable[esp]) espTable[esp] = { sol: 0, aut: 0, of: 0, vigente: false }
    espTable[esp].sol = Math.max(espTable[esp].sol, sol)
    if (vigente) espTable[esp].vigente = true
    if (vigente || !somenteVigenteConta) espTable[esp].aut = Math.max(espTable[esp].aut, aut)
  }
  for (const esp of excluidosEsp) delete espTable[esp]

  // Sem quantidade autorizada não há nada a posicionar nem a exibir como meta.
  if (!somenteVigenteConta) {
    for (const [esp, v] of Object.entries(espTable)) if (v.aut <= 0) delete espTable[esp]
  }
  return espTable
}

const ESP_ORD = [
  "Fonoaudiologia", "Terapia Ocupacional", "Psicologia ABA", "Musicoterapia",
  "Psicopedagogia", "Psicomotricidade", "Terapia Alimentar", "Fisioterapia",
  "Fisioterapia Aquática", "Equoterapia", "Arteterapia", "Psicologia", "Habilidades Sociais",
]

/**
 * Aloca as sessões autorizadas de cada especialidade nos slots elegíveis,
 * incrementando `of` em espTable (mutação deliberada: é a contagem de ofertado
 * que o chamador devolve na mesma estrutura). Regras preservadas do algoritmo
 * original: especialidades na ordem clínica de ESP_ORD, um slot por dia+hora, e
 * sessões do mesmo dia sempre contíguas de 40 em 40 minutos (sem buraco).
 */
function posicionarSessoes(
  espTable: Record<string, EspEntry>,
  eligible: CsvRow[],
): Record<string, Record<string, SessEntry>> {
  const toPlace = Object.fromEntries(
    Object.entries(espTable).filter(([, v]) => v.aut > 0).map(([e, v]) => [e, v.aut]),
  )
  const orderedEsps = [
    ...ESP_ORD.filter(e => toPlace[e]),
    ...Object.keys(toPlace).filter(e => !ESP_ORD.includes(e)),
  ]

  const schedule: Record<string, Record<string, SessEntry>> = {}
  const usedSlots = new Set<string>()

  for (const esp of orderedEsps) {
    let needed = toPlace[esp] || 0
    if (needed <= 0) continue
    const terapiasEsp = (ESP_CLINICO[esp] || []).filter(t => !EXCLUIR_OCUP.has(t))
    const candidates = eligible
      .filter(r => {
        const hiStr = String(r.HI_str || r["HI_str"] || "")
        return terapiasEsp.includes(r["Terapia"]) && !usedSlots.has(`${r["Dia da Semana"]}|||${hiStr}`)
      })
      .sort((a, b) => {
        const d = (DIAS_ORD[a["Dia da Semana"]] ?? 9) - (DIAS_ORD[b["Dia da Semana"]] ?? 9)
        return d !== 0 ? d : (Number(a.HI ?? 0)) - (Number(b.HI ?? 0))
      })

    for (const slot of candidates) {
      if (needed <= 0) break
      const dia = slot["Dia da Semana"]
      const hiStr = String(slot.HI_str || slot["HI_str"] || "")
      const hi = Number(slot.HI ?? 0)
      const dayTimes = Object.keys(schedule[dia] || {})
        .map(h => pm(h))
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b)
      if (dayTimes.length > 0) {
        const all = [...dayTimes, hi].sort((a, b) => a - b)
        if (all.some((t, i) => i > 0 && t - all[i - 1] !== 40)) continue
      }
      if (!schedule[dia]) schedule[dia] = {}
      schedule[dia][hiStr] = {
        tP: slot["Terapia"],
        esp,
        prof: slot["Profissional"],
        csvGradeId: slot.CsvGradeId ? String(slot.CsvGradeId) : undefined,
        unidade: String(slot.Unidade || slot["Unidade"] || "") || undefined,
      }
      usedSlots.add(`${dia}|||${hiStr}`)
      espTable[esp].of++
      needed--
    }
  }
  return schedule
}

/** Alertas que dependem só do resultado do posicionamento (comuns às duas variantes). */
function alertasPosicionamento(
  schedule: Record<string, Record<string, SessEntry>>,
  espTable: Record<string, EspEntry>,
): Alerta[] {
  const alertas: Alerta[] = []
  for (const [dia, ds] of Object.entries(schedule))
    if (Object.keys(ds).length === 1) alertas.push({ tipo: "warn", msg: `${dia}: apenas 1 sessão — regra exige mínimo 2 (R2.1)` })
  for (const [esp, { aut, of: of_ }] of Object.entries(espTable))
    if (aut > 0 && of_ < aut) alertas.push({ tipo: "info", msg: `${esp}: ${of_}/${aut} sessões alocadas — disponibilidade insuficiente` })
  return alertas
}
