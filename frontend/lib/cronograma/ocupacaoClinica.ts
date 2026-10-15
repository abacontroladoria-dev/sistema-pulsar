// ─── OCUPAÇÃO CLÍNICA: CADA VAGA DE 40 MIN EM UMA SITUAÇÃO ───────────────────
// Motor da aba Indicadores › Ocupação Clínica (UnidadeDashboardShell).
//
// A unidade de medida é a "vaga": o lugar de UM PROFISSIONAL atendendo numa sala em um
// horário da grade (40 min no padrão) — não um paciente: sessão em grupo (um
// profissional, vários pacientes) é 1 vaga. Sala individual tem 1 vaga por
// horário, dupla 2, múltipla 3. É exatamente o `slot.blocos` que
// calcularSlotsDaSala já monta — aqui só classificamos cada bloco em UMA de
// cinco situações:
//
//   paciente        a vaga tem profissional reservado e a sessão "Agendado"
//                   dele cai nesse horário exato (= bloco "preenchido")
//   aberta          tem profissional, sem paciente, e ele tem horário 'Livre'
//                   no TiTa cobrindo esse horário, na mesma unidade
//   administrativo  tem profissional, sem paciente, e ele está em "Horário
//                   Administrativo"/"Horário Bloqueado" no TiTa
//   regularizar     tem profissional reservado e nada no TiTa nesse horário
//                   (a reserva da sala e a agenda divergem) — ver
//                   MotivoReservaSemAgenda para os dois casos
//   vazia           ninguém reservado nessa vaga
//
// Por construção: paciente ≤ comProfissional ≤ total, e as cinco somam o
// total. "% com paciente" é o MESMO número de `pctGranular` (Ocupação real),
// e "% com profissional" é medido por vaga — não por sala inteira no turno,
// como o `pct` binário de calcularResumoUnidades.
//
// Feriados (`fechamentos`): o horário fechado sai da conta — nem a vaga nem a
// sessão recorrente que o TiTa ainda mostra nesse dia contam. Assim uma
// semana com feriado continua comparável com qualquer outra, sem aviso.
//
// Não busca nada: recebe o que useOcupacaoSalas já tem em memória
// (salasComOcupacao, linhas, turnosBloqueioAdmin) + os fechamentos da semana.

import { normalizarUnidadeOcupacao } from "./ocupacaoProf"
import { dowDeDiaSemana, parseSalaAgenda } from "./salas"
import { pm, cleanTxt } from "./helpers"
import { normTxt, HORAS_GRID } from "./constants"
import { DOW_PT } from "./ocupacaoConst"
import { STATUS_SLOT_EXCLUIDO, capacidadeProjetadaSala } from "./salasTypes"
import type { AgendaSalaRow, SalaCapacidade, SalaComOcupacao } from "./salasTypes"

export type TurnoClinica = "Manhã" | "Tarde"
export type SituacaoCadeira = "paciente" | "aberta" | "administrativo" | "regularizar" | "vazia"

/** Ordem fixa da barra: do uso mais pleno ao espaço vazio. */
export const SITUACOES_CADEIRA: readonly SituacaoCadeira[] = ["paciente", "aberta", "administrativo", "regularizar", "vazia"]

/**
 * Os dois casos de "reservada sem agenda", que pedem ações diferentes:
 *  semAgendaNoTurno  o profissional não tem NADA no TiTa no turno inteiro
 *                    (reserva parada: saiu do turno, mudou de horário…) —
 *                    tirar da sala ou abrir a agenda;
 *  foraDoHorario     ele atende nesse turno, mas a agenda é menor que a
 *                    reserva: a sala fica parada nos horários que sobram.
 */
export type MotivoReservaSemAgenda = "semAgendaNoTurno" | "foraDoHorario"

/** Vagas de 40 min que um profissional em tempo integral ocupa por semana (grade padrão × Seg–Sex). */
export const HORARIOS_TEMPO_INTEGRAL_SEMANA = HORAS_GRID.length * 5

/** Janela fechada de um dia da semana analisada (feriado integral ou parcial), em minutos. */
export interface FechamentoDia {
  dow: number
  inicio: number
  fim: number
  nome: string
}

