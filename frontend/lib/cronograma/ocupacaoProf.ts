// ─── LÓGICA DE CÁLCULO: OCUPAÇÃO DE PROFISSIONAIS ────────────────────────────
// Migrado de calculadora-remuneracao/src/utils/ocupacao.js

import { B, normTxt } from "./constants"
import { fmtH, fmtNumBR, fmtPctOcup, hhmm, cleanTxt } from "./helpers"
import type {
  BaseOcup,
  OcupacaoFinalizada,
  OcupacaoAgregada,
  OcupacaoPorDia,
  OcupacaoPorTurno,
  OcupacaoPorEspecialidade,
  OcupacaoPorUnidade,
  SlotNormalizado,
  SlotData,
} from "@/types/ocupacaoProf"
import { OCUP_FAIXAS } from "./ocupacaoConst"

// ─── CONSTANTES LOCAIS ────────────────────────────────────────────────────────

const DOW_PT_LONG: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
}

const SLOT_CAP_ESP: Record<string, number> = {
  "musicoterapia":      1,  // fallback; capacidade real definida por profissional abaixo
  "aplicador aba (ef)": 1,
  "aplicador aba ef":   1,
}

// Capacidade de vagas por musicoterapeuta × dia da semana (1=Seg … 5=Sex)
// DOW ausente = profissional não atende nesse dia (sem impacto no cálculo)
const MUSICO_CAPAC_POR_DIA: Record<string, Partial<Record<number, number>>> = {
  "rachel silva de castro de brito":     { 1: 1, 3: 2, 4: 2 },
  "thiago henrique brito do nascimento": { 1: 3, 2: 3 },
  "luiz gustavo mello de araujo":        { 3: 1, 4: 1, 5: 1 },
  "rosenilza abreu da silva leiras":     { 3: 2 },
  "ianca aparecida goncalves izidorio":  { 5: 3 },
}

const DOW_ABBR: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex" }

/**
 * Cadastro editável de "quantas vagas simultâneas esse profissional atende
 * nesse dia" — chave normalizada (normTxt) do nome do profissional, valor por
 * dow (1=Seg…5=Sex). Vem do banco (cronograma_capacidade_profissional_dia,
 * ver useOcupacaoProf) e é o que a tela "Cadastro de quantidade esperada de
 * pacientes" (cronograma/indicadores) lê e escreve. Ausência de chave/dow =
 * sem cadastro ainda → cai no padrão (MUSICO_CAPAC_POR_DIA ou 1).
 */
export type CapacidadeOverrides = Record<string, Partial<Record<number, number>>>

/**
 * Capacidade "de fábrica" — o que valia antes do cadastro editável existir.
 * Continua servindo de fallback quando não há linha no banco pra aquele
 * profissional+dia (ex.: cálculo de remuneração em lib/remuneracao/calculo.ts,
 * que não busca o cadastro do banco — ver comentário em getSlotCap).
 */
function capacidadeDeFabrica(prof: string, dow: number): number | undefined {
  return MUSICO_CAPAC_POR_DIA[normTxt(prof)]?.[dow]
}

/** Capacidade esperada resolvida (banco > de fábrica > 1) — usada pela tela de cadastro para pré-preencher cada célula. */
export function capacidadeEsperadaProfissionalDia(
  prof: string, dow: number, overridesFromDB?: CapacidadeOverrides,
): number {
  const viaDB = overridesFromDB?.[normTxt(prof)]?.[dow]
  if (viaDB !== undefined) return viaDB
  return capacidadeDeFabrica(prof, dow) ?? 1
}

/** Dias (1-5) com capacidade explicitamente cadastrada (banco OU de fábrica) para este profissional — usado só para montar o texto "vagas simultâneas por dia". */
function diasComCapacidadeExplicita(prof: string, overridesFromDB?: CapacidadeOverrides): number[] {
  const viaDB = overridesFromDB?.[normTxt(prof)] ?? {}
  const viaHard = MUSICO_CAPAC_POR_DIA[normTxt(prof)] ?? {}
  const dows = new Set<number>([...Object.keys(viaDB), ...Object.keys(viaHard)].map(Number))
  return [...dows].sort((a, b) => a - b)
}

// ─── ACUMULADOR INTERNO ───────────────────────────────────────────────────────

type BaseOcupAcc = BaseOcup & {
  _unidades?: Set<string>
  unidade?: string
  unidades?: string[]
}

