// ─── OCUPAÇÃO CLÍNICA: CADA HORÁRIO DE CADEIRA EM UMA SITUAÇÃO ───────────────
// Motor da aba Indicadores › Ocupação Clínica (UnidadeDashboardShell).
//
// A unidade de medida é o "horário de cadeira": uma vaga simultânea da sala
// (1/2/3 conforme Único/Duplo/Múltiplo) × um horário da grade (40 min no
// padrão). É exatamente o `slot.blocos` que calcularSlotsDaSala já monta —
// aqui só classificamos cada bloco em UMA de cinco situações:
//
//   paciente        a cadeira tem alocação e a sessão "Agendado" do profissional
//                   alocado cai nesse horário exato (= bloco "preenchido")
//   aberta          tem alocação, sem paciente, e o profissional tem horário
//                   'Livre' no TiTa cobrindo esse horário, na mesma unidade
//   administrativo  tem alocação, sem paciente, e o profissional está em
//                   "Horário Administrativo"/"Horário Bloqueado" no TiTa
//   regularizar     tem alocação e nada no TiTa explica o horário (o mapa de
//                   salas e a agenda divergem)
//   vazia           cadeira sem ninguém alocado
//
// Por construção: paciente ≤ comProfissional ≤ total, e as cinco somam o
// total. "% com paciente" é o MESMO número de `pctGranular` (Ocupação real),
// e "% com profissional" é medido por cadeira — não por sala inteira no
// turno, como o `pct` binário de calcularResumoUnidades.
//
// Não busca nada: recebe o que useOcupacaoSalas já tem em memória
// (salasComOcupacao, linhas, turnosBloqueioAdmin).

import { normalizarUnidadeOcupacao } from "./ocupacaoProf"
import { dowDeDiaSemana, parseSalaAgenda } from "./salas"
import { pm, cleanTxt } from "./helpers"
import { normTxt, HORAS_GRID } from "./constants"
import { STATUS_SLOT_EXCLUIDO, capacidadeProjetadaSala } from "./salasTypes"
import type { AgendaSalaRow, SalaCapacidade, SalaComOcupacao } from "./salasTypes"

export type TurnoClinica = "Manhã" | "Tarde"
export type SituacaoCadeira = "paciente" | "aberta" | "administrativo" | "regularizar" | "vazia"

/** Ordem fixa da barra: do uso mais pleno ao espaço vazio. */
export const SITUACOES_CADEIRA: readonly SituacaoCadeira[] = ["paciente", "aberta", "administrativo", "regularizar", "vazia"]

/** Horários de cadeira que um profissional em tempo integral ocupa por semana (grade padrão × Seg–Sex). */
export const HORARIOS_TEMPO_INTEGRAL_SEMANA = HORAS_GRID.length * 5

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
  /** nº de horários (ou de sessões, em "fora do mapa") */
  horarios: number
  salas: string[]
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
  /** Vagas simultâneas somando as salas operacionais (Único 1, Duplo 2, Múltiplo 3). */
  cadeiras: number
  contagem: ContagemCadeiras
  porTurno: Record<TurnoClinica, ContagemCadeiras>
  /** Chave `${dow}|${turno}` (dow 1 = segunda … 6 = sábado). */
  porDiaTurno: Record<string, ContagemCadeiras>
  /** Dias da semana (1–6) em que alguma sala operacional da unidade atende. */
  dias: number[]
  porSala: SalaDaUnidade[]
  pendencias: Record<"aberta" | "administrativo" | "regularizar", PendenciaProfissional[]>
  /** Sessões "Agendado" da unidade que não caem em nenhuma cadeira (profissional sem alocação naquele dia/turno/horário). */
  foraDoMapa: { sessoes: number; profissionais: PendenciaProfissional[] }
  /** Sessões com paciente nas cadeiras, por terapia. */
  terapias: { terapia: string; sessoes: number }[]
  profissionaisAlocados: number
  pacientes: number
  /** Slots com mais alocações que a capacidade ou ferindo exclusividade de terapia (mesmo critério do card da Ocupação de Salas). */
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

/** Do tempo com profissional, quanto tem paciente. */
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

// ─── ACUMULADOR DE PENDÊNCIAS ────────────────────────────────────────────────

class AcumuladorPendencias {
  private porChave = new Map<string, PendenciaProfissional>()

  add(profissional: string, terapia: string | null, sala: string | null, qtd = 1) {
    const chave = normTxt(profissional)
    let p = this.porChave.get(chave)
    if (!p) {
      p = { profissional, terapia, horarios: 0, salas: [] }
      this.porChave.set(chave, p)
    }
    p.horarios += qtd
    if (!p.terapia && terapia) p.terapia = terapia
    if (sala && !p.salas.includes(sala)) p.salas.push(sala)
  }