export interface ContagemCadeiras {
  total: number
  paciente: number
  aberta: number
  administrativo: number
  regularizar: number
  vazia: number
}

export interface PendenciaProfissional {
  profissional: string
  terapia: string | null
  /** nº de vagas (ou de sessões, em "sem sala definida") */
  horarios: number
  salas: string[]
  /** Turnos envolvidos, já rotulados ("Ter · Manhã"), em ordem da semana. */
  turnos: string[]
}

export interface SalaDaUnidade {
  salaId: string
  sala: string
  contagem: ContagemCadeiras
}

export interface OcupacaoClinicaUnidade {
  unidade: string
  /** Unidade parceira (ex.: Campo Grande) — exibida à parte e fora do total da rede. */
  terceirizada: boolean
  salasTotal: number
  salasOperacionais: number
  /** Salas por status não-operacional, chaveado pelo código (adm/nti/bloqueada/…). */
  porStatus: Record<string, number>
  salasPorCapacidade: Record<SalaCapacidade, number>
  /** Profissionais que cabem atendendo ao mesmo tempo somando as salas em uso (individual 1, dupla 2, múltipla 3). */
  atendimentosSimultaneos: number
  contagem: ContagemCadeiras
  porTurno: Record<TurnoClinica, ContagemCadeiras>
  /** Chave `${dow}|${turno}` (dow 1 = segunda … 6 = sábado). */
  porDiaTurno: Record<string, ContagemCadeiras>
  /** Dias da semana (1–6) em que alguma sala em uso da unidade atende (inclusive os fechados por feriado). */
  dias: number[]
  porSala: SalaDaUnidade[]
  pendencias: {
    aberta: PendenciaProfissional[]
    administrativo: PendenciaProfissional[]
    regularizar: Record<MotivoReservaSemAgenda, PendenciaProfissional[]>
  }
  /** Quantas vagas "regularizar" caem em cada caso. */
  regularizarPorMotivo: Record<MotivoReservaSemAgenda, number>
  /** Sessões "Agendado" da unidade que não caem em nenhuma vaga reservada (quem atende sem sala definida naquele horário). */
  semSalaDefinida: { sessoes: number; profissionais: PendenciaProfissional[] }
  /** Sessões com paciente nas salas, por terapia. */
  terapias: { terapia: string; sessoes: number }[]
  profissionaisAlocados: number
  pacientes: number
  /** Slots com mais reservas que a capacidade ou ferindo exclusividade de terapia (mesmo critério do card da Ocupação de Salas). */
  inconsistencias: number
}

export function contagemVazia(): ContagemCadeiras {
  return { total: 0, paciente: 0, aberta: 0, administrativo: 0, regularizar: 0, vazia: 0 }
}

export function comProfissional(c: ContagemCadeiras): number {
  return c.paciente + c.aberta + c.administrativo + c.regularizar
}

export function pctComProfissional(c: ContagemCadeiras): number | null {
  return c.total > 0 ? comProfissional(c) / c.total : null
}

export function pctComPaciente(c: ContagemCadeiras): number | null {
  return c.total > 0 ? c.paciente / c.total : null
}

/** Do tempo em que há profissional na sala, quanto é com paciente. */
export function pctAproveitamento(c: ContagemCadeiras): number | null {
  const p = comProfissional(c)
  return p > 0 ? c.paciente / p : null
}

export function somarContagens(cs: ContagemCadeiras[]): ContagemCadeiras {
  const out = contagemVazia()
  cs.forEach(c => {
    out.total += c.total
    out.paciente += c.paciente
    out.aberta += c.aberta
    out.administrativo += c.administrativo
    out.regularizar += c.regularizar
    out.vazia += c.vazia
  })
  return out
}

export function ehUnidadeTerceirizada(unidade: string): boolean {
  return normTxt(unidade).includes("terceirizad")
}

// ─── FERIADOS ────────────────────────────────────────────────────────────────

/** Linha mínima de feriado (tabela `feriados` / RPC ocupacao_clinica_feriados). */
export interface FeriadoSemana {
  data: string
  nome: string
  tipo: string | null
  horario_inicio: string | null
  horario_fim: string | null
}

/**
 * Converte os feriados de uma semana (segunda = `inicioSemana`) nas janelas
 * fechadas por dia da semana. Integral fecha o dia todo; parcial fecha só
 * [horario_inicio, horario_fim) — sem horário válido, o dia todo.
 */