const BASE_OCUP_KEYS = Object.keys({
  slotsTotal: 0, slotsOcupados: 0, slotsLivres: 0,
  horariosTotal: 0, horariosOcupados: 0, horariosLivres: 0,
  horasTotal: 0, horasOcupadas: 0, horasLivres: 0,
  horasTecnicas: 0, horasAssistenciais: 0,
}) as (keyof BaseOcup)[]

// ─── CAPACIDADE ───────────────────────────────────────────────────────────────

function capacidadePadraoEsp(terapia: string): number {
  return SLOT_CAP_ESP[normTxt(terapia)] ?? 1
}

/**
 * `overridesFromDB` vem do cadastro editável (cronograma_capacidade_profissional_dia,
 * carregado em useOcupacaoProf) e — diferente do fallback "de fábrica" abaixo —
 * vale para QUALQUER terapia daquele profissional nesse dia, não só
 * Musicoterapia: é um cadastro por profissional × dia, não por terapia. Sem
 * override no banco, cai no comportamento antigo (só Musicoterapia).
 *
 * `lib/remuneracao/calculo.ts` chama esta função SEM overridesFromDB de
 * propósito — é uma função pura sem acesso a banco (ver cabeçalho do
 * arquivo), então o cálculo de remuneração continua só no fallback "de
 * fábrica", isolado de edições feitas na tela de indicadores.
 */
export function getSlotCap(prof: string, esp: string, dow?: number, overridesFromDB?: CapacidadeOverrides): number {
  if (dow !== undefined) {
    const viaDB = overridesFromDB?.[normTxt(prof)]?.[dow]
    if (viaDB !== undefined) return viaDB
    if (normTxt(esp) === "musicoterapia") {
      const capDia = capacidadeDeFabrica(prof, dow)
      if (capDia !== undefined) return capDia
    }
  }
  return capacidadePadraoEsp(esp)
}

// ─── NORMALIZAÇÃO ─────────────────────────────────────────────────────────────

export function normalizarUnidadeOcupacao(unidade: string): string {
  const raw = cleanTxt(unidade)
  const n = normTxt(raw)
  if (!n) return "Consertar Unidade no sistema"
  if (n.includes("ambiente natural") || n.includes("casa") || n.includes("escola") || n.includes("externo")) return "Ambiente Natural"
  if (n.includes("fazendinha")) return "Fazendinha"
  if (n.includes("padre miguel")) return "Padre Miguel"
  if (n.includes("realengo")) return "Realengo"
  if (n.includes("campo grande") || n.includes("terceirizada")) return "Unidade Terceirizada - Campo Grande"
  return "Consertar Unidade no sistema"
}

export function parseUnidadeSala(sala: string): string {
  const raw = cleanTxt(sala)
  if (!raw) return "Consertar Unidade no sistema"
  const n = normTxt(raw)
  const mUnid = raw.match(/^Unid\.\s*([^\-–—]+)\s*[-–—]?/i)
  if (mUnid?.[1]) return normalizarUnidadeOcupacao(mUnid[1])
  if (n.includes("ambiente natural") || n.includes("casa") || n.includes("escola") || n.includes("externo")) return "Ambiente Natural"
  if (n.includes("fazendinha")) return "Fazendinha"
  if (n.includes("padre miguel")) return "Padre Miguel"
  if (n.includes("realengo")) return "Realengo"
  if (n.includes("campo grande") || n.includes("terceirizada")) return "Unidade Terceirizada - Campo Grande"
  return normalizarUnidadeOcupacao(raw.split(/[-–—]/)[0].trim())
}

// ─── FILTROS ──────────────────────────────────────────────────────────────────

export function parseFiltroComparecimento(txt: string): { dow: number; modo: "comparece" | "nao_comparece" } | null {
  const q = normTxt(txt)
  if (!q || q === "todos" || q === "todos os dias") return null
  const dias: [number, string[]][] = [
    [1, ["segunda", "seg"]],
    [2, ["terca", "terca", "ter"]],
    [3, ["quarta", "qua"]],
    [4, ["quinta", "qui"]],
    [5, ["sexta", "sex"]],
  ]
  const found = dias.find(([, alts]) => alts.some(a => q.includes(normTxt(a))))
  if (!found) return null
  const negativo = q.includes("nao") || q.includes("nao compare") || q.includes("ausente")
  return { dow: found[0], modo: negativo ? "nao_comparece" : "comparece" }
}

