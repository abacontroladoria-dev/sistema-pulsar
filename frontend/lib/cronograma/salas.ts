// ─── LÓGICA DE CÁLCULO: OCUPAÇÃO DE SALAS ────────────────────────────────────
// Adaptado de calculadora-remuneracao/src/utils/salas.js (calcularResumoSalas,
// cruzarSalasComGradeProfissionais) + ocupacao.js (corFaixaOcupacao). Reescrito
// em TypeScript para cruzar o cadastro estrutural de salas (cronograma_salas)
// com dados de agendamento REAIS já existentes em csv_grades_profissionais, em
// vez de CSV importado manualmente + localStorage.

import { normalizarUnidadeOcupacao, turnoDoHorario, corFaixaOcupacao } from "./ocupacaoProf"
import { DOW_PT } from "./ocupacaoConst"
import { pm, fm, cleanTxt } from "./helpers"
import { normTxt, HORAS_GRID } from "./constants"
import { capacidadeProjetadaSala, STATUS_SLOT_EXCLUIDO, DIAS_DISPONIVEIS_PADRAO, chaveHorarioCustomizado } from "./salasTypes"
import { construirIndiceExclusividadeTerapia, verificarExclusividade, type IndiceExclusividadeTerapia } from "./exclusividadeTerapia"
import type {
  Sala,
  SalaCapacidade,
  AgendaSalaRow,
  AlocacaoSala,
  AlocacaoCardSlot,
  BlocoOcupacaoSlot,
  SlotOcupacaoSala,
  SalaComOcupacao,
  ResumoUnidadeSalas,
  ResumoTurnoUnidadeSalas,
  StatusOcupacaoSlot,
  SlotDetalhado,
  BlocoDetalhado,
  SalaTerapiaExclusiva,
} from "./salasTypes"

const INDICE_EXCLUSIVIDADE_VAZIO = construirIndiceExclusividadeTerapia([])

export { corFaixaOcupacao }

// ─── DIA DA SEMANA ────────────────────────────────────────────────────────────

const DOW_POR_NOME: Record<string, number> = {
  "segunda-feira": 1, "segunda": 1,
  "terca-feira": 2, "terça-feira": 2, "terca": 2, "terça": 2,
  "quarta-feira": 3, "quarta": 3,
  "quinta-feira": 4, "quinta": 4,
  "sexta-feira": 5, "sexta": 5,
  "sábado": 6, "sabado": 6,
}

export function dowDeDiaSemana(diaSemana: string | null | undefined): number | null {
  const n = normTxt(diaSemana)
  return DOW_POR_NOME[n] ?? null
}

// ─── CRUZAMENTO: SALA × AGENDAMENTO ───────────────────────────────────────────
//
// O texto livre `sala_nome` da agenda real (ex.: "Unid. Realengo - Sala 18
// (Coordenação de caso)") tem variações de observação/capitalização entre
// registros do mesmo cômodo físico. Uma comparação por substring simples é
// insegura (ex.: "Sala 1" é substring de "Sala 10", "Sala 11" ... "Sala 19"),
// então o cruzamento é feito de forma estrutural: extrai-se {unidade, número}
// do texto e compara-se com os campos já normalizados de `cronograma_salas`,
// em vez de comparar as strings inteiras.

/**
 * Extrai {unidade, numeroSala} de um `sala_nome` livre vindo da agenda (ex.:
 * "Unid. Realengo - Sala 18 (Coordenação de caso)"). O trecho "Sala N" é
 * opcional — salas identificadas só pela descrição, sem número (ex.: "Unid.
 * Terceirizada - Equoterapia em Movimento (Campo Grande)"), retornam
 * `numeroSala: ""` em vez de `null` inteiro; ver `salaCasaComAgenda` pra como
 * isso é tratado no casamento exato.
 */
export function parseSalaAgenda(salaNomeRaw: string | null | undefined): { unidade: string; numeroSala: string } | null {
  const raw = cleanTxt(salaNomeRaw)
  if (!raw) return null
  const m = raw.match(/^Unid\.?\s*([^-–—]+?)\s*[-–—]\s*(?:Sala\s*0*(\d+)\b)?/i)
  if (!m) return null
  return { unidade: normalizarUnidadeOcupacao(m[1]), numeroSala: m[2] ?? "" }
}

