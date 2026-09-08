// ─── Disponibilidade interna (Tarefa 4) ────────────────────────────────────────
// Um profissional já contratado pode estar livre exatamente no horário que se
// cogitaria abrir vaga de contratação. Mesmo padrão de detecção de "livre" já
// usado em saida.ts (Status do Agendamento === "Livre").
//
// listarOportunidadesDiretas é a FONTE ÚNICA de "quantos pacientes já têm
// cobertura direta" — usada tanto pela tela "Ocupar Profissionais
// Disponíveis" (lista navegável por profissional) quanto pelo desconto de
// disponibilidade interna na simulação de contratação
// (sugestaoContratacao.ts). Antes as duas tinham lógicas independentes que
// podiam divergir: a tela listava TODOS os candidatos elegíveis em CADA linha
// de profissional livre (sem descontar que só 1 paciente ocupa cada vaga), e
// a simulação só contava profissionais livres sem saber se aquela capacidade
// já estava reservada por um paciente real. Consolidado aqui: casa cada
// profissional livre com no máximo 1 paciente, respeitando o gap de cada um
// GLOBALMENTE (mesmo paciente não conta em mais vagas do que pode aceitar).

import { agendaClinica, avaliarPeriodo, type CandidatoSlot, type GapItem, type Turno } from "./simulacaoNovoPrestador"
import { turnoFromHora } from "./helpers"
import { TERAPIA_TO_ESP, normTxt } from "./constants"
import type { CsvRow } from "@/types/cronograma"

/**
 * Unidade que domina o dia do paciente, contando as sessões "Agendado" dele
 * naquele dia — usada só pela tela "Ocupar Profissionais Disponíveis"
 * (ocupacaoCategoria.ts/ocupacaoProfissional.ts), NUNCA pela Simulação de
 * Novo Prestador nem por sugestaoContratacao.ts (que chamam avaliarPeriodo/
 * encontrarCandidatosRemanejamento diretamente, sem passar por aqui).
 *
 * Corrige um caso real: um paciente pode ter, por uma troca de agenda pontual,
 * 1 sessão isolada numa unidade e o resto do dia inteiro noutra (ex.: só a
 * Psicologia de terça virou Fazendinha, o resto do dia continua Realengo). A
 * checagem "o paciente já tem ALGUMA sessão nessa unidade nesse dia" (usada
 * em pacientesQueFrequentamUnidade/pacientesDaUnidadeNoDia) sozinha deixa
 * esse paciente virar candidato pra QUALQUER vaga da unidade minoritária —
 * exatamente o que essa função evita, exigindo que a unidade da vaga seja a
 * mesma que já concentra a maioria das sessões do paciente naquele dia.
 * Sem maioria clara (empate), retorna null e o candidato não é filtrado aqui
 * (a decisão fica pra outra regra, ex.: sequenciamento por horário).
 */
