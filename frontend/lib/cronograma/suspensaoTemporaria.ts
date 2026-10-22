// ─── Bloqueios do cadastro valem na Ocupação de Paciente ─────────────────────
//
// O que a aba "Altas e Individualidades" do cadastro do paciente registra
// precisa vencer a sugestão de vaga em Ocupação · Paciente:
//
//   • Suspensão temporária vigente — bloqueia aquela especialidade.
//   • Alta registrada (ativa)      — bloqueia aquela especialidade.
//   • Alta clínica vigente         — bloqueia todas as especialidades do laudo.
//
// Mesmo princípio de gradeTitaOcupacao.ts (Regra C): uma restrição clínica do
// paciente, gravada em outra tabela, vence a sugestão — só que aqui a chave é
// (paciente, especialidade), não (profissional, slot).
//
// A ponte de ID é obrigatória: grade e laudo identificam o paciente pelo id do
// TiTa (`CsvRow.PacienteId` e "ID Favorecido" do laudo, ambos o
// `tita_paciente_id`), e o cadastro pelo `id_paciente_pulsar`. Ver o comentário
// de `tita_paciente_id` em supabase/migrations/20260817190000_pacientes_canonica.sql.
//
// O laudo entra como fonte de id (e não só a grade) por causa do "Criar Novo
// Cronograma": o paciente dali ainda não tem nenhuma sessão na grade, e até
// 20/10/2026 a suspensão dele simplesmente não era encontrada (caso ID 22386,
// Fonoaudiologia e Psicologia suspensas e ainda ofertadas).
//
// Especialidade não precisa de ponte: `especialidade_suspensao` e
// `especialidade_alta` são gravadas com as chaves de ESP_CLINICO
// (AbaAltasIndividualidades.tsx), o mesmo domínio de texto da Ocupação. A
// comparação é exata: suspender "Psicologia" NÃO bloqueia "Psicologia ABA".

import { listarPacientesBasicos } from "@/services/pacientesBasico.service"
import { getSuspensoesVigentesPorPacientes } from "@/services/pacienteSuspensaoTemporaria.service"
import { getAltasAtivasPorPacientes } from "@/services/pacienteAltaIndividualidade.service"
import { getAltasClinicasVigentesPorPacientes } from "@/services/pacienteAltaClinica.service"
import { ESP_LAUDO_IGNORAR, ESP_LAUDO_SINONIMO } from "@/lib/cronograma/constants"
import type { CsvRow, LaudoRow } from "@/types/cronograma"

/** `${nomePaciente}|||${especialidade}` — mesmo formato de chave do altaSet já usado para "Alta". */
export type ChaveSuspensao = string

export type TipoBloqueio = "alta_clinica" | "alta" | "suspensao"

/** De onde vem o bloqueio — para rotular na tela e linkar de volta à ficha do paciente. */
export interface SuspensaoLinkInfo {
  tipo: TipoBloqueio
  idPacientePulsar: number
  /** id_suspensao, id_alta ou id_alta_clinica, conforme `tipo`. */
  idRegistro: number
}

export interface SuspensaoTemporariaCruzamento {
  /** Usado nos pontos que excluem por "Alta" do laudo — mesmo Set, mesmo formato de chave. */
  set: Set<ChaveSuspensao>
  /** Mesma chave -> origem do bloqueio. */
  info: Map<ChaveSuspensao, SuspensaoLinkInfo>
  /**
   * Não deu para ler o cadastro de pacientes (sem login, sem permissão, rede).
   * Aí NENHUM bloqueio é conhecido — a tela precisa avisar, senão oferta
   * especialidade suspensa/com alta como se estivesse liberada.
   */
  erro?: string
}

export const ROTULO_BLOQUEIO: Record<TipoBloqueio | "alta_laudo", string> = {
  alta_clinica: "Alta clínica",
  alta: "Alta registrada",
  suspensao: "Suspensão temporária",
  alta_laudo: "Alta no laudo",
}

/** Quando a mesma especialidade tem mais de um motivo, mostra o mais forte. */
const PRIORIDADE: Record<TipoBloqueio, number> = { alta_clinica: 3, alta: 2, suspensao: 1 }

export interface RegistrosCadastro {
  suspensoes: Map<number, { idSuspensao: number; especialidade: string }[]>
  altas: Map<number, { idAlta: number; especialidade: string }[]>
  /** id_paciente_pulsar → id_alta_clinica vigente. */
  altasClinicas: Map<number, number>
}