/** Normaliza número de sala para comparação (remove zeros à esquerda: "09" -> "9"). */
export function normNumeroSala(numero: string | null | undefined): string {
  const raw = cleanTxt(numero)
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? String(n) : raw
}

function salaCasaComAgenda(sala: Sala, salaNomeAgenda: string | null): boolean {
  const parsed = parseSalaAgenda(salaNomeAgenda)
  if (!parsed) return false
  if (parsed.unidade !== normalizarUnidadeOcupacao(sala.unidade_nome)) return false
  // Sem "Sala N" no nome real (ex.: "Unid. Terceirizada - Equoterapia em
  // Movimento (Campo Grande)") — a sala não tem como ser diferenciada de
  // outras da mesma unidade pelo nome, então a própria unidade já a
  // identifica; não exige bater o número cadastrado (que nesses casos é só
  // organizacional, sem correspondência na TiTa).
  if (parsed.numeroSala === "") return true
  return normNumeroSala(sala.numero_sala) === parsed.numeroSala
}

/** Filtra linhas de agenda cuja `sala_nome` corresponde estruturalmente (unidade + número) à sala. */
export function linhasDaSala(sala: Sala, linhas: AgendaSalaRow[]): AgendaSalaRow[] {
  return linhas.filter(r => salaCasaComAgenda(sala, r.sala_nome))
}

/**
 * Filtra linhas de agenda cuja `sala_nome` bate só pela UNIDADE (ignora o
 * número da sala) — usado exclusivamente pra proporção "X/Y com paciente"
 * dos cards (`sessoesReais`/`semCruzamentoCsv`), nunca pros `blocos` (grade
 * real de ocupação física, que precisa da sala exata).
 *
 * A TiTa não é confiável pra registrar EM QUAL sala física a sessão
 * aconteceu (o profissional pode estar cadastrado numa sala pra fins de
 * ocupação/planejamento e a sessão real cair registrada em outro número
 * dentro da mesma unidade — comum pra Coordenador de Caso, cuja sessão é
 * sempre lançada numa sala genérica de "Coordenação"). O que de fato
 * importa validar é unidade + turno, não o número exato da sala.
 */
export function linhasDaUnidade(sala: Sala, linhas: AgendaSalaRow[]): AgendaSalaRow[] {
  const unidade = normalizarUnidadeOcupacao(sala.unidade_nome)
  return linhas.filter(r => parseSalaAgenda(r.sala_nome)?.unidade === unidade)
}

// Uma sala "única" atende, ao longo de um turno inteiro, VÁRIOS pacientes/
// profissionais diferentes em sequência (blocos de 40min) — isso é normal,
// não é ocupação simultânea. `capacidadeProjetadaSala` representa capacidade
// POR BLOCO de horário (1/2/3 pacientes ao mesmo tempo), não por turno inteiro.
// O nº de blocos por turno vem do tamanho da própria grade de horários em uso
// (`horasTurno` em calcularSlotsDaSala) — HORAS_POR_TURNO por padrão (6 na
// manhã / 7 na tarde, grade fixa do módulo), ou `sala.horarios_customizados`
// quando a sala tiver um override (ex.: sábado com sessões de 30min).

// HORAS_GRID tem os 13 horários oficiais em sequência (6 da manhã + 7 da
// tarde) — mesma fonte usada em toda a Cronograma, nunca hardcodar de novo.
const HORAS_POR_TURNO: Record<"Manhã" | "Tarde", string[]> = {
  "Manhã": HORAS_GRID.slice(0, 6),
  "Tarde": HORAS_GRID.slice(6),
}

function statusDoSlot(
  status: Sala["status"],
  capacidadeProjetada: number,
  numAlocacoes: number,
): StatusOcupacaoSlot {
  if (status === "bloqueada") return "bloqueado"
  if (status !== "operacional") return "inativo"
  if (numAlocacoes === 0) return "livre"
  if (numAlocacoes >= capacidadeProjetada) return "ocupado"
  return "parcial"
}