  lista(): PendenciaProfissional[] {
    return [...this.porChave.values()].sort((a, b) => b.horarios - a.horarios || a.profissional.localeCompare(b.profissional, "pt-BR"))
  }
}

// ─── CÁLCULO ─────────────────────────────────────────────────────────────────

export function calcularOcupacaoClinica(
  salasComOcupacao: SalaComOcupacao[],
  linhas: AgendaSalaRow[],
  turnosBloqueioAdmin: AgendaSalaRow[] = [],
): OcupacaoClinicaUnidade[] {
  // 'Livre' só vale na própria unidade (agenda aberta em outra unidade não
  // libera esta cadeira); bloqueio administrativo vale em qualquer lugar — o
  // profissional não está atendendo, seja onde for lançado.
  const livres = indexarIntervalos(linhas.filter(ehLivre), r => {
    const u = unidadeDaLinha(r)
    return u ? `${u}|` : null
  })
  const administrativos = indexarIntervalos(turnosBloqueioAdmin, () => "")

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
      regularizar: new AcumuladorPendencias(),
    }
    const terapias = new Map<string, number>()
    const profissionais = new Set<string>()
    /** dow|minuto|chaveProfissional de toda cadeira com paciente — base de "fora do mapa". */
    const cobertas = new Set<string>()
    let salasOperacionais = 0
    let cadeiras = 0
    let inconsistencias = 0

    itens.forEach(({ sala, slots }) => {
      if (sala.status === "operacional") salasOperacionais++
      else porStatus[sala.status] = (porStatus[sala.status] ?? 0) + 1
      salasPorCapacidade[sala.capacidade]++
      cadeiras += capacidadeProjetadaSala(sala.capacidade, sala.status)

      const contSala = contagemVazia()

      slots.forEach(slot => {
        if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return
        if (slot.inconsistente || slot.violaExclusividade) inconsistencias++
        slot.alocacoes.forEach(a => profissionais.add(normTxt(a.profissionalNome)))

        const chaveDT = `${slot.dow}|${slot.turno}`
        const contDT = (porDiaTurno[chaveDT] ??= contagemVazia())
        if (slot.blocos.length) dias.add(slot.dow)

        slot.blocos.forEach(bloco => {
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
            } else if (cobre(administrativos, chaves.map(k => `${slot.dow}|${k}`), minuto)) {
              situacao = "administrativo"
            } else {
              situacao = "regularizar"
            }
            if (situacao !== "paciente") {
              pend[situacao].add(bloco.alocacao.nome, bloco.alocacao.terapia, sala.nome_exibicao)
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

    // Sessões reais da unidade que nenhuma cadeira absorveu.
    const fora = new AcumuladorPendencias()
    let sessoesFora = 0
    const pacientes = new Set<number>()
    linhas.forEach(r => {
      if (!ehAgendado(r) || unidadeDaLinha(r) !== unidade) return
      if (r.paciente_id !== null && r.paciente_id !== undefined) pacientes.add(r.paciente_id)
      const dow = dowDeDiaSemana(r.dia_semana)
      const minuto = pm(r.hora_inicial)
      if (!dow || minuto === null) return
      const chaves = chavesProfissional(r.profissional_id, r.profissional_nome)
      if (chaves.some(k => cobertas.has(`${dow}|${minuto}|${k}`))) return
      sessoesFora++
      fora.add(cleanTxt(r.profissional_nome) || "Sem profissional", cleanTxt(r.terapia_nome) || null, null)
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
      cadeiras,
      contagem,
      porTurno,
      porDiaTurno,
      dias: [...dias].sort((a, b) => a - b),
      porSala,
      pendencias: {
        aberta: pend.aberta.lista(),
        administrativo: pend.administrativo.lista(),
        regularizar: pend.regularizar.lista(),
      },
      foraDoMapa: { sessoes: sessoesFora, profissionais: fora.lista() },
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

/** Soma da rede — só unidades próprias (terceirizadas ficam fora do total). */
export function totalDaRede(unidades: OcupacaoClinicaUnidade[]): { contagem: ContagemCadeiras; cadeiras: number; foraDoMapa: number; unidades: number } {
  const proprias = unidades.filter(u => !u.terceirizada)
  return {
    contagem: somarContagens(proprias.map(u => u.contagem)),
    cadeiras: proprias.reduce((s, u) => s + u.cadeiras, 0),
    foraDoMapa: proprias.reduce((s, u) => s + u.foraDoMapa.sessoes, 0),
    unidades: proprias.length,
  }
}