function dominanteEm<T>(linhas: CsvRow[], chave: (r: CsvRow) => T): T | null {
  const contagem = new Map<T, number>()
  for (const r of linhas) {
    const k = chave(r)
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  let melhor: T | null = null
  let max = 0
  let empatado = false
  for (const [k, n] of contagem) {
    if (n > max) { max = n; melhor = k; empatado = false }
    else if (n === max) { empatado = true }
  }
  return empatado ? null : melhor
}

// "AT Externo" (Técnico Terapêutico Particular em casa/escola) não é uma
// unidade física — é atendimento domiciliar, tipicamente com várias sessões
// recorrentes por dia. Contar essas linhas aqui inflava artificialmente a
// "unidade dominante" pra "AT Externo" em pacientes com essa rotina, mesmo
// quando toda a agenda clínica real deles num dia é 100% Realengo/Fazendinha/
// Padre Miguel — rejeitando candidatos válidos que a Simulação de Novo
// Prestador (que não passa por essas funções) continuava encontrando
// corretamente. Bug real encontrado 2026-08-17 (caso Lucas Teixeira Vieira).
function agendaClinicaComUnidadeFisica(cRows: CsvRow[]): CsvRow[] {
  return agendaClinica(cRows).filter(r => String(r.Unidade || "Desconhecida") !== "AT Externo")
}

export function unidadeDominanteDoDia(pac: string, dia: string, cRows: CsvRow[]): string | null {
  return dominanteEm(agendaClinicaComUnidadeFisica(cRows).filter(r => r["Nome Favorecido"] === pac && r["Dia da Semana"] === dia), r => String(r.Unidade || "Desconhecida"))
}

/**
 * Variante de unidadeDominanteDoDia pra semana INTEIRA — usada pela
 * modalidade "Novo Dia" (novoDia.ts): o paciente só pode ganhar um dia
 * totalmente novo na mesma unidade que já concentra a maioria dos OUTROS
 * dias da semana dele, já que ele ainda não frequenta o dia em questão (não
 * haveria "maioria do dia" a calcular ali). Sem sessão nenhuma na semana
 * (paciente novo/sem agenda ainda) = sem restrição (retorna null). Mesmo
 * critério de empate de unidadeDominanteDoDia: empate -> null.
 */
export function unidadeDominantePaciente(pac: string, cRows: CsvRow[]): string | null {
  return dominanteEm(agendaClinicaComUnidadeFisica(cRows).filter(r => r["Nome Favorecido"] === pac), r => String(r.Unidade || "Desconhecida"))
}

/**
 * Turno (manhã/tarde) que domina a semana do paciente — mesmo princípio de
 * unidadeDominantePaciente, mas por turno em vez de unidade: usada pela
 * modalidade "Novo Dia" pra nunca oferecer um dia novo num turno que o
 * paciente não costuma frequentar (ex.: paciente só vem de manhã a semana
 * toda, não faz sentido oferecer um dia novo à tarde só porque a vaga do
 * profissional caiu nesse turno). Sem sessão nenhuma na semana ou empate
 * exato manhã×tarde = sem restrição (retorna null).
 */
export function turnoDominantePaciente(pac: string, cRows: CsvRow[]): Turno | null {
  return dominanteEm(agendaClinicaComUnidadeFisica(cRows).filter(r => r["Nome Favorecido"] === pac), r => turnoFromHora(String(r.HI_str || "")))
}

// Dentro do balde "Psicologia ABA" (que soma Aplicador ABA PS/SF/AV/AE/EF,
// Supervisão ABA e Coordenador de Caso pra fins de OFERTADO/gap — ver
// calcularGaps em simulacaoNovoPrestador.ts), só Aplicador ABA (PS) e (EF)
// são papéis realmente intercambiáveis com um novo aplicador contratado.
// As demais (SF, AV, AE, Supervisão, Coordenador de Caso) não podem ser
// tratadas como "vaga já livre internamente": Coordenador de Caso é vínculo
// de caso 1-para-1, Supervisão não é atendimento direto, e SF/AV/AE são
// papéis distintos que não cobrem a demanda de um Aplicador ABA comum.
const PSICOLOGIA_ABA_DISPONIVEL_INTERNAMENTE = new Set(["Aplicador ABA (PS)", "Aplicador ABA (EF)"])

export interface SlotLivre {
  profissional: string
  dia: string
  hora: string
  terapia: string
  especialidade: string | null
  unidade: string
}

// Um horário "Livre" pode servir mais de uma terapia — a view traz isso como
// uma única string separada por vírgula (ex.: "Aplicador ABA (AE), Aplicador
// ABA (HS), Psicopedagogia"). Split aqui e emite 1 SlotLivre por especialidade
// distinta que o horário realmente cobre, em vez de tentar casar a string
// inteira em TERAPIA_TO_ESP (que nunca bate e derruba o slot pra null — bug
// real encontrado 2026-08-18, caso Amanda Martins Rodrigues: profissional com
// disponibilidade real sumia da lista "Ocupar Profissionais Disponíveis").
// Achado 2026-08-20 (caso Marcia Regina Araujo de Paula, Fonoaudiologia): a TiTa
// mantém uma linha por terapia ofertada, então quando um horário do profissional é
// preenchido as OUTRAS linhas dele no mesmo dia/hora podem continuar "Livre" — seja
// por atraso de sincronização, seja pelo formato do CSV. Sem esta trava, um
// profissional já ocupado (inclusive por "Horário Bloqueado"/PACS_ADMIN) reaparecia
// como disponível aqui. Mesma trava de profOcupado em OcupPacMode.tsx — usa TODAS as
// linhas "Agendado" de cRows, sem filtrar por paciente, exatamente pelo mesmo motivo.
function construirProfOcupado(cRows: CsvRow[]): Set<string> {
  const ocupado = new Set<string>()
  for (const r of cRows) {
    if (r["Status do Agendamento"] !== "Agendado" || !r["Profissional"]) continue
    ocupado.add(`${normTxt(r["Profissional"])}|||${r["Dia da Semana"]}|||${String(r.HI_str || "")}`)
  }
  return ocupado
}

export interface OpcoesSlotsLivres {
  /** Quando true, um horário "Livre" de terapia bruta "Coordenador de Caso"
   *  deixa de ser descartado como "isolado" (ver PSICOLOGIA_ABA_DISPONIVEL_
   *  INTERNAMENTE acima) e passa a gerar um SlotLivre com
   *  especialidade "Psicologia ABA" (mesma chave usada por calcularGaps, pra
   *  reusar o gap/CH e o sequenciamento já existentes) preservando
   *  terapia: "Coordenador de Caso" pra quem precisar filtrar só esses
   *  horários depois (ver ocupacaoCategoria.ts). Usado só pela tab "Por
   *  Unidade, Dia e Especialidade" quando a especialidade escolhida é
   *  "Coordenador de Caso" — default false preserva o comportamento atual
   *  em todos os outros consumidores (tab "Por Nome", Simulação de Novo
   *  Prestador). */
  incluirCoordCaso?: boolean
}

export function listarSlotsLivres(cRows: CsvRow[], opts?: OpcoesSlotsLivres): SlotLivre[] {
  const profOcupado = construirProfOcupado(cRows)
  return cRows
    .filter(r =>
      r["Status do Agendamento"] === "Livre" && r["Profissional"]
      && !profOcupado.has(`${normTxt(r["Profissional"])}|||${r["Dia da Semana"]}|||${String(r.HI_str || "")}`),
    )
    .flatMap((r): SlotLivre[] => {
      const base = {
        profissional: r["Profissional"],
        dia: r["Dia da Semana"],
        hora: String(r.HI_str || ""),
        unidade: String(r.Unidade || "Desconhecida"),
      }
      const terapiasBrutas = String(r.Terapia || "").split(",").map(t => t.trim()).filter(Boolean)
      const porEspecialidade = new Map<string, string>() // especialidade -> terapia bruta que a gerou
      for (const terapiaBruta of terapiasBrutas) {
        const esp = TERAPIA_TO_ESP[terapiaBruta] ?? null
        if (!esp) continue
        const isolado = esp === "Psicologia ABA" && !PSICOLOGIA_ABA_DISPONIVEL_INTERNAMENTE.has(terapiaBruta)
          && !(opts?.incluirCoordCaso && terapiaBruta === "Coordenador de Caso")
        if (isolado) continue
        if (!porEspecialidade.has(esp)) porEspecialidade.set(esp, terapiaBruta)
      }
      if (porEspecialidade.size === 0) {
        return [{ ...base, terapia: r.Terapia, especialidade: null }]
      }
      return [...porEspecialidade.entries()].map(([especialidade, terapia]) => ({ ...base, terapia, especialidade }))
    })
}

export interface OportunidadeDireta {
  profissional: string
  dia: string
  turno: "manha" | "tarde"
  hora: string
  unidade: string
  terapia: string
  especialidade: string
  paciente: CandidatoSlot
}

function chaveGrupo(dia: string, hora: string, unidade: string, especialidade: string): string {
  return `${dia}|||${hora}|||${unidade}|||${especialidade}`
}

/** Casa cada profissional livre (Status "Livre") com no máximo 1 paciente
 *  elegível — nunca lista o mesmo paciente como "coberto" em mais vagas do
 *  que o gap dele permite, e nunca atribui mais pacientes a um horário do que
 *  profissionais realmente livres ali. */
export function listarOportunidadesDiretas(
  cRows: CsvRow[], gapMap: Record<string, GapItem>, opts?: OpcoesSlotsLivres,
): OportunidadeDireta[] {
  const slotsLivres = listarSlotsLivres(cRows, opts).filter((s): s is SlotLivre & { especialidade: string } => !!s.especialidade)

  const porGrupo = new Map<string, SlotLivre[]>()
  for (const s of slotsLivres) {
    const chave = chaveGrupo(s.dia, s.hora, s.unidade, s.especialidade)
    if (!porGrupo.has(chave)) porGrupo.set(chave, [])
    porGrupo.get(chave)!.push(s)
  }

  // avaliarPeriodo já calcula os candidatos de TODAS as horas do turno de uma
  // vez (retorna `slots`, 1 por hora) — sem este cache, grupos de horas
  // diferentes dentro do mesmo dia/unidade/especialidade/turno chamavam
  // avaliarPeriodo de novo cada um, recomputando o turno inteiro repetidas
  // vezes só pra extrair uma hora diferente do MESMO resultado. Crítico pra
  // rankearOportunidadesInternas (ocupacaoCategoria.ts), que soma esse custo
  // por cada combinação unidade×dia×especialidade da varredura.
  const periodoPorTurno = new Map<string, ReturnType<typeof avaliarPeriodo>>()
  const candidatosPorGrupo = new Map<string, CandidatoSlot[]>()
  for (const chave of porGrupo.keys()) {
    const [dia, hora, unidade, especialidade] = chave.split("|||")
    const turno = turnoFromHora(hora)
    const chaveTurno = `${dia}|||${unidade}|||${especialidade}|||${turno}`
    let periodo = periodoPorTurno.get(chaveTurno)
    if (!periodo) {
      periodo = avaliarPeriodo(dia, turno, unidade, especialidade, cRows, gapMap)
      periodoPorTurno.set(chaveTurno, periodo)
    }
    candidatosPorGrupo.set(chave, periodo.slots.find(sl => sl.hora === hora)?.candidatos ?? [])
  }

  // Teto de gap por paciente+especialidade, GLOBAL entre todos os grupos —
  // mesmo princípio de limitarCandidatosPorGap (simulacaoNovoPrestador.ts):
  // corta primeiro onde o paciente tem mais alternativas (mais substituível).
  interface Ocorrencia { chave: string; alternativas: number }
  const ocorrenciasPorPacienteEsp = new Map<string, Ocorrencia[]>()
  for (const [chave, candidatos] of candidatosPorGrupo) {
    const especialidade = chave.split("|||")[3]
    for (const c of candidatos) {
      const chavePac = `${c.pac}|||${especialidade}`
      const lista = ocorrenciasPorPacienteEsp.get(chavePac) ?? []
      lista.push({ chave, alternativas: candidatos.length - 1 })
      ocorrenciasPorPacienteEsp.set(chavePac, lista)
    }
  }
  const excluir = new Set<string>() // chave|||pac
  for (const [chavePac, ocorrencias] of ocorrenciasPorPacienteEsp) {
    const [pac, especialidade] = chavePac.split("|||")
    const gap = gapMap[`${pac}|||${especialidade}`]?.gap ?? 0
    if (ocorrencias.length <= gap) continue
    const excedentes = [...ocorrencias].sort((a, b) => a.alternativas - b.alternativas).slice(gap)
    for (const e of excedentes) excluir.add(`${e.chave}|||${pac}`)
  }

  // Um horário "Livre" que serve mais de 1 especialidade (ver listarSlotsLivres)
  // aparece em mais de um grupo aqui — sem essa trava, o MESMO horário físico
  // podia ser pareado com um paciente pela especialidade A e, no grupo
  // seguinte, com outro paciente pela especialidade B (double-booking do
  // mesmo slot real). Uma vez usado por qualquer grupo, some dos demais.
  const chaveSlotFisico = (s: SlotLivre) => `${s.profissional}|||${s.dia}|||${s.hora}|||${s.unidade}`
  const slotFisicoUsado = new Set<string>()

  const oportunidades: OportunidadeDireta[] = []
  for (const [chave, profissionaisLivres] of porGrupo) {
    const [dia, hora, unidade, especialidade] = chave.split("|||")
    const turno = turnoFromHora(hora)
    const disponiveis = profissionaisLivres.filter(p => !slotFisicoUsado.has(chaveSlotFisico(p)))
    const sobreviventes = (candidatosPorGrupo.get(chave) ?? []).filter(c => !excluir.has(`${chave}|||${c.pac}`))
    const n = Math.min(disponiveis.length, sobreviventes.length)
    for (let i = 0; i < n; i++) {
      slotFisicoUsado.add(chaveSlotFisico(disponiveis[i]))
      oportunidades.push({
        profissional: disponiveis[i].profissional,
        dia, turno, hora, unidade,
        terapia: disponiveis[i].terapia,
        especialidade,
        paciente: sobreviventes[i],
      })
    }
  }
  return oportunidades
}

/** Quantos pacientes por dia/hora/unidade/especialidade já têm cobertura
 *  direta via `listarOportunidadesDiretas` — é essa cobertura que a simulação
 *  de contratação pode descontar da fila de quem precisaria do novo
 *  profissional (ver filtrarPorDisponibilidadeInterna em
 *  sugestaoContratacao.ts). Não é "sobra não utilizada": é o próprio número
 *  de pareamentos profissional-livre↔paciente que `listarOportunidadesDiretas`
 *  já fez pra esse grupo — a mesma fonte usada pela tela "Ocupar
 *  Profissionais Disponíveis", garantindo que os dois lugares nunca
 *  divirjam. */
export function capacidadeDiretaRestante(
  cRows: CsvRow[], gapMap: Record<string, GapItem>,
): Map<string, number> {
  const usadoPorGrupo = new Map<string, number>()
  for (const o of listarOportunidadesDiretas(cRows, gapMap)) {
    const chave = chaveGrupo(o.dia, o.hora, o.unidade, o.especialidade)
    usadoPorGrupo.set(chave, (usadoPorGrupo.get(chave) ?? 0) + 1)
  }
  return usadoPorGrupo
}

/** Quantos profissionais "Livre" existem, de fato, por dia+hora+unidade+
 *  especialidade — um fato físico, independente de listarOportunidadesDiretas
 *  ter conseguido formar par com algum paciente ali. capacidadeDiretaRestante
 *  só conta PARES já formados pelo motor Direto, que às vezes rejeita o único
 *  paciente elegível daquele grupo por critério próprio (ex.: sequenciamento
 *  de horário) mesmo com um profissional de verdade livre ali — nesse caso o
 *  Remanejamento pode resolver o MESMO paciente reorganizando a agenda dele,
 *  e o profissional livre "sobra" sem nenhum par Direto, mas continua sendo
 *  cobertura real (sugestaoContratacao.ts usa a diferença entre esta função e
 *  capacidadeDiretaRestante pra reconhecer essa cobertura extra pros
 *  candidatos de remanejamento — bug real 2026-08-17, caso "Davi Dantas"). */
export function capacidadeLivrePorGrupo(cRows: CsvRow[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const s of listarSlotsLivres(cRows)) {
    if (!s.especialidade) continue
    const chave = chaveGrupo(s.dia, s.hora, s.unidade, s.especialidade)
    mapa.set(chave, (mapa.get(chave) ?? 0) + 1)
  }
  return mapa
}
