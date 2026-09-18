"use client"

import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import Link from "next/link"
import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import {
  ABA_EXIB_PSICO_NAMES, B, DIAS_LIST, DIAS_ORD, ESP_LAUDO_IGNORAR, ESP_LAUDO_SINONIMO, EXCLUIR_OCUP, EXIB_ID, EXIB_NOME,
  HORAS_GRID, PACS_ADMIN, TERAPIA_TO_ESP, TODAS_ESP, isProfBloqueadoTemp, normTxt,
} from "@/lib/cronograma/constants"
import {
  buildCronoUnitMeta, ceilOcupacaoAba, espParaOcupacaoPac, espRealPorExibicao, fm, fmtName, isLaudoComAlta, pesoOcupacaoAba, pm,
  shouldShowSessionUnit, unidadeBadgeText,
} from "@/lib/cronograma/helpers"
import { UnitHeaderBadges, CronoGlobalUnitBadge } from "@/components/cronograma/ui/UnitBadges"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { ConfirmarImplantacaoModal, type AvisoMultiProf } from "./ConfirmarImplantacaoModal"
import { ObservacaoPacienteBox } from "./ObservacaoPacienteBox"
import type { CsvRow, LaudoRow, CfgState, RecItem, InvItem } from "@/types/cronograma"
import type { AceiteSessao } from "@/types/acompanhamento"
import { useCronogramaData } from "@/contexts/CronogramaDataContext"
import { reativarRecusaPaciente } from "@/lib/cronograma/reativarRecusaPaciente"
import { registrarRecusa, registrarReativacao } from "@/services/cronogramaRecusasAuditoria.service"
import type { SuspensaoLinkInfo } from "@/lib/cronograma/suspensaoTemporaria"

// ─── Types ────────────────────────────────────────────────────────────────────

type Estrategia = "S1" | "S2" | "S3"
type Status     = "acompanhamento" | "inviavel"

interface VComp { tP: string; prof: string; hora: string; csvGradeId: string }
interface ProfAlt { tP: string; prof: string; unidade: string; csvGradeId: string }

interface EspAlt {
  esp: string; tP: string; prof: string; unidade: string; csvGradeId: string
  profAlts: ProfAlt[]
  vComp: VComp[]
  vCompAlts: Record<string, VComp[]>
}

interface Sugestao {
  id: string
  esp: string
  tP: string
  dia: string; hora: string; prof: string; unidade: string; csvGradeId: string
  tipo: "adjacente" | "dia-novo"
  vComp: VComp[]
  vCompAlts: Record<string, VComp[]>
  profAlts: ProfAlt[]
  espAlts: EspAlt[]
}

interface GapInfo { esp: string; aut: number; of: number; dif: number }

interface AceitePacBundle {
  id: string; pac: string; ts: number; origem: "ocp-paciente"
  sessoes: AceiteSessao[]
  // "removido_tita": série excluída direto na TiTa e detectada pela reconciliação.
  // Mantém em sincronia com o tipo canônico em types/acompanhamento.ts.
  status: "pendente" | "confirmado" | "recusado" | "inviavel" | "removido_tita"
  inviavelSlots: string[]
  motivo?: string
  // Recusa/confirmação slot a slot feita na aba Acompanhamento — um bundle pode
  // seguir "pendente" no todo com sessões individuais já recusadas. Espelha o
  // campo homônimo do tipo canônico em types/acompanhamento.ts.
  slotStatus?: Record<string, "confirmado" | "recusado" | "inviavel">

