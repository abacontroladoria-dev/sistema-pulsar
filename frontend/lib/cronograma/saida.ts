import { DIAS_UTIL, EXCLUIR_OCUP } from "./constants"
import { construirProfissionaisOcupados, pm, isLaudoComAlta, getTurno, profissionalEstaOcupado } from "./helpers"
import type {
  AfetadaItem,
  AnaliseResult,
  CsvRow,
  Estrategia,
  EstrategiaDia,
  EstrategiaSwap,
  Inconsistencia,
  LaudoRow,
  MovimentoSessao,
  OpcaoDiaMigracao,
  OpcaoEstrategia,
  OpcaoSwap,
  SessPacItem,
} from "@/types/cronograma"

// ─── CONSTANTES LOCAIS ────────────────────────────────────────────────────────

const ABA_EXT_S = new Set(["Aplicador ABA Casa", "Aplicador ABA Escola", "Aplicador ABA Escola/Casa"])
const ABA_COM_COORD = new Set(["Aplicador ABA (SF)", "Aplicador ABA (AE)", "Aplicador ABA (HS)"])
const COORD_CASO = "Coordenador de Caso"

/** PS e EF são intercambiáveis para fins de substituição */
const ABA_PS_EF = new Set(["Aplicador ABA (PS)", "Aplicador ABA (EF)"])

/** Especialidades elegíveis para E4 (outra terapia no slot vago) */
const ESP_CLIN_L: Record<string, string[]> = {
  "Terapia Ocupacional":   ["Terapia Ocupacional"],
  "Fonoaudiologia":        ["Fonoaudiologia"],
  "Psicomotricidade":      ["Psicomotricidade"],
  "Psicopedagogia":        ["Psicopedagogia"],
  "Fisioterapia":          ["Fisioterapia"],
  "Fisioterapia Aquática": ["Fisioterapia Aquática"],
  "Musicoterapia":         ["Musicoterapia"],
  "Psicologia":            ["Psicologia"],
  "Equoterapia":           ["Equoterapia"],
  "Arteterapia":           ["Arteterapia"],
  "Habilidades Sociais":   ["Aplicador ABA (HS)"],
  "Psicologia ABA":        ["Aplicador ABA (PS)", "Aplicador ABA (AV)", "Aplicador ABA (EF)"],
}

// ─── HELPERS INTERNOS ────────────────────────────────────────────────────────

function normConvenio(s: string | undefined): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function getPacTurno(sessPac: SessPacItem[]): "manhã" | "tarde" | "ambos" {
  const clin = sessPac.filter(s => !s.isAdmin && s.unidade !== "AT Externo")
  const m = clin.filter(s => (pm(s.hora) || 0) < 780).length
  const t = clin.filter(s => (pm(s.hora) || 0) >= 780).length
  if (m > 0 && t === 0) return "manhã"
  if (t > 0 && m === 0) return "tarde"
  return "ambos"
}

