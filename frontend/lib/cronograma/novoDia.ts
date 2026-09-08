// ─── Modalidade "Novo Dia" ──────────────────────────────────────────────────
// 3ª modalidade de "Ocupar Profissionais Disponíveis": quando uma vaga Livre
// não tem cobertura Direta nem via Remanejamento, verifica se dá pra convencer
// um paciente com gap a vir também num dia da semana que ele ainda NÃO
// frequenta — oferecendo não só a terapia da vaga (âncora), mas um conjunto de
// terapias formando uma agenda hipotética válida naquele dia (mínimo 2
// sessões contíguas, respeitando o autorizado de cada especialidade). Ao
// contrário de Direto/Remanejamento (que resolvem pra 1 candidato fixo), a
// escolha final de quais sessões complementares aceitar fica com o usuário no
// modal — aqui só calculamos QUEM qualifica pra vaga e QUAIS candidatas
// existem, nunca escrevemos na agenda real.

import { listarSlotsLivres, unidadeDominantePaciente, turnoDominantePaciente, type SlotLivre, type OpcoesSlotsLivres } from "./disponibilidadeInterna"
import { agendaClinica, type GapItem, type Turno } from "./simulacaoNovoPrestador"
import { turnoFromHora } from "./helpers"
import { HORAS_GRID } from "./constants"
import type { CsvRow } from "@/types/cronograma"

export interface SessaoCandidataNovoDia {
  hora: string
  profissional: string
  terapia: string
  especialidade: string
}

export interface OportunidadeNovoDia {
  paciente: string
  dia: string
  turno: Turno
  unidade: string
  /** Sessão que originou a vaga sendo avaliada — sempre incluída/travada no modal. */
  ancora: SessaoCandidataNovoDia
  /** TODO o universo de sessões Livres reais desse dia+turno+unidade em que o
   *  paciente tem gap>0 na especialidade — inclui a âncora. A escolha final de
   *  quais marcar fica com o usuário no modal, não é resolvida aqui. */
  candidatas: SessaoCandidataNovoDia[]
  /** aut/of por especialidade presente em `candidatas`, pro modal montar o
   *  contador ao vivo sem precisar voltar no gapMap. */
  gapPorEspecialidade: Record<string, { aut: number; of: number }>
  /** Tamanho do maior bloco válido (≥2, contíguo, respeitando teto de gap)
   *  contendo a âncora, menos 1 — só usado pra ranquear pacientes concorrentes
   *  à mesma vaga (regra: prioriza quem forma mais sessões complementares). */
  maxComplementaresPossiveis: number
}

function chaveSlot(profissional: string, hora: string): string { return `${profissional}|||${hora}` }

export interface IndiceNovoDia {
  /** `dia|||unidade|||turno` -> todos os SlotLivre elegíveis (especialidade != null). */
  slotsPorDiaUnidadeTurno: Map<string, SlotLivre[]>
  /** paciente -> dias da semana que ele já frequenta (via agendaClinica). */
  diasQueFrequenta: Map<string, Set<string>>
  /** paciente -> unidade que já domina a semana dele (null = sem restrição). */
  unidadeDominanteSemana: Map<string, string | null>
  /** paciente -> turno que já domina a semana dele (null = sem restrição). */
  turnoDominanteSemana: Map<string, Turno | null>
  /** especialidade -> pacientes com gap>0 nela. */
  pacientesComGapPorEspecialidade: Map<string, string[]>
}