/**
 * Calcula os 10 slots (5 dias × 2 turnos) de uma sala a partir das ALOCAÇÕES
 * (planejamento — quem é o "dono" recorrente do bloco), cruzando cada
 * alocação com as sessões reais dessa pessoa nesse dia/turno/UNIDADE (não
 * exige a sala exata — ver `linhasDaUnidade`) apenas para exibir a proporção
 * "X/Y com paciente" (informativo, não valida nada).
 */
export function calcularSlotsDaSala(
  sala: Sala,
  alocacoesSala: AlocacaoSala[],
  linhasSala: AgendaSalaRow[],
  linhasUnidade: AgendaSalaRow[] = linhasSala,
  indiceExclusividade: IndiceExclusividadeTerapia = INDICE_EXCLUSIVIDADE_VAZIO,
  nomeDaSalaPorId: (salaId: string) => string = id => id,
): SlotOcupacaoSala[] {
  const capacidadeProjetada = capacidadeProjetadaSala(sala.capacidade, sala.status)

  // sessões reais "Agendado" agrupadas por profissional + dow + turno — usado só
  // pelos `cards` (proporção "X/Y com paciente" da alocação cadastrada). Duas
  // chaves por linha: por profissional_id (estável — sobrevive a nome editado
  // na TiTa depois do cadastro da alocação) e por nome normalizado (fallback
  // pra quando a alocação não tem profissional_id resolvido). Cruzar só por
  // nome quebra silenciosamente sempre que o texto cadastrado diverge do nome
  // atual na TiTa (ex.: alocação renomeada pra bater com uma planilha, mas a
  // agenda real ainda usa a grafia antiga) — ver profissional_id em salasTypes.ts.
  //
  // Usa `linhasUnidade` (bate só pela unidade, não pela sala exata) — a TiTa
  // não é confiável pra registrar em qual sala física a sessão aconteceu (ex.:
  // Coordenador de Caso é sempre lançado numa sala genérica de "Coordenação",
  // nunca na sala onde a pessoa está fisicamente alocada). O que precisa bater
  // de verdade é profissional + dia + turno + unidade, não o número da sala.
  const sessoesPorProfissionalId = new Map<string, number>()
  const sessoesPorProfissional = new Map<string, number>()
  // Mesmo agrupamento (profissional + dow + turno, sem exigir sala exata), mas
  // pra 'Livre' — a TiTa reserva um horário de agenda ABERTO pro profissional
  // (sem paciente marcado ainda), não é sessão real, então não conta pro "X/Y
  // com paciente". Existe só pra alimentar `temAgendaTita` abaixo: sem isto,
  // profissional recém-cadastrado que só tem horário 'Livre' (nenhum
  // atendimento no histórico ainda, caso da Andréa Aparecida Borges de
  // Oliveira, 2026-08-27) fica indistinguível de alocação puramente
  // fantasiosa, sem NENHUM vínculo com a agenda real — os dois caíam no mesmo
  // "sem cruzamento no CSV"/"Alocação sem sessão", quando só o segundo é de
  // fato uma pendência de planejamento.
  const livrePorProfissionalId = new Set<string>()
  const livrePorProfissional = new Set<string>()
  linhasUnidade.forEach(r => {
    const dow = dowDeDiaSemana(r.dia_semana)
    if (!dow) return
    const statusNorm = normTxt(r.status_agendamento)
    const ehAgendado = statusNorm.includes("agendado")
    const ehLivre = !ehAgendado && statusNorm.includes("livre")
    if (!ehAgendado && !ehLivre) return
    const minutos = pm(r.hora_inicial)
    if (minutos === null) return
    const turno = turnoDoHorario(minutos)
    const prof = cleanTxt(r.profissional_nome)
    if (!prof) return
    const key = `${dow}|${turno}|${normTxt(prof)}`
    const keyId = r.profissional_id !== null && r.profissional_id !== undefined ? `${dow}|${turno}|${r.profissional_id}` : null
    if (ehAgendado) {
      sessoesPorProfissional.set(key, (sessoesPorProfissional.get(key) ?? 0) + 1)
      if (keyId) sessoesPorProfissionalId.set(keyId, (sessoesPorProfissionalId.get(keyId) ?? 0) + 1)
    } else {
      livrePorProfissional.add(key)
      if (keyId) livrePorProfissionalId.add(keyId)
    }
  })

  // Mesmas linhas, mas agrupadas por HORÁRIO EXATO + PROFISSIONAL (dow|turno|
  // minutos|profissional), usado pra montar `blocos` ("Ocupação real" =
  // TD_AGENDADO/TD_EXISTENTE). Cada "cadeira" do bloco é amarrada à alocação
  // planejada daquele assento (ver loop abaixo) — só conta preenchida se ESSE
  // profissional específico tiver sessão real "Agendado" naquele horário exato.
  //
  // Cruza por `linhasUnidade` (não `linhasSala`), mesmo critério já usado acima
  // pra `sessoesPorProfissional`/`sessoesPorProfissionalId`: a TiTa não é
  // confiável pra registrar em qual sala física a sessão aconteceu (ex.:
  // Coordenador de Caso é sempre lançado numa sala genérica de "Coordenação",
  // nunca na sala onde a pessoa está fisicamente alocada). Exigir a sala exata
  // aqui fazia esses blocos aparecerem sempre "livre" mesmo com sessão real
  // acontecendo, subcontando a ocupação granular de qualquer sala que hospede
  // esse tipo de terapia. A hora exata continua sendo exigida (`minutos` na
  // chave) — só a exigência de sala exata foi relaxada.
  const sessoesPorHoraProfissionalId = new Map<string, AgendaSalaRow>()
  const sessoesPorHoraProfissional = new Map<string, AgendaSalaRow>()
  linhasUnidade.forEach(r => {
    const dow = dowDeDiaSemana(r.dia_semana)
    if (!dow) return
    if (!normTxt(r.status_agendamento).includes("agendado")) return
    const minutos = pm(r.hora_inicial)
    if (minutos === null) return
    const turno = turnoDoHorario(minutos)
    const chaveHora = `${dow}|${turno}|${minutos}`
    if (r.profissional_id !== null && r.profissional_id !== undefined) {
      sessoesPorHoraProfissionalId.set(`${chaveHora}|${r.profissional_id}`, r)
    }
    const prof = cleanTxt(r.profissional_nome)
    if (prof) sessoesPorHoraProfissional.set(`${chaveHora}|${normTxt(prof)}`, r)
  })

  const alocacoesPorSlot = new Map<string, AlocacaoSala[]>()
  alocacoesSala.forEach(a => {
    const key = `${a.dow}-${a.turno}`
    if (!alocacoesPorSlot.has(key)) alocacoesPorSlot.set(key, [])
    alocacoesPorSlot.get(key)!.push(a)
  })

  const slots: SlotOcupacaoSala[] = []
  const diasDaSala = sala.dias_disponiveis?.length ? sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO
  for (const { dow, turnos } of diasDaSala) {
    for (const turno of turnos) {
      const key = `${dow}-${turno}`
      const alocacoesDoSlot = alocacoesPorSlot.get(key) ?? []
      // Override opcional de horários (sala/dia/turno com duração de sessão
      // diferente do padrão do sistema, ex.: sábado da Equoterapia em
      // Movimento — 30min em vez dos 40min de HORAS_POR_TURNO). Ausência de
      // chave = grid padrão, comportamento 100% igual ao de antes.
      const horasTurno = sala.horarios_customizados?.[chaveHorarioCustomizado(dow, turno)] ?? HORAS_POR_TURNO[turno]
      const capacidadeBloco = horasTurno.length

      const cards: AlocacaoCardSlot[] = alocacoesDoSlot.map(a => {
        const sessoesReais = (a.profissional_id !== null ? sessoesPorProfissionalId.get(`${dow}|${turno}|${a.profissional_id}`) : undefined)
          ?? sessoesPorProfissional.get(`${dow}|${turno}|${normTxt(a.profissional_nome)}`)
          ?? 0
        const sessoesLimitadas = Math.min(sessoesReais, capacidadeBloco)
        // "Tem agenda na TiTa" é mais amplo que "tem sessão real": inclui
        // horário 'Livre' reservado pro profissional, mesmo sem paciente
        // marcado ainda — ver comentário de livrePorProfissionalId acima.
        const temAgendaTita = sessoesReais > 0
          || (a.profissional_id !== null && livrePorProfissionalId.has(`${dow}|${turno}|${a.profissional_id}`))
          || livrePorProfissional.has(`${dow}|${turno}|${normTxt(a.profissional_nome)}`)
        const verificacao = verificarExclusividade(sala.id, a.terapia_id, indiceExclusividade, nomeDaSalaPorId)
        return {
          alocacaoId: a.id,
          profissionalNome: a.profissional_nome,
          terapiaNome: a.terapia_nome,
          sessoesReais: sessoesLimitadas,
          sessoesCapacidadeTurno: capacidadeBloco,
          pctOcupacao: capacidadeBloco > 0 ? sessoesLimitadas / capacidadeBloco : null,
          semCruzamentoCsv: !temAgendaTita,
          violacaoExclusividade: verificacao.status === "bloqueado" ? { direcao: verificacao.direcao, motivo: verificacao.motivo } : null,
        }
      })

      const status = statusDoSlot(sala.status, capacidadeProjetada, cards.length)
      const inconsistente = sala.status === "operacional" && cards.length > capacidadeProjetada
      const violaExclusividade = cards.some(c => c.violacaoExclusividade !== null)

      // Blocos de 40min, um por "cadeira" (vaga simultânea, até capacidadeProjetada)
      // × horário oficial do turno. Cada cadeira corresponde à alocação planejada
      // daquele assento (`alocacoesDoSlot[seat]`) — uma cadeira sem ninguém
      // alocado nunca aparece preenchida. "Preenchido" = esse profissional
      // específico tem sessão real "Agendado" na UNIDADE, nesse dia/turno/
      // horário EXATO (ver comentário de `sessoesPorHoraProfissional*` acima —
      // não exige mais a sala exata). Cadeiras além da capacidade (alocação
      // excedente, já sinalizado por `inconsistente`) não geram bloco — o
      // denominador continua limitado à capacidade física da sala.
      // Duração de cada bloco: gap entre os 2 primeiros horários da própria
      // grade em uso (padrão ou customizada) — 40min no grid padrão (igual
      // sempre foi), ou o passo customizado (ex.: 30min) quando houver override.
      const duracaoBloco = horasTurno.length >= 2 ? (pm(horasTurno[1])! - pm(horasTurno[0])!) : 40
      const blocos: BlocoOcupacaoSlot[] = []
      for (const hora of horasTurno) {
        const minutos = pm(hora) ?? 0
        const horaFim = fm(minutos + duracaoBloco)
        const chaveHora = `${dow}|${turno}|${minutos}`
        for (let seat = 0; seat < capacidadeProjetada; seat++) {
          const alocacao = alocacoesDoSlot[seat]
          const linhaReal = alocacao
            ? (alocacao.profissional_id !== null ? sessoesPorHoraProfissionalId.get(`${chaveHora}|${alocacao.profissional_id}`) : undefined)
              ?? sessoesPorHoraProfissional.get(`${chaveHora}|${normTxt(alocacao.profissional_nome)}`)
            : undefined
          blocos.push(linhaReal ? {
            hora, horaFim,
            profissional: alocacao!.profissional_nome,
            terapia: alocacao!.terapia_nome ?? (cleanTxt(linhaReal.terapia_nome) || cleanTxt(linhaReal.terapia_exibicao_nome) || null),
            idAgendamento: linhaReal.tita_agendamento_id ?? null,
            status: "preenchido",
          } : {
            hora, horaFim,
            profissional: null,
            terapia: null,
            idAgendamento: null,
            status: "livre",
          })
        }
      }

      slots.push({
        salaId: sala.id,
        dow,
        turno,
        capacidadeProjetada,
        alocacoes: cards,
        status,
        inconsistente,
        violaExclusividade,
        blocos,
      })
    }
  }

  return slots
}