export function fechamentosDaSemana(feriados: FeriadoSemana[], inicioSemana: string): FechamentoDia[] {
  const [y, m, d] = inicioSemana.split("-").map(Number)
  const seg = Date.UTC(y, m - 1, d)
  const out: FechamentoDia[] = []
  feriados.forEach(f => {
    const [fy, fm, fd] = f.data.split("-").map(Number)
    const dow = Math.round((Date.UTC(fy, fm - 1, fd) - seg) / 86_400_000) + 1
    if (dow < 1 || dow > 6) return
    const ini = pm(f.horario_inicio)
    const fim = pm(f.horario_fim)
    const parcialValido = normTxt(f.tipo) === "parcial" && ini !== null && fim !== null && fim > ini
    out.push({ dow, inicio: parcialValido ? ini! : 0, fim: parcialValido ? fim! : 24 * 60, nome: cleanTxt(f.nome) || "Feriado" })
  })
  return out
}

function fechado(fechamentos: FechamentoDia[], dow: number, minuto: number): FechamentoDia | undefined {
  return fechamentos.find(f => f.dow === dow && minuto >= f.inicio && minuto < f.fim)
}

/** Nome do feriado quando o turno inteiro (todos os horários da grade padrão) está fechado; senão null. */
export function feriadoDoTurno(fechamentos: FechamentoDia[], dow: number, turno: TurnoClinica): string | null {
  const horas = turno === "Manhã" ? HORAS_GRID.slice(0, 6) : HORAS_GRID.slice(6)
  const fs = horas.map(h => fechado(fechamentos, dow, pm(h) ?? 0))
  return fs.every(Boolean) ? fs[0]!.nome : null
}

// ─── ÍNDICES DE AGENDA ───────────────────────────────────────────────────────

/** Intervalos [início, fim) em minutos, por chave dow + profissional. */
type IndiceIntervalos = Map<string, [number, number][]>

function chavesProfissional(id: number | null | undefined, nome: string | null | undefined): string[] {
  const out: string[] = []
  if (id !== null && id !== undefined) out.push(`id:${id}`)
  const n = normTxt(cleanTxt(nome))
  if (n) out.push(`n:${n}`)
  return out
}

function indexarIntervalos(rows: AgendaSalaRow[], prefixo: (r: AgendaSalaRow) => string | null): IndiceIntervalos {
  const idx: IndiceIntervalos = new Map()
  rows.forEach(r => {
    const dow = dowDeDiaSemana(r.dia_semana)
    const ini = pm(r.hora_inicial)
    if (!dow || ini === null) return
    const pre = prefixo(r)
    if (pre === null) return
    const fimRaw = pm(r.hora_final)
    const fim = fimRaw !== null && fimRaw > ini ? fimRaw : ini + 40
    chavesProfissional(r.profissional_id, r.profissional_nome).forEach(k => {
      const chave = `${pre}${dow}|${k}`
      if (!idx.has(chave)) idx.set(chave, [])
      idx.get(chave)!.push([ini, fim])
    })
  })
  return idx
}

function cobre(idx: IndiceIntervalos, chaves: string[], minuto: number): boolean {
  return chaves.some(k => (idx.get(k) ?? []).some(([a, b]) => minuto >= a && minuto < b))
}

function unidadeDaLinha(r: AgendaSalaRow): string | null {
  return parseSalaAgenda(r.sala_nome)?.unidade ?? null
}

function ehAgendado(r: AgendaSalaRow): boolean {
  return normTxt(r.status_agendamento).includes("agendado")
}

function ehLivre(r: AgendaSalaRow): boolean {
  return !ehAgendado(r) && normTxt(r.status_agendamento).includes("livre")
}

function chaveTurno(dow: number, turno: TurnoClinica): string {
  return `${dow}|${turno}`
}

function rotuloTurno(chave: string): string {
  const [dow, turno] = chave.split("|")
  return `${DOW_PT[Number(dow)] ?? dow} · ${turno}`
}

// ─── ACUMULADOR DE PENDÊNCIAS ────────────────────────────────────────────────