  // Auditoria da implantação (imutável) — ver types/acompanhamento.ts.
  implantadoPor?: string
  implantadoPorEmail?: string
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

const ESTRATEGIA_META: Record<Estrategia, {
  label: string; short: string; desc: string
  bg: string; c: string; border: string; disponivel: boolean
}> = {
  S1: {
    label: "Acrescentar sessões",
    short: "S1",
    desc: "Adiciona sessões em vagas adjacentes à agenda do paciente. Qualquer profissional disponível. Não remaeja sessões existentes.",
    bg: "#f0f9ff", c: "#0369a1", border: "#bae6fd", disponivel: true,
  },
  S2: {
    label: "Remanejamento — mesmo profissional",
    short: "S2",
    desc: "Move sessões existentes para liberar horários de maior déficit. Mantém o mesmo profissional na sessão remanejada.",
    bg: "#ecfdf5", c: "#059669", border: "#6ee7b7", disponivel: false,
  },
  S3: {
    label: "Remanejamento — outro profissional",
    short: "S3",
    desc: "Move sessões existentes podendo atribuir a outro profissional. Alto índice de recusa — use apenas se necessário.",
    bg: "#faf5ff", c: "#7e22ce", border: "#e9d5ff", disponivel: false,
  },
}

const STATUS_META: Record<Status, { label: string; bg: string; c: string }> = {
  acompanhamento: { label: "Em Acompanhamento", bg: B.blueLt,  c: B.blue    },
  inviavel:       { label: "Inviável",           bg: "var(--muted)", c: "var(--muted-foreground)" },
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ABA_EXT_NAMES = new Set(["Aplicador ABA Casa", "Aplicador ABA Escola", "Aplicador ABA Escola/Casa"])
const EXCLUIR_GAPS  = new Set([
  "Aplicador ABA Casa", "Aplicador ABA Escola", "Aplicador ABA Escola/Casa",
])
// Terapias vedadas para ASSIM Saúde, salvo exceção judicial LIMINAR com gap > 0
const ASSIM_RESTR_TERAPIAS = new Set(["Fisioterapia Aquática", "Equoterapia"])

// Aplicador ABA (AE)/(HS): a especialidade do laudo que determina se o paciente
// está autorizado para Arteterapia/Habilidades Sociais (não confundir com a
// especialidade padrão de TERAPIA_TO_ESP, usada só pra pontuar o déficit da
// sugestão). Mesma regra de negócio de detectarInconsistencias
// (inconsistencias.ts) — Gratuidade nunca oferta; ASSIM só com qtd autorizada
// > 1; demais convênios sempre elegíveis, com exibição condicional (ver
// terapiaExibicaoOverride em TodasSugestoesModal e regraFixaExibicaoAeHs).
const AE_HS_LAUDO_ESP: Record<string, string> = {
  "Aplicador ABA (AE)": "Arteterapia",
  "Aplicador ABA (HS)": "Habilidades Sociais",
}
const AE_HS_EXIB_ID: Record<string, number> = {
  "Aplicador ABA (AE)": EXIB_ID.ARTETERAPIA_ABA,
  "Aplicador ABA (HS)": EXIB_ID.HS_ABA,
}
const SK         = "aba_ocup_pac_status_v1"
const SK_ACEITES = "aba_ocup_pac_aceites_v1"
const DIAS_UTIL  = DIAS_LIST.slice(0, 5)
const DIA_ABR: Record<string, string> = {
  "Segunda-feira": "Seg", "Terça-feira": "Ter", "Quarta-feira": "Qua",
  "Quinta-feira":  "Qui", "Sexta-feira":  "Sex",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hiStr(r: CsvRow): string { return String(r.HI_str || "") }
function hiMin(r: CsvRow): number { return Number(r.HI || 0) }
function rowUnid(r: CsvRow): string {
  const unidade = String(r.Unidade || "").trim()
  // "Notificação Prévia" (paciente-teste da homologação TiTa) usa salas que não
  // resolvem para uma unidade real — "Sala Teste" faz exU() retornar a string
  // "Desconhecida" (não vazio). Sem forçar Realengo aqui, pacUnidades vira
  // {"Desconhecida"} e nenhum horário Livre (todos em unidades reais) casa no
  // filtro de unidade de buildSugestoes → zero sugestões. Cobre vazio E "Desconhecida".
  if (r["Nome Favorecido"] === "Notificação Prévia" && (!unidade || unidade === "Desconhecida")) {
    return "Realengo"
  }
  return unidade || "Desconhecida"
}

// Normaliza variações de encoding comuns entre os dois CSVs (apóstrofo curvo vs reto,
// espaços duplos, NFC vs NFD) para permitir junção tolerante de nomes.
function normalizeName(n: string): string {
  return n
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "’")
    .replace(/\s+/g, " ")
    .trim()
}


function adjHs(hora: string): string[] {
  const hi = pm(hora)
  if (hi === null) return []
  return [hi + 40, hi - 40].filter(v => v >= 0).map(fm)
}

// Sugestões (ainda não implantadas): não há terapia_exibicao real gravada ainda
// pra AE/HS (depende de laudo+convênio, resolvido só na implantação — ver
// terapiaExibicaoIdPorRegraFixa em services/tita/mappings.ts), então só o
// Grupo 1 (sempre "Psicologia ABA") pode ser adiantado com segurança aqui.
function tExib(tP: string): string | undefined {
  return ABA_EXIB_PSICO_NAMES.has(tP) ? EXIB_NOME[2271] : undefined
}

// Sessões já existentes (Agendado): usa a terapia_exibicao_nome real, já
// sincronizada da TiTa para aquela sessão — mostrada só quando difere da
// terapia de ação (ex.: "Aplicador ABA (AE)" exibindo "Arteterapia (Psicologia
// ABA)"); quando são iguais (a maioria das terapias) não repete a informação.
function tExibReal(tP: string, terapiaExibicaoNome: string | number | null | undefined): string | undefined {
  const te = String(terapiaExibicaoNome || "").trim()
  return te && te !== tP ? te : undefined
}

function countSlots(rows: CsvRow[]): number {
  const s = new Set<string>()
  for (const r of rows) s.add(`${r["Dia da Semana"]}|||${hiStr(r)}`)
  return s.size
}

// Pedido 1: encontra slot livre mais próximo para deslocar a Supervisão ABA
function findSupervTarget(dia: string, hora: string, prof: string, cRows: CsvRow[]): string | null {
  const myHMin = pm(hora) ?? 0
  // Mesma regra do profOcupado em buildSugestoes: horário "Agendado" do profissional
  // nunca pode ser alvo, mesmo existindo uma linha "Livre" gêmea dele no mesmo dia/hora
  // (a TiTa mantém uma linha por terapia ofertada). Vale para qualquer paciente —
  // real ou fictício de bloqueio —, porque o critério é o status, não o nome.
  const horasOcupadas = new Set<string>()
  for (const r of cRows) {
    if (r["Status do Agendamento"] !== "Agendado") continue
    if (r["Dia da Semana"] !== dia) continue
    if (normTxt(r.Profissional) !== normTxt(prof)) continue
    const c = fm(pm(hiStr(r)) ?? hiMin(r))
    if (c) horasOcupadas.add(c)
  }
  let best: { dist: number; hora: string } | null = null
  for (const r of cRows) {
    if (r["Status do Agendamento"] !== "Livre") continue
    if (r["Dia da Semana"] !== dia) continue
    if (r.Terapia !== "Supervisão ABA") continue
    if (r.Profissional !== prof) continue
    const h = pm(hiStr(r)) ?? hiMin(r)
    const canonical = fm(h)
    if (!canonical) continue
    if (horasOcupadas.has(canonical)) continue
    const dist = Math.abs(h - myHMin)
    if (!best || dist < best.dist) best = { dist, hora: canonical }
  }
  return best?.hora ?? null
}

// Opções do multiselect de "Alterar preferência → Por especialidade". O índice é o id
// exigido por MultiSearchCombobox; o nome é a chave real usada em prefEsps/prefSet.
const ESP_PREF_OPCOES = TODAS_ESP.map((nome, id) => ({ id, nome }))

// Marcador de rádio das opções de "Alterar preferência" — anel + miolo, para as duas
// alternativas se lerem como escolhas mutuamente exclusivas do mesmo grupo.
function PrefRadio({ ativo }: { ativo: boolean }) {
  return (
    <span aria-hidden="true" style={{ width: "13px", height: "13px", borderRadius: "50%", flexShrink: 0, marginTop: "1px", border: `2px solid ${ativo ? B.navy : "var(--border)"}`, background: "var(--card)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {ativo && <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: B.navy }} />}
    </span>
  )
}

// ─── buildSugestoes ───────────────────────────────────────────────────────────

function buildSugestoes(
  pac: string,
  agend: CsvRow[],
  agendClin: CsvRow[],
  cRows: CsvRow[],
  gapMap: Record<string, { dif: number; aut: number; of: number }>,
  aceites: AceitePacBundle[] = [],
  conv = "",
  isLiminar = false,
  // "Alterar preferência" → Por especialidade. Nomes de especialidade a priorizar na
  // escolha automática da terapia de cada card. Vazio = preferência natural (maior
  // distância entre ofertado e autorizado). Só reordena: nunca muda a elegibilidade,
  // então nenhuma vaga deixa de ser ofertada por causa da preferência.
  prefEsps: string[] = [],
): Sugestao[] {
  const prefSet = new Set(prefEsps)
  const pacClinRows = agendClin.filter(r => r["Nome Favorecido"] === pac)
  const clinPuras   = pacClinRows.filter(r => !ABA_EXT_NAMES.has(r.Terapia))

  let manhaCt = 0, tardeCt = 0
  for (const r of clinPuras) {
    const h = pm(hiStr(r)) ?? hiMin(r)
    if (!h && h !== 0) continue
    if (h < 720) manhaCt++; else tardeCt++
  }
  const clinTurno: "manhã" | "tarde" | null =
    manhaCt + tardeCt === 0 ? null : manhaCt >= tardeCt ? "manhã" : "tarde"

  // ABA em Ambiente Natural (Aplicador ABA Casa/Escola) ocupa o TURNO inteiro do
  // paciente, não só o dia/hora exato da sessão — pedido explícito do usuário
  // (2026-08-25): se o paciente tem Escola SEG/QUA/SEX de manhã, TER/QUI de manhã
  // também ficam bloqueados pra novas ofertas, mesmo sem sessão de Escola nesses
  // dias. `agend` (não `agendClin`/`pacClinRows`, que já descartam Ambiente
  // Natural via EXCLUIR_GAPS) é a única fonte com essas linhas.
  const turnosAmbNat = new Set<"manhã" | "tarde">()
  for (const r of agend) {
    if (r["Nome Favorecido"] !== pac || !ABA_EXT_NAMES.has(r.Terapia)) continue
    const h = pm(hiStr(r)) ?? hiMin(r)
    if (!h && h !== 0) continue
    turnosAmbNat.add(h < 720 ? "manhã" : "tarde")
  }

  function hMin(r: CsvRow): number { return pm(hiStr(r)) ?? hiMin(r) }

  function isTurnoOk(hMinVal: number): boolean {
    const turnoDoSlot = hMinVal < 720 ? "manhã" : "tarde"
    if (turnosAmbNat.has(turnoDoSlot)) return false
    if (clinTurno === null) return true
    return clinTurno === turnoDoSlot
  }

  // Todas as sessões do paciente — usado para evitar sugerir slot já ocupado
  const dayHours: Record<string, Set<string>> = {}
  for (const r of agend.filter(r => r["Nome Favorecido"] === pac)) {
    const d = r["Dia da Semana"]
    const h = hMin(r)
    if (!h && h !== 0) continue
    const canonical = fm(h)
    if (!canonical) continue
    if (!dayHours[d]) dayHours[d] = new Set()
    dayHours[d].add(canonical)
  }
  // Ocupação REAL do profissional (independe do paciente da vez). A TiTa mantém uma
  // linha por terapia ofertada, então quando um horário do profissional é preenchido
  // as OUTRAS linhas dele no mesmo dia/hora continuam com Status "Livre". Sem esta
  // trava, o horário volta a ser ofertado mesmo já estando ocupado — bastava a vaga
  // "Livre" gêmea existir. dayHours só olha a agenda do próprio paciente e por isso
  // nunca pegou esse caso.
  // Usa `agend` inteiro de propósito (nunca `agendClin`): pacientes-bloqueio como
  // "Horário Bloqueado" / "Horário Administrativo" ocupam a agenda do profissional
  // exatamente como um paciente real — é justamente esse tipo de linha que o
  // agendClin descarta.
  const profOcupado = new Set<string>()
  for (const r of agend) {
    const p = normTxt(r.Profissional)
    if (!p) continue
    const h = hMin(r)
    if (!h && h !== 0) continue
    const canonical = fm(h)
    if (!canonical) continue
    profOcupado.add(`${p}|||${r["Dia da Semana"]}|||${canonical}`)
  }
  const isProfOcupado = (prof: string, dia: string, hora: string) =>
    profOcupado.has(`${normTxt(prof)}|||${dia}|||${hora}`)
  // CRON-008: slots já reservados (implantação imediata) por OUTROS pacientes — vagas
  // ainda "Livre" no CSV mas comprometidas, não podem ser sugeridas para ninguém mais.
  // Chave normalizada (normTxt no profissional), igual à de profOcupado: o nome do
  // bundle vem do que foi gravado no aceite e o da grade vem do CSV da TiTa, e uma
  // diferença de acento/caixa/espaço faria a trava falhar em silêncio.
  const chaveSlot = (prof: string, dia: string, hora: string) => `${normTxt(prof)}|||${dia}|||${hora}`
  const slotsReservadosOutros = new Set<string>()
  for (const bundle of aceites) {
    if (bundle.pac === pac || bundle.status !== "confirmado") continue
    for (const s of bundle.sessoes) slotsReservadosOutros.add(chaveSlot(s.prof, s.dia, s.hora))
  }
  // Slots que a própria família já recusou pra esse paciente — não podem ser
  // reofertados enquanto a recusa não for desfeita ("Reativar sugestão" na aba
  // Recusados). Sem essa trava, buildSugestoes ignorava "rec" (só auditoria) e
  // reofertava o mesmo horário/profissional a cada recálculo.
  // Considera também recusa slot a slot (slotStatus), não só o status do bundle:
  // a aba Acompanhamento permite recusar sessões individuais de um bundle que
  // continua "pendente" como um todo.
  //
  // Achado 2026-08-20 (caso Adrian Araújo Nery): a chave incluía o profissional,
  // então recusar "Psicopedagogia com a Ana Beatriz" às 08:00 não impedia oferecer
  // "Psicomotricidade com a Rafaela" no MESMO horário — o sistema ofertava outra
  // coisa bem em cima de um horário que a família já tinha dito não servir.
  // Os motivos reais de recusa (ver Arthur Luiz Maciel Fortes) são quase sempre
  // sobre o HORÁRIO, não sobre o profissional específico: "não consegue chegar
  // às 13h por causa da escola", "não aguenta muitas terapias no mesmo dia". A
  // chave agora é só dia+hora — qualquer recusa nesse paciente naquele dia/hora
  // bloqueia QUALQUER terapia/profissional novo ali, não só o que foi recusado.
  const chaveDiaHora = (dia: string, hora: string) => `${dia}|||${hora}`
  const slotsRecusados = new Set<string>()
  for (const bundle of aceites) {
    if (bundle.pac !== pac) continue
    for (const s of bundle.sessoes) {
      const recusadoNoSlot = bundle.slotStatus?.[`${s.dia}|||${s.hora}`] === "recusado"
      if (bundle.status === "recusado" || recusadoNoSlot) slotsRecusados.add(chaveDiaHora(s.dia, s.hora))
    }
  }
  // Vagas comprometidas: sessões confirmadas que ainda não estão no agend
  // ("pendente" não bloqueia mais — é um status que nenhum caminho da UI cria hoje).
  for (const bundle of aceites) {
    if (bundle.pac !== pac) continue
    if (bundle.status !== "confirmado") continue
    for (const s of bundle.sessoes) {
      if (!dayHours[s.dia]) dayHours[s.dia] = new Set()
      dayHours[s.dia].add(s.hora)
    }
  }

  // Usado só para adjacência/hasDay: "a paciente já está presente nesse dia perto
  // desse horário?". "Coordenador de Caso" é a ÚNICA exceção de EXCLUIR_OCUP aqui
  // (mesmo carve-out do allFreeRows acima): mesmo sendo administrativa, uma sessão
  // nova de 40min colada nela não é um "dia novo" isolado, é avulsa aproveitando
  // uma visita que já vai acontecer. As demais administrativas (Supervisão ABA,
  // Visita Guiada, Triagem, Avaliações) NÃO contam — a paciente não está
  // fisicamente presente nelas, então usá-las como âncora criaria um buraco real
  // (ex.: oferecer 08:00 só porque 08:40 é Supervisão ABA, sem ninguém de verdade
  // até bem mais tarde). Exclui também AT Externo (atendimento domiciliar, não é
  // presença física na unidade).
  const dayHoursClin: Record<string, Set<string>> = {}
  for (const r of agend.filter(r =>
    r["Nome Favorecido"] === pac && !ABA_EXT_NAMES.has(r.Terapia)
    && (!EXCLUIR_OCUP.has(r.Terapia) || r.Terapia === "Coordenador de Caso"),
  )) {
    const d = r["Dia da Semana"]
    const h = hMin(r)
    if (!h && h !== 0) continue
    const canonical = fm(h)
    if (!canonical) continue
    if (!dayHoursClin[d]) dayHoursClin[d] = new Set()
    dayHoursClin[d].add(canonical)
  }

  // Sessões administrativas onde a paciente NÃO está fisicamente presente (tudo de
  // EXCLUIR_OCUP exceto Coordenador de Caso, que já tem tratamento próprio acima) —
  // nunca servem de vizinha pra justificar uma sessão nova adjacente a elas: colar
  // um horário novo do lado de uma Supervisão ABA (por ex.), sem ninguém de verdade
  // logo depois/antes, cria um buraco real na presença da paciente, mesmo que o dia
  // tenha presença real em outro horário mais distante (hasDay true não basta aqui).
  const adminSemPresenca: Record<string, Set<string>> = {}
  for (const r of agend.filter(r =>
    r["Nome Favorecido"] === pac && EXCLUIR_OCUP.has(r.Terapia) && r.Terapia !== "Coordenador de Caso",
  )) {
    const d = r["Dia da Semana"]
    const h = hMin(r)
    if (!h && h !== 0) continue
    const canonical = fm(h)
    if (!canonical) continue
    if (!adminSemPresenca[d]) adminSemPresenca[d] = new Set()
    adminSemPresenca[d].add(canonical)
  }

  const pacUnidades = new Set(pacClinRows.map(r => rowUnid(r)))

  // R5.4: mapa da unidade DOMINANTE (maioria das sessões) que o paciente já usa
  // por dia+turno (manhã < 720 min; tarde ≥ 720) — não a primeira linha
  // encontrada, já que `clinPuras` não vem em ordem cronológica e "primeira
  // vence" podia travar o turno inteiro numa unidade minoritária (ex.: uma
  // sessão isolada às 08:40 decidindo a unidade de todo o resto da manhã).
  // Mesmo critério de unidadeDominanteDoDia (disponibilidadeInterna.ts), usado
  // pelas telas de Ocupação Profissional/Categoria: empate → sem restrição.
  // `clinPuras` já exclui AT Externo (Aplicador ABA Casa/Escola), que não é
  // unidade física e não deve contar pra maioria.
  const pacDayTurnoCounts: Record<string, Record<string, number>> = {}
  for (const r of clinPuras) {
    const h = hMin(r)
    if (!h && h !== 0) continue
    const turno = h < 720 ? "manha" : "tarde"
    const key = `${r["Dia da Semana"]}|||${turno}`
    const unid = rowUnid(r)
    if (!pacDayTurnoCounts[key]) pacDayTurnoCounts[key] = {}
    pacDayTurnoCounts[key][unid] = (pacDayTurnoCounts[key][unid] || 0) + 1
  }
  const pacDayTurnoUnid: Record<string, string> = {}
  for (const [key, counts] of Object.entries(pacDayTurnoCounts)) {
    const entries = Object.entries(counts)
    const max = Math.max(...entries.map(([, n]) => n))
    const top = entries.filter(([, n]) => n === max)
    if (top.length === 1) pacDayTurnoUnid[key] = top[0][0]
  }
  // Fallback pro empate acima (turno sem maioria clara — ex.: tarde real. meio a
  // meio entre duas unidades): usa a unidade do horário exato vizinho, se houver.
  // Cobre "16:20 é Fazendinha → 17:00 só pode ser Fazendinha ou nada", mesmo
  // quando o turno inteiro não tem unidade dominante pra decidir sozinho.
  const dayHourUnid: Record<string, string> = {}
  for (const r of clinPuras) {
    const h = hMin(r)
    if (!h && h !== 0) continue
    const canonical = fm(h)
    if (!canonical) continue
    const key = `${r["Dia da Semana"]}|||${canonical}`
    if (!dayHourUnid[key]) dayHourUnid[key] = rowUnid(r)
  }

  const pacGaps = Object.entries(gapMap)
    .filter(([k]) => k.startsWith(`${pac}|||`))
    .map(([k, v]) => ({ esp: k.split("|||")[1], ...v }))
    .filter(v => v.dif > 0)
    .sort((a, b) => b.dif - a.dif)

  if (pacGaps.length === 0) return []

  const espDif: Record<string, number> = {}
  const espMeta: Record<string, { dif: number; aut: number; of: number }> = {}
  for (const g of pacGaps) { espDif[g.esp] = g.dif; espMeta[g.esp] = g }

  // Rastreia sessões já propostas nesta rodada — usado só pra ORDENAR (prioriza
  // quem ainda tem mais déficit efetivo), nunca pra parar de gerar candidatos:
  // a tela deve mostrar toda vaga encaixável mesmo além do que falta pro
  // autorizado (o usuário decide o que aceitar); quem trava a escrita real na
  // TiTa é o "hasExcesso"/excessoEsps no render, que desabilita "Aceitar
  // alterações" quando a seleção ultrapassa a CH Autorizada.
  const proposedOf: Record<string, number> = {}
  const effDif = (e: string, extra = 0) => (espDif[e] ?? 0) - (proposedOf[e] ?? 0) - extra
  // Elegibilidade (gera candidato ou não) usa o déficit ORIGINAL, fixo — nunca o
  // efetivo (effDif), que cairia a 0 assim que a rodada já tivesse proposto o
  // suficiente e impediria mostrar mais opções encaixáveis pro usuário escolher.
  const hasGap = (e: string) => (espDif[e] ?? 0) > 0

  const isAssimSaude = /assim/i.test(conv)
  const isGratuidade = /gratuidade/i.test(conv)
  // Aplicador ABA (AE)/(HS): nunca oferta pra Gratuidade; ASSIM só com qtd
  // autorizada (laudo de Arteterapia/Habilidades Sociais) > 1 — mesmo limiar de
  // detectarInconsistencias. Demais convênios: sempre elegível (exibição
  // resolvida depois, na implantação).
  function aeHsBloqueado(terapia: string): boolean {
    const laudoEsp = AE_HS_LAUDO_ESP[terapia]
    if (!laudoEsp) return false
    if (isGratuidade) return true
    if (isAssimSaude) return (gapMap[`${pac}|||${laudoEsp}`]?.aut ?? 0) <= 1
    return false
  }
  // Coordenador de Caso só pode ser ofertado como acréscimo pra compor o déficit de
  // Psicologia ABA — nunca cria o vínculo do zero (paciente sem Coordenador de Caso
  // agendado não recebe a oferta) e nunca troca de coordenador (só o mesmo
  // profissional que já é o Coordenador de Caso atual dela).
  const coordenadorAtual = new Set(
    agend
      .filter(r => r["Nome Favorecido"] === pac && r.Terapia === "Coordenador de Caso")
      .map(r => normTxt(r.Profissional)),
  )
  const seenFree = new Set<string>()
  const allFreeRows: Array<CsvRow & { _hMin: number; _hora: string }> = []
  for (const r of cRows) {
    if (r["Status do Agendamento"] !== "Livre") continue
    if (isProfBloqueadoTemp(r.Profissional)) continue
    // Aplicador ABA (AE) é a única exceção "de sempre" liberada de EXCLUIR_OCUP aqui.
    // Coordenador de Caso é uma segunda exceção, condicional: só passa se for
    // exatamente o profissional que já é o coordenador atual da paciente (ver
    // coordenadorAtual acima). As demais (Supervisão ABA etc.) continuam fora da
    // oferta de sugestões. Ver AE_HS_LAUDO_ESP acima para a condição real de
    // elegibilidade do Aplicador ABA (AE).
    if (EXCLUIR_OCUP.has(r.Terapia) && r.Terapia !== "Aplicador ABA (AE)") {
      const coordMatch = r.Terapia === "Coordenador de Caso" && coordenadorAtual.has(normTxt(r.Profissional))
      if (!coordMatch) continue
    }
    if (aeHsBloqueado(r.Terapia)) continue
    const esp = TERAPIA_TO_ESP[r.Terapia]
    if (!esp || !espDif[esp]) continue
    // ASSIM Saúde: Fisioterapia Aquática e Equoterapia só se o paciente for LIMINAR (gap > 0 já garantido pelo check acima)
    if (isAssimSaude && ASSIM_RESTR_TERAPIAS.has(r.Terapia) && !isLiminar) continue
    if (pacUnidades.size > 0 && !pacUnidades.has(rowUnid(r))) continue
    const h = hMin(r)
    if (!isTurnoOk(h)) continue
    const canonical = fm(h)
    if (!canonical) continue
    if (slotsReservadosOutros.has(chaveSlot(r.Profissional, r["Dia da Semana"], canonical))) continue
    if (slotsRecusados.has(chaveDiaHora(r["Dia da Semana"], canonical))) continue
    // Vaga "Livre" gêmea de um horário já agendado do mesmo profissional — ver profOcupado.
    if (isProfOcupado(r.Profissional, r["Dia da Semana"], canonical)) continue
    const dk = `${r["Dia da Semana"]}|||${h}|||${r.Terapia}|||${r.Profissional}`
    if (seenFree.has(dk)) continue
    seenFree.add(dk)
    allFreeRows.push({ ...r, _hMin: h, _hora: canonical })
  }

  const slotMap: Record<string, typeof allFreeRows> = {}
  for (const r of allFreeRows) {
    const k = `${r["Dia da Semana"]}|||${r._hMin}`
    if (!slotMap[k]) slotMap[k] = []
    slotMap[k].push(r)
  }

  const sugestoes: Sugestao[] = []
  // "Dia novo" (!hasDay) não tem nenhuma sessão real pra ancorar R5.4 — o turno
  // inteiro está sendo inventado slot a slot. Sem isso, cada horário escolhia
  // unidade de forma independente (ex.: 13:00–16:20 saem Fazendinha "por sorte"
  // de ordem, 17:00 sai Realengo). `cRows` chega ordenado por data+hora (ver
  // buscarGradeComoCSVRows), e slotMap preserva essa ordem de inserção — então o
  // PRIMEIRO horário processado de um dia+turno "trava" a unidade pros seguintes:
  // ou o resto do turno usa a mesma unidade, ou não oferece nada ali.
  const novoDiaUnidEscolhida: Record<string, string> = {}

  for (const [slotKey, slotRows] of Object.entries(slotMap)) {
    const parts = slotKey.split("|||")
    const dia  = parts[0]
    const hora = slotRows[0]._hora
    const slotTurno = (pm(hora) ?? 0) < 720 ? "manha" : "tarde"

    if (dayHours[dia]?.has(hora)) continue

    const adjs = adjHs(hora)
    // Nunca oferece colado numa sessão administrativa sem presença física da
    // paciente (Supervisão ABA etc.) — ver adminSemPresenca acima.
    if (adjs.some(a => adminSemPresenca[dia]?.has(a))) continue

    const byEspRows: Record<string, typeof allFreeRows> = {}
    const seenProf = new Set<string>()
    for (const r of slotRows) {
      const esp = TERAPIA_TO_ESP[r.Terapia]!
      const pk = `${esp}|||${r.Profissional}`
      if (seenProf.has(pk)) continue
      seenProf.add(pk)
      if (!byEspRows[esp]) byEspRows[esp] = []
      byEspRows[esp].push(r)
    }

    const hoursOnDay = dayHoursClin[dia]
    const hasDay = !!hoursOnDay && hoursOnDay.size > 0

    // Esps elegíveis: qualquer uma com déficit original (hasGap) — não para de gerar
    // candidato só porque a rodada já propôs o suficiente (ver comentário em hasGap).
    // Ordenadas por déficit efetivo desc; tiebreak por taxa de preenchimento asc.
    // Com preferência "Por especialidade" ativa, as escolhidas vêm primeiro — entre
    // elas (e entre as demais) a ordenação natural acima continua valendo intacta.
    const eligibleEsps = Object.keys(byEspRows)
      .filter(esp => hasGap(esp))
      .sort((a, b) => {
        const pa = prefSet.has(a) ? 0 : 1, pb = prefSet.has(b) ? 0 : 1
        if (pa !== pb) return pa - pb
        const da = effDif(a), db = effDif(b)
        if (db !== da) return db - da
        const ra = (espMeta[a]?.aut ?? 0) > 0 ? (espMeta[a].of / espMeta[a].aut) : 0
        const rb = (espMeta[b]?.aut ?? 0) > 0 ? (espMeta[b].of / espMeta[b].aut) : 0
        return ra - rb
      })
    if (eligibleEsps.length === 0) continue

    // Constrói os dados de uma esp para este slot; retorna null se inválido.
    const buildEntry = (esp: string): EspAlt | null => {
      const chaveTurnoNovoDia = `${dia}|||${slotTurno}`
      const unidJaEscolhida = !hasDay ? novoDiaUnidEscolhida[chaveTurnoNovoDia] : undefined
      const espRows = unidJaEscolhida
        ? byEspRows[esp].filter(r => rowUnid(r) === unidJaEscolhida)
        : byEspRows[esp]
      if (espRows.length === 0) return null
      const [primaryRow, ...altRows] = espRows
      const unid = rowUnid(primaryRow)
      // Para dia-novo: restringe profAlts à mesma unidade do slot principal, pois os
      // vComps são calculados com base em `unid`. Trocar para um profAlt de outra unidade
      // causaria duas sessões consecutivas em unidades diferentes (viola R5.4).
      const profAlts = altRows
        .filter(r => !hasDay ? rowUnid(r) === unid : true)
        // Invariante: toda linha aqui vem de cRows (Status=Livre), sempre com CsvGradeId
        // preenchido — a grade é sempre carregada via buscarGradeComoCSVRows.
        .map(r => ({ tP: r.Terapia, prof: r.Profissional, unidade: rowUnid(r), csvGradeId: r.CsvGradeId! }))
      if (!hasDay) {
        const seenComp = new Set<string>()
        const compRows: Array<{ tP: string; prof: string; hora: string; csvGradeId: string }> = []
        for (const r of cRows) {
          if (r["Status do Agendamento"] !== "Livre") continue
          if (isProfBloqueadoTemp(r.Profissional)) continue
          if (r["Dia da Semana"] !== dia) continue
          if (rowUnid(r) !== unid) continue
          if (EXCLUIR_OCUP.has(r.Terapia) && r.Terapia !== "Aplicador ABA (AE)") continue
          if (aeHsBloqueado(r.Terapia)) continue
          const compEsp = TERAPIA_TO_ESP[r.Terapia]
          // hasGap (déficit original), não effDif — mesmo motivo do eligibleEsps acima.
          if (!compEsp || !hasGap(compEsp)) continue
          const ch = hMin(r)
          if (!isTurnoOk(ch)) continue
          const cHora = fm(ch)
          if (!adjs.includes(cHora)) continue
          // Mesmas travas do allFreeRows — a varredura de companheiras tinha ficado de
          // fora, e por isso um horário recusado (ou já reservado por outro paciente)
          // voltava a ser ofertado como sessão adjacente mesmo estando bloqueado.
          if (isProfOcupado(r.Profissional, dia, cHora)) continue
          if (slotsReservadosOutros.has(chaveSlot(r.Profissional, dia, cHora))) continue
          if (slotsRecusados.has(chaveDiaHora(dia, cHora))) continue
          const ck = `${r.Terapia}|||${r.Profissional}|||${cHora}`
          if (seenComp.has(ck)) continue
          seenComp.add(ck)
          compRows.push({ tP: r.Terapia, prof: r.Profissional, hora: cHora, csvGradeId: r.CsvGradeId! })
        }
        // Não exige mais compRows não-vazio: uma vaga isolada (sem parceira livre
        // adjacente pra formar dupla) ainda é "encaixável" — o usuário decide se
        // aceita; só a escrita real na TiTa fica travada acima do autorizado
        // (hasExcesso/excessoEsps no render). Sem isso, uma sessão avulsa útil
        // (ex.: déficit grande, sem vaga livre adjacente de outra especialidade)
        // era descartada por inteiro em vez de oferecida sozinha.
        // Ordena por déficit desc + taxa de preenchimento asc para que g[0] seja sempre
        // a especialidade mais necessária em cada hora.
        compRows.sort((a, b) => {
          const espA = TERAPIA_TO_ESP[a.tP] ?? "", espB = TERAPIA_TO_ESP[b.tP] ?? ""
          // Preferência "Por especialidade" também vale para as sessões companheiras.
          const pa = prefSet.has(espA) ? 0 : 1, pb = prefSet.has(espB) ? 0 : 1
          if (pa !== pb) return pa - pb
          // Desconta 1 do esp principal ao comparar vComps do mesmo slot.
          const da = effDif(espA, espA === esp ? 1 : 0)
          const db = effDif(espB, espB === esp ? 1 : 0)
          if (db !== da) return db - da
          const ra = (espMeta[espA]?.aut ?? 0) > 0 ? (espMeta[espA].of / espMeta[espA].aut) : 0
          const rb = (espMeta[espB]?.aut ?? 0) > 0 ? (espMeta[espB].of / espMeta[espB].aut) : 0
          return ra - rb
        })
        const byHora: Record<string, VComp[]> = {}
        for (const c of compRows) {
          if (!byHora[c.hora]) byHora[c.hora] = []
          byHora[c.hora].push(c)
        }
        return {
          esp, tP: primaryRow.Terapia, prof: primaryRow.Profissional, unidade: unid,
          csvGradeId: primaryRow.CsvGradeId!, profAlts,
          vComp: Object.values(byHora).map(g => g[0]),
          vCompAlts: byHora,
        }
      }
      // R5.4: slot adjacente deve estar na mesma unidade que as sessões existentes do
      // paciente naquele dia+turno. Filtra todas as linhas pelo turno correto e rejeita
      // se nenhuma tiver a unidade esperada.
      let existingUnid = pacDayTurnoUnid[`${dia}|||${slotTurno}`]
      if (!existingUnid) {
        // Turno sem maioria clara (empate): usa a unidade do horário vizinho mais
        // próximo, se houver — ver dayHourUnid acima. Cobre "16:20 é Fazendinha →
        // 17:00 só pode ser Fazendinha ou nada", mesmo com o turno inteiro empatado.
        for (const a of adjs) {
          const vizinho = dayHourUnid[`${dia}|||${a}`]
          if (vizinho) { existingUnid = vizinho; break }
        }
      }
      if (existingUnid) {
        const validRows = espRows.filter(r => rowUnid(r) === existingUnid)
        if (validRows.length === 0) return null
        const [vPrimary, ...vAlts] = validRows
        return {
          esp, tP: vPrimary.Terapia, prof: vPrimary.Profissional, unidade: existingUnid,
          csvGradeId: vPrimary.CsvGradeId!,
          profAlts: vAlts.map(r => ({ tP: r.Terapia, prof: r.Profissional, unidade: rowUnid(r), csvGradeId: r.CsvGradeId! })),
          vComp: [], vCompAlts: {},
        }
      }
      return {
        esp, tP: primaryRow.Terapia, prof: primaryRow.Profissional, unidade: unid,
        csvGradeId: primaryRow.CsvGradeId!, profAlts, vComp: [], vCompAlts: {},
      }
    }

    // Encontra a esp default (maior gap com dados válidos) e coleta espAlts.
    let defaultEntry: EspAlt | null = null
    const altEntries: EspAlt[] = []
    for (const esp of eligibleEsps) {
      const entry = buildEntry(esp)
      if (!entry) continue
      if (!defaultEntry) { defaultEntry = entry; continue }
      altEntries.push(entry)
    }
    if (!defaultEntry) continue

    // Invariante: todo tP em espAlts e profAlts vem de buildEntry(), que usa CsvRow real
    // (Profissional + Terapia + Status=Livre). allEsps e allProfs no render são a única
    // fonte de verdade para terapias e profissionais disponíveis — não há terapia elegível
    // sem profissional correspondente.
    // Antes só empurrava quando hasDay && isAdj (dia já frequentado E o horário
    // colado numa sessão existente) ou quando !hasDay (dia novo). O meio-termo —
    // dia já frequentado, mas esse horário específico não está a ±40min de
    // nenhuma sessão existente (ex.: só sessões à tarde, oferta às 13:00 quando a
    // mais próxima é 14:20) — não caía em nenhuma das duas: buildEntry calculava
    // a entrada certinha (já validada por unidade/turno via R5.4) e ela era
    // descartada sem nunca virar sugestão. `isAdj` continua sem uso aqui — a
    // vaga é "encaixável" (unidade/turno batem) mesmo sem adjacência estrita.
    if (hasDay) {
      sugestoes.push({
        id: `${dia}|||${hora}|||${defaultEntry.esp}`,
        esp: defaultEntry.esp, tP: defaultEntry.tP,
        dia, hora, prof: defaultEntry.prof, unidade: defaultEntry.unidade,
        csvGradeId: defaultEntry.csvGradeId,
        tipo: "adjacente", vComp: [], vCompAlts: {},
        profAlts: defaultEntry.profAlts,
        espAlts: altEntries,
      })
      proposedOf[defaultEntry.esp] = (proposedOf[defaultEntry.esp] ?? 0) + 1
    } else {
      sugestoes.push({
        id: `${dia}|||${hora}|||${defaultEntry.esp}`,
        esp: defaultEntry.esp, tP: defaultEntry.tP,
        dia, hora, prof: defaultEntry.prof, unidade: defaultEntry.unidade,
        csvGradeId: defaultEntry.csvGradeId,
        tipo: "dia-novo",
        vComp: defaultEntry.vComp, vCompAlts: defaultEntry.vCompAlts,
        profAlts: defaultEntry.profAlts,
        espAlts: altEntries,
      })
      // Trava a unidade desse dia+turno pros próximos horários "dia novo" — ver
      // comentário em novoDiaUnidEscolhida.
      const chaveTurnoNovoDia = `${dia}|||${slotTurno}`
      if (!novoDiaUnidEscolhida[chaveTurnoNovoDia]) novoDiaUnidEscolhida[chaveTurnoNovoDia] = defaultEntry.unidade
      proposedOf[defaultEntry.esp] = (proposedOf[defaultEntry.esp] ?? 0) + 1
      for (const vc of defaultEntry.vComp) {
        const e = TERAPIA_TO_ESP[vc.tP]
        if (e) proposedOf[e] = (proposedOf[e] ?? 0) + 1
      }
    }
  }

  sugestoes.sort((a, b) =>
    (a.tipo === "adjacente" ? 0 : 1) - (b.tipo === "adjacente" ? 0 : 1) ||
    ((DIAS_ORD[a.dia] ?? 9) - (DIAS_ORD[b.dia] ?? 9)) ||
    ((pm(a.hora) || 0) - (pm(b.hora) || 0))
  )
  const slotFinal = new Set<string>()
  const slotFiltered = sugestoes.filter(s => {
    const k = `${s.dia}|||${s.hora}`
    if (slotFinal.has(k)) return false
    slotFinal.add(k)
    return true
  })

  // Nenhum corte por quantidade: todas as sugestões válidas (adjacente e dia-novo)
  // são retornadas — o único descarte por slot já ocorreu acima via `slotFinal`,
  // que evita duas sugestões diferentes disputando o mesmo dia+hora.
  return slotFiltered
}

// ─── TodasSugestoesModal ──────────────────────────────────────────────────────

type AcaoDiretaType = "aceitar" | "recusar" | "inviavel"
interface PendingAcaoInfo {
  sugestao: Sugestao; hora: string; tP: string; prof: string; unidade: string; csvGradeId: string; acao: AcaoDiretaType
}

// Paciente-teste oficial da homologação TiTa (habilitado como paciente normal
// só nesta página — ver PACS_ADMIN_OCUP_PAC abaixo).
const PACIENTE_TESTE_TITA = "Notificação Prévia"

interface TodasSugestoesModalProps {
  pac: string; conv: string; cRows: CsvRow[]; sugestoes: Sugestao[]; pacGaps: GapInfo[]; pacAllEsp: GapInfo[]
  /** Especialidades deste paciente com suspensão temporária vigente — não estão em pacAllEsp (removidas de lá, junto com "Alta"). */
  pacSuspensoes: { esp: string; info: SuspensaoLinkInfo }[]
  stOf: (s: Sugestao) => Status | null
  setSt: (s: Sugestao, st: Status | null) => void
  estrategia: Estrategia; setEstrategia: (e: Estrategia) => void
  onAceitar: (bundle: { sessoes: AceiteSessao[]; beforeCount: number; avisoMultiProf: AvisoMultiProf[] }) => void
  onInviavel: (sessoes: AceiteSessao[], motivo: string) => void
  onAcaoDireta: (sessoes: AceiteSessao[], status: "pendente" | "recusado" | "inviavel", motivo?: string) => void
  onUndoRecusa: (dia: string, hora: string, tP: string, prof: string) => void
  /** CRON-008: sessões já reservadas (implantação imediata) deste paciente — exibidas
   * diretamente na grade como "Reservado", fora do fluxo normal de sugestões. */
  reservasConfirmadas: AceiteSessao[]
  /** Horários recusados pela família para este paciente — exibidos em vermelho na
   *  grade para o bloqueio ficar visível no próprio horário. Não são sugestões. */
  recusasPac: {
    dia: string; hora: string; tP: string; prof: string; unidade: string
    ocorrencias: Array<{ ts: number; data: string; motivo?: string }>
  }[]
  /** Abre o modal de detalhe do card "recusadoFamilia" ao ser clicado. */
  onAbrirRecusaDetalhe: (dia: string, hora: string, recusas: Array<{ tP: string; prof: string; ocorrencias: Array<{ ts: number; data: string; motivo?: string }> }>) => void
}

export interface TodasSugestoesModalHandle {
  selectAll: () => void
  clearAll: () => void
}

const TodasSugestoesModal = forwardRef<TodasSugestoesModalHandle, TodasSugestoesModalProps>(function TodasSugestoesModal({
  pac, conv, cRows, sugestoes, pacGaps, pacAllEsp, pacSuspensoes, stOf, setSt,
  estrategia, setEstrategia, onAceitar, onInviavel, onAcaoDireta,
  onUndoRecusa, reservasConfirmadas, recusasPac, onAbrirRecusaDetalhe,
}: TodasSugestoesModalProps, ref: React.Ref<TodasSugestoesModalHandle>) {
  const [selIdx, setSelIdx]         = useState<Record<string, Record<string, number>>>({})
  const [profSelIdx, setProfSelIdx] = useState<Record<string, number>>({})
  const [espSelIdx, setEspSelIdx]   = useState<Record<string, number>>({})
  // Confirma que o profissional foi explicitamente escolhido no wizard multi-terapia
  const [profConfirmed, setProfConfirmed] = useState<Set<string>>(() => new Set())
  // Proposals começam no estado "Proposta" (não analisadas).
  // O usuário aceita clicando no card da grade ou no checkbox do Col 1.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  // Ação direta por sessão (✗ / ⛔)
  const [pendingAcao, setPendingAcao] = useState<PendingAcaoInfo | null>(null)
  const [acaoMotivo, setAcaoMotivo]   = useState("")
  // vComps excluídos individualmente: { sugestaoId: Set<hora> }
  const [vcExcluded, setVcExcluded] = useState<Record<string, Set<string>>>({})

  // Seletor inline de profissional: id do card expandido na grade
  const [expandedProfCardId, setExpandedProfCardId] = useState<string | null>(null)
  useEffect(() => {
    if (!expandedProfCardId) return
    const close = (e: MouseEvent) => {
      if ((e.target as Element)?.closest("[data-prof-dropdown]")) return
      setExpandedProfCardId(null)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [expandedProfCardId])

  // Seletor inline de terapia: id do card expandido na grade
  const [expandedEspCardId, setExpandedEspCardId] = useState<string | null>(null)
  useEffect(() => {
    if (!expandedEspCardId) return
    const close = (e: MouseEvent) => {
      if ((e.target as Element)?.closest("[data-esp-dropdown]")) return
      setExpandedEspCardId(null)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [expandedEspCardId])

  useImperativeHandle(ref, () => ({
    selectAll() {
      const next = new Set<string>()
      for (const s of sugestoes) {
        if (stOf(s) === "inviavel") continue
        next.add(s.id)
        for (const vc of getActiveVComps(s)) {
          next.add(`${s.id}|||vc|||${vc.hora}`)
        }
      }
      setSelectedIds(next)
    },
    clearAll() {
      setSelectedIds(new Set())
    },
  }))

  function isVCompExcluded(sid: string, hora: string) {
    return vcExcluded[sid]?.has(hora) ?? false
  }
  function toggleVComp(sid: string, hora: string) {
    setVcExcluded(prev => {
      const s = new Set(prev[sid] || [])
      if (s.has(hora)) s.delete(hora); else s.add(hora)
      return { ...prev, [sid]: s }
    })
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function getActiveEspData(s: Sugestao): EspAlt {
    const idx = espSelIdx[s.id] ?? 0
    if (idx > 0 && s.espAlts[idx - 1]) return s.espAlts[idx - 1]
    return {
      esp: s.esp, tP: s.tP, prof: s.prof, unidade: s.unidade, csvGradeId: s.csvGradeId,
      profAlts: s.profAlts, vComp: s.vComp, vCompAlts: s.vCompAlts,
    }
  }

  function getActiveEntry(s: Sugestao): { tP: string; prof: string; unidade: string; csvGradeId: string } {
    const ed  = getActiveEspData(s)
    const idx = profSelIdx[s.id] ?? 0
    if (idx === 0 || !ed.profAlts[idx - 1]) return { tP: ed.tP, prof: ed.prof, unidade: ed.unidade, csvGradeId: ed.csvGradeId }
    return ed.profAlts[idx - 1]
  }

  function getActiveVComps(s: Sugestao): VComp[] {
    const ed = getActiveEspData(s)
    return ed.vComp.map(v => {
      const alts = ed.vCompAlts[v.hora] || [v]
      return alts[selIdx[s.id]?.[v.hora] ?? 0] ?? v
    })
  }

  // Aplicador ABA (AE)/(HS): resolve o terapia_exibicao_id aqui (cliente) porque
  // depende de laudo + convênio, que só existem no navegador — o servidor recebe
  // o valor já pronto via AceiteSessao.terapiaExibicaoOverride (ver
  // confirmarImplantacao → /api/tita/confirmar-agendamento → prepararAgendamento).
  // Mesmo limiar de negócio de detectarInconsistencias (inconsistencias.ts) e do
  // gate de elegibilidade em buildSugestoes (aeHsBloqueado): ASSIM só com qtd > 1.
  function terapiaExibicaoOverride(tP: string): number | undefined {
    const laudoEsp = AE_HS_LAUDO_ESP[tP]
    if (!laudoEsp) return undefined
    const isAssim = /assim/i.test(conv)
    const qtd = pacAllEsp.find(g => g.esp === laudoEsp)?.aut ?? 0
    const limiar = isAssim ? 1 : 0
    return qtd > limiar ? AE_HS_EXIB_ID[tP] : EXIB_ID.PSICOLOGIA_ABA
  }

  function buildSelectedSessoes(): AceiteSessao[] {
    const sessoes: AceiteSessao[] = []
    for (const id of selectedIds) {
      if (id.includes("|||vc|||")) {
        // vComp independente: "${parentId}|||vc|||${hora}"
        const sep    = id.indexOf("|||vc|||")
        const parentId = id.slice(0, sep)
        const hora   = id.slice(sep + 8)
        const s = sugestoes.find(x => x.id === parentId)
        if (!s || stOf(s) === "inviavel") continue
        const vc = getActiveVComps(s).find(v => v.hora === hora)
        if (!vc) continue
        const ae = getActiveEntry(s)
        sessoes.push({ dia: s.dia, hora, tP: vc.tP, prof: vc.prof, unidade: ae.unidade, csvGradeId: vc.csvGradeId, terapiaExibicaoOverride: terapiaExibicaoOverride(vc.tP) })
      } else {
        const s = sugestoes.find(x => x.id === id)
        if (!s || stOf(s) === "inviavel") continue
        const ae = getActiveEntry(s)
        if (!isVCompExcluded(s.id, s.hora)) {
          sessoes.push({ dia: s.dia, hora: s.hora, tP: ae.tP, prof: ae.prof, unidade: ae.unidade, csvGradeId: ae.csvGradeId, terapiaExibicaoOverride: terapiaExibicaoOverride(ae.tP) })
        }
      }
    }
    return sessoes
  }

  function handleAceitar() {
    const sessoes = buildSelectedSessoes()
    if (!sessoes.length) return
    // CRON-008: não aplica nem limpa a seleção aqui — o pai abre o modal premium de
    // confirmação; a seleção só é limpa (via ref.clearAll) após a implantação ser
    // efetivamente confirmada, permitindo cancelar sem perder o que foi selecionado.
    onAceitar({ sessoes, beforeCount: sessPac.length, avisoMultiProf: multiProfTerapias })
  }

  const sessPac = useMemo(() => {
    const seen = new Set<string>()
    const ADMIN_WARN = new Set(["Triagem", "Avaliação Neuropsicológica", "Visita Guiada"])
    const res: { dia: string; hora: string; tP: string; tE?: string; prof: string; unidade: string; tipo: "exist" | "adminSuperv" | "adminWarn" }[] = []
    for (const r of cRows) {
      if (r["Nome Favorecido"] !== pac) continue
      const hm = pm(hiStr(r)) ?? Number(r.HI || 0)
      const hora = fm(hm) || hiStr(r)
      const k = `${r["Dia da Semana"]}|||${hm}|||${r.Terapia}|||${r.Profissional}`
      if (seen.has(k)) continue; seen.add(k)
      let tipo: "exist" | "adminSuperv" | "adminWarn" = "exist"
      if (r.Terapia === "Supervisão ABA")       tipo = "adminSuperv"
      else if (ADMIN_WARN.has(r.Terapia))       tipo = "adminWarn"
      res.push({
        dia: r["Dia da Semana"], hora,
        tP: r.Terapia, tE: tExibReal(r.Terapia, r["Terapia Exibição"] || r["Terapia Exibicao"]),
        prof: r.Profissional, unidade: rowUnid(r),
        tipo,
      })
    }
    return res
  }, [pac, cRows])

  type CellInfo = {
    tP: string; tE?: string; prof: string
    // "recusadoFamilia": horário que a família recusou. NÃO é sugestão (buildSugestoes
    // já o exclui) — existe só para o bloqueio ficar visível no próprio horário, em
    // vermelho, em vez de o card simplesmente sumir sem explicação.
    tipo: "proposta" | "aceito" | "exist" | "adminSuperv" | "adminWarn" | "supervDesloc" | "recusada" | "reservado" | "recusadoFamilia"
    unidade: string; target?: string
    sugestaoId?: string
    isVComp?: boolean
    // Lista estruturada por trás do card "recusadoFamilia" — o modal de detalhe
    // (aberto ao clicar no card) usa isto. Cada combinação terapia+profissional
    // carrega TODAS as vezes que foi recusada (data + motivo de cada uma), pra
    // deixar claro se é uma recusa isolada ou a mesma oferta recusada de novo.
    recusas?: Array<{
      tP: string; prof: string
      ocorrencias: Array<{ ts: number; data: string; motivo?: string }>
    }>
  }

  const cMap: Record<string, CellInfo[]> = {}
  for (const s of sessPac) {
    const k = `${s.dia}|||${s.hora}`
    if (!cMap[k]) cMap[k] = []
    if (!cMap[k].some(x => x.tP === s.tP && x.prof === s.prof)) {
      cMap[k].push({ tP: s.tP, tE: s.tE, prof: s.prof, tipo: s.tipo, unidade: s.unidade })
    }
  }

  // CRON-008/Sprint 4: reservas já implantadas na TiTa (definitivas, não mais um
  // estado provisório) — não são mais sugestões (buildSugestoes já as bloqueia via
  // dayHours), entram direto na grade como "Reservado": não clicáveis, sem opção
  // de trocar terapia ou remover.
  for (const s of reservasConfirmadas) {
    const k = `${s.dia}|||${s.hora}`
    if (!cMap[k]) cMap[k] = []
    if (!cMap[k].some(x => x.tP === s.tP && x.prof === s.prof)) {
      cMap[k].push({ tP: s.tP, prof: s.prof, tipo: "reservado", unidade: s.unidade })
    }
  }

  // Horários recusados pela família: buildSugestoes já os exclui das sugestões, mas
  // sumir sem deixar rastro fazia a grade parecer vazia sem motivo aparente — foi
  // exatamente o que aconteceu com o paciente Arthur Luiz Maciel Fortes, cujas
  // sugestões desapareceram todas de uma vez. Entram aqui só como marcação visual
  // (vermelho, não clicável, sem sugestaoId), para o bloqueio ficar explícito no
  // próprio horário.
  // UM card por horário, nunca um por recusa: o mesmo horário costuma acumular
  // várias recusas (terapias/profissionais diferentes, ou a mesma recusada mais de
  // uma vez ao longo do tempo). Empilhadas, elas transbordavam a célula e invadiam
  // as linhas seguintes da grade. O que importa visualmente é "este horário está
  // bloqueado"; o detalhe de quantas e quais vai no tooltip.
  const recusasPorSlot: Record<string, typeof recusasPac> = {}
  for (const r of recusasPac) {
    const k = `${r.dia}|||${r.hora}`
    if (!recusasPorSlot[k]) recusasPorSlot[k] = []
    recusasPorSlot[k].push(r)
  }
  for (const [k, lista] of Object.entries(recusasPorSlot)) {
    // Se o horário já tem uma sessão REAL do paciente (tipo "exist"/adminSuperv/
    // adminWarn/reservado, inseridas acima a partir de sessPac/reservasConfirmadas),
    // mostrar a recusa ali é redundante: dayHours já impede qualquer oferta nova
    // nesse dia/hora por causa da sessão existente, com ou sem a recusa histórica.
    // O card vermelho ficaria competindo com o card real por atenção sem acrescentar
    // nada — foi o caso do Adrian às 10:00 (Psicopedagogia real + recusa antiga de
    // "Aplicador ABA (PS)" empilhadas sem necessidade).
    if ((cMap[k] ?? []).some(x => x.tipo !== "recusadoFamilia")) continue
    if (!cMap[k]) cMap[k] = []
    // n = combinações terapia+profissional distintas recusadas nesse horário — não
    // o total de recusas (uma combinação pode ter sido recusada mais de uma vez).
    const n = lista.length
    cMap[k].push({
      // Com mais de uma combinação não dá pra eleger uma como "a" recusa do horário
      // sem mentir sobre as outras — então o título passa a ser a contagem.
      tP: n === 1 ? lista[0].tP : `${n} recusas neste horário`,
      prof: n === 1 ? lista[0].prof : "",
      tipo: "recusadoFamilia",
      unidade: lista[0].unidade,
      recusas: lista.map(r => ({ tP: r.tP, prof: r.prof, ocorrencias: r.ocorrencias })),
    })
  }

  // Todos os cards de proposta sempre visíveis na grade — o estado visual muda, não a presença.
  // mainSlots registra todos os slots principais para impedir que vComps os sobrescrevam.
  const mainSlots = new Set<string>()
  for (const s of sugestoes) {
    mainSlots.add(`${s.dia}|||${s.hora}`)
  }
  for (const s of reservasConfirmadas) {
    mainSlots.add(`${s.dia}|||${s.hora}`)
  }
  for (const s of sugestoes) {
    const st  = stOf(s)
    const ae  = getActiveEntry(s)
    const kP  = `${s.dia}|||${s.hora}`
    // tipo visual: "recusada" se inviavel; "proposta" caso contrário — recusa da família
    // não bloqueia mais reoferta (só fica registrada em "rec" para auditoria/histórico).
    // A distinção aceita/não-aceita é feita no render via selectedIds.has(c.sugestaoId)
    const tipo: CellInfo["tipo"] = st === "inviavel" ? "recusada" : "proposta"
    if (!cMap[kP]) cMap[kP] = []
    if (!cMap[kP].some(x => x.sugestaoId === s.id)) {
      cMap[kP].push({ tP: ae.tP, tE: tExib(ae.tP), prof: ae.prof, tipo, unidade: ae.unidade, sugestaoId: s.id })
    }
  }

  // vComps: sempre visíveis na grade, em slots não ocupados por slot principal.
  // Cada vComp recebe sugestaoId único ("${parentId}|||vc|||${hora}") para ser
  // selecionável de forma independente — sem dependência do estado do card pai.
  const seenSlot = new Set<string>(mainSlots)
  for (const s of sugestoes) {
    const st = stOf(s)
    if (st === "inviavel") continue
    const activeUnid = getActiveEspData(s).unidade
    const activeVComps = getActiveVComps(s)
    for (const vc of activeVComps) {
      const kC     = `${s.dia}|||${vc.hora}`
      const vcSugId = `${s.id}|||vc|||${vc.hora}`
      if (seenSlot.has(kC)) continue
      seenSlot.add(kC)
      if (!cMap[kC]) cMap[kC] = []
      if (!cMap[kC].some(x => x.sugestaoId === vcSugId)) {
        cMap[kC].push({ tP: vc.tP, tE: tExib(vc.tP), prof: vc.prof, tipo: "proposta", unidade: activeUnid, sugestaoId: vcSugId, isVComp: true })
      }
    }
  }

  // Pedido 1: detectar Supervisão ABA deslocável e pintar de preto
  for (const [k, cells] of Object.entries(cMap)) {
    const hasProposal = cells.some(c => c.tipo === "proposta" || c.tipo === "aceito")
    if (!hasProposal) continue
    const supervIdx = cells.findIndex(c => c.tipo === "adminSuperv" && c.tP === "Supervisão ABA")
    if (supervIdx === -1) continue
    const sv = cells[supervIdx]
    const kParts = k.split("|||")
    const target = findSupervTarget(kParts[0], kParts[1], sv.prof, cRows)
    cells[supervIdx] = { ...sv, tipo: "supervDesloc", target: target ?? undefined }
  }

  const dias   = [...DIAS_UTIL].sort((a, b) => (DIAS_ORD[a] ?? 9) - (DIAS_ORD[b] ?? 9))
  // Eixo de tempo contínuo: dentro da faixa ocupada (por turno), inclui TODOS os tempos da
  // grade — inclusive os sem sessão — para que apareçam como linhas em branco, sem vãos.
  const horasComConteudo = HORAS_GRID.filter(h => dias.some(d => cMap[`${d}|||${h}`]?.length))
  const horas  = (() => {
    if (horasComConteudo.length === 0) return [] as string[]
    const manha = horasComConteudo.filter(h => (pm(h) ?? 0) < 720)
    const tarde = horasComConteudo.filter(h => (pm(h) ?? 0) >= 720)
    const ranges: Array<[number, number]> = []
    if (manha.length) ranges.push([pm(manha[0])!, pm(manha[manha.length - 1])!])
    if (tarde.length) ranges.push([pm(tarde[0])!, pm(tarde[tarde.length - 1])!])
    return HORAS_GRID.filter(h => { const m = pm(h) ?? -1; return ranges.some(([lo, hi]) => m >= lo && m <= hi) })
  })()
  const unitMeta = buildCronoUnitMeta(dias, cMap)

  // Time-axis: generate every 20-min tick within the range that has sessions.
  // Session rows (in `horas`) get rowSpan=2 to occupy 80px (= 40 min).
  const sessionStartSet = new Set(horas)
  const allSlots = (() => {
    if (horas.length === 0) return [] as string[]
    const toMin = (h: string) => { const [hr, mn] = h.split(":").map(Number); return hr * 60 + mn }
    const toHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    const slots: string[] = []
    const morningH  = horas.filter(h => toMin(h) < 720)
    const afternoonH = horas.filter(h => toMin(h) >= 720)
    if (morningH.length > 0) {
      for (let m = toMin(morningH[0]); m < toMin(morningH[morningH.length - 1]) + 40; m += 20) slots.push(toHora(m))
    }
    if (afternoonH.length > 0) {
      for (let m = toMin(afternoonH[0]); m < toMin(afternoonH[afternoonH.length - 1]) + 40; m += 20) slots.push(toHora(m))
    }
    return slots
  })()
  const firstAfternoonSlot = allSlots.find(s => parseInt(s.replace(":", "")) >= 1300)

  const discrepantCellKeys = new Set<string>()
  if (!unitMeta.globalUnit) {
    for (const d of dias) {
      for (const isM of [true, false]) {
        const horasT = horas.filter(h => isM ? (pm(h) ?? 999) < 720 : (pm(h) ?? 0) >= 720)
        const items: Array<{ unit: string; k: string }> = []
        for (const h of horasT) {
          for (const c of cMap[`${d}|||${h}`] || []) {
            if (!c.unidade || c.tipo === "adminSuperv" || c.tipo === "adminWarn" || c.tipo === "supervDesloc" || c.tipo === "recusada" || c.isVComp) continue
            items.push({ unit: c.unidade, k: `${d}|||${h}|||${c.tP}|||${c.prof}` })
          }
        }
        if (items.length < 2) continue
        const cnt: Record<string, number> = {}
        for (const x of items) cnt[x.unit] = (cnt[x.unit] || 0) + 1
        const dom = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]
        for (const x of items) if (x.unit !== dom) discrepantCellKeys.add(x.k)
      }
    }
  }

  const cSt = (tipo: string) => {
    if (tipo === "supervDesloc") return { bg: "#111827", bd: "#374151",  label: "↔ mover" }
    if (tipo === "adminSuperv")  return { bg: "#111827", bd: "#374151",  label: null       }
    if (tipo === "adminWarn")    return { bg: "#fef9c3", bd: "#fde047",  label: null       }
    if (tipo === "aceito")       return { bg: B.blueLt,  bd: B.blue,    label: "Aceito"   }
    if (tipo === "proposta")     return { bg: B.blueLt,  bd: B.blue,    label: null       }
    if (tipo === "recusada")     return { bg: "#fff5f5", bd: "#fca5a5", label: null       }
    // Vermelho forte e borda sólida: precisa ler como BLOQUEIO, não como sugestão
    // desbotada — é a diferença entre "não há vaga aqui" e "há vaga, mas a família
    // recusou". O tom fraco (#fff5f5) já é usado acima para a recusa de sugestão.
    // "Ver detalhe" no rótulo: única pista visual de que o card abre um modal ao
    // ser clicado — não há botão de ação aqui como nos cards de proposta.
    if (tipo === "recusadoFamilia") return { bg: "#fee2e2", bd: "#dc2626", label: "🚫 Recusado · ver detalhe" }
    if (tipo === "reservado")    return { bg: "#f0fdf4", bd: "#16a34a", label: "✅ Implantado" }
    return                              { bg: "#f8fafc", bd: "#e2e8f0", label: null       }
  }

  const selectedCount = buildSelectedSessoes().length

  // Cards multi-terapia já vêm com terapia/profissional pré-selecionados (maior
  // déficit primeiro — ver wizardComplete acima), então nunca ficam "pendentes"
  // de escolha antes de aceitar. Mantido como constante pra não mexer nos
  // pontos que ainda leem essa variável (label/estilo do botão "Aceitar").
  const hasPendingEsp = false

  const selectedByEsp: Record<string, number> = {}
  for (const id of selectedIds) {
    if (id.includes("|||vc|||")) {
      const sep = id.indexOf("|||vc|||")
      const parentId = id.slice(0, sep)
      const hora = id.slice(sep + 8)
      const s = sugestoes.find(x => x.id === parentId)
      if (!s || stOf(s) === "inviavel") continue
      const vc = getActiveVComps(s).find(v => v.hora === hora)
      if (vc) {
        const esp = TERAPIA_TO_ESP[vc.tP]
        if (esp) selectedByEsp[esp] = (selectedByEsp[esp] || 0) + 1
      }
    } else {
      const s = sugestoes.find(x => x.id === id)
      if (!s || stOf(s) === "inviavel") continue
      if (!isVCompExcluded(s.id, s.hora)) {
        const activeEsp = getActiveEspData(s).esp
        selectedByEsp[activeEsp] = (selectedByEsp[activeEsp] || 0) + 1
      }
    }
  }
  const isDeficitSobre = pacAllEsp.some(g => g.of > g.aut)
  const hasExcesso = pacAllEsp.some(g => {
    const sel = selectedByEsp[g.esp] || 0
    if (isDeficitSobre) return sel > 0 && (g.of + sel) > g.aut
    return (g.of + sel) > g.aut
  })
  // Mesma fonte de verdade do painel "Quantidade de Sessões" — nenhuma lógica duplicada
  const excessoEsps = new Set<string>(
    pacAllEsp.filter(g => (g.of + (selectedByEsp[g.esp] || 0)) > g.aut).map(g => g.esp)
  )

  // AVISO (nunca bloqueia): 3+ profissionais diferentes atendendo a mesma terapia.
  // Diferente do hasExcesso/CH Autorizada, que trava a escrita na TiTa, aqui só
  // pintamos de vermelho e explicamos — o usuário decide se aceita mesmo assim.
  // Conta o quadro final do paciente: sessões já existentes/implantadas + as
  // propostas efetivamente selecionadas nesta rodada.
  const profsPorTerapia: Record<string, Map<string, string>> = {}
  for (const cells of Object.values(cMap)) {
    for (const c of cells) {
      if (c.tipo === "adminSuperv" || c.tipo === "adminWarn" || c.tipo === "supervDesloc" || c.tipo === "recusada") continue
      if (c.tipo === "proposta" && !(c.sugestaoId && selectedIds.has(c.sugestaoId))) continue
      const key = normTxt(c.prof)
      if (!key) continue
      if (!profsPorTerapia[c.tP]) profsPorTerapia[c.tP] = new Map()
      if (!profsPorTerapia[c.tP].has(key)) profsPorTerapia[c.tP].set(key, c.prof)
    }
  }
  const multiProfTerapias = Object.entries(profsPorTerapia)
    .filter(([, m]) => m.size >= 3)
    .map(([tP, m]) => ({ tP, profs: [...m.values()] }))
  const multiProfSet = new Set<string>(multiProfTerapias.map(x => x.tP))
  const hasMultiProf = multiProfTerapias.length > 0

  return (
    <>
    {/* Barra de estratégias */}
    <div style={{ padding: "10px 14px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "12px", display: "none", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", marginRight: "4px" }}>Estratégia:</span>
          {(["S1", "S2", "S3"] as Estrategia[]).map(s => {
            const m = ESTRATEGIA_META[s]
            const isActive = estrategia === s
            return (
              <button key={s}
                onClick={() => m.disponivel && setEstrategia(s)}
                disabled={!m.disponivel}
                title={m.desc}
                style={{
                  padding: "4px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                  cursor: m.disponivel ? "pointer" : "not-allowed", fontFamily: "inherit",
                  border: `1px solid ${isActive ? m.border : "var(--border)"}`,
                  background: isActive ? m.bg : "var(--muted)",
                  color: isActive ? m.c : "var(--muted-foreground)",
                  opacity: m.disponivel ? 1 : 0.5,
                  display: "flex", alignItems: "center", gap: "5px",
                }}>
                <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "10px", fontWeight: 800, background: isActive ? m.c : "var(--border)", color: isActive ? "white" : "var(--muted-foreground)" }}>{m.short}</span>
                {m.label}
                {!m.disponivel && <span style={{ fontSize: "11px", background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24", borderRadius: "3px", padding: "0 4px" }}>Em breve</span>}
              </button>
            )
          })}
    </div>

    {/* Workspace — grade (fonte única de verdade) + resumo de ocupação */}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--card)", overflow: "hidden", height: "calc(100vh - 280px)", minHeight: "480px", marginBottom: "16px" }}>

      {/* ── Grade: Agenda ────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>
        <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", padding: "6px 16px 16px" }}>
            {!horas.length ? (
              <div style={{ textAlign: "center", color: "var(--muted-foreground)", padding: "20px" }}>Nenhuma sessão encontrada.</div>
            ) : (
              <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: `${46 + dias.length * 110}px`, width: "100%" }}>
                <colgroup>
                  <col style={{ width: "44px" }} />
                  {dias.map(d => <col key={d} style={{ width: "110px" }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ paddingBottom: "8px", textAlign: "right", paddingRight: "4px", fontSize: "11px", color: "var(--muted-foreground)", fontWeight: 400 }}>Hora</th>
                    {dias.map(d => (
                      <th key={d} style={{ paddingBottom: "8px", textAlign: "center", fontSize: "12px", color: B.navy, fontWeight: 800 }}>
                        <div>{d.replace("-feira", "")}</div>
                        <UnitHeaderBadges dayMeta={unitMeta.byDay[d]} globalUnit={unitMeta.globalUnit} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allSlots.map((slot) => {
                    const isSession = sessionStartSet.has(slot)
                    const isFirstAfternoon = slot === firstAfternoonSlot
                    return (
                      <tr key={slot} style={{ height: "38px", borderTop: isFirstAfternoon ? "2px solid var(--border)" : isSession ? "1px solid var(--border)" : "none" }}>
                        <td style={{ textAlign: "right", paddingRight: "4px", verticalAlign: "top", paddingTop: "5px", fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "12px", fontWeight: 800, color: B.navy, whiteSpace: "nowrap" }}>
                          {isSession ? slot : null}
                        </td>
                        {isSession && dias.map(d => {
                          const cells = cMap[`${d}|||${slot}`] || []
                          const cellHasExpanded = cells.some(c => c.sugestaoId && (expandedProfCardId === c.sugestaoId || expandedEspCardId === c.sugestaoId))
                          return (
                            <td key={d} rowSpan={2} style={{ position: "relative", zIndex: cellHasExpanded ? 1 : "auto" }}>
                              <div style={{ position: "absolute", inset: "2px", display: "flex", flexDirection: "column", gap: "2px", overflow: "visible" }}>
                              {cells.map((c, ci) => {
                                const cs       = cSt(c.tipo)
                                const isDark   = c.tipo === "supervDesloc" || c.tipo === "adminSuperv"
                                const cellKey  = `${d}|||${slot}|||${c.tP}|||${c.prof}`
                                const isDisc   = discrepantCellKeys.has(cellKey)
                                const isRecusadaCard = c.tipo === "recusada"
                                const isVCompCard    = !!c.isVComp
                                const isClickable    = (c.tipo === "proposta") && !!c.sugestaoId
                                // isSel funciona para main cards E vComps: cada um tem sugestaoId único
                                const isSel    = isClickable && selectedIds.has(c.sugestaoId!)
                                // Profissionais alternativos — só para main proposals (não vComp)
                                const mainSug  = (isClickable && !isVCompCard) ? (sugestoes.find(x => x.id === c.sugestaoId) ?? null) : null
                                const mainEd   = mainSug ? getActiveEspData(mainSug) : null
                                const allProfs = mainEd ? [{ prof: mainEd.prof, tP: mainEd.tP, unidade: mainEd.unidade } as ProfAlt, ...mainEd.profAlts] : []
                                const altCount = Math.max(0, allProfs.length - 1)
                                const isExpanded = expandedProfCardId === c.sugestaoId
                                // Terapias elegíveis para este slot (espAlts calculadas por buildSugestoes)
                                const allEsps     = mainSug ? [{ esp: mainSug.esp, tP: mainSug.tP }, ...mainSug.espAlts.map(a => ({ esp: a.esp, tP: a.tP }))] : []
                                const espAltCount = Math.max(0, allEsps.length - 1)
                                const isEspExpanded = expandedEspCardId === c.sugestaoId
                                const curEspIdx   = mainSug ? (espSelIdx[mainSug.id] ?? 0) : 0
                                // Wizard multi-terapia: estados derivados. Terapia/profissional já vêm
                                // pré-selecionados no índice 0 — que é sempre a maior distância entre
                                // autorizado e ofertado, porque buildSugestoes já ordena eligibleEsps por
                                // déficit efetivo desc (ver comentário em hasGap/eligibleEsps). Não exige
                                // mais escolha explícita pra liberar o card: "Alterar terapia" reabre o
                                // mesmo picker pra quem quiser trocar.
                                const wizardComplete = !!mainSug && allEsps.length > 1
                                const espIsPending = false
                                const cardEsp = isVCompCard
                                  ? (TERAPIA_TO_ESP[c.tP] ?? null)
                                  : (mainEd?.esp ?? TERAPIA_TO_ESP[c.tP] ?? null)
                                const isExcesso = isSel && cardEsp !== null && excessoEsps.has(cardEsp)
                                // Aviso (não bloqueia): esta terapia ficou com 3+ profissionais diferentes
                                const isMultiProf = isSel && multiProfSet.has(c.tP)
                                const isVermelho = isExcesso || isMultiProf
                                // Cor do card: amarelo se pendente, vermelho se excesso/3+ profissionais, verde se selecionado, default caso contrário
                                const bg  = espIsPending ? "#fefce8" : isVermelho ? "#fff1f2" : (isSel ? "#dcfce7" : cs.bg)
                                const bd  = espIsPending ? "#fbbf24" : isVermelho ? "#fca5a5" : (isSel ? "#16a34a" : cs.bd)
                                const isMultiEsp = !!(mainSug && allEsps.length > 1)
                                const cardClickable = isClickable && (!isMultiEsp || wizardComplete)
                                return (
                                  <div
                                    key={ci}
                                    onClick={
                                      cardClickable ? () => toggleSelected(c.sugestaoId!)
                                        : c.tipo === "recusadoFamilia" ? () => onAbrirRecusaDetalhe(d, slot, c.recusas ?? [])
                                        : undefined
                                    }
                                    style={{
                                      background: bg,
                                      // Sprint 4: borda sólida também para "reservado" — a implantação na TiTa é
                                      // definitiva, não há mais um estado "pendente" a distinguir visualmente.
                                      border: `1px solid ${isDisc ? "#f97316" : bd}`,
                                      borderRadius: "8px", padding: "5px 7px",
                                      flex: (isExpanded || isEspExpanded) ? "none" : "1",
                                      boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2px",
                                      outline: isDisc ? "2px solid #fed7aa" : "none",
                                      cursor: (cardClickable || c.tipo === "recusadoFamilia") ? "pointer" : "default",
                                      position: "relative",
                                      opacity: isRecusadaCard ? 0.65 : 1,
                                      zIndex: (isExpanded || isEspExpanded) ? 20 : "auto",
                                      boxShadow: (isExpanded || isEspExpanded) ? "0 6px 24px rgba(0,0,0,.13)" : "none",
                                      transition: "box-shadow 180ms ease",
                                    }}>

                                    {/* ── CARD TERAPIA ÚNICA (comportamento original inalterado) ── */}
                                    {!isMultiEsp && (
                                      <>
                                        {isSel && !isExpanded && (
                                          <span style={{ position: "absolute", top: "3px", right: "4px", fontSize: "10px", fontWeight: 900, color: isVermelho ? "#dc2626" : "#16a34a", lineHeight: 1, pointerEvents: "none" }}>{isVermelho ? "⚠" : "✓"}</span>
                                        )}
                                        {isRecusadaCard && (
                                          <span style={{ position: "absolute", top: "2px", right: "4px", fontSize: "9px", lineHeight: 1, pointerEvents: "none", opacity: 0.7 }}>🚫</span>
                                        )}
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2px" }}>
                                          <span style={{ fontSize: "10px", fontWeight: 600, color: isDark ? "white" : "#111827", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.tP}</span>
                                          <span style={{ fontSize: "8px", color: isDark ? "#d1d5db" : "#9ca3af", flexShrink: 0, whiteSpace: "nowrap", paddingRight: !isExpanded && (isSel || isRecusadaCard) ? "12px" : 0 }}>📍 {c.unidade}</span>
                                        </div>
                                        {!isExpanded && c.tE && (
                                          <div style={{ fontSize: "8px", fontStyle: "italic", color: isDark ? "#9ca3af" : "#9ca3af", lineHeight: "1", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>({c.tE})</div>
                                        )}
                                        {!isExpanded && (
                                          <div style={{ fontSize: "11px", color: isDark ? "#d1d5db" : "#6b7280", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(c.prof)}</div>
                                        )}
                                        {altCount > 0 && isClickable && !isVCompCard && (
                                          <div data-prof-dropdown="true" style={{ overflow: "hidden", maxHeight: isExpanded ? `${(altCount + 1) * 26 + 8}px` : "0px", opacity: isExpanded ? 1 : 0, transition: "max-height 200ms ease-out, opacity 150ms ease-out", display: "flex", flexDirection: "column", gap: "1px", marginTop: isExpanded ? "3px" : "0" }} onClick={e => e.stopPropagation()}>
                                            {allProfs.map((p, i) => {
                                              const isCurr = (profSelIdx[mainSug!.id] ?? 0) === i
                                              return (
                                                <button key={i} onClick={e => { e.stopPropagation(); setProfSelIdx(prev => ({ ...prev, [mainSug!.id]: i })); setExpandedProfCardId(null) }}
                                                  style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none", background: isCurr ? "rgba(22,163,74,0.1)" : "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: isCurr ? 600 : 400, color: isCurr ? "#166534" : "#374151", textAlign: "left", width: "100%", transition: "background 100ms ease" }}>
                                                  <span style={{ fontSize: "8px", color: isCurr ? "#16a34a" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>{isCurr ? "●" : "○"}</span>
                                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(p.prof)}</span>
                                                </button>
                                              )
                                            })}
                                          </div>
                                        )}
                                        {isDisc && <div style={{ fontSize: "11px", fontWeight: 700, color: "#ea580c", marginTop: "2px", display: "flex", alignItems: "center", gap: "3px" }}>⚠ {c.unidade}</div>}
                                        {isDark && <div style={{ fontSize: "11px", fontWeight: 700, color: "#fbbf24", marginTop: "auto" }}>{c.target ? `→ ${c.target}` : "→ verificar"}</div>}
                                        {!isDark && (cs.label || isClickable || isRecusadaCard) && (
                                          <div style={{ fontSize: "10px", fontWeight: 700, marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "3px" }}>
                                            {altCount > 0 && isClickable && !isVCompCard ? (
                                              <div style={{ display: "flex", alignItems: "center", gap: "3px", minWidth: 0 }}>
                                                <button data-prof-dropdown="true" onClick={e => { e.stopPropagation(); setExpandedProfCardId(isExpanded ? null : c.sugestaoId!); setExpandedEspCardId(null) }}
                                                  style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, fontSize: "10px", fontWeight: 700, color: "#0369a1", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", lineHeight: "1.4" }}>
                                                  <span style={{ fontSize: "7px", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>▼</span>
                                                  <span>{altCount === 1 ? "1 prof." : `${altCount} profs.`}</span>
                                                </button>
                                                {cs.label && <><span style={{ color: "#d1d5db", flexShrink: 0 }}>•</span><span style={{ color: c.tipo === "aceito" ? B.blue : "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cs.label}</span></>}
                                              </div>
                                            ) : isExcesso ? (
                                              <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>Acima do limite</span>
                                            ) : isMultiProf ? (
                                              <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>3+ profissionais</span>
                                            ) : cs.label ? (
                                              <span style={{ color: c.tipo === "aceito" ? B.blue : c.tipo === "recusadoFamilia" ? "#dc2626" : "#374151" }}>{cs.label}</span>
                                            ) : null}
                                            {isClickable && c.sugestaoId && (
                                              <button onClick={e => { e.stopPropagation(); const sid = isVCompCard ? c.sugestaoId!.slice(0, c.sugestaoId!.indexOf("|||vc|||")) : c.sugestaoId!; const sug = sugestoes.find(x => x.id === sid); if (!sug) return; const ae = getActiveEntry(sug); setPendingAcao({ sugestao: sug, hora: slot, tP: c.tP, prof: c.prof, unidade: ae.unidade, csvGradeId: ae.csvGradeId, acao: "recusar" }); setAcaoMotivo("") }}
                                                style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "3px", border: "1px solid #fca5a5", background: "#fee2e2", color: "#dc2626", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, lineHeight: "1.4", flexShrink: 0, marginLeft: "auto" }}>Recusar</button>
                                            )}
                                            {isRecusadaCard && c.sugestaoId && (
                                              <button onClick={e => { e.stopPropagation(); const sid = c.sugestaoId!.includes("|||vc|||") ? c.sugestaoId!.slice(0, c.sugestaoId!.indexOf("|||vc|||")) : c.sugestaoId!; const sug = sugestoes.find(x => x.id === sid); if (sug) setSt(sug, null); onUndoRecusa(d, slot, c.tP, c.prof) }}
                                                style={{ fontSize: "9px", padding: "1px 4px", borderRadius: "3px", border: "1px solid var(--border)", background: "var(--muted)", color: "var(--muted-foreground)", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, lineHeight: "1.4", flexShrink: 0 }}>↺</button>
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}

                                    {/* ── WIZARD MULTI-TERAPIA ── */}
                                    {isMultiEsp && (
                                      <>
                                        {/* Estágio 1: Pendente — wizard fechado */}
                                        {!isEspExpanded && !wizardComplete && (
                                          <>
                                            <span style={{ position: "absolute", top: "2px", right: "4px", fontSize: "9px", fontWeight: 900, color: "#92400e", lineHeight: 1, pointerEvents: "none" }}>⚠</span>
                                            <div style={{ fontSize: "8px", color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📍 {c.unidade}</div>
                                            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
                                              <button
                                                data-esp-dropdown="true"
                                                onClick={e => { e.stopPropagation(); setExpandedEspCardId(c.sugestaoId!); setExpandedProfCardId(null) }}
                                                style={{ fontSize: "9px", fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: "4px", padding: "2px 4px", cursor: "pointer", fontFamily: "inherit", lineHeight: "1.4", textAlign: "center" }}>
                                                ⚠ Escolher terapia
                                              </button>
                                              <button
                                                onClick={e => { e.stopPropagation(); const sug = sugestoes.find(x => x.id === c.sugestaoId!); if (!sug) return; const ae = getActiveEntry(sug); setPendingAcao({ sugestao: sug, hora: slot, tP: c.tP, prof: c.prof, unidade: ae.unidade, csvGradeId: ae.csvGradeId, acao: "recusar" }); setAcaoMotivo("") }}
                                                style={{ fontSize: "9px", padding: "2px 4px", borderRadius: "3px", border: "1px solid #fca5a5", background: "#fee2e2", color: "#dc2626", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, lineHeight: "1.4", textAlign: "center" }}>
                                                Recusar
                                              </button>
                                            </div>
                                          </>
                                        )}

                                        {/* Estágio 2+3: Wizard aberto — escolha de terapia e profissional */}
                                        {isEspExpanded && (
                                          <div data-esp-dropdown="true" onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                            <div style={{ fontSize: "9px", fontWeight: 800, color: "#374151", marginBottom: "1px" }}>Escolha uma terapia</div>
                                            {allEsps.map((e, i) => {
                                              const isCurr = curEspIdx === i
                                              return (
                                                <button key={i}
                                                  onClick={evt => { evt.stopPropagation(); setEspSelIdx(prev => ({ ...prev, [mainSug!.id]: i })); setProfSelIdx(prev => ({ ...prev, [mainSug!.id]: 0 })); setSelIdx(prev => ({ ...prev, [mainSug!.id]: {} })); setProfConfirmed(prev => { const s = new Set(prev); s.delete(mainSug!.id); return s }) }}
                                                  style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none", background: isCurr ? "rgba(126,34,206,0.08)" : "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: isCurr ? 600 : 400, color: isCurr ? "#6b21a8" : "#374151", textAlign: "left", width: "100%", transition: "background 100ms ease" }}>
                                                  <span style={{ fontSize: "8px", color: isCurr ? "#7e22ce" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>{isCurr ? "●" : "○"}</span>
                                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.tP}</span>
                                                </button>
                                              )
                                            })}
                                            {/* Lista de profissionais sempre visível — a terapia já vem pré-selecionada */}
                                            <>
                                                <div style={{ borderTop: "1px solid #e5e7eb", margin: "2px 0" }} />
                                                <div style={{ fontSize: "9px", fontWeight: 800, color: "#374151", marginBottom: "1px" }}>Escolha um profissional</div>
                                                {allProfs.map((p, i) => {
                                                  const isCurr = (profSelIdx[mainSug!.id] ?? 0) === i
                                                  return (
                                                    <button key={i}
                                                      onClick={evt => { evt.stopPropagation(); setProfSelIdx(prev => ({ ...prev, [mainSug!.id]: i })); setProfConfirmed(prev => { const s = new Set(prev); s.add(mainSug!.id); return s }); setExpandedEspCardId(null) }}
                                                      style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none", background: isCurr ? "rgba(22,163,74,0.1)" : "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: "11px", fontWeight: isCurr ? 600 : 400, color: isCurr ? "#166534" : "#374151", textAlign: "left", width: "100%", transition: "background 100ms ease" }}>
                                                      <span style={{ fontSize: "8px", color: isCurr ? "#16a34a" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>{isCurr ? "●" : "○"}</span>
                                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(p.prof)}</span>
                                                    </button>
                                                  )
                                                })}
                                            </>
                                          </div>
                                        )}

                                        {/* Estágio 4: Wizard concluído — layout normal + "Alterar terapia" */}
                                        {!isEspExpanded && wizardComplete && (
                                          <>
                                            {isSel && (
                                              <span style={{ position: "absolute", top: "3px", right: "4px", fontSize: "10px", fontWeight: 900, color: isVermelho ? "#dc2626" : "#16a34a", lineHeight: 1, pointerEvents: "none" }}>{isVermelho ? "⚠" : "✓"}</span>
                                            )}
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2px" }}>
                                              <span style={{ fontSize: "10px", fontWeight: 600, color: "#111827", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.tP}</span>
                                              <span style={{ fontSize: "8px", color: "#9ca3af", flexShrink: 0, whiteSpace: "nowrap", paddingRight: isSel ? "12px" : 0 }}>📍 {c.unidade}</span>
                                            </div>
                                            {c.tE && (
                                              <div style={{ fontSize: "8px", fontStyle: "italic", color: "#9ca3af", lineHeight: "1", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>({c.tE})</div>
                                            )}
                                            <div style={{ fontSize: "11px", color: "#6b7280", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(c.prof)}</div>
                                            {isDisc && <div style={{ fontSize: "11px", fontWeight: 700, color: "#ea580c", marginTop: "2px", display: "flex", alignItems: "center", gap: "3px" }}>⚠ {c.unidade}</div>}
                                            <div style={{ fontSize: "10px", fontWeight: 700, marginTop: "auto", display: "flex", alignItems: "center", gap: "3px" }}>
                                              {isExcesso && <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>Acima do limite</span>}
                                              {!isExcesso && isMultiProf && <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>3+ profissionais</span>}
                                              <button
                                                data-esp-dropdown="true"
                                                onClick={e => { e.stopPropagation(); setProfConfirmed(prev => { const s = new Set(prev); s.delete(mainSug!.id); return s }); setExpandedEspCardId(c.sugestaoId!); setExpandedProfCardId(null) }}
                                                style={{ fontSize: "9px", fontWeight: 700, color: "#7e22ce", background: "rgba(126,34,206,0.05)", border: "1px solid rgba(126,34,206,0.2)", borderRadius: "4px", padding: "1px 5px", cursor: "pointer", fontFamily: "inherit", lineHeight: "1.4" }}>
                                                Alterar terapia
                                              </button>
                                              <button
                                                onClick={e => { e.stopPropagation(); const sug = sugestoes.find(x => x.id === c.sugestaoId!); if (!sug) return; const ae = getActiveEntry(sug); setPendingAcao({ sugestao: sug, hora: slot, tP: c.tP, prof: c.prof, unidade: ae.unidade, csvGradeId: ae.csvGradeId, acao: "recusar" }); setAcaoMotivo("") }}
                                                style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "3px", border: "1px solid #fca5a5", background: "#fee2e2", color: "#dc2626", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, lineHeight: "1.4", flexShrink: 0, marginLeft: "auto" }}>
                                                Recusar
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </>
                                    )}

                                  </div>
                                )
                              })}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Action Bar contextual ── aparece só com seleção; selecionar → revisar → confirmar */}
          {selectedCount > 0 && (() => {
            const selSessoes = buildSelectedSessoes()
            const n = selSessoes.length
            return (
              <div
                className="animate-in slide-in-from-bottom-4 fade-in duration-300"
                style={{
                  flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--card)",
                  boxShadow: "0 -10px 28px rgba(15,23,42,0.07)",
                  display: "flex", alignItems: "stretch", gap: "14px", padding: "11px 16px",
                }}>
                {/* Esquerda — identidade da ação */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", width: "220px", flexShrink: 0 }}>
                  <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: "#dcfce7", border: "1px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#16a34a", fontSize: "17px", fontWeight: 900, lineHeight: 1 }}>✓</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 800, color: B.navy, lineHeight: 1.25 }}>
                      {n} {n === 1 ? "alteração pronta" : "alterações prontas"} para implantação
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "2px", lineHeight: 1.35 }}>
                      Revise as propostas selecionadas na grade.
                    </div>
                  </div>
                </div>

                {/* Centro — resumo das alterações (gerado automaticamente) */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", gap: "8px", overflowX: "auto", alignItems: "center", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", padding: "0 14px" }}>
                  {selSessoes.map((s, i) => (
                    <div key={i} style={{ flexShrink: 0, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "5px 9px", minWidth: "120px", maxWidth: "150px" }}>
                      <div style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "11px", fontWeight: 800, color: B.navy }}>{(DIA_ABR[s.dia] ?? s.dia.replace("-feira", ""))} • {s.hora}</div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--card-foreground)", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.tP}</div>
                      <div style={{ fontSize: "10px", color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtName(s.prof)}</div>
                    </div>
                  ))}
                </div>

                {/* Direita — ações */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: "6px", flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      style={{ padding: "8px 14px", borderRadius: "9px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--card-foreground)", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: "12px" }}>
                      Cancelar seleção
                    </button>
                    <button
                      disabled={hasExcesso || hasPendingEsp}
                      onClick={() => !hasExcesso && !hasPendingEsp && handleAceitar()}
                      style={{ padding: "8px 16px", borderRadius: "9px", border: "none", background: (hasExcesso || hasPendingEsp) ? "#e5e7eb" : hasMultiProf ? "#dc2626" : "#16a34a", color: (hasExcesso || hasPendingEsp) ? "#9ca3af" : "white", cursor: (hasExcesso || hasPendingEsp) ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 800, fontSize: "12px", boxShadow: (hasExcesso || hasPendingEsp) ? "none" : hasMultiProf ? "0 2px 8px rgba(220,38,38,0.30)" : "0 2px 8px rgba(22,163,74,0.30)" }}>
                      Aceitar alterações ({n})
                    </button>
                  </div>
                  <div style={{ fontSize: "10px", maxWidth: "340px", textAlign: "right", color: (hasExcesso || hasMultiProf) ? "#dc2626" : hasPendingEsp ? "#d97706" : "var(--muted-foreground)", fontWeight: (hasExcesso || hasPendingEsp || hasMultiProf) ? 700 : 400 }}>
                    {hasExcesso ? "⚠ Limite ultrapassado — desmarque sessões em excesso."
                      : hasPendingEsp ? "⚠ Selecione a terapia de todas as sugestões antes de continuar."
                      : hasMultiProf ? `⚠ ${multiProfTerapias.map(x => x.tP).join(", ")} ficará com 3 ou mais profissionais diferentes. O ideal é no máximo 2 por terapia — você pode continuar, mas revise antes.`
                      : "As alterações só serão aplicadas após a confirmação."}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

      {/* ── Coluna 3: Resumo Ocupação ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "8px 14px", flexShrink: 0, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--card-foreground)", letterSpacing: "0.03em" }}>Quantidade de Sessões</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 14px", overflowY: "auto", gap: "0" }}>

            {/* Quantidade de Sessões — antes e depois */}
            {(() => {
              const beforeCount = sessPac.length
              const addedCount  = buildSelectedSessoes().length
              const afterCount  = beforeCount + addedCount
              const pctGain     = beforeCount > 0 ? Math.round((addedCount / beforeCount) * 100) : null
              return (
                <div style={{ marginBottom: "14px", flexShrink: 0 }}>

                  {/* Labels */}
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.03em" }}>Antes</div>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.03em" }}>Depois</div>
                  </div>

                  {/* Numbers */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: "22px", fontWeight: 900, color: "var(--muted-foreground)", lineHeight: 1 }}>{beforeCount}</div>

                    <div style={{ fontSize: "20px", fontWeight: 900, color: addedCount > 0 ? "#16a34a" : "var(--border)", transition: "color 200ms ease", flexShrink: 0 }}>→</div>

                    <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                      <div key={afterCount} className="ocup-num-tick" style={{ fontSize: "28px", fontWeight: 900, color: addedCount > 0 ? "#16a34a" : "var(--muted-foreground)", lineHeight: 1, transition: "color 200ms ease" }}>
                        {afterCount}
                      </div>
                      {addedCount > 0 && (
                        <div key={addedCount} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span className="ocup-badge-pop" style={{ fontSize: "10px", fontWeight: 800, background: "#dcfce7", color: "#15803d", border: "1px solid #86efac", borderRadius: "5px", padding: "1px 6px", whiteSpace: "nowrap" }}>+{addedCount}</span>
                          {pctGain !== null && <span style={{ fontSize: "9px", fontWeight: 700, color: "#16a34a", textAlign: "center", whiteSpace: "nowrap" }}>(+{pctGain}%)</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ height: "1px", background: "var(--border)", margin: "12px 0 0" }} />
                </div>
              )
            })()}

<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              {pacAllEsp.length === 0 && (
                <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>Sem autorização registrada.</div>
              )}
              {pacAllEsp.map((g, i) => {
                const sel = selectedByEsp[g.esp] || 0
                const total = g.of + sel
                const excesso = total > g.aut
                const completo = total === g.aut
                const parcial = !excesso && !completo && sel > 0
                const cor = excesso ? "#dc2626" : completo ? "#16a34a" : parcial ? "#d97706" : B.navy
                return (
                  <div key={`${pac}|||${g.esp}`} className="ocup-esp-row" style={{ "--i": i } as CSSProperties}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--card-foreground)", marginBottom: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.esp}>{g.esp}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span key={`${pac}|||${g.esp}|||${total}`} className="ocup-num-tick" style={{ fontSize: "15px", fontWeight: 900, color: cor, transition: "color 180ms ease", display: "inline-flex", alignItems: "baseline", gap: "3px" }}>
                        <span>{g.of}</span>
                        <span>/{g.aut}</span>
                      </span>
                      {excesso && <span className="ocup-badge-pop" style={{ fontSize: "11px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>acima</span>}
                      {completo && sel > 0 && <span key={`completo-${sel}`} className="ocup-badge-pop" style={{ fontSize: "11px", background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>+{sel}</span>}
                      {completo && sel === 0 && <span className="ocup-badge-pop" style={{ fontSize: "11px", background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>✓</span>}
                      {parcial && <span key={`parcial-${sel}`} className="ocup-badge-pop" style={{ fontSize: "11px", background: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>+{sel}</span>}
                    </div>
                    <div style={{ height: "4px", background: "var(--muted)", borderRadius: "2px", marginTop: "4px", overflow: "hidden" }}>
                      <div className="ocup-progress-bar" style={{ height: "100%", borderRadius: "2px", width: "100%", background: cor, transform: `scaleX(${Math.min(1, total / g.aut)})`, transformOrigin: "left" }} />
                    </div>
                  </div>
                )
              })}
            </div>
            {pacSuspensoes.length > 0 && (
              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
                {pacSuspensoes.map(({ esp, info }) => (
                  <div key={esp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: "8px", padding: "6px 8px" }}>
                    <span style={{ fontSize: "10.5px", color: "#92400e", fontWeight: 700, lineHeight: 1.3 }}>
                      🚫 {esp} — suspensa temporariamente
                    </span>
                    <Link
                      href={`/cadastros/pacientes/${info.idPacientePulsar}?aba=altas&suspensao=${info.idSuspensao}`}
                      target="_blank"
                      title={`Ver a suspensão de ${esp} na ficha do paciente`}
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "6px", background: "var(--card)", border: "1px solid #fcd34d", color: "#92400e", flexShrink: 0, textDecoration: "none", fontWeight: 900, fontSize: "13px" }}
                    >
                      →
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {hasExcesso && (
              <div style={{ marginTop: "12px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "8px 10px", fontSize: "10px", color: "#dc2626", fontWeight: 700, flexShrink: 0 }}>
                ⚠ Limite ultrapassado. Desmarque sessões em excesso antes de aceitar.
              </div>
            )}
            {hasMultiProf && (
              <div style={{ marginTop: "12px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "8px 10px", fontSize: "10px", color: "#dc2626", fontWeight: 700, flexShrink: 0 }}>
                <div>⚠ 3 ou mais profissionais na mesma terapia (ideal: até 2).</div>
                {multiProfTerapias.map(x => (
                  <div key={x.tP} style={{ marginTop: "5px", fontWeight: 400 }}>
                    <span style={{ fontWeight: 700 }}>{x.tP}</span>: {x.profs.map(p => fmtName(p)).join(" · ")}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>

    {/* ── Modal: ação direta por sessão (✓ aceitar · ✗ recusar · ⛔ inviável) ── */}
    {pendingAcao && (() => {
      const ACAO_META: Record<AcaoDiretaType, { titulo: string; desc: string; cor: string; label: string; placeholder: string }> = {
        aceitar:  { titulo: "✓ Confirmar Aceite",   desc: "Sessão enviada para Acompanhamento → Aguardando Resposta.", cor: "#15803d", label: "Confirmar",     placeholder: "Ex: família confirmou disponibilidade..." },
        recusar:  { titulo: "✗ Confirmar Recusa",   desc: "Sessão registrada como recusada em Aceites e Recusas.",      cor: "#dc2626", label: "Confirmar",     placeholder: "Ex: família recusou por conflito de agenda..." },
        inviavel: { titulo: "⛔ Confirmar Inviável", desc: "Sessão registrada como inviável em Aceites e Recusas.",      cor: B.navy,    label: "Confirmar",     placeholder: "Ex: família não tem disponibilidade neste horário..." },
      }
      const meta = ACAO_META[pendingAcao.acao]
      const isInvAcao = pendingAcao.acao === "inviavel"
      const motivoFaltando = isInvAcao && !acaoMotivo.trim()
      const handleConfirmar = () => {
        if (motivoFaltando) return
        const sessao: AceiteSessao = { dia: pendingAcao.sugestao.dia, hora: pendingAcao.hora, tP: pendingAcao.tP, prof: pendingAcao.prof, unidade: pendingAcao.unidade, csvGradeId: pendingAcao.csvGradeId }
        const statusFinal = pendingAcao.acao === "aceitar" ? "pendente" : pendingAcao.acao === "recusar" ? "recusado" : "inviavel"
        onAcaoDireta([sessao], statusFinal, acaoMotivo || undefined)
        if (pendingAcao.acao === "inviavel") {
          setSt(pendingAcao.sugestao, "inviavel")
          setSelectedIds(prev => { const n = new Set(prev); n.delete(pendingAcao.sugestao.id); return n })
        }
        setPendingAcao(null); setAcaoMotivo("")
      }
      return (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.45)", padding: "16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setPendingAcao(null); setAcaoMotivo("") } }}
        >
          <div style={{ background: "var(--card)", borderRadius: "16px", boxShadow: "0 20px 60px rgba(0,0,0,.25)", maxWidth: "380px", width: "100%", padding: "22px" }}>
            <div style={{ fontWeight: 900, fontSize: "16px", color: meta.cor, marginBottom: "4px", textWrap: "balance" as const }}>{meta.titulo}</div>
            <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "14px" }}>{meta.desc}</div>
            <div style={{ background: "var(--muted)", borderRadius: "10px", padding: "11px 14px", marginBottom: "12px" }}>
              <div style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize: "13px", color: B.navy }}>{pendingAcao.sugestao.dia.replace("-feira", "")} {pendingAcao.hora}</div>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--card-foreground)", marginTop: "3px" }}>{pendingAcao.tP}</div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", marginTop: "1px" }}>{fmtName(pendingAcao.prof)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "5px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: isInvAcao ? "#dc2626" : "#6b7280" }}>
                Justificativa{isInvAcao ? " *" : " (opcional)"}
              </span>
              {motivoFaltando && (
                <span style={{ fontSize: "10px", color: "#dc2626", fontWeight: 600 }}>— obrigatória para Inviável</span>
              )}
            </div>
            <textarea
              value={acaoMotivo}
              onChange={e => setAcaoMotivo(e.target.value)}
              placeholder={meta.placeholder}
              rows={3}
              style={{ width: "100%", border: `1px solid ${motivoFaltando ? "#fca5a5" : "#d1d5db"}`, borderRadius: "10px", padding: "8px 12px", fontSize: "16px", fontFamily: "inherit", resize: "none", marginBottom: motivoFaltando ? "6px" : "16px", boxSizing: "border-box", outline: motivoFaltando ? "none" : undefined }}
            />
            {motivoFaltando && (
              <div style={{ fontSize: "11px", color: "#dc2626", marginBottom: "10px" }}>Descreva o motivo para registrar como inviável.</div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleConfirmar}
                disabled={motivoFaltando}
                style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", background: motivoFaltando ? "#f3f4f6" : meta.cor, color: motivoFaltando ? "#9ca3af" : "white", border: "none", cursor: motivoFaltando ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>
                {meta.label}
              </button>
              <button onClick={() => { setPendingAcao(null); setAcaoMotivo("") }} style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", background: "#f3f4f6", color: "#374151", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )
    })()}



  </>
  )
})

// ─── PacAgendaGrid ────────────────────────────────────────────────────────────

function PacAgendaGrid({ pac, cRows, sugestoes, onVerAll }: { pac: string; cRows: CsvRow[]; sugestoes: Sugestao[]; onVerAll: () => void }) {
  const sessionMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const r of cRows) {
      if (r["Nome Favorecido"] !== pac || r["Status do Agendamento"] !== "Agendado") continue
      const k = `${r["Dia da Semana"]}|||${hiStr(r)}`
      if (!m[k]) m[k] = []
      if (!m[k].includes(r.Terapia)) m[k].push(r.Terapia)
    }
    return m
  }, [pac, cRows])

  const sugMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const s of sugestoes) {
      const k = `${s.dia}|||${s.hora}`
      if (!m[k]) m[k] = []
      if (!m[k].includes(s.esp)) m[k].push(s.esp)
    }
    return m
  }, [sugestoes])

  const activeDias = [...DIAS_UTIL].sort((a, b) => (DIAS_ORD[a] ?? 9) - (DIAS_ORD[b] ?? 9))

  const allHoras = useMemo(() => {
    const hs = new Set<string>()
    for (const k of [...Object.keys(sessionMap), ...Object.keys(sugMap)]) hs.add(k.split("|||")[1])
    return [...hs].sort((a, b) => (pm(a) || 0) - (pm(b) || 0))
  }, [sessionMap, sugMap])

  return (
    <div style={{ background: "var(--card)", borderRadius: "14px", border: "1px solid var(--border)", padding: "16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
        <div style={{ fontWeight: 800, color: B.navy, fontSize: "14px" }}>Agenda atual do paciente</div>
        <button onClick={onVerAll} style={btnStyle("var(--muted)", "var(--card-foreground)", "var(--border)")}>🗓 Ver aperfeiçoamentos</button>
      </div>
      <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "10px" }}>
        Sessões agendadas{sugestoes.length > 0 ? " + propostas destacadas" : ""}
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "10px", flexWrap: "wrap" }}>
        {[
          { bg: "#22c55e", label: "Agendado" },
          ...(sugestoes.length ? [{ bg: "#fef3c7", bd: "#fbbf24", label: "Proposta" }] : []),
        ].map(({ bg, label, bd }: { bg: string; label: string; bd?: string }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "11px", height: "11px", borderRadius: "3px", background: bg, border: bd ? `1px solid ${bd}` : undefined }} />
            <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>{label}</span>
          </div>
        ))}
      </div>

      {!allHoras.length && (
        <div style={{ textAlign: "center", color: "var(--muted-foreground)", fontSize: "11px", padding: "16px 0" }}>Nenhuma sessão agendada.</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", fontSize: "11px", width: `${48 + activeDias.length * 100}px` }}>
          <colgroup>
            <col style={{ width: "48px" }} />
            {activeDias.map(d => <col key={d} style={{ width: "100px" }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: "4px 6px", borderBottom: "2px solid var(--border)" }} />
              {activeDias.map(d => (
                <th key={d} style={{ padding: "6px 8px", textAlign: "center", fontWeight: 800, fontSize: "13px", color: B.navy, borderBottom: `2px solid ${B.navy}` }}>
                  {DIA_ABR[d] ?? d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allHoras.map(hora => {
              const isSep = hora === "13:00"
              return (
                <tr key={hora} style={{ borderTop: isSep ? "2px solid var(--border)" : "1px solid var(--border)" }}>
                  <td style={{ padding: "2px 6px", color: "var(--muted-foreground)", fontSize: "10px", fontWeight: 500, height: "40px", verticalAlign: "middle", whiteSpace: "nowrap" }}>{hora}</td>
                  {activeDias.map(d => {
                    const k      = `${d}|||${hora}`
                    const sesses = sessionMap[k]
                    const sugs   = sugMap[k]
                    // Pedido 1: slot tem Supervisão ABA + proposta → célula preta
                    const hasSupervConflict = sesses?.includes("Supervisão ABA") && !!sugs?.length

                    if (hasSupervConflict) {
                      return (
                        <td key={d} style={{ padding: "2px 4px", verticalAlign: "middle" }}>
                          <div style={{ background: "var(--card-foreground)", borderRadius: "8px", minHeight: "36px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4px 6px", gap: "2px" }}>
                            <div style={{ fontWeight: 700, fontSize: "10px", lineHeight: 1.2, color: "white", textAlign: "center" }}>Superv. ABA</div>
                            <div style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700 }}>↔ deslocar</div>
                          </div>
                        </td>
                      )
                    }
                    if (sesses?.length) {
                      return (
                        <td key={d} style={{ padding: "2px 4px", verticalAlign: "middle" }}>
                          <div style={{ background: "#22c55e", borderRadius: "8px", minHeight: "36px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "white", textAlign: "center", padding: "4px 6px", gap: "2px" }}>
                            {sesses.slice(0, 2).map((t, i) => (
                              <div key={i} style={{ fontWeight: 700, fontSize: i === 0 ? "10px" : "9px", lineHeight: 1.2, opacity: i > 0 ? 0.85 : 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                                {t.length > 14 ? t.slice(0, 13) + "…" : t}
                              </div>
                            ))}
                            {sesses.length > 2 && <div style={{ fontSize: "11px", opacity: 0.7 }}>+{sesses.length - 2}</div>}
                          </div>
                        </td>
                      )
                    }
                    if (sugs?.length) {
                      return (
                        <td key={d} style={{ padding: "2px 4px", verticalAlign: "middle" }}>
                          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: "8px", minHeight: "36px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3px 4px", gap: "1px" }}>
                            {sugs.slice(0, 2).map((t, i) => (
                              <div key={i} style={{ fontWeight: 600, fontSize: "11px", color: "#92400e", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "center" }}>
                                {t.length > 14 ? t.slice(0, 13) + "…" : t}
                              </div>
                            ))}
                            <div style={{ fontSize: "11px", color: "#d97706", fontWeight: 700 }}>proposta ↓</div>
                          </div>
                        </td>
                      )
                    }
                    return <td key={d} style={{ padding: "2px 4px" }} />
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── OcupPacMode ──────────────────────────────────────────────────────────────

interface Props {
  cRows: CsvRow[]
  lRows: LaudoRow[]
  cfg: CfgState
  rec?: RecItem[]
  inv?: InvItem[]
  sRec?: (rec: RecItem[]) => void
  sInv?: (inv: InvItem[]) => void
  /** `${pacienteNome}|||${especialidade}` com suspensão temporária vigente — ver suspensaoTemporaria.ts. */
  suspensaoSet?: Set<string>
  /** Mesma chave -> paciente/suspensão de origem, para o link "ver na ficha do paciente". */
  suspensaoInfo?: Map<string, SuspensaoLinkInfo>
}

// "Notificação Prévia" é o paciente-teste oficial usado na homologação da
// integração com a TiTa — habilitado como paciente normal só nesta página, para
// permitir testar o fluxo real de implantação (Sprint 4) sem afetar as demais
// páginas do Cronograma, que continuam tratando-o como registro administrativo.
const PACS_ADMIN_OCUP_PAC = new Set(PACS_ADMIN)
PACS_ADMIN_OCUP_PAC.delete(PACIENTE_TESTE_TITA)

// Referência estável para quando `suspensaoSet` não é passado (ex.: chamador
// antigo, ou ainda carregando) — `new Set()` como default de destructuring
// recriaria a cada render e invalidaria os `useMemo` que a usam como dependência.
const SUSPENSAO_SET_VAZIO = new Set<string>()
const SUSPENSAO_INFO_VAZIO = new Map<string, SuspensaoLinkInfo>()

export function OcupPacMode({
  cRows, lRows, cfg, rec: recGlobal = [], inv: invGlobal = [], sRec, sInv,
  suspensaoSet = SUSPENSAO_SET_VAZIO, suspensaoInfo = SUSPENSAO_INFO_VAZIO,
}: Props) {
  const modalRef = useRef<TodasSugestoesModalHandle>(null)
  const [pac, setPac]           = useState("")
  const [inputVal, setInputVal] = useState("")
  const [dropOpen, setDropOpen] = useState(false)
  const [estrategia, setEstrategia] = useState<Estrategia>("S1")
  const [statusMap, setStatusMap] = useState<Record<string, Status>>(() => {
    try { return JSON.parse(localStorage.getItem(SK) || "{}") } catch { return {} }
  })
  const { pacBundles, persistPacBundles } = useCronogramaData()
  const aceites = pacBundles
  const persistAceites = persistPacBundles
  const [invPending, setInvPending] = useState<Sugestao | null>(null)
  const [invMotivo, setInvMotivo]   = useState("")
  // Modal de detalhe do card "recusadoFamilia" — aberto ao clicar no card, em vez
  // de depender só do title nativo (que não funciona em toque e não é clicável).
  const [recusaDetalheAberto, setRecusaDetalheAberto] = useState<{
    dia: string; hora: string
    recusas: Array<{ tP: string; prof: string; ocorrencias: Array<{ ts: number; data: string; motivo?: string }> }>
  } | null>(null)
  const [inputFocused, setInputFocused] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const listboxRef = useRef<HTMLDivElement>(null)
  // CRON-008: sessões aguardando confirmação no modal premium de implantação
  const [pendingConfirm, setPendingConfirm] = useState<{ sessoes: AceiteSessao[]; beforeCount: number; avisoMultiProf: AvisoMultiProf[] } | null>(null)
  // Confirmação agora chama a API da TiTa (fetch assíncrono) — usado para desabilitar
  // o modal e impedir cancelar/duplo-clique enquanto a chamada está em andamento.
  const [confirmando, setConfirmando] = useState(false)

  // CRON-008: sessões já reservadas (implantação imediata) deste paciente — exibidas
  // diretamente na grade do TodasSugestoesModal como "Reservado".
  const reservasConfirmadas = useMemo(
    () => aceites.filter(b => b.pac === pac && b.status === "confirmado").flatMap(b => b.sessoes),
    [aceites, pac],
  )

  // Horários recusados pela família, para marcar a grade em vermelho. Mesma regra de
  // slotsRecusados em buildSugestoes (status do bundle OU recusa slot a slot), para
  // que o que é BLOQUEADO e o que é MOSTRADO como bloqueado nunca divirjam.
  // Achado 2026-08-20 (caso Arthur Luiz Maciel Fortes, quarta 13:00): o mesmo
  // horário pode ter sido recusado mais de uma vez — às vezes para a MESMA
  // combinação terapia+profissional (a família recusa, o sistema volta a oferecer
  // exatamente aquilo meses depois, ela recusa de novo), às vezes para combinações
  // diferentes. Antes isso era achatado num único ponto por combinação, sem data
  // — no modal ficava impossível saber se era "recusado 1 vez, bloqueando 3
  // opções" ou "recusado 3 vezes, uma por opção". Agora cada combinação carrega
  // TODAS as ocorrências (data + motivo), em ordem cronológica.
  const recusasPac = useMemo(() => {
    type Ocorrencia = { ts: number; data: string; motivo?: string }
    const porCombo = new Map<string, { dia: string; hora: string; tP: string; prof: string; unidade: string; ocorrencias: Ocorrencia[] }>()
    for (const b of aceites) {
      if (b.pac !== pac) continue
      for (const s of b.sessoes) {
        const recusadoNoSlot = b.slotStatus?.[`${s.dia}|||${s.hora}`] === "recusado"
        if (b.status !== "recusado" && !recusadoNoSlot) continue
        const k = `${s.dia}|||${s.hora}|||${s.tP}|||${s.prof}`
        if (!porCombo.has(k)) porCombo.set(k, { dia: s.dia, hora: s.hora, tP: s.tP, prof: s.prof, unidade: s.unidade, ocorrencias: [] })
        // Ordena pela data real (ts), não pelo texto já formatado — "09/07" vem
        // antes de "19/08" no calendário, mas depois em ordem alfabética de string.
        porCombo.get(k)!.ocorrencias.push({ ts: b.ts, data: new Date(b.ts).toLocaleDateString("pt-BR"), motivo: b.motivo })
      }
    }
    for (const combo of porCombo.values()) combo.ocorrencias.sort((a, b) => a.ts - b.ts)
    return [...porCombo.values()]
  }, [aceites, pac])

  // Reconciliação com a TiTa. A API só grava, não exclui — então uma série pode ser
  // removida diretamente na TiTa sem que o Pulsar saiba. Como o estado "Implantado"
  // vive só nos bundles (pacBundles), sem sync de volta ele ficaria preso para
  // sempre, mostrando "✅ Implantado" e bloqueando o slot para todos. Ao abrir um
  // paciente, um bundle "confirmado" cujas sessões não aparecem mais na grade oficial
  // é reclassificado para "removido_tita": some de reservasConfirmadas (grade),
  // slotsReservadosOutros e do bloqueio de dayHours — tudo porque buildSugestoes
  // filtra por status === "confirmado". Só libera localmente (não há exclusão via API).
  //
  // Guarda anti-corrida (limite fixo de 24h): a grade oficial sincroniza 1x/dia (06h);
  // uma sessão recém-implantada ainda não aparece nela, e sem essa guarda seria
  // liberada por engano logo depois de implantada.
  const RECONCILE_MIN_AGE_MS = 24 * 60 * 60 * 1000
  useEffect(() => {
    if (!pac || cRows.length === 0) return
    // Só reconcilia se a grade cobre este paciente — sem nenhuma linha dele não dá
    // para distinguir "removido na TiTa" de "grade ainda não carregou este paciente".
    if (!cRows.some(r => r["Nome Favorecido"] === pac)) return

    const agora = Date.now()
    const sessaoNaGrade = (s: AceiteSessao) => cRows.some(r =>
      r["Nome Favorecido"] === pac &&
      r["Dia da Semana"] === s.dia &&
      r.Profissional === s.prof &&
      r.Terapia === s.tP &&
      fm(pm(hiStr(r)) ?? hiMin(r)) === s.hora,
    )

    let mudou = false
    const proximos = aceites.map(b => {
      if (b.pac !== pac || b.status !== "confirmado") return b
      if (agora - b.ts < RECONCILE_MIN_AGE_MS) return b
      // Exclusão é sempre da série inteira — só libera quando NENHUMA sessão do
      // bundle aparece mais na grade (conservador: presença parcial mantém).
      if (b.sessoes.some(sessaoNaGrade)) return b
      mudou = true
      return { ...b, status: "removido_tita" as const }
    })
    if (mudou) {
      persistAceites(proximos)
      toast("♻️ Sessões implantadas foram removidas na TiTa — os horários foram liberados.")
    }
  }, [pac, cRows, aceites, persistAceites])

  function openInvModal(s: Sugestao) { setInvPending(s); setInvMotivo("") }
  function confirmInv() {
    if (!invPending) return
    setSt(invPending, "inviavel")
    sInv?.([...invGlobal, { paciente: pac, motivo: invMotivo, registradoEm: new Date().toLocaleDateString("pt-BR") }])
    setInvPending(null)
    setInvMotivo("")
  }

  function persistStatus(m: Record<string, Status>) {
    setStatusMap(m)
    try { localStorage.setItem(SK, JSON.stringify(m)) } catch {}
  }

  // CRON-008: "Aceitar alterações" não aplica mais direto — abre o modal premium de
  // confirmação. A implantação de fato só ocorre em confirmarImplantacao().
  function handleAceitar({ sessoes, beforeCount, avisoMultiProf }: { sessoes: AceiteSessao[]; beforeCount: number; avisoMultiProf: AvisoMultiProf[] }) {
    if (!sessoes.length) return
    setPendingConfirm({ sessoes, beforeCount, avisoMultiProf })
  }

  function cancelarImplantacao() {
    if (confirmando) return // chamada à TiTa em andamento — não permite fechar no meio
    setPendingConfirm(null)
  }

  // CRON-008: pacBundles é a ÚNICA fonte de verdade da Reserva Pendente — nada é
  // espelhado em `conf`. Isso evita o estado duplicado (bundle + conf) que ficava
  // dessincronizado sempre que a reserva era desfeita por um caminho que só
  // conhecia um dos dois lados. Grade ("Reservado"), bloqueio cross-paciente
  // (slotsReservadosOutros/aqui e confirmedItems em OcupacaoShell) e a aba
  // Confirmados (via pacConfDerived em AcompanhamentoTab) leem todos direto daqui.
  //
  // A implantação local (persistAceites) só acontece se a TiTa confirmar TODAS as
  // sessões do bundle (tudo ou nada) — ver app/api/tita/confirmar-agendamento.
  // Isso evita que a Reserva Pendente exista localmente sem o agendamento real ter
  // sido criado na TiTa. Se a chamada falhar, o modal permanece aberto com a
  // seleção intacta para o usuário tentar de novo.
  async function confirmarImplantacao() {
    if (!pendingConfirm || confirmando) return
    const { sessoes } = pendingConfirm

    // Guarda: uma sessão sem csvGradeId faria a rota rejeitar com 400
    // (sessao_sem_csv_grade_id) — resposta sem `mensagem`, que caía no fallback
    // genérico "Não foi possível concluir a integração com a TiTa". Barra aqui, antes
    // de qualquer chamada, com uma mensagem que diz o que realmente aconteceu.
    const semGradeId = sessoes.filter(s => !s.csvGradeId)
    if (semGradeId.length) {
      toast.error(
        `❌ ${semGradeId.length}/${sessoes.length} ${semGradeId.length === 1 ? "horário ainda não está sincronizado" : "horários ainda não estão sincronizados"} para implantação. Gere uma nova sugestão e tente novamente.`,
      )
      return
    }

    setConfirmando(true)
    try {
      const resp = await fetch("/api/tita/confirmar-agendamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `modalidade` alimenta o card de inclusão que avisa o cronograma (ver
        // services/tita/inclusaoTerapia.ts). Explícita de propósito: o servidor
        // conseguiria inferi-la, mas por um efeito colateral que mentiria calado
        // se mudasse.
        body: JSON.stringify({ pac, sessoes, modalidade: "aumentar" }),
      })
      const body = await resp.json().catch(() => null) as {
        ok: boolean
        error?: string
        mensagem?: string
        implantadoPor?: string
        implantadoPorEmail?: string | null
        resultados?: Array<{ csvGradeId: string; ok: boolean; codigoErro?: string }>
      } | null

      if (!resp.ok || !body?.ok) {
        const falhas = body?.resultados?.filter(r => !r.ok) ?? []
        // Mensagem amigável já vem traduzida do backend (mensagemAmigavel/
        // mensagemResumoCriacao em services/tita/confirmar.ts) — nunca expõe
        // código técnico/stack ao usuário. Respostas de guarda da rota (401/400)
        // trazem só `error` (sem `mensagem`); traduz esses casos aqui em vez de
        // cair no fallback genérico, que não diz nada ao usuário.
        const mensagem =
          body?.mensagem ??
          (body?.error === "not_authenticated" ? "Sua sessão expirou. Recarregue a página e entre novamente."
            : body?.error === "sessao_sem_csv_grade_id" ? "Um dos horários ainda não está sincronizado para implantação. Gere uma nova sugestão e tente novamente."
            : "Não foi possível concluir a integração com a TiTa. Tente novamente.")
        const contagem = falhas.length || sessoes.length
        toast.error(`❌ ${mensagem} (${contagem}/${sessoes.length} sessões afetadas)`)
        return
      }

      const bundle: AceitePacBundle = {
        id: `${Date.now()}_${pac.slice(0, 8)}`,
        pac, ts: Date.now(),
        origem: "ocp-paciente",
        sessoes,
        status: "confirmado",
        inviavelSlots: [],
        // Autoria imutável da implantação (do usuário autenticado no servidor).
        implantadoPor: body?.implantadoPor,
        implantadoPorEmail: body?.implantadoPorEmail ?? undefined,
      }
      persistAceites([...aceites, bundle])

      modalRef.current?.clearAll()
      setPendingConfirm(null)
      // Sprint 4/4.1: a implantação na TiTa já aconteceu (é o que "ok" confirma) —
      // não existe mais estado "aguardando sincronização" depois disso. A grade e o
      // painel lateral já reagem sozinhos (reservasConfirmadas/sugestoes/pacAllEsp
      // derivam de `aceites`), então ocupação e indicadores aparecem imediatamente,
      // sem precisar sair da tela nem atualizar a página. body.mensagem já vem pronta
      // do backend: "Implantação realizada com sucesso." no total, ou o detalhe de
      // sucesso parcial ("16 sessões implantadas. 6 não puderam...").
      toast(`✅ ${body?.mensagem ?? "Implantação realizada com sucesso."}`)
    } catch (err) {
      // Detalhe técnico só no console — o usuário vê uma mensagem amigável.
      console.error("[ocupacao-paciente] falha ao implantar na TiTa", err)
      toast.error("❌ Não foi possível concluir a implantação agora. Verifique a conexão e tente novamente.")
    } finally {
      setConfirmando(false)
    }
  }

  function handleInviavel(sessoes: AceiteSessao[], motivo: string) {
    if (!sessoes.length) return
    const bundle: AceitePacBundle = {
      id: `inv_${Date.now()}_${pac.slice(0, 8)}`,
      pac, ts: Date.now(),
      origem: "ocp-paciente",
      sessoes,
      status: "inviavel",
      inviavelSlots: [],
      motivo,
    }
    persistAceites([...aceites, bundle])
  }

  function handleAcaoDireta(sessoes: AceiteSessao[], status: "pendente" | "recusado" | "inviavel", motivo?: string) {
    if (!sessoes.length) return
    const bundle: AceitePacBundle = {
      id: `${status}_${Date.now()}_${pac.slice(0, 8)}`,
      pac, ts: Date.now(),
      origem: "ocp-paciente",
      sessoes, status,
      inviavelSlots: [],
      motivo,
    }
    persistAceites([...aceites, bundle])

    // Espelha em "Aceites e Recusas" (contexto global)
    if (status === "recusado" && sRec) {
      const registradoEm = new Date().toLocaleDateString("pt-BR")
      const newItems: RecItem[] = sessoes.map(s => ({
        paciente: pac,
        profissional: s.prof,
        especialidade: s.tP,
        unidade: s.unidade,
        dia: s.dia,
        hora: s.hora,
        registradoEm,
        obs: motivo || undefined,
      }))
      sRec([...recGlobal, ...newItems])
      for (const s of sessoes)
        registrarRecusa({ origem: "ocp-paciente", paciente: pac, profissional: s.prof, especialidade: s.tP, unidade: s.unidade, dia: s.dia, hora: s.hora, motivo })
    }

    if (status === "inviavel" && sInv && !invGlobal.some(x => x.paciente === pac)) {
      sInv([...invGlobal, {
        paciente: pac,
        motivo: motivo || "",
        registradoEm: new Date().toLocaleDateString("pt-BR"),
      }])
    }
  }

  function onUndoRecusa(dia: string, hora: string, tP: string, prof: string) {
    sRec?.(recGlobal.filter(r =>
      !(r.paciente === pac && r.dia === dia && r.hora === hora
        && r.especialidade === tP && r.profissional === prof)
    ))
    persistAceites(
      aceites
        .map(b => {
          if (b.pac !== pac || b.status !== "recusado") return b
          const novas = b.sessoes.filter(s => !(s.dia === dia && s.hora === hora && s.tP === tP && s.prof === prof))
          return { ...b, sessoes: novas }
        })
        .filter(b => b.sessoes.length > 0)
    )
    registrarReativacao({ origem: "ocp-paciente", paciente: pac, profissional: prof, especialidade: tP, dia, hora })
  }

  const stKey = (sugestao: Sugestao) => `${pac}|||${sugestao.id}`
  const stOf  = (sugestao: Sugestao): Status | null => statusMap[stKey(sugestao)] || null
  const setSt = (sugestao: Sugestao, s: Status | null) => {
    const k = stKey(sugestao)
    if (s === null) { const m = { ...statusMap }; delete m[k]; persistStatus(m) }
    else persistStatus({ ...statusMap, [k]: s })
  }

  // ── Dados derivados ─────────────────────────────────────────────────────────

  const agend = useMemo(() => cRows.filter(r => r["Status do Agendamento"] === "Agendado"), [cRows])
  const agendClin = useMemo(() =>
    agend.filter(r => r["Nome Favorecido"] && !PACS_ADMIN_OCUP_PAC.has(r["Nome Favorecido"]) && !EXCLUIR_GAPS.has(r.Terapia)),
    [agend])

  // Lista de nomes canônicos do agend ordenados por comprimento decrescente.
  // Usada por agendMergeMap para encontrar o nome canônico mais curto.
  const agendNamesByLen = useMemo(() => {
    const s = new Set<string>()
    for (const r of agend) {
      const p = r["Nome Favorecido"]
      if (p && !PACS_ADMIN_OCUP_PAC.has(p)) s.add(p)
    }
    return [...s].sort((a, b) => b.length - a.length)
  }, [agend])

  // Mapeia variantes de nome do agend para o nome canônico mais curto.
  // Ex: "Pietro Ferreira D'Ávila" → "Pietro Ferreira" quando ambos existem no agend.
  const agendMergeMap = useMemo(() => {
    const byLen = [...agendNamesByLen].reverse() // shortest first
    const m = new Map<string, string>()
    for (const name of byLen) {
      const nn = normalizeName(name)
      let canonical = name
      // Find the shortest existing agend name that is a prefix of this one
      for (const shorter of byLen) {
        if (shorter.length >= name.length) continue
        const ns = normalizeName(shorter)
        if (ns.split(" ").length >= 2 && nn.startsWith(ns + " ")) {
          canonical = shorter
          break
        }
      }
      m.set(name, canonical)
    }
    return m
  }, [agendNamesByLen])

  // Mapa: "ID Favorecido" do lRows → nome canônico do agend.
  // Substitui a junção por nome normalizado — mais confiável e independente de encoding.
  const agendIdMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of agend) {
      const id  = String(r["Id Favorecido"] ?? r["ID Favorecido"] ?? "").trim()
      const rawP = r["Nome Favorecido"]
      if (id && rawP && !PACS_ADMIN_OCUP_PAC.has(rawP)) {
        const p = agendMergeMap.get(rawP) ?? rawP
        if (!m.has(id)) m.set(id, p)
      }
    }
    return m
  }, [agend, agendMergeMap])

  const gapMap = useMemo(() => {
    if (!cRows.length || !lRows.length) return {} as Record<string, { dif: number; aut: number; of: number }>
    const qtdOf: Record<string, number> = {}
    const seenOf = new Set<string>()
    for (const r of agend) {
      const rawP = r["Nome Favorecido"]
      if (!rawP || PACS_ADMIN_OCUP_PAC.has(rawP)) continue
      const p = agendMergeMap.get(rawP) ?? rawP
      const espPadrao = espParaOcupacaoPac(r.Terapia, TERAPIA_TO_ESP)
      if (!espPadrao) continue
      const terapiaExib = String(r["Terapia Exibição"] || r["Terapia Exibicao"] || "").trim()
      const esp = espRealPorExibicao(r.Terapia, terapiaExib, espPadrao)
      const hm = pm(hiStr(r)) ?? hiMin(r)
      const dk = `${p}|||${r["Dia da Semana"]}|||${hm}|||${r.Terapia}|||${r.Profissional}`
      if (seenOf.has(dk)) continue
      seenOf.add(dk)
      qtdOf[`${p}|||${esp}`] = (qtdOf[`${p}|||${esp}`] || 0) + pesoOcupacaoAba(r.Terapia)
    }
    // Reservas confirmadas também ocupam a vaga — sem isso o motor de sugestões
    // (buildSugestoes) continuaria ofertando sessões além do que resta de autorização.
    // "pendente" não conta mais — nenhum caminho da UI cria esse status hoje.
    // `seenOf` evita dupla contagem após a sincronização.
    for (const b of aceites) {
      if (b.status !== "confirmado") continue
      if (PACS_ADMIN_OCUP_PAC.has(b.pac)) continue
      for (const s of b.sessoes) {
        const esp = espParaOcupacaoPac(s.tP, TERAPIA_TO_ESP)
        if (!esp) continue
        const hm = pm(s.hora)
        if (hm === null) continue
        const dk = `${b.pac}|||${s.dia}|||${hm}|||${s.tP}|||${s.prof}`
        if (seenOf.has(dk)) continue
        seenOf.add(dk)
        qtdOf[`${b.pac}|||${esp}`] = (qtdOf[`${b.pac}|||${esp}`] || 0) + pesoOcupacaoAba(s.tP)
      }
    }
    const qtdAut: Record<string, number> = {}
    // "Alta" (do laudo) e "Suspensão Temporária" (cadastro do paciente) são
    // duas fontes diferentes, mas o efeito é o mesmo: a especialidade não deve
    // ser ofertada. Um Set só para as duas, mesmo padrão já usado para Alta.
    const excluidosSet = new Set<string>()
    for (const l of lRows) {
      const idFav = String(l["ID Favorecido"] ?? l["Id Favorecido"] ?? "").trim()
      const p     = (idFav ? agendIdMap.get(idFav) : undefined) ?? String(l["Paciente"] || "").trim()
      const espRaw = String(l["Especialidade"] || "").trim()
      if (ESP_LAUDO_IGNORAR.has(espRaw)) continue
      const esp   = ESP_LAUDO_SINONIMO[espRaw] ?? espRaw
      if (!p || PACS_ADMIN_OCUP_PAC.has(p) || !esp) continue
      const k = `${p}|||${esp}`
      if (isLaudoComAlta(l) || suspensaoSet.has(k)) { excluidosSet.add(k); continue }
      const aut = parseFloat(String(l["Qtd autorizada"] || "0").replace(",", ".")) || 0
      if (aut <= 0) continue
      if (!qtdAut[k] || aut > qtdAut[k]) qtdAut[k] = aut
    }
    for (const k of excluidosSet) delete qtdAut[k]
    const result: Record<string, { dif: number; aut: number; of: number }> = {}
    for (const [k, aut] of Object.entries(qtdAut)) {
      const of_ = ceilOcupacaoAba(qtdOf[k] || 0)
      const dif = Math.round((aut - of_) * 10) / 10
      result[k] = { dif, aut, of: of_ }
    }
    return result
  }, [cRows, lRows, agend, agendIdMap, agendMergeMap, aceites, suspensaoSet])

  const todosPacs = useMemo(() => {
    const pacs = new Set<string>()
    for (const r of agend) {
      const rawP = r["Nome Favorecido"]
      if (!rawP || PACS_ADMIN_OCUP_PAC.has(rawP)) continue
      pacs.add(agendMergeMap.get(rawP) ?? rawP)
    }
    return [...pacs].sort()
  }, [agend, agendMergeMap])

  const pacStatusMap = useMemo((): Record<string, "deficit" | "em-dia" | "deficit-sobre" | "sobreofertado" | "sem-laudo"> => {
    // Detecta quem tem QUALQUER laudo com Qtd > 0 (independe de Situação).
    const temLaudo = new Set<string>()
    for (const l of lRows) {
      const idFav = String(l["ID Favorecido"] ?? l["Id Favorecido"] ?? "").trim()
      const p     = (idFav ? agendIdMap.get(idFav) : undefined) ?? String(l["Paciente"] || "").trim()
      if (!p || PACS_ADMIN_OCUP_PAC.has(p)) continue
      const aut = parseFloat(String(l["Qtd autorizada"] || "0").replace(",", ".")) || 0
      if (aut > 0) temLaudo.add(p)
    }
    // Agrupa os difs por paciente a partir do gapMap (já calculado, inclui dif ≤ 0).
    const pacDifs: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(gapMap)) {
      const [p] = k.split("|||")
      if (!pacDifs[p]) pacDifs[p] = []
      pacDifs[p].push(v.dif)
    }
    const result: Record<string, "deficit" | "em-dia" | "deficit-sobre" | "sobreofertado" | "sem-laudo"> = {}
    for (const p of todosPacs) result[p] = temLaudo.has(p) ? "em-dia" : "sem-laudo"
    for (const [p, difs] of Object.entries(pacDifs)) {
      const hasDeficit = difs.some(d => d > 0)
      const hasSobre   = difs.some(d => d < 0)
      if      (hasDeficit && hasSobre) result[p] = "deficit-sobre"
      else if (hasDeficit)             result[p] = "deficit"
      else if (hasSobre)               result[p] = "sobreofertado"
      else                             result[p] = "em-dia"
    }
    return result
  }, [gapMap, todosPacs, lRows, agendIdMap])

  const pacIdMap = useMemo(() => {
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "")
    const TARGET = normalize("id favorecido")
    const findId = (r: Record<string, unknown>): string => {
      const exact = r["Id Favorecido"] ?? r["ID Favorecido"] ?? r["id favorecido"]
      if (exact != null) return String(exact).trim()
      // fallback: case/space-insensitive scan
      for (const key of Object.keys(r)) {
        if (normalize(key) === TARGET) return String(r[key] ?? "").trim()
      }
      return ""
    }
    const m: Record<string, string> = {}
    for (const r of agend) {
      const rawP = r["Nome Favorecido"]
      if (!rawP) continue
      const p = agendMergeMap.get(rawP) ?? rawP
      const id = findId(r as Record<string, unknown>)
      if (id && !m[p]) m[p] = id
    }
    return m
  }, [agend, agendMergeMap])

  const pacConvMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of lRows) {
      const p = String(l["Paciente"] || "").trim()
      const plano = String(l["Plano"] || "").trim()
      if (p && plano) m[p] = plano
    }
    for (const r of agend) {
      const rawP = r["Nome Favorecido"]
      if (!rawP) continue
      const p = agendMergeMap.get(rawP) ?? rawP
      if (m[p]) continue
      const conv = r["Convênio"]
      if (conv) m[p] = conv
    }
    return m
  }, [lRows, agend, agendMergeMap])

  const [convFilter, setConvFilter]       = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter]   = useState<Set<string>>(new Set())
  const [situacaoOpen, setSituacaoOpen]   = useState(false)
  const [convOpen, setConvOpen]           = useState(false)
  // "Alterar preferência": quais especialidades priorizar na escolha automática da
  // terapia de cada card. Vazio = preferência natural (maior distância entre ofertado
  // e autorizado), que é o padrão e segue valendo sempre que nada é escolhido aqui.
  const [prefOpen, setPrefOpen]           = useState(false)
  const [prefEspIds, setPrefEspIds]       = useState<Set<number>>(new Set())
  const prefEsps = useMemo(
    () => ESP_PREF_OPCOES.filter(o => prefEspIds.has(o.id)).map(o => o.nome),
    [prefEspIds],
  )
  // Nenhuma especialidade escolhida = preferência natural em vigor.
  const prefPadrao = prefEspIds.size === 0
  const alternarPrefEsp = (id: number) => setPrefEspIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  // Fecha ao clicar fora. O ref envolve gatilho + painel (mesmo padrão de
  // MultiSearchCombobox), então clicar no próprio gatilho continua alternando.
  const prefRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!prefOpen) return
    const fechar = (e: MouseEvent) => {
      if (prefRef.current?.contains(e.target as Node)) return
      setPrefOpen(false)
    }
    document.addEventListener("mousedown", fechar)
    return () => document.removeEventListener("mousedown", fechar)
  }, [prefOpen])

  const convenios = useMemo(() => {
    const s = new Set<string>()
    for (const p of todosPacs) { const c = pacConvMap[p]; if (c) s.add(c) }
    return [...s].sort()
  }, [todosPacs, pacConvMap])

  const countBySituacao = useMemo(() => {
    const q = inputVal.toLowerCase()
    const base = todosPacs.filter(p =>
      (convFilter.size === 0 || convFilter.has(pacConvMap[p] || "")) &&
      (!q || p.toLowerCase().includes(q))
    )
    const counts: Record<string, number> = { todos: base.length }
    for (const p of base) {
      const st = pacStatusMap[p] || "sem-laudo"
      counts[st] = (counts[st] || 0) + 1
    }
    return counts
  }, [todosPacs, convFilter, pacConvMap, pacStatusMap, inputVal])

  const countByConv = useMemo(() => {
    const q = inputVal.toLowerCase()
    const base = todosPacs.filter(p =>
      (statusFilter.size === 0 || statusFilter.has(pacStatusMap[p] || "sem-laudo")) &&
      (!q || p.toLowerCase().includes(q))
    )
    const counts: Record<string, number> = { "": base.length }
    for (const p of base) {
      const c = pacConvMap[p]
      if (c) counts[c] = (counts[c] || 0) + 1
    }
    return counts
  }, [todosPacs, statusFilter, pacStatusMap, pacConvMap, inputVal])

  const filteredPacs = useMemo(() => {
    return todosPacs
      .filter(p => convFilter.size === 0 || convFilter.has(pacConvMap[p] || ""))
      .filter(p => statusFilter.size === 0 || statusFilter.has(pacStatusMap[p] || "sem-laudo"))
      .filter(p => !inputVal.trim() || p.toLowerCase().includes(inputVal.toLowerCase()))
  }, [todosPacs, inputVal, convFilter, pacConvMap, statusFilter, pacStatusMap])

  const pacAllRows   = useMemo(() => agend.filter(r => (agendMergeMap.get(r["Nome Favorecido"] ?? "") ?? r["Nome Favorecido"]) === pac), [pac, agend, agendMergeMap])
  const currentSlots = useMemo(() => countSlots(pacAllRows), [pacAllRows])

  const pacGaps = useMemo((): GapInfo[] =>
    Object.entries(gapMap)
      .filter(([k]) => k.startsWith(`${pac}|||`))
      .map(([k, v]) => ({ esp: k.split("|||")[1], ...v }))
      .filter(v => v.dif > 0)
      .sort((a, b) => b.dif - a.dif),
    [pac, gapMap])

  // Todas as especialidades do paciente (com déficit, zeradas ou sobreofertadas)
  const pacAllEsp = useMemo((): GapInfo[] => {
    if (!pac) return []
    const qtdOf: Record<string, number> = {}
    const seenOf = new Set<string>()
    for (const r of agend) {
      const rawP = r["Nome Favorecido"]
      if (!rawP) continue
      if ((agendMergeMap.get(rawP) ?? rawP) !== pac) continue
      const espPadrao = espParaOcupacaoPac(r.Terapia, TERAPIA_TO_ESP)
      if (!espPadrao) continue
      const terapiaExib = String(r["Terapia Exibição"] || r["Terapia Exibicao"] || "").trim()
      const esp = espRealPorExibicao(r.Terapia, terapiaExib, espPadrao)
      const hm = pm(hiStr(r)) ?? hiMin(r)
      const dk = `${r["Dia da Semana"]}|||${hm}|||${r.Terapia}|||${r.Profissional}`
      if (seenOf.has(dk)) continue
      seenOf.add(dk)
      qtdOf[esp] = (qtdOf[esp] || 0) + pesoOcupacaoAba(r.Terapia)
    }
    // Sprint 4: implantação na TiTa é imediata e definitiva — reservas confirmadas
    // contam junto com o que já veio de `agend`, num único total (sem "+N" separado
    // à espera de sincronização). `seenOf` evita dupla contagem quando a mesma sessão
    // também aparecer em `agend` após o próximo sync do CSV.
    // "pendente" não conta mais — nenhum caminho da UI cria esse status hoje.
    for (const b of aceites) {
      if (b.pac !== pac || b.status !== "confirmado") continue
      for (const s of b.sessoes) {
        const esp = espParaOcupacaoPac(s.tP, TERAPIA_TO_ESP)
        if (!esp) continue
        const hm = pm(s.hora)
        if (hm === null) continue
        const dk = `${s.dia}|||${hm}|||${s.tP}|||${s.prof}`
        if (seenOf.has(dk)) continue
        seenOf.add(dk)
        qtdOf[esp] = (qtdOf[esp] || 0) + pesoOcupacaoAba(s.tP)
      }
    }
    const qtdAut: Record<string, number> = {}
    const excluidosSet = new Set<string>()
    for (const l of lRows) {
      const idFav = String(l["ID Favorecido"] ?? l["Id Favorecido"] ?? "").trim()
      const p     = (idFav ? agendIdMap.get(idFav) : undefined) ?? String(l["Paciente"] || "").trim()
      if (p !== pac) continue
      const espRaw = String(l["Especialidade"] || "").trim()
      if (ESP_LAUDO_IGNORAR.has(espRaw)) continue
      const esp = ESP_LAUDO_SINONIMO[espRaw] ?? espRaw
      if (!esp) continue
      if (isLaudoComAlta(l) || suspensaoSet.has(`${pac}|||${esp}`)) { excluidosSet.add(esp); continue }
      const aut = parseFloat(String(l["Qtd autorizada"] || "0").replace(",", ".")) || 0
      if (aut <= 0) continue
      if (!qtdAut[esp] || aut > qtdAut[esp]) qtdAut[esp] = aut
    }
    for (const esp of excluidosSet) delete qtdAut[esp]
    return Object.entries(qtdAut)
      .map(([esp, aut]) => {
        const of_ = ceilOcupacaoAba(qtdOf[esp] || 0)
        return { esp, aut, of: of_, dif: Math.round((aut - of_) * 10) / 10 }
      })
      .sort((a, b) => b.dif - a.dif)
  }, [pac, agend, lRows, agendIdMap, agendMergeMap, aceites, suspensaoSet])

  // Especialidades do paciente com suspensão temporária vigente — não aparecem em
  // pacAllEsp (foram removidas de lá, junto com "Alta"), então sem isto o
  // operador só veria a especialidade desaparecer sem entender o motivo.
  const pacSuspensoes = useMemo(() => {
    const resultado: { esp: string; info: SuspensaoLinkInfo }[] = []
    if (!pac) return resultado
    const prefixo = `${pac}|||`
    for (const chave of suspensaoSet) {
      if (!chave.startsWith(prefixo)) continue
      const info = suspensaoInfo.get(chave)
      if (info) resultado.push({ esp: chave.slice(prefixo.length), info })
    }
    return resultado
  }, [pac, suspensaoSet, suspensaoInfo])

  const sugestoes = useMemo(() => {
    if (!pac || estrategia !== "S1") return [] as Sugestao[]
    const conv      = pacConvMap[pac] || ""
    const isLiminar = /LIMINAR/i.test(cfg.judicialMap?.[pac] || "")
    // CRON-008: bundles "confirmado" (Reserva Pendente) são passados para que a vaga
    // implantada saia da lista de sugestões — tanto para o próprio paciente (não pode
    // ser reofertada) quanto para os demais (slot já reservado, ver slotsReservadosOutros).
    // Bundles "recusado" também são passados: a família já recusou aquele horário
    // (com justificativa registrada em "rec"), então buildSugestoes não pode reofertá-lo
    // até a família reativar via "Reativar sugestão" na aba Recusados (ver slotsRecusados).
    // Bundles "pendente" continuam fora do cálculo — preserva o comportamento anterior
    // de manter os cards visíveis enquanto aguardam confirmação do responsável.
    const aceitesRelevantes = aceites.filter(a => a.status === "confirmado" || a.status === "recusado")
    return buildSugestoes(pac, agend, agendClin, cRows, gapMap, aceitesRelevantes, conv, isLiminar, prefEsps)
    // prefEsps nas deps: trocar a preferência recalcula as sugestões na hora, sem recarregar a página.
  }, [pac, estrategia, agend, agendClin, cRows, gapMap, pacConvMap, cfg.judicialMap, aceites, prefEsps])

  useEffect(() => {
    if (!pac) return
    const valid = new Set(sugestoes.map(s => `${pac}|||${s.id}`))
    setStatusMap(prev => {
      const stale = Object.keys(prev).filter(k => k.startsWith(`${pac}|||`) && !valid.has(k))
      if (!stale.length) return prev
      const pruned = { ...prev }
      for (const k of stale) delete pruned[k]
      try { localStorage.setItem(SK, JSON.stringify(pruned)) } catch {}
      return pruned
    })
  }, [pac, sugestoes])

  const totalAceitos = aceites.filter(a => a.pac === pac).reduce((acc, b) => acc + b.sessoes.length, 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSituacaoOpen(false); setConvOpen(false); setDropOpen(false); setPrefOpen(false) }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  function selectPac(p: string) { setPac(p); setInputVal(p); setDropOpen(false); setHighlightedIdx(-1) }

  return (
    <>
      <style>{`
        .ocup-workbench-bar {
          display: grid;
          grid-template-columns: 35fr 12fr 38fr 15fr;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: 16px 0 0 16px;
          margin-bottom: 16px;
          margin-right: -1.5rem;
          position: relative;
        }
        @media (max-width: 900px) {
          .ocup-workbench-bar { grid-template-columns: 1fr 1fr; }
          .ocup-workbench-bar > div:nth-child(2) { border-right: none !important; }
        }
        @media (max-width: 560px) {
          .ocup-workbench-bar { grid-template-columns: 1fr; }
          .ocup-workbench-bar > div { border-right: none !important; border-bottom: 1px solid var(--border); }
          .ocup-workbench-bar > div:last-child { border-bottom: none !important; }
        }
        @media (pointer: coarse) {
          .ocup-btn-situacao { min-height: 44px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ocup-workbench-bar * { transition: none !important; }
        }
      `}</style>
      {/* ── WORKBENCH BAR ─────────────────────────────────────────────────────── */}
      <div className="ocup-workbench-bar">

        {/* Área 1 — Paciente */}
        <div style={{ padding: "14px 18px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: "6px" }}>
          <label htmlFor="pac-search" style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>Paciente</label>
          <div style={{ position: "relative" }}>
            <input
              id="pac-search"
              type="text"
              // O campo não tinha autoComplete definido, então o Chrome guardava o que
              // já foi digitado aqui e sobrepunha sua própria caixa de sugestão (preta,
              // fora do nosso CSS) por cima da lista branca do sistema. "off" some com
              // ela; a lista própria (role="listbox" abaixo) continua funcionando igual.
              autoComplete="off"
              aria-label="Buscar paciente"
              aria-autocomplete="list"
              aria-controls={dropOpen ? "pac-listbox" : undefined}
              aria-expanded={dropOpen}
              value={inputVal}
              onChange={e => { setInputVal(e.target.value); setPac(""); setDropOpen(true); setHighlightedIdx(-1) }}
              onFocus={() => { setDropOpen(true); setInputFocused(true) }}
              onBlur={() => { setTimeout(() => { setDropOpen(false); setHighlightedIdx(-1) }, 150); setInputFocused(false); if (pac) setInputVal(pac) }}
              onKeyDown={e => {
                if (!dropOpen || filteredPacs.length === 0) return
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  const next = Math.min(highlightedIdx + 1, filteredPacs.length - 1)
                  setHighlightedIdx(next)
                  listboxRef.current?.children[next]?.scrollIntoView({ block: "nearest" })
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  const prev = Math.max(highlightedIdx - 1, 0)
                  setHighlightedIdx(prev)
                  listboxRef.current?.children[prev]?.scrollIntoView({ block: "nearest" })
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  const idx = highlightedIdx >= 0 ? highlightedIdx : (filteredPacs.length === 1 ? 0 : -1)
                  if (idx >= 0) selectPac(filteredPacs[idx])
                } else if (e.key === "Escape") {
                  setDropOpen(false); setHighlightedIdx(-1)
                  if (pac) setInputVal(pac)
                }
              }}
              placeholder="Buscar paciente..."
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: "9px", padding: "7px 12px", fontSize: "16px", fontFamily: "inherit", outline: "none", background: "var(--card)", color: "inherit", boxShadow: inputFocused ? `0 0 0 2px ${B.navy}` : "none" }}
            />
            {dropOpen && filteredPacs.length > 0 && (
              <div ref={listboxRef} id="pac-listbox" role="listbox" aria-label="Pacientes" style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 100, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", boxShadow: "0 4px 16px rgba(0,0,0,.08)", maxHeight: "200px", overflowY: "auto" }}>
                {filteredPacs.map((p, i) => {
                  const st  = pacStatusMap[p]
                  const dot = st === "deficit" ? "#dc2626" : st === "deficit-sobre" ? "#ea580c" : st === "em-dia" ? "#16a34a" : st === "sobreofertado" ? "#d97706" : "#d1d5db"
                  const stLabel = st === "deficit" ? "deficit" : st === "deficit-sobre" ? "deficit com sobreoferta" : st === "em-dia" ? "em dia" : st === "sobreofertado" ? "sobreofertado" : "sem laudo"
                  const isSelected  = p === pac
                  const isHighlight = i === highlightedIdx
                  return (
                    <button key={p} type="button" role="option" aria-selected={isSelected} aria-label={`${p} — ${stLabel}`} onMouseDown={() => selectPac(p)}
                      style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left", padding: "8px 12px", background: isHighlight ? B.navy : isSelected ? "var(--muted)" : "transparent", border: "none", fontSize: "12px", cursor: "pointer", color: isHighlight ? "#fff" : isSelected ? B.navy : "var(--card-foreground)", fontWeight: isSelected || isHighlight ? 700 : 400, fontFamily: "inherit" }}>
                      <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: isHighlight ? "#fff" : dot, flexShrink: 0 }} />
                      {p}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {pac && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginTop: "2px", paddingLeft: "2px" }}>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>
                {pacConvMap[pac] ?? ""}
              </div>
              <ObservacaoPacienteBox pac={pac} />
            </div>
          )}
        </div>

        {/* Área 3 — Seleção */}
        <div style={{ padding: "14px 18px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "8px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>Seleção</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
            <button
              type="button"
              onClick={() => modalRef.current?.selectAll()}
              style={{ padding: "5px 10px", borderRadius: "7px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#16a34a", whiteSpace: "nowrap" }}
            >
              Selecionar tudo
            </button>
            <button
              type="button"
              onClick={() => modalRef.current?.clearAll()}
              style={{ padding: "5px 10px", borderRadius: "7px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "1px solid #fecaca", background: "#fff1f2", color: "#dc2626", whiteSpace: "nowrap" }}
            >
              Limpar Seleção
            </button>
          </div>
        </div>

        {/* Área 4 — Filtros */}
        <div style={{ padding: "14px 18px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: "6px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>Filtros</div>
          <div style={{ display: "flex", gap: "8px" }}>

            {/* Situação — dropdown */}
            <div style={{ position: "relative", flex: 1 }}>
              <button
                type="button"
                aria-expanded={situacaoOpen}
                aria-haspopup="listbox"
                onClick={() => { setSituacaoOpen(v => !v); setConvOpen(false) }}
                className="ocup-btn-situacao"
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${statusFilter.size > 0 ? B.navy : "var(--border)"}`, background: statusFilter.size > 0 ? `${B.navy}15` : "var(--muted)", color: statusFilter.size > 0 ? B.navy : "var(--card-foreground)" }}>
                <span>Situação{statusFilter.size > 0 ? ` (${statusFilter.size})` : ""}</span>
                <span aria-hidden="true" style={{ fontSize: "10px", marginLeft: "4px" }}>{situacaoOpen ? "▲" : "▼"}</span>
              </button>
              {situacaoOpen && (
                <div role="listbox" aria-multiselectable="true" aria-label="Filtrar por situação" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,.1)", padding: "8px", minWidth: "230px", display: "flex", flexDirection: "column", gap: "3px" }}>
                  {([
                    { key: "em-dia",        label: "Autorização = Oferta",               color: "#16a34a" },
                    { key: "deficit",       label: "Acrescentar",                        color: "#dc2626" },
                    { key: "deficit-sobre", label: "Acrescentar & Contém Sobreoferta",   color: "#ea580c" },
                    { key: "sobreofertado", label: "Sobreofertado & Nada P/ Acrescentar",color: "#d97706" },
                    { key: "sem-laudo",     label: "Sem autorização registrada",         color: "var(--muted-foreground)" },
                  ] as const).map(({ key, label, color }) => {
                    const isActive = statusFilter.has(key)
                    const count = countBySituacao[key] ?? 0
                    const toggle = () => setStatusFilter(prev => {
                      const next = new Set(prev)
                      if (next.has(key)) next.delete(key); else next.add(key)
                      return next
                    })
                    return (
                      <button key={key} type="button" role="option" aria-selected={isActive} onClick={toggle} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                        cursor: "pointer", fontFamily: "inherit", border: `1px solid ${isActive ? color : "var(--border)"}`,
                        background: isActive ? color : "var(--muted)", color: isActive ? "white" : "var(--card-foreground)", textAlign: "left",
                      }}>
                        <span>{label}</span>
                        <span aria-hidden="true" style={{ fontSize: "10px", fontWeight: 800, background: isActive ? "rgba(255,255,255,0.25)" : "var(--border)", color: isActive ? "white" : "var(--muted-foreground)", borderRadius: "10px", padding: "1px 7px", minWidth: "20px", textAlign: "center" }}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                  {statusFilter.size > 0 && (
                    <button type="button" onClick={() => setStatusFilter(new Set())} style={{ marginTop: "2px", padding: "4px 10px", borderRadius: "7px", fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: "var(--muted)", color: "var(--muted-foreground)", textAlign: "center" }}>
                      Limpar filtros
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* Alterar preferência — qual terapia o sistema escolhe sozinho em cada card */}
          <div style={{ display: "flex", gap: "8px" }}>
            <div ref={prefRef} style={{ position: "relative", flex: 1 }}>
              <button
                type="button"
                aria-expanded={prefOpen}
                aria-haspopup="listbox"
                onClick={() => { setPrefOpen(v => !v); setSituacaoOpen(false); setConvOpen(false) }}
                className="ocup-btn-situacao"
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${prefEspIds.size > 0 ? B.navy : "var(--border)"}`, background: prefEspIds.size > 0 ? `${B.navy}15` : "var(--muted)", color: prefEspIds.size > 0 ? B.navy : "var(--card-foreground)" }}>
                <span>Alterar preferência{prefEspIds.size > 0 ? ` (${prefEspIds.size})` : ""}</span>
                <span aria-hidden="true" style={{ fontSize: "10px", marginLeft: "4px" }}>{prefOpen ? "▲" : "▼"}</span>
              </button>
              {prefOpen && (
                <div role="radiogroup" aria-label="Preferência de escolha automática da terapia" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 200, background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,.1)", padding: "10px", width: "300px", display: "flex", flexDirection: "column", gap: "7px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>
                    Como o sistema escolhe a terapia de cada card
                  </div>

                  {/* Opção 1 — preferência natural. Ativa sempre que nenhuma especialidade está escolhida. */}
                  <button type="button" role="radio" aria-checked={prefPadrao}
                    onClick={() => setPrefEspIds(new Set())}
                    style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "9px 10px", borderRadius: "10px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", border: `1px solid ${prefPadrao ? B.navy : "var(--border)"}`, background: prefPadrao ? `${B.navy}0d` : "transparent" }}>
                    <PrefRadio ativo={prefPadrao} />
                    <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: prefPadrao ? B.navy : "var(--card-foreground)" }}>Quantidade ofertada mais distante da autorizada</span>
                        <span style={{ fontSize: "9px", fontWeight: 800, color: "var(--muted-foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: "4px", padding: "0 4px", lineHeight: "1.6" }}>Padrão</span>
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--muted-foreground)", lineHeight: 1.35 }}>
                        Prioriza a especialidade com o maior vão entre o ofertado e o autorizado.
                      </span>
                    </span>
                  </button>

                  {/* Opção 2 — por especialidade. A caixa de seleção fica dentro do próprio cartão. */}
                  <div role="radio" aria-checked={!prefPadrao}
                    style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "9px 10px", borderRadius: "10px", border: `1px solid ${!prefPadrao ? B.navy : "var(--border)"}`, background: !prefPadrao ? `${B.navy}0d` : "transparent" }}>
                    <PrefRadio ativo={!prefPadrao} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: !prefPadrao ? B.navy : "var(--card-foreground)" }}>Por especialidade</span>
                        <span style={{ fontSize: "10px", color: "var(--muted-foreground)", lineHeight: 1.35 }}>
                          {prefPadrao
                            ? "Escolha uma ou mais especialidades abaixo para priorizá-las."
                            : "As escolhidas passam à frente. Nenhuma oferta deixa de aparecer — só muda a ordem."}
                        </span>
                      </div>
                      <MultiSearchCombobox
                        opcoes={ESP_PREF_OPCOES}
                        selecionados={prefEspIds}
                        onToggle={alternarPrefEsp}
                        placeholder="Todas as especialidades"
                        nomePlural="especialidades"
                        ariaLabel="Especialidades a priorizar"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Área 5 — Exportação */}
        {(() => {
          const SITUACAO_LABEL: Record<string, string> = {
            deficit: "Acrescentar",
            "deficit-sobre": "Acrescentar & Contém Sobreoferta",
            "em-dia": "Autorização = Oferta",
            sobreofertado: "Sobreofertado & Nada P/ Acrescentar",
            "sem-laudo": "Sem autorização registrada",
          }
          const handleExport = () => {
            // "Autorizado em" mais recente por paciente (DD/MM/YYYY)
            const excelSerialToDateStr = (serial: number): string => {
              const d = new Date((serial - 25569) * 86400 * 1000)
              const dd = d.getUTCDate().toString().padStart(2, "0")
              const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0")
              return `${dd}/${mm}/${d.getUTCFullYear()}`
            }
            // Converte qualquer formato de data para DD/MM/YYYY normalizado.
            // Suporta: serial Excel, DD/MM/YY, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YY, DD-MM-YYYY.
            const normalizeDate = (raw: string): string => {
              const n = Number(raw)
              if (!isNaN(n) && n > 1000) return excelSerialToDateStr(n)
              // Separador "/"
              const sp = raw.split("/")
              if (sp.length === 3) {
                let [a, b, c] = sp.map(s => s.trim())
                if (c.length === 2) c = `20${c}`
                // YYYY/MM/DD → reordena
                if (a.length === 4) return `${b.padStart(2,"0")}/${c.padStart(2,"0")}/${a}`
                return `${a.padStart(2,"0")}/${b.padStart(2,"0")}/${c}`
              }
              // Separador "-"
              const sd = raw.split("-")
              if (sd.length === 3) {
                let [a, b, c] = sd.map(s => s.trim())
                if (c.length === 2) c = `20${c}`
                // YYYY-MM-DD (ISO) → reordena para DD/MM/YYYY
                if (a.length === 4) return `${b.padStart(2,"0")}/${c.padStart(2,"0")}/${a}`
                return `${a.padStart(2,"0")}/${b.padStart(2,"0")}/${c}`
              }
              return raw
            }
            // Retorna string "YYYYMMDD" para comparação lexicográfica; "" se inválido.
            const toSortable = (d: string) => {
              const parts = d.split("/")
              if (parts.length !== 3) return ""
              let [dd, mm, yyyy] = parts.map(s => s.trim())
              if (yyyy.length === 2) yyyy = `20${yyyy}`
              if (yyyy.length !== 4) return ""
              return `${yyyy}${mm.padStart(2,"0")}${dd.padStart(2,"0")}`
            }
            // Sortable de hoje — descarta datas futuras (podem surgir de conversão errada)
            const _now = new Date()
            const todaySortable = `${_now.getFullYear()}${String(_now.getMonth()+1).padStart(2,"0")}${String(_now.getDate()).padStart(2,"0")}`
            // Mapa nome normalizado → nome canônico (para resolver variações de grafia em lRows)
            const normNameMap: Record<string, string> = {}
            for (const p of todosPacs) normNameMap[normalizeName(p)] = p
            const pacAutEmMap: Record<string, string> = {}
            for (const l of lRows) {
              const idFav = String(l["ID Favorecido"] ?? l["Id Favorecido"] ?? "").trim().replace(/\.0$/, "")
              const rawPac = String(l["Paciente"] || "").trim()
              const p = (idFav ? agendIdMap.get(idFav) : undefined)
                ?? normNameMap[normalizeName(rawPac)]
                ?? agendMergeMap.get(rawPac)
                ?? rawPac
              if (!p || PACS_ADMIN_OCUP_PAC.has(p)) continue
              // Tenta o campo em variações de capitalização
              const autRaw = l["Autorizado em"] ?? l["Autorizado Em"] ?? l["autorizado em"]
              const raw = normalizeDate(String(autRaw || "").trim())
              if (!raw) continue
              const s = toSortable(raw)
              if (!s || s > todaySortable) continue   // descarta datas futuras ou inválidas
              if (!pacAutEmMap[p] || s > toSortable(pacAutEmMap[p])) {
                pacAutEmMap[p] = raw
              }
            }

            const rows = todosPacs.map(p => {
              const st = pacStatusMap[p]
              let sobreoferta = ""
              if (st === "deficit-sobre" || st === "sobreofertado") {
                sobreoferta = Object.entries(gapMap)
                  .filter(([k, v]) => k.startsWith(`${p}|||`) && v.dif < 0)
                  .map(([k, v]) => `${k.split("|||")[1]}: ${v.of}/${v.aut}`)
                  .join("; ")
              }
              return {
                "ID Favorecido": pacIdMap[p] || "—",
                "Nome": p,
                "Convênio": pacConvMap[p] || "—",
                "Situação": SITUACAO_LABEL[st] || "—",
                "Sobreoferta": sobreoferta || "—",
              }
            })
            const ws = XLSX.utils.json_to_sheet(rows)
            ws["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 28 }, { wch: 30 }, { wch: 40 }]
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, "Pacientes")
            XLSX.writeFile(wb, "relatorio_pacientes.xlsx")
          }
          return (
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", alignItems: "flex-end", textAlign: "right", gap: "8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Relatório de Pacientes</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                <div style={{ fontSize: "28px", fontWeight: 800, color: B.navy, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{todosPacs.length}</div>
                <div style={{ fontSize: "10px", color: "var(--muted-foreground)", fontWeight: 500 }}>Pacientes analisados</div>
              </div>
              <button
                onClick={handleExport}
                style={{ padding: "4px 10px", borderRadius: "7px", border: "1px solid #d1fae5", background: "#ecfdf5", color: "#065f46", fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                ↓ Exportar XLSX
              </button>
            </div>
          )
        })()}

      </div>

      {/* ── WORKSPACE ──────────────────────────────────────────────────────────── */}
      {!pac && (
        <div style={{ background: "var(--card)", borderRadius: "14px", border: "1px solid var(--border)", padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>🧒</div>
          <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--card-foreground)", marginBottom: "4px" }}>Selecione um paciente</div>
          <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>Apenas pacientes com déficit de sessões autorizadas aparecem na lista.</div>
        </div>
      )}

      {pac && (
        <>
          <TodasSugestoesModal
            ref={modalRef}
            key={pac}
            pac={pac}
            conv={pacConvMap[pac] || ""}
            cRows={cRows}
            sugestoes={sugestoes}
            pacGaps={pacGaps}
            pacAllEsp={pacAllEsp}
            pacSuspensoes={pacSuspensoes}
            stOf={stOf}
            setSt={setSt}
            estrategia={estrategia}
            setEstrategia={setEstrategia}
            onAceitar={handleAceitar}
            onInviavel={handleInviavel}
            onAcaoDireta={handleAcaoDireta}
            onUndoRecusa={onUndoRecusa}
            reservasConfirmadas={reservasConfirmadas}
            recusasPac={recusasPac}
            onAbrirRecusaDetalhe={(dia, hora, recusas) => setRecusaDetalheAberto({ dia, hora, recusas })}
          />
        </>
      )}

      {pendingConfirm && (
        <ConfirmarImplantacaoModal
          pac={pac}
          sessoesAtuais={pendingConfirm.beforeCount}
          sessoes={pendingConfirm.sessoes}
          avisoMultiProf={pendingConfirm.avisoMultiProf}
          confirming={confirmando}
          onConfirm={confirmarImplantacao}
          onCancel={cancelarImplantacao}
        />
      )}

      {invPending && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setInvPending(null); setInvMotivo("") } }}
        >
          <div style={{ background: "var(--card)", borderRadius: "18px", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "380px", width: "100%", padding: "20px" }}>
            <div style={{ fontWeight: 900, fontSize: "17px", marginBottom: "4px", textWrap: "balance" as const }}>⛔ Marcar como Inviável</div>
            <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "10px" }}>Removido de TODAS as sugestões até tirado da lista.</div>
            <div style={{ background: "var(--muted)", borderRadius: "10px", padding: "10px 12px", fontSize: "13px", fontWeight: 700, marginBottom: "10px" }}>{pac}</div>
            <textarea
              value={invMotivo}
              onChange={e => setInvMotivo(e.target.value)}
              placeholder="Motivo (ex: família faltando muito...)"
              rows={2}
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: "10px", padding: "8px 12px", fontSize: "13px", fontFamily: "inherit", resize: "none", marginBottom: "14px", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={confirmInv} style={{ padding: "8px 16px", borderRadius: "10px", background: B.navy, color: "white", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>
                Confirmar
              </button>
              <button onClick={() => { setInvPending(null); setInvMotivo("") }} style={{ flex: 1, padding: "8px 16px", borderRadius: "10px", background: "var(--muted)", color: "var(--card-foreground)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {recusaDetalheAberto && (() => {
        const combos = recusaDetalheAberto.recusas
        const { dia, hora } = recusaDetalheAberto
        function reativarCombo(r: { tP: string; prof: string }) {
          // Precisa limpar as DUAS representações da mesma recusa: o bundle
          // (pacBundles/slotStatus, que bloqueia a sugestão) E a entrada em
          // `rec` (RecItem, que é o que a aba Recusados lê pra decidir o que
          // mostrar) — handleAcaoDireta/handlePacSlotStatus gravam nas duas ao
          // recusar, então reativar sem limpar `rec` deixava o item aparecendo
          // ao mesmo tempo em "Recusados" e "Reativados".
          sRec?.(recGlobal.filter(x =>
            !(x.paciente === pac && x.dia === dia && x.hora === hora && x.profissional === r.prof)
          ))
          persistAceites(prev => reativarRecusaPaciente(prev, { paciente: pac, profissional: r.prof, dia, hora }))
          registrarReativacao({ origem: "ocp-paciente", paciente: pac, profissional: r.prof, especialidade: r.tP, dia, hora })
          setRecusaDetalheAberto(prevState => {
            if (!prevState) return null
            const restantes = prevState.recusas.filter(x => !(x.tP === r.tP && x.prof === r.prof))
            return restantes.length ? { ...prevState, recusas: restantes } : null
          })
        }
        return (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
          onClick={e => { if (e.target === e.currentTarget) setRecusaDetalheAberto(null) }}
        >
          <div style={{ background: "var(--card)", borderRadius: "18px", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "420px", width: "100%", padding: "18px", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", fontWeight: 900, fontSize: "15px", marginBottom: "3px", color: "#dc2626" }}>
              🚫 Recusado pela família
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "14px" }}>
              {recusaDetalheAberto.dia.replace("-feira", "")} · {recusaDetalheAberto.hora} · {fmtName(pac)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "14px" }}>
              {combos.map((r, i) => {
                // Acha o olho: mesma data + mesmo motivo (ou os dois sem motivo) é a
                // MESMA recusa que já apareceria idêntica de novo — junta numa linha só
                // em vez de repetir a data (achado real: duas linhas "23/06/2026" iguais
                // uma embaixo da outra, sem nada que as diferenciasse).
                const vistos = new Set<string>()
                const linhas: typeof r.ocorrencias = []
                for (const o of r.ocorrencias) {
                  const k = `${o.data}|||${o.motivo ?? ""}`
                  if (vistos.has(k)) continue
                  vistos.add(k)
                  linhas.push(o)
                }
                return (
                <div key={i} style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "10px", padding: "8px 11px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#7f1d1d" }}>{r.tP} · {fmtName(r.prof)}</div>
                    {r.ocorrencias.length > 1 && (
                      <span style={{ fontSize: "10px", fontWeight: 800, color: "#7f1d1d", background: "rgba(255,255,255,.6)", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", flexShrink: 0 }}>
                        {r.ocorrencias.length}x
                      </span>
                    )}
                  </div>
                  {linhas.map((o, j) => (
                    <div key={j} style={{ fontSize: "11px", color: "#991b1b", marginTop: "2px" }}>
                      {o.data}{o.motivo && <span> — "{o.motivo}"</span>}
                    </div>
                  ))}
                  <button onClick={() => reativarCombo(r)} style={{ marginTop: "6px", width: "100%", padding: "5px 10px", borderRadius: "7px", border: "1px solid #fca5a5", background: "rgba(255,255,255,.7)", color: "#7f1d1d", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "11.5px" }}>
                    ↺ Reativar
                  </button>
                </div>
                )
              })}
            </div>
            <button onClick={() => setRecusaDetalheAberto(null)} style={{ width: "100%", padding: "8px 16px", borderRadius: "10px", background: "var(--muted)", color: "var(--card-foreground)", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: "13px" }}>
              Fechar
            </button>
          </div>
        </div>
        )
      })()}
    </>
  )
}

// ─── SugestaoCard ─────────────────────────────────────────────────────────────

function SugestaoCard({
  sugestao, stOf, setSt, limitReached, onInviavel,
}: {
  sugestao: Sugestao
  stOf: (s: Sugestao) => Status | null
  setSt: (s: Sugestao, st: Status | null) => void
  limitReached: boolean
  onInviavel?: (sessoes: AceiteSessao[], motivo: string) => void
}) {
  const [pendingInv, setPendingInv] = useState(false)
  const [invMotivo, setInvMotivo]   = useState("")

  const st  = stOf(sugestao)
  const stM = st ? STATUS_META[st] : null

  const TIPO_META = {
    adjacente:  { label: "Adjacente", bg: "#f0f9ff", c: "#0369a1", border: "#bae6fd" },
    "dia-novo": { label: "Dia novo",  bg: "#faf5ff", c: "#7e22ce", border: "#e9d5ff" },
  }
  const tm = TIPO_META[sugestao.tipo]

  return (
    <>
    <div style={{
      border: `1px solid ${st === "acompanhamento" ? B.blue + "44" : "var(--border)"}`,
      borderRadius: "10px", padding: "10px 12px",
      background: st === "acompanhamento" ? "var(--muted)" : "var(--card)",
      display: "flex", gap: "10px", alignItems: "flex-start", flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 180px" }}>
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "5px" }}>
          <span style={{ padding: "1px 7px", borderRadius: "5px", fontSize: "10px", fontWeight: 800, background: tm.bg, color: tm.c, border: `1px solid ${tm.border}` }}>
            {tm.label}
          </span>
          {stM && <span style={{ padding: "1px 7px", borderRadius: "5px", fontSize: "10px", fontWeight: 700, background: stM.bg, color: stM.c }}>{stM.label}</span>}
        </div>

        <div style={{ fontWeight: 800, fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "14px", color: B.navy }}>
          {sugestao.dia.replace("-feira", "")} · {sugestao.hora}
        </div>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--card-foreground)", marginTop: "1px" }}>{sugestao.tP}</div>
        <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "1px" }}>
          {fmtName(sugestao.prof)}
          <span style={{ color: "var(--muted-foreground)", marginLeft: "5px" }}>· {sugestao.unidade}</span>
        </div>

        {sugestao.vComp.length > 0 && (
          <div style={{ fontSize: "10px", color: "#16a34a", fontWeight: 700, marginTop: "4px" }}>
            Oferecer junto: {sugestao.vComp.map(v => {
              const nAlts = (sugestao.vCompAlts[v.hora] || [v]).length
              return `${v.hora} — ${nAlts > 1 ? `${nAlts} opções` : `${v.tP} · ${fmtName(v.prof)}`}`
            }).join(" · ")}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap", flexShrink: 0, alignSelf: "center" }}>
        {!st && (
          <button onClick={() => { setPendingInv(true); setInvMotivo("") }} style={btnStyle("#fef2f2", "#dc2626", "#fca5a5")}>
            ⛔ Inviável
          </button>
        )}
        {st === "inviavel" && (
          <button onClick={() => setSt(sugestao, null)} style={btnStyle("var(--muted)", "var(--muted-foreground)", "var(--border)")}>
            Desfazer
          </button>
        )}
      </div>
    </div>

    {/* Modal de confirmação inviável */}
    {pendingInv && (
      <div
        style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.4)", padding: "16px" }}
        onClick={e => { if (e.target === e.currentTarget) { setPendingInv(false); setInvMotivo("") } }}
      >
        <div style={{ background: "var(--card)", borderRadius: "16px", boxShadow: "0 20px 60px rgba(0,0,0,.2)", maxWidth: "380px", width: "100%", padding: "22px" }}>
          <div style={{ fontWeight: 900, fontSize: "16px", color: B.navy, marginBottom: "4px", textWrap: "balance" as const }}>⛔ Confirmar Inviável</div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "14px" }}>
            A proposta será removida de todas as sugestões e registrada em Aceites e Recusas.
          </div>
          <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "11px 14px", fontSize: "13px", fontWeight: 700, color: B.navy, marginBottom: "12px" }}>
            {sugestao.dia.replace("-feira", "")} {sugestao.hora} · {sugestao.tP}
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", marginBottom: "5px" }}>Justificativa (opcional)</div>
          <textarea
            value={invMotivo}
            onChange={e => setInvMotivo(e.target.value)}
            placeholder="Ex: família não tem disponibilidade neste horário..."
            rows={3}
            style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: "10px", padding: "8px 12px", fontSize: "16px", fontFamily: "inherit", resize: "none", marginBottom: "16px", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => {
                setSt(sugestao, "inviavel")
                onInviavel?.([{ dia: sugestao.dia, hora: sugestao.hora, tP: sugestao.tP, prof: sugestao.prof, unidade: sugestao.unidade, csvGradeId: sugestao.csvGradeId }], invMotivo)
                setPendingInv(false); setInvMotivo("")
              }}
              style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", background: "#dc2626", color: "white", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px" }}>
              Confirmar
            </button>
            <button
              onClick={() => { setPendingInv(false); setInvMotivo("") }}
              style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", background: "#f3f4f6", color: "#374151", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function btnStyle(bg: string, color: string, border: string): CSSProperties {
  return { padding: "5px 10px", borderRadius: "8px", background: bg, color, border: `1px solid ${border}`, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }
}