/** Resolve um `sala_id` em rótulo legível ("Unidade · Nome de exibição") — usado nas mensagens de violação de exclusividade. */
export function construirNomeDaSalaPorId(salas: Sala[]): (salaId: string) => string {
  const porId = new Map(salas.map(s => [s.id, `${s.unidade_nome} · ${s.nome_exibicao}`]))
  return (salaId: string) => porId.get(salaId) ?? "sala removida"
}

export function calcularOcupacaoDaSala(
  sala: Sala,
  alocacoes: AlocacaoSala[],
  linhas: AgendaSalaRow[],
  indiceExclusividade: IndiceExclusividadeTerapia = INDICE_EXCLUSIVIDADE_VAZIO,
  nomeDaSalaPorId: (salaId: string) => string = id => id,
): SalaComOcupacao {
  const linhasSala = linhasDaSala(sala, linhas)
  const linhasUnidade = linhasDaUnidade(sala, linhas)
  const alocacoesSala = alocacoes.filter(a => a.sala_id === sala.id)
  const slots = calcularSlotsDaSala(sala, alocacoesSala, linhasSala, linhasUnidade, indiceExclusividade, nomeDaSalaPorId)
  const relevantes = slots.filter(s => !STATUS_SLOT_EXCLUIDO.includes(s.status))
  const ocupados = relevantes.filter(s => s.status === "ocupado" || s.status === "parcial").length
  const pctOcupacaoSemanal = relevantes.length > 0 ? ocupados / relevantes.length : null
  return { sala, slots, pctOcupacaoSemanal }
}