class AcumuladorPendencias {
  private porChave = new Map<string, PendenciaProfissional & { _turnos: Set<string> }>()

  add(profissional: string, terapia: string | null, sala: string | null, turno: string | null, qtd = 1) {
    const chave = normTxt(profissional)
    let p = this.porChave.get(chave)
    if (!p) {
      p = { profissional, terapia, horarios: 0, salas: [], turnos: [], _turnos: new Set() }
      this.porChave.set(chave, p)
    }
    p.horarios += qtd
    if (!p.terapia && terapia) p.terapia = terapia
    if (sala && !p.salas.includes(sala)) p.salas.push(sala)
    if (turno) p._turnos.add(turno)
  }

  lista(): PendenciaProfissional[] {
    const ordemTurno = (k: string) => { const [d, t] = k.split("|"); return Number(d) * 2 + (t === "Tarde" ? 1 : 0) }
    return [...this.porChave.values()]
      .map(({ _turnos, ...p }) => ({ ...p, turnos: [..._turnos].sort((a, b) => ordemTurno(a) - ordemTurno(b)).map(rotuloTurno) }))
      .sort((a, b) => b.horarios - a.horarios || a.profissional.localeCompare(b.profissional, "pt-BR"))
  }
}

// ─── CÁLCULO ─────────────────────────────────────────────────────────────────

