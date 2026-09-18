import {
  ABA_CLI_EXCL,
  ABA_EXT,
  DEFAULT_MCAP,
  DIAS_ORD,
  ESP_CLINICO,
  ESP_EXTERNO,
  EXCLUIR_OCUP,
  FOCO_CAMILA_ESP,
  FOCO_CAMILA_PROF,
  MEXCL,
  MJULIANA,
  PACS_ADMIN,
  PROFS_PRIO_DEF,
  TERAPIA_TO_ESP,
  isProfBloqueadoTemp,
  reservaSlotKey,
  reservasAtivasFromWa,
} from "./constants"
import {
  cFx,
  construirProfissionaisOcupados,
  espRealPorExibicao,
  exU,
  expandirTerapiasLivres,
  fm,
  fmtName,
  gPrio,
  isLaudoComAlta,
  isSupervisaoAba,
  isUnidadeValida,
  pm,
  profissionalEstaOcupado,
} from "./helpers"
import { slotValidoParaPaciente } from "./candidatos"
import type {
  AlgorithmConfig,
  AlgorithmResult,
  CsvRow,
  CsvRowProcessada,
  LaudoRow,
  Sugestao,
  VCompSlot,
} from "@/types/cronograma"

interface RecusadoEntry { paciente: string; profissional: string; dia: string; hora: string }
interface InvivelEntry { paciente: string }