// ─── RESUMO POR UNIDADE (adaptado de calcularResumoSalas) ────────────────────

export function calcularResumoUnidades(salas: Sala[], alocacoes: AlocacaoSala[], linhas: AgendaSalaRow[], exclusividades: SalaTerapiaExclusiva[] = []): ResumoUnidadeSalas[] {
  const indiceExclusividade = construirIndiceExclusividadeTerapia(exclusividades)
  const nomeDaSalaPorId = construirNomeDaSalaPorId(salas)
  const porUnidade = new Map<string, Sala[]>()
  salas.forEach(s => {
    const unidade = normalizarUnidadeOcupacao(s.unidade_nome)
    if (!porUnidade.has(unidade)) porUnidade.set(unidade, [])
    porUnidade.get(unidade)!.push(s)
  })

  const resumos: ResumoUnidadeSalas[] = []

  porUnidade.forEach((salasUnidade, unidade) => {
    let slotsTotal = 0, slotsOcupados = 0, slotsLivres = 0, slotsBloqueados = 0
    let blocosTotal = 0, blocosPreenchidos = 0
    let capacidadeSimultanea = 0
    let salasAtivas = 0
    const porStatus: Record<string, number> = {}
    let inconsistencias = 0
    const salasPorCapacidade: Record<SalaCapacidade, number> = { unico: 0, duplo: 0, multiplo: 0 }
    const porTurnoAcc: Record<"Manhã" | "Tarde", ResumoTurnoUnidadeSalas> = {
      Manhã: { turno: "Manhã", slotsTotal: 0, slotsOcupados: 0, slotsLivres: 0, slotsBloqueados: 0, pct: null, blocosTotal: 0, blocosPreenchidos: 0, pctGranular: null },
      Tarde: { turno: "Tarde", slotsTotal: 0, slotsOcupados: 0, slotsLivres: 0, slotsBloqueados: 0, pct: null, blocosTotal: 0, blocosPreenchidos: 0, pctGranular: null },
    }
    const terapiaAcc = new Map<string, number>()

    salasUnidade.forEach(sala => {
      if (sala.status === "operacional") salasAtivas++
      else porStatus[sala.status] = (porStatus[sala.status] ?? 0) + 1
      capacidadeSimultanea += capacidadeProjetadaSala(sala.capacidade, sala.status)
      salasPorCapacidade[sala.capacidade]++

      const { slots } = calcularOcupacaoDaSala(sala, alocacoes, linhas, indiceExclusividade, nomeDaSalaPorId)
      slots.forEach(slot => {
        if (slot.status === "inativo") return
        const turnoBucket = porTurnoAcc[slot.turno]
        if (slot.status === "bloqueado") {
          slotsBloqueados++
          turnoBucket.slotsBloqueados++
          return
        }
        slotsTotal++
        turnoBucket.slotsTotal++
        if (slot.status === "ocupado" || slot.status === "parcial") {
          slotsOcupados++
          turnoBucket.slotsOcupados++
        } else {
          slotsLivres++
          turnoBucket.slotsLivres++
        }
        if (slot.inconsistente || slot.violaExclusividade) inconsistencias++

        // Ocupação granular: soma direto de slot.blocos (já calculado bloco a
        // bloco, por horário EXATO, em calcularSlotsDaSala) — mesma fonte lida
        // pelo drill-down (listarBlocosDetalhados), então o StatCard nunca
        // diverge da lista de auditoria.
        blocosTotal += slot.blocos.length
        blocosPreenchidos += slot.blocos.filter(b => b.status === "preenchido").length
        turnoBucket.blocosTotal += slot.blocos.length
        turnoBucket.blocosPreenchidos += slot.blocos.filter(b => b.status === "preenchido").length

        slot.alocacoes.forEach(card => {
          const terapia = cleanTxt(card.terapiaNome) || "Sem especialidade"
          terapiaAcc.set(terapia, (terapiaAcc.get(terapia) ?? 0) + Math.max(card.sessoesReais, 1))
        })
      })
    })

    ;(["Manhã", "Tarde"] as const).forEach(t => {
      const b = porTurnoAcc[t]
      b.pct = b.slotsTotal > 0 ? b.slotsOcupados / b.slotsTotal : null
      b.pctGranular = b.blocosTotal > 0 ? b.blocosPreenchidos / b.blocosTotal : null
    })

    resumos.push({
      unidade,
      salasTotal: salasUnidade.length,
      salasAtivas,
      porStatus,
      salasPorCapacidade,
      capacidadeSimultanea,
      slotsTotal,
      slotsOcupados,
      slotsLivres,
      slotsBloqueados,
      pct: slotsTotal > 0 ? slotsOcupados / slotsTotal : null,
      porTurno: [porTurnoAcc.Manhã, porTurnoAcc.Tarde],
      porTerapia: [...terapiaAcc.entries()]
        .map(([terapia, sessoes]) => ({ terapia, sessoes }))
        .sort((a, b) => b.sessoes - a.sessoes),
      inconsistencias,
      blocosTotal,
      blocosPreenchidos,
      pctGranular: blocosTotal > 0 ? blocosPreenchidos / blocosTotal : null,
    })
  })

  return resumos.sort((a, b) => a.unidade.localeCompare(b.unidade))
}