function idTita(v: unknown): number | null {
  const n = Number(String(v ?? "").trim())
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null
}

/**
 * Parte pura do cruzamento: dado quem é quem (nomes por id do TiTa, id do
 * cadastro por id do TiTa) e o que o cadastro registra, monta as chaves.
 * `espsLaudoPorTita` diz quais especialidades a alta clínica bloqueia.
 */
export function montarBloqueios(
  nomesPorTita: Map<number, Set<string>>,
  idsPulsarPorTita: Map<number, number>,
  espsLaudoPorTita: Map<number, Set<string>>,
  registros: RegistrosCadastro,
): SuspensaoTemporariaCruzamento {
  const set = new Set<ChaveSuspensao>()
  const info = new Map<ChaveSuspensao, SuspensaoLinkInfo>()

  const marcar = (nomes: Set<string>, esp: string, i: SuspensaoLinkInfo) => {
    for (const nome of nomes) {
      const chave = `${nome}|||${esp}`
      const atual = info.get(chave)
      if (atual && PRIORIDADE[atual.tipo] >= PRIORIDADE[i.tipo]) continue
      set.add(chave)
      info.set(chave, i)
    }
  }

  for (const [tita, nomes] of nomesPorTita) {
    const idPulsar = idsPulsarPorTita.get(tita)
    if (idPulsar == null) continue
    const espsLaudo = espsLaudoPorTita.get(tita) ?? new Set<string>()
    // A especialidade do cadastro e os nomes crus do laudo que viram ela pelo
    // sinônimo (ex.: "Psicoterapia" → "Psicologia"). "Criar Novo" compara pelo
    // nome cru. Igualdade exata: "Psicologia" nunca casa "Psicologia ABA".
    const equivalentes = (esp: string) =>
      [esp, ...[...espsLaudo].filter(raw => (ESP_LAUDO_SINONIMO[raw] ?? raw) === esp)]
    for (const s of registros.suspensoes.get(idPulsar) ?? []) {
      for (const esp of equivalentes(s.especialidade)) {
        marcar(nomes, esp, { tipo: "suspensao", idPacientePulsar: idPulsar, idRegistro: s.idSuspensao })
      }
    }
    for (const a of registros.altas.get(idPulsar) ?? []) {
      for (const esp of equivalentes(a.especialidade)) {
        marcar(nomes, esp, { tipo: "alta", idPacientePulsar: idPulsar, idRegistro: a.idAlta })
      }
    }
    const idAltaClinica = registros.altasClinicas.get(idPulsar)
    if (idAltaClinica != null) {
      for (const esp of espsLaudoPorTita.get(tita) ?? []) {
        marcar(nomes, esp, { tipo: "alta_clinica", idPacientePulsar: idPulsar, idRegistro: idAltaClinica })
      }
    }
  }
  return { set, info }
}

/**
 * Lê do cadastro os bloqueios dos pacientes que aparecem na grade OU no laudo
 * e devolve as chaves `${nome}|||${especialidade}`. Cada id do TiTa gera
 * chave para todos os nomes com que ele aparece (grade e laudo podem grafar
 * diferente). Uma consulta por tabela, compartilhada pelas modalidades
 * "Aumentar Cronograma" e "Criar Novo Cronograma".
 */