export function calcularOcupacaoClinica(
  salasComOcupacao: SalaComOcupacao[],
  linhas: AgendaSalaRow[],
  turnosBloqueioAdmin: AgendaSalaRow[] = [],
  fechamentos: FechamentoDia[] = [],
): OcupacaoClinicaUnidade[] {
  // 'Livre' só vale na própria unidade (agenda aberta em outra unidade não
  // libera esta vaga); bloqueio administrativo vale em qualquer lugar — o
  // profissional não está atendendo, seja onde for lançado.
  const livres = indexarIntervalos(linhas.filter(ehLivre), r => {
    const u = unidadeDaLinha(r)
    return u ? `${u}|` : null
  })
  const administrativos = indexarIntervalos(turnosBloqueioAdmin, () => "")

  // "Tem alguma coisa no TiTa nesse turno?" — separa reserva parada (nada no
  // turno inteiro) de agenda menor que a reserva (atende só parte do turno).
  const temAgendaNoTurno = new Set<string>()
  const marcarTurno = (r: AgendaSalaRow, unidade: string | null) => {
    const dow = dowDeDiaSemana(r.dia_semana)
    const ini = pm(r.hora_inicial)
    if (!dow || ini === null) return
    const turno = ini < 12 * 60 ? "Manhã" : "Tarde"
    chavesProfissional(r.profissional_id, r.profissional_nome).forEach(k => temAgendaNoTurno.add(`${unidade ?? "*"}|${dow}|${turno}|${k}`))
  }
  linhas.forEach(r => { if (ehAgendado(r) || ehLivre(r)) marcarTurno(r, unidadeDaLinha(r)) })
  turnosBloqueioAdmin.forEach(r => marcarTurno(r, null))

  const porUnidade = new Map<string, SalaComOcupacao[]>()
  salasComOcupacao.forEach(item => {
    const u = normalizarUnidadeOcupacao(item.sala.unidade_nome)
    if (!porUnidade.has(u)) porUnidade.set(u, [])
    porUnidade.get(u)!.push(item)
  })

  const resultado: OcupacaoClinicaUnidade[] = []

  porUnidade.forEach((itens, unidade) => {
    const contagem = contagemVazia()
    const porTurno: Record<TurnoClinica, ContagemCadeiras> = { "Manhã": contagemVazia(), "Tarde": contagemVazia() }
    const porDiaTurno: Record<string, ContagemCadeiras> = {}
    const dias = new Set<number>()
    const porSala: SalaDaUnidade[] = []
    const porStatus: Record<string, number> = {}
    const salasPorCapacidade: Record<SalaCapacidade, number> = { unico: 0, duplo: 0, multiplo: 0 }
    const pend = {
      aberta: new AcumuladorPendencias(),
      administrativo: new AcumuladorPendencias(),
      semAgendaNoTurno: new AcumuladorPendencias(),
      foraDoHorario: new AcumuladorPendencias(),
    }
    const regularizarPorMotivo: Record<MotivoReservaSemAgenda, number> = { semAgendaNoTurno: 0, foraDoHorario: 0 }
    const terapias = new Map<string, number>()
    const profissionais = new Set<string>()
    /** dow|minuto|chaveProfissional de toda vaga com paciente — base de "sem sala definida". */
    const cobertas = new Set<string>()
    let salasOperacionais = 0
    let atendimentosSimultaneos = 0
    let inconsistencias = 0

    itens.forEach(({ sala, slots }) => {
      if (sala.status === "operacional") salasOperacionais++
      else porStatus[sala.status] = (porStatus[sala.status] ?? 0) + 1
      salasPorCapacidade[sala.capacidade]++
      atendimentosSimultaneos += capacidadeProjetadaSala(sala.capacidade, sala.status)

      const contSala = contagemVazia()

      slots.forEach(slot => {
        if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
        if (slot.blocos.length) dias.add(slot.dow)
        const chaveDT = chaveTurno(slot.dow, slot.turno)
        const contDT = (porDiaTurno[chaveDT] ??= contagemVazia())
        const abertos = slot.blocos.filter(b => !fechado(fechamentos, slot.dow, pm(b.hora) ?? 0))
        if (!abertos.length) return
        if (slot.inconsistente || slot.violaExclusividade) inconsistencias++
        slot.alocacoes.forEach(a => profissionais.add(normTxt(a.profissionalNome)))

        abertos.forEach(bloco => {
          const minuto = pm(bloco.hora) ?? 0
          let situacao: SituacaoCadeira
          if (!bloco.alocacao) {
            situacao = "vazia"
          } else {
            const chaves = chavesProfissional(bloco.alocacao.id, bloco.alocacao.nome)
            if (bloco.status === "preenchido") {
              situacao = "paciente"
              chaves.forEach(k => cobertas.add(`${slot.dow}|${minuto}|${k}`))
              const terapia = cleanTxt(bloco.terapia) || "Sem especialidade"
              terapias.set(terapia, (terapias.get(terapia) ?? 0) + 1)
            } else if (cobre(livres, chaves.map(k => `${unidade}|${slot.dow}|${k}`), minuto)) {
              situacao = "aberta"
              pend.aberta.add(bloco.alocacao.nome, bloco.alocacao.terapia, sala.nome_exibicao, chaveDT)
            } else if (cobre(administrativos, chaves.map(k => `${slot.dow}|${k}`), minuto)) {
              situacao = "administrativo"
              pend.administrativo.add(bloco.alocacao.nome, bloco.alocacao.terapia, sala.nome_exibicao, chaveDT)
            } else {
              situacao = "regularizar"
              const atendeNoTurno = chaves.some(k =>
                temAgendaNoTurno.has(`${unidade}|${slot.dow}|${slot.turno}|${k}`) || temAgendaNoTurno.has(`*|${slot.dow}|${slot.turno}|${k}`))
              const motivo: MotivoReservaSemAgenda = atendeNoTurno ? "foraDoHorario" : "semAgendaNoTurno"
              regularizarPorMotivo[motivo]++
              pend[motivo].add(bloco.alocacao.nome, bloco.alocacao.terapia, sala.nome_exibicao, chaveDT)
            }
          }

          for (const c of [contagem, porTurno[slot.turno], contDT, contSala]) {
            c.total++
            c[situacao]++
          }
        })
      })

      if (contSala.total > 0) porSala.push({ salaId: sala.id, sala: sala.nome_exibicao, contagem: contSala })
    })

    // Sessões reais da unidade que nenhuma vaga reservada absorveu.
    const fora = new AcumuladorPendencias()
    let sessoesFora = 0
    const pacientes = new Set<number>()
    linhas.forEach(r => {
      if (!ehAgendado(r) || unidadeDaLinha(r) !== unidade) return
      const dow = dowDeDiaSemana(r.dia_semana)
      const minuto = pm(r.hora_inicial)
      if (!dow || minuto === null) return
      if (fechado(fechamentos, dow, minuto)) return
      if (r.paciente_id !== null && r.paciente_id !== undefined) pacientes.add(r.paciente_id)
      const chaves = chavesProfissional(r.profissional_id, r.profissional_nome)
      if (chaves.some(k => cobertas.has(`${dow}|${minuto}|${k}`))) return
      sessoesFora++
      fora.add(cleanTxt(r.profissional_nome) || "Sem profissional", cleanTxt(r.terapia_nome) || null, null, chaveTurno(dow, minuto < 12 * 60 ? "Manhã" : "Tarde"))
    })

    // Ordem: salas que mais sobram (menos paciente proporcional) primeiro.
    porSala.sort((a, b) => (pctComPaciente(a.contagem) ?? 0) - (pctComPaciente(b.contagem) ?? 0) || b.contagem.total - a.contagem.total)

    resultado.push({
      unidade,
      terceirizada: ehUnidadeTerceirizada(unidade),
      salasTotal: itens.length,
      salasOperacionais,
      porStatus,
      salasPorCapacidade,
      atendimentosSimultaneos,
      contagem,
      porTurno,
      porDiaTurno,
      dias: [...dias].sort((a, b) => a - b),
      porSala,
      pendencias: {
        aberta: pend.aberta.lista(),
        administrativo: pend.administrativo.lista(),
        regularizar: { semAgendaNoTurno: pend.semAgendaNoTurno.lista(), foraDoHorario: pend.foraDoHorario.lista() },
      },
      regularizarPorMotivo,
      semSalaDefinida: { sessoes: sessoesFora, profissionais: fora.lista() },
      terapias: [...terapias.entries()].map(([terapia, sessoes]) => ({ terapia, sessoes })).sort((a, b) => b.sessoes - a.sessoes),
      profissionaisAlocados: profissionais.size,
      pacientes: pacientes.size,
      inconsistencias,
    })
  })

  // Maiores primeiro; terceirizadas sempre no fim.
  return resultado.sort((a, b) =>
    Number(a.terceirizada) - Number(b.terceirizada) || b.contagem.total - a.contagem.total || a.unidade.localeCompare(b.unidade, "pt-BR"))
}