export function findByLabelOrKey(
  lista: { k: string; l: string }[],
  texto: string,
  fallback: string,
): string {
  const q = normTxt(texto)
  if (!q) return fallback
  return lista.find(x => normTxt(x.k) === q || normTxt(x.l) === q || normTxt(x.l).includes(q))?.k ?? fallback
}

// ─── CORES ────────────────────────────────────────────────────────────────────

export function corFaixaOcupacao(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return B.navy
  const p = Number(pct) > 1 ? Number(pct) / 100 : Number(pct)
  if (!Number.isFinite(p)) return B.navy
  if (p >= 0.8) return B.green
  if (p >= 0.6) return B.blue
  if (p >= 0.4) return B.yellow
  return B.red
}

export function textoFaixaOcupacao(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return B.navy
  const p = Number(pct) > 1 ? Number(pct) / 100 : Number(pct)
  if (!Number.isFinite(p)) return B.navy
  return p >= 0.4 && p < 0.6 ? B.navy : "#fff"
}

// ─── BASE DE OCUPAÇÃO ────────────────────────────────────────────────────────

export function novaBaseOcup(): BaseOcup {
  return {
    slotsTotal: 0, slotsOcupados: 0, slotsLivres: 0,
    horariosTotal: 0, horariosOcupados: 0, horariosLivres: 0,
    horasTotal: 0, horasOcupadas: 0, horasLivres: 0,
    horasTecnicas: 0, horasAssistenciais: 0,
  }
}

export function somaBaseOcup(dest: BaseOcupAcc, src: BaseOcupAcc): BaseOcupAcc {
  BASE_OCUP_KEYS.forEach(k => { dest[k] = (dest[k] || 0) + (src[k] || 0) })
  const unidades: string[] = []
  if (src?.unidade) unidades.push(src.unidade)
  if (Array.isArray(src?.unidades)) unidades.push(...(src.unidades as string[]))
  if (src?._unidades instanceof Set) unidades.push(...src._unidades)
  if (unidades.length) {
    if (!(dest._unidades instanceof Set)) {
      dest._unidades = new Set(Array.isArray(dest.unidades) ? dest.unidades : [])
    }
    unidades.map(cleanTxt).filter(Boolean).forEach(u => dest._unidades!.add(u))
  }
  return dest
}

export function baseCompactaOcup(b: BaseOcup, capacidadeMultipla?: boolean): string {
  const cm = capacidadeMultipla ?? ((b.slotsTotal || 0) > (b.horariosTotal || 0) + 0.0001)
  if (!(b?.slotsTotal > 0)) return ""
  if (cm) {
    const sess = `${fmtNumBR(b.horariosOcupados, b.horariosOcupados % 1 ? 1 : 0)}/${fmtNumBR(b.horariosTotal, b.horariosTotal % 1 ? 1 : 0)} sess.`
    const vg   = `${fmtNumBR(b.slotsOcupados, b.slotsOcupados % 1 ? 1 : 0)}/${fmtNumBR(b.slotsTotal, b.slotsTotal % 1 ? 1 : 0)} vagas`
    return `${sess} · ${vg}`
  }
  const num = b.horariosOcupados
  const den = b.horariosTotal
  return `${fmtNumBR(num, num % 1 ? 1 : 0)}/${fmtNumBR(den, den % 1 ? 1 : 0)}`
}