// ─── DRILL-DOWN DE AUDITORIA (StatCards "X/Y ocupados"/"X/Y preenchidos") ────
// Ambas as funções abaixo recebem `salasComOcupacao` já calculado (pelo hook
// useOcupacaoSalas, via calcularOcupacaoDaSala) — não refazem nenhum cálculo,
// só filtram por unidade/turno e "achatam" os slots em linhas de tabela.
// Mesmo critério de exclusão de calcularResumoUnidades: fora "adm"/"bloqueado".

/** Linhas do drill-down binário — 1 linha por slot (sala×dia), pro StatCard "X/Y ocupados". */
export function listarSlotsDetalhados(
  salasComOcupacao: SalaComOcupacao[],
  unidade: string,
  turno: "Manhã" | "Tarde",
): SlotDetalhado[] {
  const unidadeAlvo = normalizarUnidadeOcupacao(unidade)
  const linhas: SlotDetalhado[] = []

  salasComOcupacao.forEach(({ sala, slots }) => {
    if (normalizarUnidadeOcupacao(sala.unidade_nome) !== unidadeAlvo) return
    slots.forEach(slot => {
      if (slot.turno !== turno) return
      if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
      linhas.push({
        sala: sala.nome_exibicao,
        dow: slot.dow,
        diaLabel: DOW_PT[slot.dow] ?? String(slot.dow),
        status: slot.status as "ocupado" | "parcial" | "livre",
        alocacoes: slot.alocacoes.map(a => ({
          profissional: a.profissionalNome,
          terapia: a.terapiaNome,
          sessoesReais: a.sessoesReais,
          sessoesCapacidadeTurno: a.sessoesCapacidadeTurno,
        })),
      })
    })
  })

  return linhas
}