export function construirIndiceNovoDia(cRows: CsvRow[], gapMap: Record<string, GapItem>, opts?: OpcoesSlotsLivres): IndiceNovoDia {
  const slotsPorDiaUnidadeTurno = new Map<string, SlotLivre[]>()
  for (const s of listarSlotsLivres(cRows, opts)) {
    if (!s.especialidade) continue
    const chave = `${s.dia}|||${s.unidade}|||${turnoFromHora(s.hora)}`
    const lista = slotsPorDiaUnidadeTurno.get(chave) ?? []
    lista.push(s)
    slotsPorDiaUnidadeTurno.set(chave, lista)
  }

  const diasQueFrequenta = new Map<string, Set<string>>()
  const pacientesVistos = new Set<string>()
  for (const r of agendaClinica(cRows)) {
    const pac = r["Nome Favorecido"]
    if (!pac) continue
    pacientesVistos.add(pac)
    const dias = diasQueFrequenta.get(pac) ?? new Set<string>()
    dias.add(r["Dia da Semana"])
    diasQueFrequenta.set(pac, dias)
  }

  const unidadeDominanteSemana = new Map<string, string | null>()
  const turnoDominanteSemana = new Map<string, Turno | null>()
  for (const pac of pacientesVistos) {
    unidadeDominanteSemana.set(pac, unidadeDominantePaciente(pac, cRows))
    turnoDominanteSemana.set(pac, turnoDominantePaciente(pac, cRows))
  }

  const pacientesComGapPorEspecialidade = new Map<string, string[]>()
  for (const chave of Object.keys(gapMap)) {
    const g = gapMap[chave]
    if (g.gap <= 0) continue
    const lista = pacientesComGapPorEspecialidade.get(g.esp) ?? []
    lista.push(g.pac)
    pacientesComGapPorEspecialidade.set(g.esp, lista)
  }

  return { slotsPorDiaUnidadeTurno, diasQueFrequenta, unidadeDominanteSemana, turnoDominanteSemana, pacientesComGapPorEspecialidade }
}

/** Todo run contíguo (na HORAS_GRID do turno, passo de 40min) de horas
 *  selecionadas precisa ter tamanho >= 2. Retorna as horas que estão em algum
 *  run inválido (tamanho 1) — vazio = seleção válida. Usada tanto pra checar
 *  viabilidade de uma vaga (existe pelo menos 1 bloco válido contendo a
 *  âncora?) quanto, no modal, pra validar ao vivo a seleção do usuário. */
export function horasEmBlocoInvalido(horasSelecionadas: string[], turno: Turno): string[] {
  const selecionadas = new Set(horasSelecionadas)
  const horasTurno = HORAS_GRID.filter(h => turnoFromHora(h) === turno)

  const invalidas: string[] = []
  let runAtual: string[] = []
  const fecharRun = () => {
    if (runAtual.length === 1) invalidas.push(runAtual[0])
    runAtual = []
  }
  for (const h of horasTurno) {
    if (selecionadas.has(h)) runAtual.push(h)
    else fecharRun()
  }
  fecharRun()
  return invalidas
}

/** Maior bloco contíguo (≥2, respeitando teto de gap por especialidade)
 *  contendo `horaAncora`, expandindo pros dois lados na grade do turno.
 *  Retorna as horas do bloco (vazio = nenhum bloco válido possível). */
function maiorBlocoValido(
  horaAncora: string, turno: Turno, candidatasPorHora: Map<string, SessaoCandidataNovoDia>,
  gapMap: Record<string, GapItem>, pac: string,
): string[] {
  const horasTurno = HORAS_GRID.filter(h => turnoFromHora(h) === turno)
  const idxAncora = horasTurno.indexOf(horaAncora)
  if (idxAncora === -1) return []

  const usadoPorEsp = new Map<string, number>()
  const consumir = (esp: string): boolean => {
    const gap = gapMap[`${pac}|||${esp}`]?.gap ?? 0
    const usado = usadoPorEsp.get(esp) ?? 0
    if (usado >= gap) return false
    usadoPorEsp.set(esp, usado + 1)
    return true
  }

  const ancoraCand = candidatasPorHora.get(horaAncora)
  if (!ancoraCand || !consumir(ancoraCand.especialidade)) return []
  const bloco = [horaAncora]

  for (let i = idxAncora + 1; i < horasTurno.length; i++) {
    const cand = candidatasPorHora.get(horasTurno[i])
    if (!cand || !consumir(cand.especialidade)) break
    bloco.push(horasTurno[i])
  }
  for (let i = idxAncora - 1; i >= 0; i--) {
    const cand = candidatasPorHora.get(horasTurno[i])
    if (!cand || !consumir(cand.especialidade)) break
    bloco.unshift(horasTurno[i])
  }

  return bloco.length >= 2 ? bloco : []
}

/** Lista, por vaga-âncora qualificada, a oportunidade de "Novo Dia" — nunca
 *  mais de 1 paciente por âncora (mesmo princípio de "1 vaga = 1 candidato"
 *  de listarOportunidadesDiretas/encontrarCandidatosRemanejamento). */