export function finalizarBaseOcup(b: BaseOcupAcc): OcupacaoFinalizada {
  const pct = b.slotsTotal > 0 ? b.slotsOcupados / b.slotsTotal : null
  const capacidadeMultipla = (b.slotsTotal || 0) > (b.horariosTotal || 0) + 0.0001
  const baseCompacta = baseCompactaOcup(b, capacidadeMultipla)
  const baseTexto = b.slotsTotal > 0
    ? capacidadeMultipla
      ? `${fmtNumBR(b.horariosOcupados, 0)} de ${fmtNumBR(b.horariosTotal, 0)} sessões · ${fmtNumBR(b.slotsOcupados, b.slotsOcupados % 1 ? 1 : 0)} de ${fmtNumBR(b.slotsTotal, b.slotsTotal % 1 ? 1 : 0)} vagas (múltiplos pacientes na mesma sessão) = ${fmtPctOcup(pct)}`
      : `${fmtNumBR(b.horariosOcupados, b.horariosOcupados % 1 ? 1 : 0)} de ${fmtNumBR(b.horariosTotal, b.horariosTotal % 1 ? 1 : 0)} sessões ocupadas = ${fmtPctOcup(pct)}`
    : "Sem base de agenda para calcular ocupação"
  const baseHorasTexto = b.horasTotal > 0
    ? capacidadeMultipla
      ? `Agenda do profissional: ${fmtNumBR(b.horariosOcupados, 0)} de ${fmtNumBR(b.horariosTotal, 0)} sessões com paciente · ${fmtH(b.horasOcupadas)} de ${fmtH(b.horasTotal)}`
      : `${fmtH(b.horasOcupadas)} ocupadas de ${fmtH(b.horasTotal)} disponíveis`
    : "Sem carga semanal calculada"
  const unidades = [
    ...(b._unidades instanceof Set
      ? b._unidades
      : new Set(Array.isArray(b.unidades) ? b.unidades : []))
  ].sort((a, c) => a.localeCompare(c))
  const { _unidades, unidade, ...limpo } = b as BaseOcupAcc & { unidade?: string }
  return {
    ...limpo,
    unidades,
    pct,
    ociosidade: pct === null ? null : 1 - pct,
    capacidadeMultipla,
    baseCompacta,
    baseTexto,
    baseHorasTexto,
    unidadeTexto: unidades.join(", "),
  }
}

// ─── TURNO ────────────────────────────────────────────────────────────────────

export function turnoDoHorario(min: number | null): "Manhã" | "Tarde" {
  return min !== null && min < 12 * 60 ? "Manhã" : "Tarde"
}

// ─── PREDICADOS ───────────────────────────────────────────────────────────────

export function dentroFaixaOcupacao(pct: number | null | undefined, faixaKey: string): boolean {
  const f = OCUP_FAIXAS.find(x => x.k === faixaKey)
  if (!f || f.k === "todos") return true
  if (pct === null || pct === undefined) return false
  return pct >= (f.min ?? 0) && pct < (f.max ?? 1)
}

export function temBaseOcupacaoLinha(x: Partial<OcupacaoFinalizada> | null | undefined): boolean {
  if (!x) return false
  return (x.horasTotal || 0) > 0 || (x.slotsTotal || 0) > 0 || x.pct !== null
}

export function temComparecimentoNoTurno(
  ocupacao: OcupacaoAgregada | null | undefined,
  dow: number,
  turno: string,
): boolean {
  const x = ocupacao?.porTurno?.find(t => t.dow === dow && t.turno === turno)
  return !!x && temBaseOcupacaoLinha(x) && ((x.horariosOcupados || 0) > 0 || (x.slotsOcupados || 0) > 0 || (x.horasOcupadas || 0) > 0)
}

// ─── AGENDA ───────────────────────────────────────────────────────────────────

export function resumirJornadaAgenda(slotData: SlotData): string {
  const dias = Object.values(slotData?.diasInfo || {})
  if (!dias.length) return ""
  const slots = dias.flatMap(di => Object.values(di.slotDetails || {}))
  if (!slots.length) return ""
  const morning = slots.filter(s => s.ini < 12 * 60)
  const afternoon = slots.filter(s => s.fim > 13 * 60 && s.ini >= 12 * 60)
  const mStart = morning.length ? Math.min(...morning.map(s => s.ini)) : null
  const mEnd   = morning.length ? Math.max(...morning.map(s => s.fim)) : null
  const aStart = afternoon.length ? Math.min(...afternoon.map(s => s.ini)) : null
  const aEnd   = afternoon.length ? Math.max(...afternoon.map(s => s.fim)) : null
  const parts: string[] = []
  if (mStart !== null && mEnd !== null) parts.push(`${hhmm(mStart)} às ${hhmm(mEnd)}`)
  if (aStart !== null && aEnd !== null) parts.push(`${hhmm(aStart)} às ${hhmm(aEnd)}`)
  if (parts.length === 2 && mEnd !== null && aStart !== null && mEnd <= 12 * 60 && aStart >= 13 * 60) {
    return `${parts.join(" e ")} · intervalo de ${hhmm(mEnd)} às ${hhmm(aStart)}`
  }
  return parts.join(" e ")
}

// ─── TEXTO DE CAPACIDADE ──────────────────────────────────────────────────────