export function runAlgorithm(
  csvRows: CsvRow[],
  laudosRows: LaudoRow[],
  recusados: RecusadoEntry[],
  inviaveis: InvivelEntry[],
  config: AlgorithmConfig,
): AlgorithmResult {
  const df: CsvRowProcessada[] = csvRows.map(r => ({
    ...r,
    Unidade: exU(r["Sala"] || ""),
    HI: pm(r["Hora Inicial"]),
    HI_str: fm(pm(r["Hora Inicial"])),
  }))

  const agend = df.filter(r => r["Status do Agendamento"] === "Agendado")
  // Vaga "Livre" gêmea de um horário já agendado do mesmo profissional (ver
  // construirProfissionaisOcupados em helpers.ts) — a TiTa mantém uma linha por
  // terapia ofertada, então preencher um horário não apaga as outras linhas
  // "Livre" do mesmo profissional nesse dia/hora.
  const profOcupado = construirProfissionaisOcupados(agend)
  // Um horário "Livre" pode servir mais de uma terapia — a view traz isso como
  // uma única string separada por vírgula (ver expandirTerapiasLivres). Expande
  // ANTES do restante do algoritmo tratar `r.Terapia`/`TERAPIA_TO_ESP[...]` como
  // valor único: sem isso, um profissional com mais de uma terapia livre no
  // mesmo horário some da oferta inteira (mesmo bug do caso Amanda Martins
  // Rodrigues, corrigido em listarSlotsLivres/buildSugestoesManual/OcupPacMode
  // — este é um motor de sugestões paralelo, que não herda essas correções).
  const livre = expandirTerapiasLivres(df.filter(
    r => r["Status do Agendamento"] === "Livre" && !isProfBloqueadoTemp(r["Profissional"])
      && !profissionalEstaOcupado(profOcupado, r["Profissional"], r["Dia da Semana"], r.HI_str || ""),
  ))

  const qtdAut: Record<string, number> = {}
  const altaAut: Record<string, number> = {}
  const cM: Record<string, string> = {}
  const aM: Record<string, string> = {}
  const fxM: Record<string, string> = {}
  const jM = config.judicialMap || {}
  const altaSet = new Set<string>()

  for (const r of laudosRows) {
    const pac = String(r["Paciente"] || "").trim()
    if (!pac) continue
    if (r["Plano"] && !cM[pac]) cM[pac] = String(r["Plano"])
    if (r["Comp. agressivo"]) aM[pac] = String(r["Comp. agressivo"])
    if (r["Data nasc."] && !fxM[pac]) {
      const f = cFx(String(r["Data nasc."]))
      if (f) fxM[pac] = f
    }
    // "Situação" (Vigente/Vencido) NÃO recorta nada aqui — mesma regra de
    // calcularGaps (simulacaoNovoPrestador.ts), pelo mesmo motivo: a renovação
    // de laudo é um controle administrativo PARALELO, o paciente segue sendo
    // atendido com laudo vencido enquanto a renovação tramita, então a demanda
    // é real e a vaga existe. Filtrar por "vigente" escondia mais da metade da
    // demanda (1000 das 1845 linhas do relatório estavam "Vencido" em
    // 27/08/2026), apagando oportunidades sem aviso na tela.
    //
    // "Alta" continua excluindo, e agora vale mesmo vindo de laudo vencido —
    // antes um laudo com alta só entrava no altaSet se estivesse vigente, o
    // que deixava passar como demanda um paciente já com alta cujo laudo
    // tinha vencido depois.
    const espAlta = String(r["Especialidade"] || "").trim()
    if (espAlta && isLaudoComAlta(r as Record<string, unknown>)) {
      const altaK = `${pac}|||${espAlta}`
      altaSet.add(altaK)
      const qAlta = parseFloat(String(r["Qtd autorizada"])) || 0
      if (qAlta > 0) altaAut[altaK] = Math.max(altaAut[altaK] || 0, qAlta)
      continue
    }
    const esp = String(r["Especialidade"] || "").trim()
    const q = parseFloat(String(r["Qtd autorizada"])) || 0
    if (esp && q > 0) {
      const k = `${pac}|||${esp}`
      qtdAut[k] = Math.max(qtdAut[k] || 0, q)
    }
  }

  for (const k of altaSet) delete qtdAut[k]

  const qtdOf: Record<string, number> = {}
  for (const [esp, cli] of Object.entries(ESP_CLINICO)) {
    const ext = ESP_EXTERNO[esp] || []
    for (const r of agend) {
      const pac = r["Nome Favorecido"]
      if (!pac || PACS_ADMIN.has(pac)) continue
      const terapia = r["Terapia"]
      if (cli.includes(terapia)) {
        const terapiaExib = String(r["Terapia Exibição"] || r["Terapia Exibicao"] || "").trim()
        const k = `${pac}|||${espRealPorExibicao(terapia, terapiaExib, esp)}`
        qtdOf[k] = (qtdOf[k] || 0) + 1
      } else if (ext.includes(terapia)) {
        const k = `${pac}|||${esp}`
        qtdOf[k] = (qtdOf[k] || 0) + 2 / 3
      }
    }
  }

  const allGaps: AlgorithmResult["allGaps"] = []
  const gM: Record<string, Record<string, number>> = {}

  for (const [key, aut] of Object.entries(qtdAut)) {
    const [pac, esp] = key.split("|||")
    const of_ = qtdOf[key] || 0
    const gap = Math.round((aut - of_) * 10) / 10
    allGaps.push({ pac, esp, aut, of: Math.round(of_ * 10) / 10, gap, prio: gPrio(pac, cM, jM) })
    if (gap > 0) {
      if (!gM[pac]) gM[pac] = {}
      gM[pac][esp] = gap
    }
  }

  for (const [key, of_] of Object.entries(qtdOf)) {
    if (!qtdAut[key] && !altaSet.has(key)) {
      const [pac, esp] = key.split("|||")
      if (of_ > 0) {
        allGaps.push({ pac, esp, aut: 0, of: Math.round(of_ * 10) / 10, gap: Math.round(-of_ * 10) / 10, prio: gPrio(pac, cM, jM) })
      }
    }
  }

  // Linhas com alta — visíveis em GapsTab com badge "Alta" para justificar o gap
  for (const k of altaSet) {
    const [pac, esp] = k.split("|||")
    const aut = altaAut[k] || 0
    const of_ = qtdOf[k] || 0
    if (aut > 0 || of_ > 0) {
      allGaps.push({ pac, esp, aut: Math.round(aut * 10) / 10, of: Math.round(of_ * 10) / 10, gap: Math.round((aut - of_) * 10) / 10, prio: gPrio(pac, cM, jM), isAlta: true })
    }
  }

  const recSet = new Set(recusados.map(r => `${r.paciente}|||${r.profissional}|||${r.dia}|||${r.hora}`))
  const invSet = new Set(inviaveis.map(i => i.paciente))
  const isRec = (pac: string, prof: string, dia: string, hora: string) =>
    recSet.has(`${pac}|||${prof}|||${dia}|||${hora}`)

  const reservasWa = reservasAtivasFromWa(config.waMap || {})
  const slotReservadoOutro = (pac: string, prof: string, dia: string, hora: string) => {
    const dono = reservasWa.get(reservaSlotKey(prof, dia, hora))
    return !!(dono && dono !== pac)
  }

  const tAba = (pac: string) =>
    agend.some(r => r["Nome Favorecido"] === pac && ABA_CLI_EXCL.has(r["Terapia"]))

  const aCli = agend.filter(
    r =>
      r["Nome Favorecido"] &&
      !PACS_ADMIN.has(r["Nome Favorecido"]) &&
      r.Unidade !== "AT Externo" &&
      !ABA_EXT.has(r["Terapia"]) &&
      r["Terapia"] !== "Supervisão ABA" &&
      r["Terapia"] !== "Coordenador de Caso",
  )

  const unidadePrincipalPac = (pac: string): string | null => {
    const cnt: Record<string, number> = {}
    for (const r of agend) {
      if (
        r["Nome Favorecido"] !== pac ||
        PACS_ADMIN.has(pac) ||
        ABA_EXT.has(r["Terapia"]) ||
        isSupervisaoAba(r["Terapia"]) ||
        !isUnidadeValida(r.Unidade) ||
        r.Unidade === "AT Externo"
      ) continue
      cnt[r.Unidade] = (cnt[r.Unidade] || 0) + 1
    }
    const ord = Object.entries(cnt).sort((a, b) => b[1] - a[1])
    return ord.length ? ord[0][0] : null
  }

  const unidadePrincipalOk = (pac: string, un: string) => {
    const u = unidadePrincipalPac(pac)
    return !u || u === un
  }

  const agendByPDH = new Map<string, CsvRowProcessada[]>()
  for (const r of agend) {
    if (!r["Nome Favorecido"] || PACS_ADMIN.has(r["Nome Favorecido"])) continue
    const k = `${r["Nome Favorecido"]}|||${r["Dia da Semana"]}|||${r.HI_str}`
    if (!agendByPDH.has(k)) agendByPDH.set(k, [])
    agendByPDH.get(k)!.push(r)
  }

  const pacOcup = (pac: string, dia: string, hora: string) =>
    agendByPDH.has(`${pac}|||${dia}|||${hora}`)

  const gTurno = (pac: string): "manha" | "tarde" | "ambos" | null => {
    const ext = agend.filter(r => r["Nome Favorecido"] === pac && ABA_EXT.has(r["Terapia"]))
    if (ext.length) {
      const m2 = ext.some(r => (r.HI || 0) < 780)
      const t = ext.some(r => (r.HI || 0) >= 780)
      if (m2 && !t) return "tarde"
      if (t && !m2) return "manha"
      return null
    }
    const cli = aCli.filter(r => r["Nome Favorecido"] === pac)
    if (!cli.length) return null
    const m2 = cli.some(r => (r.HI || 0) < 780)
    const t = cli.some(r => (r.HI || 0) >= 780)
    if (m2 && !t) return "manha"
    if (t && !m2) return "tarde"
    return "ambos"
  }

  const noT = (hi: number | null, t: "manha" | "tarde" | "ambos" | null) => {
    if (hi === null || !t || t === "ambos") return true
    if (t === "manha") return hi < 780
    return hi >= 780
  }

  const gMCap = (prof: string, dia: string): number => {
    const cap = config.musicoCap || DEFAULT_MCAP
    for (const [ch, dias] of Object.entries(cap)) {
      if (prof.toLowerCase().includes(ch.toLowerCase())) return dias[dia] || 0
    }
    return 0
  }

  const isExcl = (prof: string, dia: string, hora: string, un: string): string | null => {
    for (const s of MEXCL) {
      if (prof.toLowerCase().includes(s.prof.toLowerCase()) && s.dia === dia && s.hora === hora && s.unidade === un)
        return s.pac
    }
    return null
  }

  const compat = (sp: string[], c: string): boolean => {
    if (String(aM[c] || "Não") === "Sim") return false
    const fc = fxM[c]
    for (const p of sp) {
      if (String(aM[p] || "Não") === "Sim") return false
      if (fc && fxM[p] && fxM[p] !== fc) return false
    }
    return true
  }

  const sugCount: Record<string, number> = {}
  const incSug = (pac: string, esp: string) => {
    const k = `${pac}|||${esp}`
    sugCount[k] = (sugCount[k] || 0) + 1
  }
  const canSug = (pac: string, esp: string) => {
    const k = `${pac}|||${esp}`
    return (sugCount[k] || 0) < (gM[pac]?.[esp] || 0)
  }

  const mGap = Object.fromEntries(
    Object.entries(gM).filter(([, e]) => e["Musicoterapia"]).map(([p, e]) => [p, e["Musicoterapia"]]),
  )

  const sugs: Sugestao[] = []
  const fila: Sugestao[] = []

  const mOcup: Record<string, { prof: string; unidade: string; dia: string; hora: string; pacs: string[] }> = {}
  for (const r of agend.filter(r => r["Terapia"] === "Musicoterapia" && r["Nome Favorecido"])) {
    const k = `${r["Profissional"]}|||${r.Unidade}|||${r["Dia da Semana"]}|||${r.HI_str}`
    if (!mOcup[k]) mOcup[k] = { prof: r["Profissional"], unidade: r.Unidade, dia: r["Dia da Semana"], hora: r.HI_str, pacs: [] }
    mOcup[k].pacs.push(r["Nome Favorecido"])
  }

  const dPac: Record<string, Set<string>> = {}
  for (const r of aCli) {
    if (!dPac[r["Nome Favorecido"]]) dPac[r["Nome Favorecido"]] = new Set()
    dPac[r["Nome Favorecido"]].add(r["Dia da Semana"])
  }

  // Módulo Musicoterapia — R1
  for (const { prof, unidade, dia, hora, pacs } of Object.values(mOcup)) {
    const cap = gMCap(prof, dia)
    if (!cap || pacs.length >= cap) continue
    if (isExcl(prof, dia, hora, unidade)) continue
    if (pacs.some(p => !tAba(p))) continue

    for (const pac of Object.keys(mGap)) {
      if (
        pacs.includes(pac) || invSet.has(pac) || !tAba(pac) ||
        isRec(pac, prof, dia, hora) || slotReservadoOutro(pac, prof, dia, hora) ||
        pacOcup(pac, dia, hora) || !canSug(pac, "Musicoterapia")
      ) continue
      if (!noT(pm(hora), gTurno(pac))) continue
      if (compat(pacs, pac)) {
        const r1ND = !(dPac[pac] || new Set()).has(dia)
        let r1VC: VCompSlot[] = []
        if (r1ND) {
          if (!unidadePrincipalOk(pac, unidade)) continue
          const a1 = [fm((pm(hora) || 0) + 40), (pm(hora) || 0) >= 40 ? fm((pm(hora) || 0) - 40) : null].filter(Boolean) as string[]
          const vC1 = livre.filter(
            r =>
              r["Dia da Semana"] === dia && exU(r["Sala"] || "") === unidade &&
              a1.includes(r.HI_str) && r["Terapia"] !== "Musicoterapia" &&
              TERAPIA_TO_ESP[r["Terapia"]] && !EXCLUIR_OCUP.has(r["Terapia"]) &&
              canSug(pac, TERAPIA_TO_ESP[r["Terapia"]]) && gM[pac]?.[TERAPIA_TO_ESP[r["Terapia"]]],
          )
          const vC1L = vC1.filter(
            vc =>
              !slotReservadoOutro(pac, vc["Profissional"], vc["Dia da Semana"], vc.HI_str) &&
              !sugs.some(s => s.prof === vc["Profissional"] && s.dia === vc["Dia da Semana"] && s.hora === vc.HI_str && s.pac !== pac),
          )
          if (!vC1L.length) continue
          r1VC = vC1L.slice(0, 2).map(r => ({
            tP: r["Terapia"],
            tE: TERAPIA_TO_ESP[r["Terapia"]] || r["Terapia"],
            prof: r["Profissional"],
            dia: r["Dia da Semana"],
            hora: r.HI_str,
          }))
        }
        sugs.push({
          mod: "Musicoterapia", regra: "R1", prof, esp: "Musicoterapia", tP: "Musicoterapia",
          unidade, dia, hora, pac, faixa: fxM[pac] || "?", colegas: pacs.join(", "), vComp: "—",
          obs: MJULIANA.has(pac) ? "🔴 Consultar Juliana" : "",
          gap: mGap[pac], conv: cM[pac] || "", prio: gPrio(pac, cM, jM),
          vCompSlots: r1ND && r1VC.length ? r1VC : undefined,
        })
        incSug(pac, "Musicoterapia")
      }
    }
  }

  // Módulo Musicoterapia — R2, R3, R4
  const mLivre = livre.filter(r => r["Terapia"] === "Musicoterapia")
  for (const sl of mLivre) {
    const prof = sl["Profissional"], un = exU(sl["Sala"] || ""), dia = sl["Dia da Semana"], hora = sl.HI_str, hi = sl.HI
    if (hi === null || ["AT Externo", "Desconhecida"].includes(un)) continue
    const cap = gMCap(prof, dia)
    if (!cap) continue
    const excl = isExcl(prof, dia, hora, un)
    const af = fm(hi + 40), bf = hi >= 40 ? fm(hi - 40) : null, adj = [af, bf].filter(Boolean) as string[]
    const pAdj = new Set(aCli.filter(r => r["Dia da Semana"] === dia && r.Unidade === un && adj.includes(r.HI_str)).map(r => r["Nome Favorecido"]))
    const pOcupSlot = new Set(aCli.filter(r => r["Dia da Semana"] === dia && r.HI_str === hora).map(r => r["Nome Favorecido"]))

    // R2
    for (const pac of pAdj) {
      if (!(pac in mGap) || invSet.has(pac) || pOcupSlot.has(pac) || slotReservadoOutro(pac, prof, dia, hora) || pacOcup(pac, dia, hora) || !canSug(pac, "Musicoterapia")) continue
      if (excl && excl !== pac) continue
      if (isRec(pac, prof, dia, hora)) continue
      if (!noT(hi, gTurno(pac))) continue
      if (compat([], pac)) {
        sugs.push({ mod: "Musicoterapia", regra: "R2", prof, esp: "Musicoterapia", tP: "Musicoterapia", unidade: un, dia, hora, pac, faixa: fxM[pac] || "?", colegas: "—", vComp: "—", obs: MJULIANA.has(pac) ? "🔴 Consultar Juliana" : "", gap: mGap[pac], conv: cM[pac] || "", prio: gPrio(pac, cM, jM) })
        incSug(pac, "Musicoterapia")
      }
    }

    // R3
    for (const pac of Object.keys(mGap)) {
      if (invSet.has(pac) || (dPac[pac] || new Set()).has(dia) || isRec(pac, prof, dia, hora) || slotReservadoOutro(pac, prof, dia, hora) || pacOcup(pac, dia, hora) || !canSug(pac, "Musicoterapia")) continue
      if (!unidadePrincipalOk(pac, un)) continue
      if (!noT(hi, gTurno(pac))) continue
      const vC = livre.filter(
        r => r["Dia da Semana"] === dia && exU(r["Sala"] || "") === un && adj.includes(r.HI_str) &&
          r["Terapia"] !== "Musicoterapia" && TERAPIA_TO_ESP[r["Terapia"]] && !EXCLUIR_OCUP.has(r["Terapia"]) && gM[pac]?.[TERAPIA_TO_ESP[r["Terapia"]]],
      )
      if (!vC.length) continue
      const vCLivre = vC.filter(vc => {
        const vcEsp = TERAPIA_TO_ESP[vc["Terapia"]]
        const slotTaken = sugs.some(s => s.prof === vc["Profissional"] && s.dia === vc["Dia da Semana"] && s.hora === vc.HI_str && s.pac !== pac)
        const gapSat = !canSug(pac, vcEsp)
        return !slotReservadoOutro(pac, vc["Profissional"], vc["Dia da Semana"], vc.HI_str) && !slotTaken && !gapSat
      })
      if (!vCLivre.length) continue
      if (compat([], pac)) {
        const vc = vCLivre.slice(0, 2).map(r => `${r["Terapia"]} ${r.HI_str}`).join(" | ")
        const vCompSlots: VCompSlot[] = vCLivre.slice(0, 2).map(r => ({ tP: r["Terapia"], tE: TERAPIA_TO_ESP[r["Terapia"]] || r["Terapia"], prof: r["Profissional"], dia: r["Dia da Semana"], hora: r.HI_str }))
        sugs.push({ mod: "Musicoterapia", regra: "R3", prof, esp: "Musicoterapia", tP: "Musicoterapia", unidade: un, dia, hora, pac, faixa: fxM[pac] || "?", colegas: "—", vComp: vc, vCompSlots, obs: MJULIANA.has(pac) ? "🔴 Consultar Juliana" : "", gap: mGap[pac], conv: cM[pac] || "", prio: gPrio(pac, cM, jM) })
        incSug(pac, "Musicoterapia")
      }
    }

    // R4 — requer remanejamento prévio; não exibido como sugestão direta
  }

  // Módulo Ocupação
  const tPrio = config.terapiasPrio || []
  const allPP = [...PROFS_PRIO_DEF, FOCO_CAMILA_PROF, ...(config.profsPrioExtras || [])]
  const isPP = (p: string) => !!(p && allPP.some(x => p.toLowerCase().includes(x.toLowerCase().split(" ")[0])))
  const isFocoSlot = (prof: string, esp: string) =>
    (prof === FOCO_CAMILA_PROF && esp === FOCO_CAMILA_ESP) ||
    (isPP(prof) && tPrio.some(t => esp.toLowerCase().includes(t.toLowerCase())))

  const turnoOk = (pac: string, hi: number | null) => noT(hi, gTurno(pac))
  const adjHs = (hi: number) => [hi + 40, hi - 40].filter(v => v >= 0).map(fm)
  const temAdjClinica = (pac: string, dia: string, un: string, hi: number) =>
    aCli.some(r => r["Nome Favorecido"] === pac && r["Dia da Semana"] === dia && r.Unidade === un && adjHs(hi).includes(r.HI_str))

  const gapRestante = (pac: string, esp: string, consumo = 0) =>
    (gM[pac]?.[esp] || 0) - (sugCount[`${pac}|||${esp}`] || 0) - consumo

  const complementosNovoDia = (
    pac: string, espBase: string, dia: string, un: string, hi: number, slBase: CsvRowProcessada | null,
  ): VCompSlot[] => {
    const hs = adjHs(hi)
    const seenComp = new Set<string>()
    const out: VCompSlot[] = []
    for (const r of livre) {
      const compEsp = TERAPIA_TO_ESP[r["Terapia"]]
      if (!compEsp || EXCLUIR_OCUP.has(r["Terapia"]) || ["AT Externo", "Desconhecida"].includes(exU(r["Sala"] || ""))) continue
      if (r["Dia da Semana"] !== dia || exU(r["Sala"] || "") !== un || !hs.includes(r.HI_str)) continue
      if (slBase && r["Profissional"] === slBase["Profissional"] && r.HI_str === slBase.HI_str && r["Terapia"] === slBase["Terapia"]) continue
      if (!gM[pac]?.[compEsp]) continue
      const consumo = compEsp === espBase ? 1 : 0
      if (gapRestante(pac, compEsp, consumo) <= 0) continue
      if (slotReservadoOutro(pac, r["Profissional"], dia, r.HI_str) || pacOcup(pac, dia, r.HI_str) || !turnoOk(pac, r.HI) || isRec(pac, r["Profissional"], dia, r.HI_str)) continue
      const k = `${r["Profissional"]}|||${dia}|||${r.HI_str}|||${r["Terapia"]}`
      if (seenComp.has(k)) continue
      seenComp.add(k)
      out.push({ tP: r["Terapia"], tE: compEsp, prof: r["Profissional"], dia, hora: r.HI_str })
    }
    return out
  }

  const lByPD: Record<string, number[]> = {}
  for (const r of livre.filter(r => r.HI !== null && !EXCLUIR_OCUP.has(r["Terapia"]))) {
    const k = `${r["Profissional"]}|||${r["Dia da Semana"]}`
    if (!lByPD[k]) lByPD[k] = []
    lByPD[k].push(r.HI as number)
  }

  const aNF = new Set<string>()
  for (const [k, ts] of Object.entries(lByPD)) {
    const s = [...ts].sort((a, b) => a - b)
    let run = 1
    for (let i = 1; i < s.length; i++) {
      if (s[i] - s[i - 1] === 40) { run++; if (run >= 6) { aNF.add(k); break } }
      else run = 1
    }
  }

  const lOcup = livre.filter(
    r => TERAPIA_TO_ESP[r["Terapia"]] && !EXCLUIR_OCUP.has(r["Terapia"]) &&
      !["AT Externo", "Desconhecida"].includes(exU(r["Sala"] || "")) &&
      (!aNF.has(`${r["Profissional"]}|||${r["Dia da Semana"]}`) || isFocoSlot(r["Profissional"], TERAPIA_TO_ESP[r["Terapia"]])),
  )

  // Ocupação R2
  // pAdj é um pré-filtro de performance (pacientes com sessão adjacente ao slot).
  // slotValidoParaPaciente é o validador definitivo R2.1+R5.1, compartilhado com
  // "Hipótese: novo profissional" em SaidaProfMode.tsx via candidatos.ts.
  for (const sl of lOcup) {
    const prof = sl["Profissional"], un = exU(sl["Sala"] || ""), dia = sl["Dia da Semana"], hora = sl.HI_str, hi = sl.HI
    const esp = TERAPIA_TO_ESP[sl["Terapia"]]
    if (!esp || hi === null) continue
    const af = fm(hi + 40), bf = hi >= 40 ? fm(hi - 40) : null, adj = [af, bf].filter(Boolean) as string[]
    const pAdj = new Set(aCli.filter(r => r["Dia da Semana"] === dia && r.Unidade === un && adj.includes(r.HI_str)).map(r => r["Nome Favorecido"]))
    for (const pac of pAdj) {
      if (PACS_ADMIN.has(pac) || invSet.has(pac) || !gM[pac]?.[esp] || isRec(pac, prof, dia, hora) || slotReservadoOutro(pac, prof, dia, hora) || pacOcup(pac, dia, hora) || !canSug(pac, esp)) continue
      if (!turnoOk(pac, hi)) continue
      if (!slotValidoParaPaciente(pac, dia, hora, aCli, un)) continue
      sugs.push({ mod: "Ocupação", regra: "Ocup. R2", prof, esp, tP: sl["Terapia"], unidade: un, dia, hora, pac, faixa: fxM[pac] || "?", colegas: "—", vComp: "—", obs: "", gap: gM[pac][esp], conv: cM[pac] || "", prio: gPrio(pac, cM, jM), isPP: isPP(prof) })
      incSug(pac, esp)
    }
  }

  // Foco profissional
  const focoPend: Array<{ rank: number; fila: boolean; pac: string; esp: string; s: Sugestao }> = []
  for (const sl of lOcup) {
    const prof = sl["Profissional"], un = exU(sl["Sala"] || ""), dia = sl["Dia da Semana"], hora = sl.HI_str, hi = sl.HI
    const esp = TERAPIA_TO_ESP[sl["Terapia"]]
    if (!isFocoSlot(prof, esp) || hi === null) continue
    const pacUn = [...new Set(aCli.filter(r => r.Unidade === un && !PACS_ADMIN.has(r["Nome Favorecido"])).map(r => r["Nome Favorecido"]))]
    for (const pac of pacUn) {
      if (invSet.has(pac) || !gM[pac]?.[esp] || isRec(pac, prof, dia, hora) || slotReservadoOutro(pac, prof, dia, hora) || !turnoOk(pac, hi)) continue
      const sessDia = aCli.filter(r => r["Nome Favorecido"] === pac && r.Unidade === un && r["Dia da Semana"] === dia)
      const sessUn = aCli.filter(r => r["Nome Favorecido"] === pac && r.Unidade === un)
      if (!sessUn.length) continue
      const conf = agend.filter(r => r["Nome Favorecido"] === pac && r["Dia da Semana"] === dia && r.HI_str === hora)
      if (conf.length) continue
      const adjOk = sessDia.length && temAdjClinica(pac, dia, un, hi)
      const diaTxt = [...new Set(sessUn.map(r => r["Dia da Semana"].replace("-feira", "")).filter(Boolean))].slice(0, 4).join(", ")
      if (sessDia.length && !adjOk) continue
      if (sessDia.length) {
        focoPend.push({ rank: 0, fila: false, pac, esp, s: { mod: "Foco Prof.", regra: "Foco adj.", prof, esp, tP: sl["Terapia"], unidade: un, dia, hora, pac, faixa: fxM[pac] || "?", colegas: "—", vComp: "—", obs: "", gap: gM[pac][esp], conv: cM[pac] || "", prio: gPrio(pac, cM, jM), isPP: true } })
      } else {
        if (!unidadePrincipalOk(pac, un)) continue
        const comp = complementosNovoDia(pac, esp, dia, un, hi, sl)
        if (!comp.length) continue
        focoPend.push({ rank: 2, fila: true, pac, esp, s: { mod: "Foco Prof.", regra: "Foco novo dia", prof, esp, tP: sl["Terapia"], unidade: un, dia, hora, pac, faixa: fxM[pac] || "?", colegas: "—", vComp: `Novo dia somente com oferta conjunta: ${comp.slice(0, 2).map(c => `${c.tP} ${c.hora}`).join(" | ")}. Paciente frequenta ${un} em ${diaTxt || "outro dia"}.`, vCompSlots: comp.slice(0, 2), obs: `🎯 ${fmtName(prof)}`, gap: gM[pac][esp], conv: cM[pac] || "", prio: gPrio(pac, cM, jM), isPP: true, filaM: "novo dia com complementar" } })
      }
    }
  }

  focoPend.sort((a, b) => a.rank - b.rank || a.s.prio - b.s.prio || (DIAS_ORD[a.s.dia] ?? 9) - (DIAS_ORD[b.s.dia] ?? 9) || (pm(a.s.hora) || 0) - (pm(b.s.hora) || 0))
  for (const f of focoPend) {
    if (f.fila) continue  // Foco novo dia requer coordenação extra — não exibir
    if (!canSug(f.pac, f.esp)) continue
    sugs.push(f.s)
    incSug(f.pac, f.esp)
  }

  // Limpeza: remover Supervisão ABA da fila
  const isSupAba = (s: Sugestao) => s.tP === "Supervisão ABA" || s.tP === "Coordenador de Caso"
  fila.splice(0, fila.length, ...fila.filter(s => !isSupAba(s)))

  // Ordenação
  const sF = (a: Sugestao, b: Sugestao) => {
    if ((a.isPP ? 0 : 1) !== (b.isPP ? 0 : 1)) return (a.isPP ? 0 : 1) - (b.isPP ? 0 : 1)
    const at = tPrio.some(t => a.esp.toLowerCase().includes(t.toLowerCase())) ? 0 : 1
    const bt = tPrio.some(t => b.esp.toLowerCase().includes(t.toLowerCase())) ? 0 : 1
    if (at !== bt) return at - bt
    if (a.prio !== b.prio) return a.prio - b.prio
    if ((DIAS_ORD[a.dia] ?? 9) !== (DIAS_ORD[b.dia] ?? 9)) return (DIAS_ORD[a.dia] ?? 9) - (DIAS_ORD[b.dia] ?? 9)
    return (pm(a.hora) || 0) - (pm(b.hora) || 0)
  }
  sugs.sort(sF)
  fila.sort(sF)

  // Deduplicação + slot único por paciente
  // slotDono: slotKey → pac que ficou com a vaga (para registrar "próximo na fila")
  const confirmedSlots = new Set(
    (config.confirmedItems ?? []).map(c => `${c.prof}|||${c.dia}|||${c.hora}`)
  )
  const seen = new Set<string>()
  const slotDono = new Map<string, string>()
  const vagasAgora: Sugestao[] = []

  for (const s of sugs) {
    const k = `${s.pac}|||${s.prof}|||${s.dia}|||${s.hora}`
    if (seen.has(k)) continue
    seen.add(k)
    if (config.isolarAssim && (s.prio === 3 || s.prio === 4)) { fila.push({ ...s, filaM: "ASSIM isolado" }); continue }
    if (s.mod === "Ocupação" || s.mod === "Foco Prof.") {
      const slotK = `${s.prof}|||${s.dia}|||${s.hora}`
      if (confirmedSlots.has(slotK)) { fila.push({ ...s, filaM: "Slot já confirmado" }); continue }
      if (slotDono.has(slotK)) {
        fila.push({ ...s, filaM: `Próximo para: ${slotDono.get(slotK)}` })
        continue
      }
      slotDono.set(slotK, s.pac)
    }
    vagasAgora.push(s)
  }

  const datas = csvRows.map(r => r["Data"]).filter(Boolean).sort() as string[]
  const fmtD = (s: string) => { const [y, mo, d] = s.split("-"); return `${d}/${mo}/${y}` }

  return {
    vagasAgora,
    filaEspera: fila,
    allGaps,
    cM,
    fxM,
    agendRows: agend,
    altaCount: altaSet.size,
    semanaRef: datas[0] ? `${fmtD(datas[0])} a ${fmtD(datas[datas.length - 1])}` : "",
    tPrioAtivas: tPrio,
  }
}