function getPacUnidade(sessPac: SessPacItem[]): string | null {
  const cnt: Record<string, number> = {}
  for (const s of sessPac) {
    if (s.isAdmin || !s.unidade || s.unidade === "AT Externo" || s.unidade === "Desconhecida") continue
    cnt[s.unidade] = (cnt[s.unidade] || 0) + 1
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

function getInconsistencias(sessPac: SessPacItem[]): Inconsistencia[] {
  const result: Inconsistencia[] = []
  const dias = [...new Set(sessPac.map(s => s.dia))]
  for (const dia of dias) {
    const sd = sessPac.filter(s => s.dia === dia && !s.isAdmin && s.unidade !== "AT Externo" && s.unidade && s.unidade !== "Desconhecida")
    if (sd.length < 2) continue
    const cnt: Record<string, number> = {}
    for (const s of sd) cnt[s.unidade] = (cnt[s.unidade] || 0) + 1
    const mainU = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]
    const out = sd.filter(s => s.unidade !== mainU)
    if (out.length === 1) result.push({ dia, sessao: out[0], unidCorreta: mainU })
  }
  return result
}

function podeSessaoSimultanea(terapiaNova: string, sessoesNoHorario: SessPacItem[], convenioPac: string): boolean {
  if (!sessoesNoHorario.length) return true
  if (normConvenio(convenioPac).includes("assim")) return false
  return (
    ABA_COM_COORD.has(terapiaNova) &&
    sessoesNoHorario.length === 1 &&
    normConvenio(sessoesNoHorario[0].terapia) === "coordenador de caso"
  )
}

/** Retorna true se t1 e t2 são terapias equivalentes para fins de substituição */
function terapiasEquivalentes(t1: string, t2: string): boolean {
  if (t1 === t2) return true
  return ABA_PS_EF.has(t1) && ABA_PS_EF.has(t2)
}

// ─── CONSTRUTORES DE ESTRATÉGIA ──────────────────────────────────────────────

/**
 * E2 / E5 — Swap de posições.
 * modo "mantido": todos os terapeutas originais (exceto o saindo) permanecem com o paciente.
 * modo "alterado": pelo menos um terapeuta não-saindo é substituído.
 * Tenta swaps de 2 sessões e também de 3 sessões (rotação em cadeia).
 */
function buildSwap(
  sessPac: SessPacItem[],
  afetada: AfetadaItem,
  livre: CsvRow[],
  profSaindo: string,
  isRes: (r: CsvRow) => boolean,
  modo: "mantido" | "alterado",
  profOcupado: Set<string>,
  maxOpcoes = 4,
): EstrategiaSwap | null {
  const tipo = modo === "mantido" ? "e2" : "e5"
  const label = modo === "mantido"
    ? "Qt. de Terapias: mantido. Posições: alterado. Profissionais: mantido."
    : "Qt. de Terapias: mantido. Posições: alterado. Profissionais: alterado."

  // Sessões disponíveis para swap: excluir afetada, administrativas, e Coordenador de Caso
  const cands = sessPac.filter(s =>
    !s.isAdmin &&
    s.terapia !== COORD_CASO &&
    !(s.dia === afetada.dia && s.hora === afetada.hora && s.prof === afetada.prof && s.terapia === afetada.terapia)
  )

  // Helper: verifica se um profissional tem slot livre em dia/hora/unidade específicos
  // — nunca aceita a vaga se o profissional já tem um horário "Agendado" real
  // ali (vaga "Livre" gêmea, ver profissionalEstaOcupado em helpers.ts).
  const profTemLivre = (prof: string, dia: string, hora: string, unidade: string): CsvRow | null => {
    if (profissionalEstaOcupado(profOcupado, prof, dia, hora)) return null
    return livre.find(r =>
      String(r.Profissional) === prof &&
      String(r["Dia da Semana"]) === dia &&
      String(r.HI_str) === hora &&
      String(r.Unidade) === unidade &&
      !isRes(r)
    ) ?? null
  }

  // Helper: encontra qualquer prof livre para uma terapia em dia/hora/unidade (excluindo lista)
  const qualquerLivre = (dia: string, hora: string, terapia: string, unidade: string, excluir: string[]): CsvRow | null =>
    livre.find(r =>
      String(r["Dia da Semana"]) === dia &&
      String(r.HI_str) === hora &&
      terapiasEquivalentes(String(r.Terapia), terapia) &&
      String(r.Unidade) === unidade &&
      !excluir.includes(String(r.Profissional)) &&
      !isRes(r) &&
      !profissionalEstaOcupado(profOcupado, String(r.Profissional), dia, hora)
    ) ?? null

  const opcoes: OpcaoSwap[] = []
  const visto = new Set<string>()

  // ── Swaps de 2 sessões ─────────────────────────────────────────────────────
  for (const s1 of cands) {
    if (opcoes.length >= maxOpcoes) break

    if (modo === "mantido") {
      // T1 (s1.prof) se move para o slot da afetada; T_new preenche o slot de S1
      const t1Row = profTemLivre(s1.prof, afetada.dia, afetada.hora, afetada.unidade)
      if (!t1Row) continue

      const tNewRow = qualquerLivre(s1.dia, s1.hora, afetada.terapia, s1.unidade, [profSaindo, s1.prof])
      if (!tNewRow) continue

      const chave = `${s1.prof}>${afetada.dia}${afetada.hora}|${tNewRow.Profissional}>${s1.dia}${s1.hora}`
      if (visto.has(chave)) continue
      visto.add(chave)

      opcoes.push({
        movimentos: [
          {
            deDia: afetada.dia, deHora: afetada.hora, deTerapia: afetada.terapia, deProf: profSaindo,
            paraDia: afetada.dia, paraHora: afetada.hora, paraTerapia: s1.terapia, paraProf: s1.prof,
            paraUnidade: String(t1Row.Unidade), profMudou: false,
          },
          {
            deDia: s1.dia, deHora: s1.hora, deTerapia: s1.terapia, deProf: s1.prof,
            paraDia: s1.dia, paraHora: s1.hora, paraTerapia: afetada.terapia, paraProf: String(tNewRow.Profissional),
            paraUnidade: String(tNewRow.Unidade), profMudou: true,
          },
        ],
        profissionaisAlterados: [],
      })
    } else {
      // E5: T_alt (≠ s1.prof) assume o slot da afetada; T_new preenche o slot de S1
      // s1.prof deixa de atender o paciente neste slot
      const tAltCands = livre.filter(r =>
        String(r["Dia da Semana"]) === afetada.dia &&
        String(r.HI_str) === afetada.hora &&
        terapiasEquivalentes(String(r.Terapia), s1.terapia) &&
        String(r.Unidade) === afetada.unidade &&
        String(r.Profissional) !== s1.prof &&
        String(r.Profissional) !== profSaindo &&
        !isRes(r)
      )
      for (const tAltRow of tAltCands) {
        if (opcoes.length >= maxOpcoes) break
        const tNewRow = qualquerLivre(s1.dia, s1.hora, afetada.terapia, s1.unidade, [profSaindo, s1.prof, String(tAltRow.Profissional)])
        if (!tNewRow) continue

        const chave = `${tAltRow.Profissional}>${afetada.dia}${afetada.hora}|${tNewRow.Profissional}>${s1.dia}${s1.hora}`
        if (visto.has(chave)) continue
        visto.add(chave)

        opcoes.push({
          movimentos: [
            {
              deDia: afetada.dia, deHora: afetada.hora, deTerapia: afetada.terapia, deProf: profSaindo,
              paraDia: afetada.dia, paraHora: afetada.hora, paraTerapia: s1.terapia, paraProf: String(tAltRow.Profissional),
              paraUnidade: String(tAltRow.Unidade), profMudou: true,
            },
            {
              deDia: s1.dia, deHora: s1.hora, deTerapia: s1.terapia, deProf: s1.prof,
              paraDia: s1.dia, paraHora: s1.hora, paraTerapia: afetada.terapia, paraProf: String(tNewRow.Profissional),
              paraUnidade: String(tNewRow.Unidade), profMudou: true,
            },
          ],
          profissionaisAlterados: [s1.prof],
        })
      }
    }
  }

  // ── Swaps de 3 sessões (rotação em cadeia) ─────────────────────────────────
  // Caso: T1 → slot_A, T2 → slot_S1, T_new → slot_S2
  // Caso: T2 → slot_A, T1 → slot_S2, T_new → slot_S1
  if (opcoes.length < maxOpcoes) {
    for (let i = 0; i < cands.length && opcoes.length < maxOpcoes; i++) {
      for (let j = i + 1; j < cands.length && opcoes.length < maxOpcoes; j++) {
        const s1 = cands[i]
        const s2 = cands[j]

        if (modo === "mantido") {
          // Rotação A: T1→A, T2→S1, T_new→S2
          const t1Row = profTemLivre(s1.prof, afetada.dia, afetada.hora, afetada.unidade)
          const t2Row_s1 = t1Row ? profTemLivre(s2.prof, s1.dia, s1.hora, s1.unidade) : null
          if (t1Row && t2Row_s1) {
            const tNewRow = qualquerLivre(s2.dia, s2.hora, afetada.terapia, s2.unidade, [profSaindo, s1.prof, s2.prof])
            if (tNewRow) {
              const chave = `3:${s1.prof}+${s2.prof}→A+S1+S2`
              if (!visto.has(chave)) {
                visto.add(chave)
                opcoes.push({
                  movimentos: [
                    { deDia: afetada.dia, deHora: afetada.hora, deTerapia: afetada.terapia, deProf: profSaindo, paraDia: afetada.dia, paraHora: afetada.hora, paraTerapia: s1.terapia, paraProf: s1.prof, paraUnidade: String(t1Row.Unidade), profMudou: false },
                    { deDia: s1.dia, deHora: s1.hora, deTerapia: s1.terapia, deProf: s1.prof, paraDia: s1.dia, paraHora: s1.hora, paraTerapia: s2.terapia, paraProf: s2.prof, paraUnidade: String(t2Row_s1.Unidade), profMudou: false },
                    { deDia: s2.dia, deHora: s2.hora, deTerapia: s2.terapia, deProf: s2.prof, paraDia: s2.dia, paraHora: s2.hora, paraTerapia: afetada.terapia, paraProf: String(tNewRow.Profissional), paraUnidade: String(tNewRow.Unidade), profMudou: true },
                  ],
                  profissionaisAlterados: [],
                })
              }
            }
          }

          // Rotação B: T2→A, T1→S2, T_new→S1
          const t2Row_a = profTemLivre(s2.prof, afetada.dia, afetada.hora, afetada.unidade)
          const t1Row_s2 = t2Row_a ? profTemLivre(s1.prof, s2.dia, s2.hora, s2.unidade) : null
          if (t2Row_a && t1Row_s2) {
            const tNewRow = qualquerLivre(s1.dia, s1.hora, afetada.terapia, s1.unidade, [profSaindo, s1.prof, s2.prof])
            if (tNewRow) {
              const chave = `3:${s2.prof}+${s1.prof}→A+S2+S1`
              if (!visto.has(chave)) {
                visto.add(chave)
                opcoes.push({
                  movimentos: [
                    { deDia: afetada.dia, deHora: afetada.hora, deTerapia: afetada.terapia, deProf: profSaindo, paraDia: afetada.dia, paraHora: afetada.hora, paraTerapia: s2.terapia, paraProf: s2.prof, paraUnidade: String(t2Row_a.Unidade), profMudou: false },
                    { deDia: s2.dia, deHora: s2.hora, deTerapia: s2.terapia, deProf: s2.prof, paraDia: s2.dia, paraHora: s2.hora, paraTerapia: s1.terapia, paraProf: s1.prof, paraUnidade: String(t1Row_s2.Unidade), profMudou: false },
                    { deDia: s1.dia, deHora: s1.hora, deTerapia: s1.terapia, deProf: s1.prof, paraDia: s1.dia, paraHora: s1.hora, paraTerapia: afetada.terapia, paraProf: String(tNewRow.Profissional), paraUnidade: String(tNewRow.Unidade), profMudou: true },
                  ],
                  profissionaisAlterados: [],
                })
              }
            }
          }
        }
        // Swaps de 3 sessões para modo "alterado" são menos prioritários; omitidos na v1
      }
    }
  }

  if (!opcoes.length) return null
  return { tipo, label, opcoes }
}

/**
 * E6 / E7 — Migração de dia inteiro.
 * O paciente não comparece num dia disponível (D_destino) e todas as sessões de
 * D_origem (inclusive a afetada, com novo profissional) são movidas para D_destino
 * no mesmo horário.
 * modo "mantido": todos os terapeutas não-saindo devem estar disponíveis no D_destino.
 * modo "alterado": pelo menos um deles precisa ser substituído.
 */
function buildDiaMigracao(
  sessPac: SessPacItem[],
  afetada: AfetadaItem,
  livre: CsvRow[],
  profSaindo: string,
  isRes: (r: CsvRow) => boolean,
  modo: "mantido" | "alterado",
  pacTurno: "manhã" | "tarde" | "ambos",
  profOcupado: Set<string>,
): EstrategiaDia | null {
  const tipo = modo === "mantido" ? "e6" : "e7"
  const label = modo === "mantido"
    ? "Alterar dia de tratamento, mesmos profissionais."
    : "Alterar dia de tratamento, profissionais diferentes."

  // Dias que o paciente já frequenta (ignorando administrativo)
  const diasComSessao = new Set(sessPac.filter(s => !s.isAdmin).map(s => s.dia))
  // Dias disponíveis para receber as sessões
  const diasDisp = (DIAS_UTIL as readonly string[]).filter(d => !diasComSessao.has(d))

  // Todas as sessões clínicas do dia de origem
  const sessDiaOrigem = sessPac.filter(s => s.dia === afetada.dia && !s.isAdmin)
  if (sessDiaOrigem.length < 2) return null // não faz sentido mover um dia com < 2 sessões

  const profTemLivre = (prof: string, dia: string, hora: string, unidade: string): CsvRow | null => {
    if (profissionalEstaOcupado(profOcupado, prof, dia, hora)) return null
    return livre.find(r =>
      String(r.Profissional) === prof &&
      String(r["Dia da Semana"]) === dia &&
      String(r.HI_str) === hora &&
      String(r.Unidade) === unidade &&
      !isRes(r)
    ) ?? null
  }

  const qualquerLivre = (dia: string, hora: string, terapia: string, unidade: string, excluir: string[]): CsvRow | null =>
    livre.find(r =>
      String(r["Dia da Semana"]) === dia &&
      String(r.HI_str) === hora &&
      terapiasEquivalentes(String(r.Terapia), terapia) &&
      String(r.Unidade) === unidade &&
      !excluir.includes(String(r.Profissional)) &&
      !isRes(r) &&
      !profissionalEstaOcupado(profOcupado, String(r.Profissional), dia, hora)
    ) ?? null

  const opcoes: OpcaoDiaMigracao[] = []

  for (const diaDestino of diasDisp) {
    if (opcoes.length >= 3) break

    // Verificar compatibilidade de turno
    if (pacTurno !== "ambos") {
      const horaTurnoOk = sessDiaOrigem.every(s => {
        const turno = getTurno(s.hora)
        return turno === pacTurno
      })
      if (!horaTurnoOk) continue
    }

    const movimentos: MovimentoSessao[] = []
    const profissionaisAlterados: string[] = []
    let valido = true

    for (const sess of sessDiaOrigem) {
      const eAfetada =
        sess.dia === afetada.dia &&
        sess.hora === afetada.hora &&
        sess.prof === afetada.prof &&
        sess.terapia === afetada.terapia

      if (eAfetada) {
        // Para a sessão afetada: qualquer terapeuta da mesma especialidade
        const rep = qualquerLivre(diaDestino, sess.hora, sess.terapia, sess.unidade, [profSaindo])
        if (!rep) { valido = false; break }
        movimentos.push({
          deDia: sess.dia, deHora: sess.hora, deTerapia: sess.terapia, deProf: sess.prof,
          paraDia: diaDestino, paraHora: sess.hora, paraTerapia: sess.terapia,
          paraProf: String(rep.Profissional), paraUnidade: String(rep.Unidade), profMudou: true,
        })
      } else if (sess.terapia === COORD_CASO) {
        // Coordenador de Caso: NUNCA mover se não é o saindo
        valido = false; break
      } else {
        // Verificar se o mesmo terapeuta está disponível no destino
        const mesmoRow = profTemLivre(sess.prof, diaDestino, sess.hora, sess.unidade)
        if (mesmoRow) {
          movimentos.push({
            deDia: sess.dia, deHora: sess.hora, deTerapia: sess.terapia, deProf: sess.prof,
            paraDia: diaDestino, paraHora: sess.hora, paraTerapia: sess.terapia,
            paraProf: sess.prof, paraUnidade: String(mesmoRow.Unidade), profMudou: false,
          })
        } else {
          if (modo === "mantido") { valido = false; break }
          // Modo alterado: aceitar terapeuta diferente
          const altRow = qualquerLivre(diaDestino, sess.hora, sess.terapia, sess.unidade, [profSaindo, sess.prof])
          if (!altRow) { valido = false; break }
          movimentos.push({
            deDia: sess.dia, deHora: sess.hora, deTerapia: sess.terapia, deProf: sess.prof,
            paraDia: diaDestino, paraHora: sess.hora, paraTerapia: sess.terapia,
            paraProf: String(altRow.Profissional), paraUnidade: String(altRow.Unidade), profMudou: true,
          })
          profissionaisAlterados.push(sess.prof)
        }
      }
    }

    if (!valido) continue

    const temAlteradoNaoAfetado = profissionaisAlterados.length > 0
    if (modo === "mantido" && temAlteradoNaoAfetado) continue
    if (modo === "alterado" && !temAlteradoNaoAfetado) continue

    opcoes.push({
      diaOrigem: afetada.dia,
      diaDestino,
      movimentos,
      profissionaisAlterados,
    })
  }

  if (!opcoes.length) return null
  return { tipo, label, opcoes }
}

// ─── ALGORITMO PRINCIPAL ──────────────────────────────────────────────────────

export function buildSaidaAnalise(
  afetada: AfetadaItem,
  cRows: CsvRow[],
  lRows: LaudoRow[],
  profSaindo: string,
  reservados: Set<string>,
  outrasAfetadasMesmoDia?: AfetadaItem[],
): AnaliseResult {
  const { pac, terapia, dia, hora, unidade } = afetada

  // 1. Montar sessPac (sessões clínicas do paciente, deduplicadas, sem ABA externo)
  const seen = new Set<string>()
  const sessPac: SessPacItem[] = []
  for (const r of cRows || []) {
    if (r["Nome Favorecido"] !== pac) continue
    if (ABA_EXT_S.has(String(r.Terapia || ""))) continue
    const k = `${r["Dia da Semana"]}|||${r.HI_str}|||${r.Terapia}|||${r.Profissional}`
    if (seen.has(k)) continue
    seen.add(k)
    const tExib = String(r["Terapia Exibição"] || r["Terapia Exibicao"] || "")
    sessPac.push({
      dia: String(r["Dia da Semana"] || ""),
      hora: String(r.HI_str || ""),
      terapia: String(r.Terapia || ""),
      terapiaExib: tExib || undefined,
      prof: String(r.Profissional || ""),
      unidade: String(r.Unidade || ""),
      isAdmin: EXCLUIR_OCUP.has(String(r.Terapia || "")),
    })
  }

  // 2. Validações no dia de ORIGEM (R5.1 + R2.1)
  const sessDiaClin = sessPac.filter(s => s.dia === dia && !s.isAdmin)
  const pmAfet = pm(hora)

  // Conjunto de TODAS as horas afetadas no mesmo dia (esta + outras do mesmo profissional saindo)
  const pmTodasAfet = new Set<number>()
  if (pmAfet !== null) pmTodasAfet.add(pmAfet)
  for (const af of outrasAfetadasMesmoDia ?? []) {
    if (af.dia === dia) { const p = pm(af.hora); if (p !== null) pmTodasAfet.add(p) }
  }

  // R5.1: usa TODAS as sessões do dia (qualquer sessão preenche o slot, não só as clínicas)
  // e remove TODAS as afetadas — evita falso-positivo quando duas sessões consecutivas saem juntas
  const hDiaTodas = [...new Set(sessPac.filter(s => s.dia === dia).map(s => pm(s.hora)))]
    .filter((h): h is number => h !== null)
    .sort((a, b) => a - b)
  const hSemTodas = hDiaTodas.filter(h => !pmTodasAfet.has(h))
  let buracoSiRemover = false
  for (let i = 1; i < hSemTodas.length; i++) {
    if (hSemTodas[i] - hSemTodas[i - 1] !== 40) { buracoSiRemover = true; break }
  }

  // R2.1: conta TODAS as sessões do dia (inclusive Coord. de Caso, Supervisão ABA)
  // pois todas implicam presença do paciente na clínica
  const min2Violation = hSemTodas.length < 2

  // 3. Laudos do paciente
  const laudosPac = (lRows || []).filter(l => String(l["Paciente"] || "").trim() === pac)

  // 4. Turno e helpers
  const pacTurno = getPacTurno(sessPac)
  const livre = (cRows || []).filter(r => r["Status do Agendamento"] === "Livre")
  // Vaga "Livre" gêmea de um horário já agendado do mesmo profissional (ver
  // construirProfissionaisOcupados em helpers.ts) — nunca usar essa vaga pra
  // realocar paciente nenhum, mesmo que o cronograma que está saindo esteja
  // livre no papel.
  const profOcupado = construirProfissionaisOcupados(cRows || [])
  const isRes = (r: CsvRow) => reservados.has(`${r.Profissional}|||${r["Dia da Semana"]}|||${r.HI_str}`)
  const isSessaoAfetada = (s: SessPacItem) =>
    s.dia === dia && s.hora === hora && s.terapia === terapia && s.prof === profSaindo

  const pacienteLivreNoHorario = (
    slotDia: string,
    slotHora: string,
    terapiaNova: string,
    opts: { ignorarAfetada?: boolean } = {},
  ) => {
    const sessoesNoHorario = sessPac.filter(
      s => s.dia === slotDia && s.hora === slotHora && !(opts.ignorarAfetada && isSessaoAfetada(s)),
    )
    return podeSessaoSimultanea(terapiaNova, sessoesNoHorario, afetada.conv || "")
  }

  // ── E1 — Substituição direta (mesmo dia/hora, mesma terapia, outro prof) ───
  const s1Rows = livre.filter(
    r =>
      r.Terapia === terapia &&
      r.Unidade === unidade &&
      r["Dia da Semana"] === dia &&
      r.HI_str === hora &&
      r.Profissional !== profSaindo &&
      !isRes(r) &&
      pacienteLivreNoHorario(dia, hora, String(r.Terapia || ""), { ignorarAfetada: true }),
  )
  const e1: Estrategia | null =
    s1Rows.length > 0
      ? {
          tipo: "e1",
          label: "Mesmo profissional disponível no mesmo horário.",
          opcoes: s1Rows.map(r => ({
            prof: String(r.Profissional || ""),
            dia, hora,
            unidade: String(r.Unidade || ""),
            terapia: String(r.Terapia || ""),
          } satisfies OpcaoEstrategia)),
        }
      : null

  // ── E2 — Swap de posições, profissionais mantidos ─────────────────────────
  const e2 = buildSwap(sessPac, afetada, livre, profSaindo, isRes, "mantido", profOcupado)

  // ── E3 — Mesma terapia, horário adjacente (sem buraco no dia de origem) ───
  let e3: Estrategia | null = null
  if (!buracoSiRemover && !min2Violation) {
    const temSessaoNoDia = (newDia: string) =>
      sessPac.some(s => s.dia === newDia && !s.isAdmin && !isSessaoAfetada(s))

    const semGapNoDestino = (newDia: string, newHora: string) => {
      const ex = sessPac
        .filter(s => s.dia === newDia && !s.isAdmin && !isSessaoAfetada(s))
        .map(s => pm(s.hora))
        .filter((h): h is number => h !== null)
      const newPm = pm(newHora)
      if (newPm === null) return false
      const todos = [...new Set([...ex, newPm])].sort((a, b) => a - b)
      for (let i = 1; i < todos.length; i++) {
        if (todos[i] - todos[i - 1] !== 40) return false
      }
      return true
    }

    const s3Rows = livre.filter(r => {
      const nd = String(r["Dia da Semana"] || "")
      const nh = String(r.HI_str || "")
      return (
        r.Terapia === terapia &&
        r.Unidade === unidade &&
        r.Profissional !== profSaindo &&
        !isRes(r) &&
        !(nd === dia && nh === hora) &&
        (pacTurno === "ambos" || getTurno(nh) === pacTurno) &&
        pacienteLivreNoHorario(nd, nh, String(r.Terapia || "")) &&
        temSessaoNoDia(nd) &&
        semGapNoDestino(nd, nh)
      )
    })

    if (s3Rows.length > 0) {
      const opts: OpcaoEstrategia[] = []
      const opV = new Set<string>()
      for (const r of s3Rows) {
        const k = `${r.Profissional}|||${r["Dia da Semana"]}|||${r.HI_str}`
        if (!opV.has(k)) {
          opV.add(k)
          opts.push({
            prof: String(r.Profissional || ""),
            dia: String(r["Dia da Semana"] || ""),
            hora: String(r.HI_str || ""),
            unidade: String(r.Unidade || ""),
            terapia: String(r.Terapia || ""),
          })
        }
        if (opts.length >= 4) break
      }
      e3 = { tipo: "e3", label: "Mesma terapia em dia/horário com encaixe sem lacunas.", opcoes: opts }
    }
  }

  // ── E4 — Outra terapia no mesmo slot (complementar) ───────────────────────
  const e4: Estrategia[] = []
  const altasSaida = new Set(
    laudosPac.filter(isLaudoComAlta).map(l => String(l.Especialidade || "").trim()).filter(Boolean),
  )
  for (const l of laudosPac) {
    if (isLaudoComAlta(l)) continue
    const esp = String(l.Especialidade || "")
    if (altasSaida.has(esp)) continue
    const aut = Number(l["Qtd autorizada"]) || 0
    if (aut <= 0) continue
    const ter = (ESP_CLIN_L[esp] || []).filter(t => !EXCLUIR_OCUP.has(t))
    if (!ter.length) continue
    const ofert = sessPac.filter(s => ter.includes(s.terapia)).length
    if (ofert >= aut) continue
    const cands = livre.filter(
      r =>
        ter.includes(String(r.Terapia || "")) &&
        r.Unidade === unidade &&
        r["Dia da Semana"] === dia &&
        r.HI_str === hora &&
        !isRes(r) &&
        pacienteLivreNoHorario(dia, hora, String(r.Terapia || ""), { ignorarAfetada: true }),
    )
    if (cands.length > 0) {
      e4.push({
        tipo: "e4",
        esp,
        gap: aut - ofert,
        label: `${esp} no mesmo slot (gap: ${aut - ofert}x, aut=${aut}, ofert=${ofert})`,
        opcoes: cands.slice(0, 3).map(r => ({
          prof: String(r.Profissional || ""),
          dia, hora,
          unidade: String(r.Unidade || ""),
          terapia: String(r.Terapia || ""),
          esp,
        })),
      })
    }
  }

  // ── E5 — Swap de posições, profissionais alterados ────────────────────────
  const e5 = buildSwap(sessPac, afetada, livre, profSaindo, isRes, "alterado", profOcupado)

  // ── E6 — Migração de dia, mesmos profissionais ────────────────────────────
  const e6 = buildDiaMigracao(sessPac, afetada, livre, profSaindo, isRes, "mantido", pacTurno, profOcupado)

  // ── E7 — Migração de dia, profissionais diferentes ────────────────────────
  const e7 = buildDiaMigracao(sessPac, afetada, livre, profSaindo, isRes, "alterado", pacTurno, profOcupado)

  return {
    sessPac,
    sessDiaClin,
    buracoSiRemover,
    min2Violation,
    pacTurno,
    pacUnidade: getPacUnidade(sessPac),
    inconsistencias: getInconsistencias(sessPac),
    e1, e2, e3, e4, e5, e6, e7,
    semSolucao: !e1 && !e2 && !e3 && e4.length === 0 && !e5 && !e6 && !e7,
  }
}