/** Linhas do drill-down granular — 1 linha por bloco de 40min, pro StatCard "X/Y preenchidos". */
export function listarBlocosDetalhados(
  salasComOcupacao: SalaComOcupacao[],
  unidade: string,
  turno: "Manhã" | "Tarde",
): BlocoDetalhado[] {
  const unidadeAlvo = normalizarUnidadeOcupacao(unidade)
  const linhas: BlocoDetalhado[] = []

  salasComOcupacao.forEach(({ sala, slots }) => {
    if (normalizarUnidadeOcupacao(sala.unidade_nome) !== unidadeAlvo) return
    slots.forEach(slot => {
      if (slot.turno !== turno) return
      if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
      slot.blocos.forEach(bloco => {
        linhas.push({
          ...bloco,
          sala: sala.nome_exibicao,
          dow: slot.dow,
          diaLabel: DOW_PT[slot.dow] ?? String(slot.dow),
        })
      })
    })
  })

  return linhas
}

export interface ResumoOcupacaoItens {
  slotsTotal: number
  slotsOcupados: number
  slotsBloqueados: number
  inconsistencias: number
  pct: number | null
}

/**
 * Agrega slotsTotal/slotsOcupados/inconsistências a partir de QUALQUER lista de
 * SalaComOcupacao (ex.: já filtrada por unidade/núcleo/turno/status na UI) —
 * mesma regra usada por calcularResumoUnidades (ignora slots "adm", conta
 * "bloqueado" à parte do total), só que sobre um subconjunto arbitrário em vez
 * de agrupar por unidade.
 */