export function regraMusicoterapiaTexto(prof: string, overridesFromDB?: CapacidadeOverrides): string {
  const dows = diasComCapacidadeExplicita(prof, overridesFromDB)
  if (!dows.length) return "Musicoterapia: capacidade de 1 paciente por sessão."
  const partes = dows.map(d => `${DOW_ABBR[d]}: ${capacidadeEsperadaProfissionalDia(prof, d, overridesFromDB)}`)
  return `Musicoterapia — vagas simultâneas por dia: ${partes.join(" · ")}.`
}

export function regrasCapacidadeTexto(
  d: { terapiaDetails?: { terp: string }[]; prof: string },
  overridesFromDB?: CapacidadeOverrides,
): string {
  const terps = d?.terapiaDetails?.map(t => t.terp) || []
  const partes: string[] = []
  if (terps.includes("Musicoterapia")) partes.push(regraMusicoterapiaTexto(d.prof, overridesFromDB))
  if (terps.some(t => normTxt(t) === "aplicador aba (ef)" || normTxt(t) === "aplicador aba ef")) {
    partes.push("Aplicador ABA EF: capacidade de até 2 pacientes simultâneos por horário, aplicada em todos os horários da agenda.")
  }
  return partes.join(" ")
}

// ─── AGREGAÇÃO ────────────────────────────────────────────────────────────────

export function agregarOcupacaoDeSlots(rawSlots: SlotNormalizado[]): OcupacaoAgregada {
  const total: BaseOcupAcc = novaBaseOcup()
  const porDiaAcc: Record<number, BaseOcupAcc> = {
    1: novaBaseOcup(), 2: novaBaseOcup(), 3: novaBaseOcup(), 4: novaBaseOcup(), 5: novaBaseOcup(),
  }
  const porTurnoAcc: Record<string, BaseOcupAcc & { dow: number; turno: string }> = {}
  const porEspAcc: Record<string, BaseOcupAcc & { terp: string }> = {}
  const porUnidAcc: Record<string, BaseOcupAcc & { unidade: string }> = {}
  const slots: SlotNormalizado[] = []

  ;(rawSlots || []).forEach(s => {
    const unidade = normalizarUnidadeOcupacao(s.unidade)
    const item: BaseOcupAcc = {
      unidade,
      slotsTotal:         s.capacidade       ?? 0,
      slotsOcupados:      s.ocupados         ?? 0,
      slotsLivres:        s.livres           ?? 0,
      horariosTotal:      s.horariosTotal    ?? 1,
      horariosOcupados:   s.horariosOcupados ?? ((s.ocupados ?? 0) > 0 ? 1 : 0),
      horariosLivres:     s.horariosLivres   ?? ((s.ocupados ?? 0) > 0 ? 0 : 1),
      horasTotal:         s.horasTotal      ?? 0,
      horasOcupadas:      s.horasOcupadas   ?? 0,
      horasLivres:        s.horasLivres     ?? 0,
      horasTecnicas:      s.horasTecnicas   ?? 0,
      horasAssistenciais: s.horasAssistenciais ?? 0,
    }
    const slotNorm: SlotNormalizado = { ...s, unidade, turno: s.turno || turnoDoHorario(s.ini) }
    const turno = slotNorm.turno
    const tk = `${s.dow}-${turno}`
    const terp = s.terp || "Sem especialidade"

    if (s.excluirBaseOcupacao) {
      total.horasTecnicas += item.horasTecnicas || 0
      if (porDiaAcc[s.dow]) porDiaAcc[s.dow].horasTecnicas += item.horasTecnicas || 0
      if (!porTurnoAcc[tk]) porTurnoAcc[tk] = { dow: s.dow, turno, ...novaBaseOcup() }
      porTurnoAcc[tk].horasTecnicas += item.horasTecnicas || 0
      if (!porEspAcc[terp]) porEspAcc[terp] = { terp, ...novaBaseOcup() }
      porEspAcc[terp].horasTecnicas += item.horasTecnicas || 0
      if (!porUnidAcc[unidade]) porUnidAcc[unidade] = { unidade, ...novaBaseOcup() }
      porUnidAcc[unidade].horasTecnicas += item.horasTecnicas || 0
      slots.push(slotNorm)
      return
    }

    somaBaseOcup(total, item)
    if (porDiaAcc[s.dow]) somaBaseOcup(porDiaAcc[s.dow], item)
    if (!porTurnoAcc[tk]) porTurnoAcc[tk] = { dow: s.dow, turno, ...novaBaseOcup() }
    somaBaseOcup(porTurnoAcc[tk], item)
    if (!porEspAcc[terp]) porEspAcc[terp] = { terp, ...novaBaseOcup() }
    somaBaseOcup(porEspAcc[terp], item)
    if (!porUnidAcc[unidade]) porUnidAcc[unidade] = { unidade, ...novaBaseOcup() }
    somaBaseOcup(porUnidAcc[unidade], item)
    slots.push(slotNorm)
  })

  const porDia: OcupacaoPorDia[] = Object.entries(porDiaAcc).map(([dow, b]) => ({
    dow: +dow,
    dia: DOW_PT_LONG[+dow] ?? "",
    ...finalizarBaseOcup(b),
  }))

  const porTurno: OcupacaoPorTurno[] = Object.values(porTurnoAcc)
    .sort((a, b) => a.dow - b.dow || a.turno.localeCompare(b.turno))
    .map(b => ({ ...finalizarBaseOcup(b), dow: b.dow, turno: b.turno }))

  const porEspecialidade: OcupacaoPorEspecialidade[] = Object.values(porEspAcc)
    .sort((a, b) => a.terp.localeCompare(b.terp))
    .map(b => ({ ...finalizarBaseOcup(b), terp: b.terp }))

  const porUnidade: OcupacaoPorUnidade[] = Object.values(porUnidAcc)
    .sort((a, b) => a.unidade.localeCompare(b.unidade))
    .map(b => ({ ...finalizarBaseOcup(b), unidade: b.unidade }))

  return { ...finalizarBaseOcup(total), porDia, porTurno, porEspecialidade, porUnidade, slots }
}