// Diagnóstico opt-in: no console do navegador, rode `window.NOVODIA_DEBUG = true`
// e reabra/recarregue a aba "Ocupar Profissionais Disponíveis" — imprime, pra
// cada vaga-âncora e cada paciente candidato daquela especialidade, o motivo
// exato da exclusão (ou a inclusão). Não roda nada em produção por padrão
// (custo zero quando a flag não existe) — só existe pra depurar com dados
// reais sem precisar expor o relatório de laudos (que só existe em memória
// no navegador, nunca no banco).
function debugAtivo(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { NOVODIA_DEBUG?: boolean }).NOVODIA_DEBUG
}

export function listarOportunidadesNovoDia(
  cRows: CsvRow[], gapMap: Record<string, GapItem>, indicePre?: IndiceNovoDia, opts?: OpcoesSlotsLivres,
): OportunidadeNovoDia[] {
  const indice = indicePre ?? construirIndiceNovoDia(cRows, gapMap, opts)
  const todosSlots = [...indice.slotsPorDiaUnidadeTurno.values()].flat()
  const debug = debugAtivo()

  interface Candidato { paciente: string; oportunidade: OportunidadeNovoDia }
  const porAncora = new Map<string, Candidato[]>()

  for (const s of todosSlots) {
    const especialidadeAncora = s.especialidade!
    const dia = s.dia, unidade = s.unidade, turno = turnoFromHora(s.hora)
    const chaveGrupo = `${dia}|||${unidade}|||${turno}`
    const slotsDoGrupo = indice.slotsPorDiaUnidadeTurno.get(chaveGrupo) ?? []

    const pacientesDaEspecialidade = indice.pacientesComGapPorEspecialidade.get(especialidadeAncora) ?? []
    if (debug && pacientesDaEspecialidade.length) {
      console.debug(`[novoDia] âncora ${s.profissional} · ${dia} ${s.hora} · ${unidade} · ${especialidadeAncora} — ${pacientesDaEspecialidade.length} paciente(s) com gap nessa especialidade a avaliar`)
    }
    for (const pac of pacientesDaEspecialidade) {
      if (indice.diasQueFrequenta.get(pac)?.has(dia)) {
        if (debug) console.debug(`[novoDia]   ✗ ${pac}: já frequenta ${dia}`)
        continue
      }
      const dominante = indice.unidadeDominanteSemana.get(pac) ?? null
      if (dominante && dominante !== unidade) {
        if (debug) console.debug(`[novoDia]   ✗ ${pac}: unidade dominante da semana é "${dominante}", vaga é em "${unidade}"`)
        continue
      }
      // Nunca oferecer um turno que o paciente não costuma frequentar (ex.:
      // paciente só vem de manhã a semana toda) só porque a vaga do
      // profissional caiu à tarde — mesmo princípio da unidade dominante acima.
      const turnoDominante = indice.turnoDominanteSemana.get(pac) ?? null
      if (turnoDominante && turnoDominante !== turno) {
        if (debug) console.debug(`[novoDia]   ✗ ${pac}: turno dominante da semana é "${turnoDominante}", vaga é "${turno}"`)
        continue
      }

      // Universo elegível pra esse paciente: slots do grupo cuja especialidade
      // tem gap>0 pra ele — pode ter mais de 1 slot na mesma hora (profissionais
      // e/ou especialidades diferentes); mantém o primeiro por hora só pro
      // cálculo de bloco (o modal reoferece todos via `candidatas`).
      const candidatasPorHora = new Map<string, SessaoCandidataNovoDia>()
      const candidatas: SessaoCandidataNovoDia[] = []
      for (const sl of slotsDoGrupo) {
        const esp = sl.especialidade!
        if (!gapMap[`${pac}|||${esp}`] || gapMap[`${pac}|||${esp}`].gap <= 0) continue
        const c: SessaoCandidataNovoDia = { hora: sl.hora, profissional: sl.profissional, terapia: sl.terapia, especialidade: esp }
        candidatas.push(c)
        if (!candidatasPorHora.has(sl.hora)) candidatasPorHora.set(sl.hora, c)
      }
      // Na hora da própria âncora, sempre usa a combinação exata da âncora
      // (nunca "a 1ª que apareceu" nessa hora) — na mesma hora podem existir
      // vagas de OUTRAS especialidades também elegíveis pro paciente (ex.:
      // Fonoaudiologia e Aplicador ABA (PS) ambos às 08:00), e sem isso o
      // cálculo de bloco podia "gastar" o gap errado logo na 1ª sessão.
      candidatasPorHora.set(s.hora, { hora: s.hora, profissional: s.profissional, terapia: s.terapia, especialidade: especialidadeAncora })
      if (!candidatasPorHora.has(s.hora)) {
        if (debug) console.debug(`[novoDia]   ✗ ${pac}: sem candidata elegível na própria hora da âncora (${s.hora}) — checar gap de "${especialidadeAncora}"`)
        continue // âncora nunca elegível pro próprio paciente (sem gap na esp dela)
      }

      const bloco = maiorBlocoValido(s.hora, turno, candidatasPorHora, gapMap, pac)
      if (bloco.length < 2) {
        if (debug) console.debug(`[novoDia]   ✗ ${pac}: não formou bloco de ≥2 sessões contíguas (candidatas nas horas: ${[...candidatasPorHora.keys()].sort().join(", ") || "nenhuma"})`)
        continue
      }
      if (debug) console.debug(`[novoDia]   ✓ ${pac}: qualificou — bloco ${bloco.join(", ")}`)

      const gapPorEspecialidade: Record<string, { aut: number; of: number }> = {}
      for (const c of candidatas) {
        if (gapPorEspecialidade[c.especialidade]) continue
        const g = gapMap[`${pac}|||${c.especialidade}`]
        gapPorEspecialidade[c.especialidade] = { aut: g.aut, of: g.of }
      }

      const ancoraSessao: SessaoCandidataNovoDia = { hora: s.hora, profissional: s.profissional, terapia: s.terapia, especialidade: especialidadeAncora }
      const oportunidade: OportunidadeNovoDia = {
        paciente: pac, dia, turno, unidade,
        ancora: ancoraSessao,
        candidatas,
        gapPorEspecialidade,
        maxComplementaresPossiveis: bloco.length - 1,
      }

      const chaveAncora = chaveSlot(s.profissional, s.hora)
      const lista = porAncora.get(chaveAncora) ?? []
      lista.push({ paciente: pac, oportunidade })
      porAncora.set(chaveAncora, lista)
    }
  }

  // 1 candidato por âncora: mais sessões complementares possíveis primeiro,
  // empate por gap (na especialidade da âncora) desc, empate final por nome.
  const vencedorPorAncora = new Map<string, OportunidadeNovoDia>()
  for (const [chaveAncora, candidatos] of porAncora) {
    candidatos.sort((a, b) => {
      const diff = b.oportunidade.maxComplementaresPossiveis - a.oportunidade.maxComplementaresPossiveis
      if (diff !== 0) return diff
      const espAncora = a.oportunidade.ancora.especialidade
      const gapA = gapMap[`${a.paciente}|||${espAncora}`]?.gap ?? 0
      const gapB = gapMap[`${b.paciente}|||${espAncora}`]?.gap ?? 0
      if (gapB !== gapA) return gapB - gapA
      return a.paciente.localeCompare(b.paciente)
    })
    vencedorPorAncora.set(chaveAncora, candidatos[0].oportunidade)
  }

  // Teto de gap GLOBAL entre vagas-âncora diferentes do mesmo paciente (mesmo
  // princípio de ocorrenciasPorPacienteEsp/excluir em listarOportunidadesDiretas):
  // corta primeiro onde o paciente tem mais alternativas (âncoras com bloco maior).
  const ocorrenciasPorPacienteEsp = new Map<string, { chaveAncora: string; alternativas: number }[]>()
  for (const [chaveAncora, op] of vencedorPorAncora) {
    const chavePac = `${op.paciente}|||${op.ancora.especialidade}`
    const lista = ocorrenciasPorPacienteEsp.get(chavePac) ?? []
    lista.push({ chaveAncora, alternativas: op.maxComplementaresPossiveis })
    ocorrenciasPorPacienteEsp.set(chavePac, lista)
  }
  const excluir = new Set<string>()
  for (const [chavePac, ocorrencias] of ocorrenciasPorPacienteEsp) {
    const [pac, esp] = chavePac.split("|||")
    const gap = gapMap[`${pac}|||${esp}`]?.gap ?? 0
    if (ocorrencias.length <= gap) continue
    const excedentes = [...ocorrencias].sort((a, b) => a.alternativas - b.alternativas).slice(gap)
    for (const e of excedentes) excluir.add(e.chaveAncora)
  }

  return [...vencedorPorAncora.entries()].filter(([chave]) => !excluir.has(chave)).map(([, op]) => op)
}