export function resumoOcupacaoDeItens(itens: SalaComOcupacao[]): ResumoOcupacaoItens {
  let slotsTotal = 0, slotsOcupados = 0, slotsBloqueados = 0, inconsistencias = 0

  itens.forEach(item => {
    item.slots.forEach(slot => {
      if (slot.status === "inativo") return
      if (slot.status === "bloqueado") {
        slotsBloqueados++
        return
      }
      slotsTotal++
      if (slot.status === "ocupado" || slot.status === "parcial") slotsOcupados++
      if (slot.inconsistente || slot.violaExclusividade) inconsistencias++
    })
  })

  return {
    slotsTotal,
    slotsOcupados,
    slotsBloqueados,
    inconsistencias,
    pct: slotsTotal > 0 ? slotsOcupados / slotsTotal : null,
  }
}

/**
 * Sugere números de sala livres para uma unidade, a partir dos números já em
 * uso (`uq_cronograma_salas_unidade_numero` é único por unidade+número, então
 * digitar um número ocupado sempre falha no salvar). Prioriza os "buracos" na
 * sequência (ex.: já tem 1,2,3,5 → sugere o 4 primeiro) e complementa com os
 * próximos números seguidos após o maior já cadastrado, até `maxSugestoes`.
 * Números de sala não numéricos (texto livre) são ignorados na sequência —
 * não têm como participar de um "próximo número".
 */
export function sugerirNumerosSalaDisponiveis(numerosUsados: string[], maxSugestoes = 10): number[] {
  const usados = new Set(
    numerosUsados
      .map(n => parseInt(normNumeroSala(n), 10))
      .filter((n): n is number => Number.isFinite(n) && n > 0),
  )
  if (!usados.size) return Array.from({ length: maxSugestoes }, (_, i) => i + 1)

  const maior = Math.max(...usados)
  const buracos: number[] = []
  for (let i = 1; i < maior; i++) {
    if (!usados.has(i)) buracos.push(i)
  }

  const seguintes: number[] = []
  for (let i = maior + 1; seguintes.length < maxSugestoes; i++) {
    seguintes.push(i)
  }

  return [...buracos, ...seguintes]
}

export function textoFaixaOcupacaoSala(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "Sem base"
  const p = Number(pct) > 1 ? Number(pct) / 100 : Number(pct)
  if (p >= 0.8) return "80% a 100%"
  if (p >= 0.6) return "60% a 79%"
  if (p >= 0.4) return "40% a 59%"
  return "0% a 39%"
}