export async function construirSuspensaoTemporaria(
  cRows: CsvRow[],
  lRows: LaudoRow[] = [],
): Promise<SuspensaoTemporariaCruzamento> {
  const vazio: SuspensaoTemporariaCruzamento = { set: new Set(), info: new Map() }

  const nomesPorTita = new Map<number, Set<string>>()
  const espsLaudoPorTita = new Map<number, Set<string>>()
  const addNome = (id: number, nome: string) => {
    const s = nomesPorTita.get(id) ?? new Set<string>()
    s.add(nome)
    nomesPorTita.set(id, s)
  }
  for (const r of cRows) {
    const nome = r["Nome Favorecido"]
    if (typeof r.PacienteId === "number" && nome) addNome(r.PacienteId, nome)
  }
  for (const l of lRows) {
    const id = idTita(l["ID Favorecido"] ?? l["Id Favorecido"])
    const nome = String(l["Paciente"] || "").trim()
    if (id == null || !nome) continue
    addNome(id, nome)
    // Alta clínica bloqueia o que o laudo autoriza — com o nome cru do laudo
    // (Criar Novo compara cru) e com o sinônimo (Aumentar compara traduzido).
    const espRaw = String(l["Especialidade"] || "").trim()
    if (!espRaw || ESP_LAUDO_IGNORAR.has(espRaw)) continue
    const esps = espsLaudoPorTita.get(id) ?? new Set<string>()
    esps.add(espRaw)
    esps.add(ESP_LAUDO_SINONIMO[espRaw] ?? espRaw)
    espsLaudoPorTita.set(id, esps)
  }
  if (nomesPorTita.size === 0) return vazio

  // Direto em listarPacientesBasicos (e não em getPacientesPorTitaIds, que
  // engole o erro): falha aqui precisa chegar à tela como aviso.
  const idsPulsarPorTita = new Map<number, number>()
  try {
    for (const p of await listarPacientesBasicos({ titaIds: [...nomesPorTita.keys()] })) {
      if (p.tita_paciente_id != null) idsPulsarPorTita.set(p.tita_paciente_id, p.id_paciente)
    }
  } catch (e) {
    console.error("[ocupacao-paciente] cadastro de pacientes ilegível:", e)
    return { ...vazio, erro: e instanceof Error ? e.message : String(e) }
  }
  if (idsPulsarPorTita.size === 0) return vazio

  const idsPulsar = [...new Set(idsPulsarPorTita.values())]
  const [suspensoes, altas, altasClinicas] = await Promise.all([
    getSuspensoesVigentesPorPacientes(idsPulsar),
    getAltasAtivasPorPacientes(idsPulsar),
    getAltasClinicasVigentesPorPacientes(idsPulsar),
  ])

  return montarBloqueios(nomesPorTita, idsPulsarPorTita, espsLaudoPorTita, { suspensoes, altas, altasClinicas })
}

export interface EspBloqueada {
  esp: string
  tipo: TipoBloqueio | "alta_laudo"
  /** Link para o registro na ficha do paciente (ausente para alta no laudo). */
  href?: string
}

/**
 * Link para a seção certa de "Laudos e individualidades" na ficha do paciente
 * (antes de 22/10/2026, a aba "Altas e Individualidades") — a suspensão abre já
 * destacada.
 */
export function hrefBloqueio(i: SuspensaoLinkInfo): string {
  const base = `/cadastros/pacientes/${i.idPacientePulsar}?aba=laudo`
  if (i.tipo === "suspensao") return `${base}&secao=suspensoes&suspensao=${i.idRegistro}`
  return `${base}&secao=${i.tipo === "alta_clinica" ? "altaClinica" : "altas"}`
}

/**
 * Especialidades bloqueadas de um paciente, para o painel "Quantidade de
 * Sessões": as do cadastro (`info`) mais as com "Alta" no próprio laudo
 * (`espsAltaLaudo`). Nome já traduzido pelos sinônimos do laudo e sem
 * repetição — um motivo por especialidade, o mais forte.
 */
export function bloqueiosDoPaciente(
  pac: string,
  info: Map<ChaveSuspensao, SuspensaoLinkInfo>,
  espsAltaLaudo: Iterable<string> = [],
): EspBloqueada[] {
  const porEsp = new Map<string, EspBloqueada & { prio: number }>()
  const prefixo = `${pac}|||`
  for (const [chave, i] of info) {
    if (!chave.startsWith(prefixo)) continue
    const raw = chave.slice(prefixo.length)
    if (ESP_LAUDO_IGNORAR.has(raw)) continue
    const esp = ESP_LAUDO_SINONIMO[raw] ?? raw
    const atual = porEsp.get(esp)
    if (atual && atual.prio >= PRIORIDADE[i.tipo]) continue
    porEsp.set(esp, { esp, tipo: i.tipo, href: hrefBloqueio(i), prio: PRIORIDADE[i.tipo] })
  }
  for (const raw of espsAltaLaudo) {
    if (ESP_LAUDO_IGNORAR.has(raw)) continue
    const esp = ESP_LAUDO_SINONIMO[raw] ?? raw
    if (!porEsp.has(esp)) porEsp.set(esp, { esp, tipo: "alta_laudo", prio: 0 })
  }
  return [...porEsp.values()]
    .sort((a, b) => b.prio - a.prio || a.esp.localeCompare(b.esp, "pt-BR"))
    .map(({ esp, tipo, href }) => ({ esp, tipo, href }))
}