/**
 * Pessoas com algo a corrigir no mapa de salas — exatamente o que a tela
 * Regularizações (Ocupação de Salas) resolve: reserva sem nenhuma agenda no
 * turno e quem atende sem sala definida. Conta pessoas, não vagas: o ajuste é
 * feito pessoa a pessoa. "Agenda menor que a reserva" (foraDoHorario) fica de
 * fora: não é erro de cadastro, é sala parada parte do turno.
 */
export function pessoasParaAjustarNoMapa(u: Pick<OcupacaoClinicaUnidade, "pendencias" | "semSalaDefinida">): { semAgendaNoTurno: number; semSalaDefinida: number; total: number } {
  const a = u.pendencias.regularizar.semAgendaNoTurno.map(p => normTxt(p.profissional))
  const b = u.semSalaDefinida.profissionais.map(p => normTxt(p.profissional))
  return { semAgendaNoTurno: a.length, semSalaDefinida: b.length, total: new Set([...a, ...b]).size }
}

/** Soma da rede — só unidades próprias (terceirizadas ficam fora do total). */
export function totalDaRede(unidades: OcupacaoClinicaUnidade[]): {
  contagem: ContagemCadeiras
  salasOperacionais: number
  semSalaDefinida: number
  regularizarPorMotivo: Record<MotivoReservaSemAgenda, number>
  /** Soma por unidade (quem aparece em duas unidades conta nas duas: o ajuste é em cada uma). */
  pessoasParaAjustar: number
  unidades: number
} {
  const proprias = unidades.filter(u => !u.terceirizada)
  return {
    contagem: somarContagens(proprias.map(u => u.contagem)),
    salasOperacionais: proprias.reduce((s, u) => s + u.salasOperacionais, 0),
    semSalaDefinida: proprias.reduce((s, u) => s + u.semSalaDefinida.sessoes, 0),
    regularizarPorMotivo: {
      semAgendaNoTurno: proprias.reduce((s, u) => s + u.regularizarPorMotivo.semAgendaNoTurno, 0),
      foraDoHorario: proprias.reduce((s, u) => s + u.regularizarPorMotivo.foraDoHorario, 0),
    },
    pessoasParaAjustar: proprias.reduce((s, u) => s + pessoasParaAjustarNoMapa(u).total, 0),
    unidades: proprias.length,
  }
}