export function filtrarOcupacaoPorUnidade(
  ocupacao: OcupacaoAgregada | null | undefined,
  unidades: string[] = [],
): OcupacaoAgregada {
  const filtros = (unidades || []).map(normTxt).filter(Boolean)
  if (!filtros.length) return ocupacao ?? agregarOcupacaoDeSlots([])
  return agregarOcupacaoDeSlots(
    (ocupacao?.slots || []).filter(s => filtros.includes(normTxt(normalizarUnidadeOcupacao(s.unidade))))
  )
}

// ─── CÁLCULO SEMANAL ─────────────────────────────────────────────────────────

export function calcularOcupacaoSemanal(slotData: SlotData, prof: string, overridesFromDB?: CapacidadeOverrides): OcupacaoAgregada {
  const rawSlots: SlotNormalizado[] = []

  Object.values(slotData?.diasInfo || {}).forEach(di => {
    Object.values(di.slotDetails || {}).forEach(sd => {
      const dur = Math.max(((sd.fim || 0) - (sd.ini || 0)) / 60, 40 / 60)
      const capPadrao = getSlotCap(prof, sd.terp, sd.dow, overridesFromDB)
      const etaAdminUnits = sd.technicalAg || 0
      const temPacienteReal = (sd.realAg || 0) > 0
      const temTecnico = etaAdminUnits > 0
      const totalUnits = temTecnico && !temPacienteReal
        ? Math.max(capPadrao, etaAdminUnits, 1)
        : Math.max(capPadrao, (sd.ag || 0) + (sd.liv || 0), sd.ag || 0, 1)
      const ocupUnits = Math.min((sd.ag || 0) + etaAdminUnits, totalUnits)
      const livreUnits = Math.max(totalUnits - ocupUnits, 0)
      const horarioOcupado: 0 | 1 = ocupUnits > 0 ? 1 : 0
      const horarioLivre: 0 | 1 = horarioOcupado ? 0 : 1
      const horarioAdministrativoEta = temTecnico && !temPacienteReal

      rawSlots.push({
        ...sd,
        unidade: normalizarUnidadeOcupacao(sd.unidade),
        turno: turnoDoHorario(sd.ini),
        capacidade: totalUnits,
        ocupados: ocupUnits,
        livres: livreUnits,
        horariosTotal: 1,
        horariosOcupados: horarioOcupado,
        horariosLivres: horarioLivre,
        pct: totalUnits > 0 ? ocupUnits / totalUnits : null,
        horasTotal: dur,
        horasOcupadas: horarioOcupado ? dur : 0,
        horasLivres: horarioLivre ? dur : 0,
        horasTecnicas: temTecnico ? dur : 0,
        horasAssistenciais: temPacienteReal ? dur : 0,
        excluirBaseOcupacao: false,
        horarioAdministrativoEta,
      })
    })
  })

  return agregarOcupacaoDeSlots(rawSlots)
}
