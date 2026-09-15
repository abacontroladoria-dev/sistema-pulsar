// ─── CAMADA 1: DERIVAÇÃO DE LEITURA PARA A UI DE OCUPAÇÃO DE SALAS ────────────
//
// Módulo PURO (só `import type` de runtime): parte `SalaComOcupacao` — que
// `calcularOcupacaoDaSala` (salas.ts) já produziu — em objetos prontos para a
// UI consumir sem calcular nada. É a camada 1 de docs/padrao-detalhamento-modal.md:
// a regra mora aqui, a UI só apresenta.
//
// NADA aqui recalcula ocupação. Todo predicado abaixo é cópia literal de um
// critério que já existe em salas.ts / SalasGridView.tsx — o objetivo é ter
// UMA fonte para cada número, não uma segunda opinião sobre ele (regra 3.1 do
// padrão: card, KPI e chip têm que divergir nunca).

import { DIAS_DISPONIVEIS_PADRAO, STATUS_SLOT_EXCLUIDO, CAPACIDADE_LABEL_CURTO } from "./salasTypes"
import { DOW_PT } from "./ocupacaoConst"
import type {
  Sala,
  SalaCapacidade,
  SalaComOcupacao,
  SalaStatus,
  SlotOcupacaoSala,
  AlocacaoCardSlot,
} from "./salasTypes"

// ─── ESTADO DE FILTRO ─────────────────────────────────────────────────────────
// Mora aqui, e não em SalasFiltros.tsx, porque `chipsDeFiltro` (camada 1)
// precisa do tipo e a camada 1 não pode importar de um arquivo de UI.
// SalasFiltros.tsx re-exporta os dois para nenhum import existente quebrar.

export interface SalasFiltrosState {
  unidade: string[]
  nucleo: string[]
  andar: string[]
  capacidade: SalaCapacidade[]
  turno: ("Manhã" | "Tarde")[]
  status: SalaStatus[]
  /** Busca livre por nome de profissional alocado (ignora acentos/maiúsculas) */
  profissional: string
  /** Só mostra slots com pelo menos uma alocação sem cruzamento real (card com "—" em vez de "X/Y") */
  semSessao: boolean
  /** Só mostra salas com pelo menos uma regra cadastrada em "Exclusividade de salas com terapias" */
  comExclusividade: boolean
}

export const SALAS_FILTROS_VAZIO: SalasFiltrosState = {
  unidade: [], nucleo: [], andar: [], capacidade: [], turno: [], status: [], profissional: "", semSessao: false, comExclusividade: false,
}

// ─── AGRUPAMENTO POR DIAS ATENDIDOS ───────────────────────────────────────────

/** true se a sala segue o padrão Seg-Sex, dia inteiro (ou não tem `dias_disponiveis` cadastrado) — usado para separar a grade principal (largura fixa) de uma seção à parte para salas fora do padrão (ex.: só quarta e sábado, ou sábado meio período), sem alargar a tabela de ninguém. */
export function seguePadraoSemanal(sala: Sala): boolean {
  const dias = sala.dias_disponiveis?.length ? sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO
  if (dias.length !== DIAS_DISPONIVEIS_PADRAO.length) return false
  return dias.every(d => {
    const padrao = DIAS_DISPONIVEIS_PADRAO.find(p => p.dow === d.dow)
    return !!padrao && d.turnos.length === 2 && d.turnos.includes("Manhã") && d.turnos.includes("Tarde")
  })
}

export interface GrupoDiasSalas {
  chave: string
  dias: { dow: number; label: string }[]
  itens: SalaComOcupacao[]
}

/** Agrupa salas fora do padrão pelo conjunto exato de DIAS que atendem (ignora diferença de turno dentro do dia — a célula de um turno ausente já aparece vazia sozinha) — cada grupo vira uma mini-tabela com só essas colunas (ex.: só Qua+Sáb), nunca a semana inteira. */
export function agruparPorDiasDisponiveis(itens: SalaComOcupacao[]): GrupoDiasSalas[] {
  const grupos = new Map<string, { dias: { dow: number; label: string }[]; itens: SalaComOcupacao[] }>()
  itens.forEach(item => {
    const dows = [...new Set((item.sala.dias_disponiveis?.length ? item.sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO).map(d => d.dow))].sort((a, b) => a - b)
    const chave = dows.join(",")
    if (!grupos.has(chave)) grupos.set(chave, { dias: dows.map(dow => ({ dow, label: DOW_PT[dow] ?? String(dow) })), itens: [] })
    grupos.get(chave)!.itens.push(item)
  })
  return [...grupos.entries()].map(([chave, g]) => ({ chave, ...g }))
}

/** Dias que a sala atende, em ordem — a fonte das COLUNAS da grade do detalhe (nunca fixo em 5: existem salas de sábado). */
export function diasDaSala(sala: Sala): { dow: number; label: string }[] {
  const dias = sala.dias_disponiveis?.length ? sala.dias_disponiveis : DIAS_DISPONIVEIS_PADRAO
  return [...new Set(dias.map(d => d.dow))]
    .sort((a, b) => a - b)
    .map(dow => ({ dow, label: DOW_PT[dow] ?? String(dow) }))
}

// ─── INCONSISTÊNCIA ───────────────────────────────────────────────────────────

/**
 * O predicado que decide se uma sala "tem problema". Extraído de page.tsx (onde
 * estava inline no filtro de `somenteInconsistentes`) para ser a fonte única do
 * KPI, do toggle, do selo do card e do chip de filtro ativo — se cada um
 * reimplementar, eles divergem e o usuário vê "3 inconsistências" num contador
 * e 2 salas marcadas.
 *
 * Mesma composição de `resumoOcupacaoDeItens` (salas.ts): conflito de
 * planejamento (alocações acima da capacidade) OU violação de exclusividade
 * obrigatória.
 */
export function salaTemInconsistencia(item: SalaComOcupacao): boolean {
  return item.slots.some(s => s.inconsistente || s.violaExclusividade)
}

// ─── SITUAÇÃO DE UMA CÉLULA/ALOCAÇÃO ──────────────────────────────────────────

/**
 * Rotulagem — não é regra nova. Cada ramo abaixo é o mesmo critério já usado
 * hoje para pintar a célula em SalasGridView; aqui ele ganha um nome para a
 * legenda do detalhe poder listá-lo.
 *
 * `indisponivel` (a sala não atende esse dia/turno) não entra na legenda: é a
 * célula vazia com um traço, como já é hoje.
 */
export type SituacaoCelula =
  | "confirmada"
  | "agenda-aberta"
  | "sem-sessao"
  | "livre"
  | "conflito"
  | "bloqueado"
  | "indisponivel"

export const SITUACAO_LABEL: Record<SituacaoCelula, string> = {
  confirmada: "Sessão confirmada",
  "agenda-aberta": "Agenda aberta, sem paciente",
  "sem-sessao": "Alocado sem sessão",
  livre: "Livre",
  conflito: "Conflito",
  bloqueado: "Bloqueado",
  indisponivel: "Não atende",
}

/**
 * Situação de UMA alocação dentro de um slot. Ordem importa: a primeira que
 * casar vence.
 *
 * `agenda-aberta` existe porque a grade de hoje já distingue esse caso: o
 * profissional tem horário 'Livre' reservado na TiTa (então `semCruzamentoCsv`
 * é false — não é alocação fantasiosa), mas ainda 0 paciente marcado, e a razão
 * "X/Y" aparece em cinza, não em verde (SalasGridView.tsx:302-308). Colapsá-lo
 * em `confirmada` diria "sessão confirmada" sobre um turno sem nenhum paciente.
 * Ver o comentário de `livrePorProfissionalId` em salas.ts — a distinção foi
 * criada de propósito (caso Andréa Aparecida, 2026-08-27).
 */
export function situacaoDaAlocacao(slot: SlotOcupacaoSala, card: AlocacaoCardSlot): SituacaoCelula {
  if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return "bloqueado"
  if (slot.inconsistente || card.violacaoExclusividade !== null) return "conflito"
  if (card.semCruzamentoCsv) return "sem-sessao"
  if (card.sessoesReais > 0) return "confirmada"
  return "agenda-aberta"
}

/** Situação agregada da CÉLULA (dia × turno), a partir das alocações que ela contém. */
export function situacaoDaCelula(slot: SlotOcupacaoSala | undefined): SituacaoCelula {
  if (!slot) return "indisponivel"
  if (STATUS_SLOT_EXCLUIDO.includes(slot.status)) return "bloqueado"
  if (slot.inconsistente || slot.violaExclusividade) return "conflito"
  if (slot.alocacoes.length === 0) return "livre"
  if (slot.alocacoes.some(a => a.semCruzamentoCsv)) return "sem-sessao"
  if (slot.alocacoes.every(a => a.sessoesReais === 0)) return "agenda-aberta"
  return "confirmada"
}

// ─── RESUMO SEMANAL (as bolinhas do card) ─────────────────────────────────────

export type NivelDia =
  | "sem-atendimento"
  | "fora-de-operacao"
  | "livre"
  | "parcial"
  | "cheio"
  | "conflito"

export interface ResumoDiaSala {
  dow: number
  label: string
  nivel: NivelDia
  ocupados: number
  total: number
}

export const NIVEL_DIA_LABEL: Record<NivelDia, string> = {
  "sem-atendimento": "não atende",
  "fora-de-operacao": "fora de operação",
  livre: "livre",
  parcial: "parcial",
  cheio: "cheio",
  conflito: "conflito",
}

/**
 * Uma entrada por dia que a sala atende, agregando os dois turnos daquele dia.
 * Deriva de `item.slots` — nada é recalculado nem re-cruzado com a agenda.
 */
export function resumoSemanalDaSala(item: SalaComOcupacao): ResumoDiaSala[] {
  return diasDaSala(item.sala).map(({ dow, label }) => {
    const doDia = item.slots.filter(s => s.dow === dow)

    if (doDia.length === 0) {
      return { dow, label, nivel: "sem-atendimento" as NivelDia, ocupados: 0, total: 0 }
    }
    if (doDia.some(s => s.inconsistente || s.violaExclusividade)) {
      return { dow, label, nivel: "conflito" as NivelDia, ocupados: 0, total: doDia.length }
    }

    const relevantes = doDia.filter(s => !STATUS_SLOT_EXCLUIDO.includes(s.status))
    if (relevantes.length === 0) {
      return { dow, label, nivel: "fora-de-operacao" as NivelDia, ocupados: 0, total: doDia.length }
    }

    const ocupados = relevantes.filter(s => s.status === "ocupado" || s.status === "parcial").length
    const nivel: NivelDia = ocupados === 0 ? "livre" : ocupados >= relevantes.length ? "cheio" : "parcial"
    return { dow, label, nivel, ocupados, total: relevantes.length }
  })
}

/** Frase para o `aria-label` do conjunto de bolinhas — cor sozinha nunca carrega informação. */
export function descreverResumoSemanal(dias: ResumoDiaSala[]): string {
  if (dias.length === 0) return "Sem dias cadastrados"
  return dias.map(d => `${d.label} ${NIVEL_DIA_LABEL[d.nivel]}`).join(", ")
}

// ─── RESUMO DO CARD ───────────────────────────────────────────────────────────

export interface ResumoCardSala {
  sala: Sala
  /** % de slots com alguém alocado na semana — já vem pronto de calcularOcupacaoDaSala. */
  pctSemanal: number | null
  /** Slots com alguém alocado / slots relevantes (exclui bloqueada e fora de operação). */
  slotsOcupados: number
  slotsTotal: number
  /** Profissionais simultâneos que a sala comporta por bloco de horário (0 se fora de operação). */
  capacidadeProjetada: number
  capacidadeLabel: string
  temInconsistencia: boolean
  dias: ResumoDiaSala[]
  /** Terapias distintas efetivamente alocadas na sala, em ordem alfabética — a "especialidade" exibida no card. */
  terapias: string[]
}

/**
 * Tudo que `SalaCard` precisa, num objeto só — o card não recebe
 * `SalaComOcupacao` cru justamente para não ter como calcular nada.
 *
 * `slotsOcupados`/`slotsTotal` usam a MESMA contagem de `resumoOcupacaoDeItens`
 * (salas.ts), reproduzida aqui sobre um item só para não importar runtime na
 * camada 1. O invariante `slotsOcupados <= slotsTotal` está coberto por teste.
 */
export function resumoCardSala(item: SalaComOcupacao): ResumoCardSala {
  let slotsTotal = 0
  let slotsOcupados = 0

  item.slots.forEach(slot => {
    if (slot.status === "inativo" || slot.status === "bloqueado") return
    slotsTotal++
    if (slot.status === "ocupado" || slot.status === "parcial") slotsOcupados++
  })

  const terapias = [...new Set(
    item.slots.flatMap(s => s.alocacoes.map(a => a.terapiaNome).filter((t): t is string => !!t)),
  )].sort((a, b) => a.localeCompare(b, "pt-BR"))

  const capacidadeProjetada = item.slots[0]?.capacidadeProjetada ?? 0

  return {
    sala: item.sala,
    pctSemanal: item.pctOcupacaoSemanal,
    slotsOcupados,
    slotsTotal,
    capacidadeProjetada,
    capacidadeLabel: CAPACIDADE_LABEL_CURTO[item.sala.capacidade],
    temInconsistencia: salaTemInconsistencia(item),
    dias: resumoSemanalDaSala(item),
    terapias,
  }
}

// ─── GRADE SEMANAL DO DETALHE ─────────────────────────────────────────────────

export interface AlocacaoNaCelula extends AlocacaoCardSlot {
  situacao: SituacaoCelula
}

export interface CelulaGradeSala {
  dow: number
  diaLabel: string
  turno: "Manhã" | "Tarde"
  situacao: SituacaoCelula
  /** Cadeiras da sala ainda sem ninguém alocado neste dia/turno — cada uma vira um "Livre +" clicável. */
  vagasLivres: number
  alocacoes: AlocacaoNaCelula[]
  /** O slot de origem, para quem precisar dos blocos de 40min (ex.: o drawer). */
  slot: SlotOcupacaoSala | null
}

export const TURNOS_GRADE: ("Manhã" | "Tarde")[] = ["Manhã", "Tarde"]

/**
 * Uma célula por (dia, turno) — 2 linhas × N colunas, N vindo dos dias que a
 * sala atende. Célula sem slot correspondente é `indisponivel` (a sala não
 * atende aquele dia/turno), não "livre": oferecer "Livre +" ali criaria uma
 * alocação num turno que a sala não tem.
 */
export function gradeSemanalDaSala(item: SalaComOcupacao): CelulaGradeSala[] {
  const celulas: CelulaGradeSala[] = []

  for (const turno of TURNOS_GRADE) {
    for (const { dow, label } of diasDaSala(item.sala)) {
      const slot = item.slots.find(s => s.dow === dow && s.turno === turno) ?? null
      const alocacoes: AlocacaoNaCelula[] = slot
        ? slot.alocacoes.map(a => ({ ...a, situacao: situacaoDaAlocacao(slot, a) }))
        : []
      celulas.push({
        dow,
        diaLabel: label,
        turno,
        situacao: situacaoDaCelula(slot ?? undefined),
        vagasLivres: slot ? Math.max(0, slot.capacidadeProjetada - slot.alocacoes.length) : 0,
        alocacoes,
        slot,
      })
    }
  }

  return celulas
}

// ─── ABA PROFISSIONAIS ────────────────────────────────────────────────────────

export interface LinhaProfissionalSala {
  profissionalNome: string
  terapias: string[]
  /** Um item por dia/turno em que a pessoa está alocada nesta sala. */
  turnos: { dow: number; diaLabel: string; turno: "Manhã" | "Tarde"; situacao: SituacaoCelula; alocacaoId: string }[]
  sessoesReais: number
  sessoesCapacidade: number
  /** Pior situação entre os turnos — a coluna "Situação" da tabela. */
  situacao: SituacaoCelula
}

/** Ordem de gravidade: o que a linha da tabela mostra quando a pessoa tem turnos em estados diferentes. */
const GRAVIDADE: SituacaoCelula[] = ["conflito", "sem-sessao", "agenda-aberta", "bloqueado", "confirmada", "livre", "indisponivel"]

/** Achata os slots da sala e agrupa por profissional — a aba "Profissionais" do detalhe. */
export function profissionaisDaSala(item: SalaComOcupacao): LinhaProfissionalSala[] {
  const porProfissional = new Map<string, LinhaProfissionalSala>()

  for (const { dow, label } of diasDaSala(item.sala)) {
    for (const turno of TURNOS_GRADE) {
      const slot = item.slots.find(s => s.dow === dow && s.turno === turno)
      if (!slot) continue
      slot.alocacoes.forEach(a => {
        const atual = porProfissional.get(a.profissionalNome) ?? {
          profissionalNome: a.profissionalNome,
          terapias: [],
          turnos: [],
          sessoesReais: 0,
          sessoesCapacidade: 0,
          situacao: "livre" as SituacaoCelula,
        }
        const situacao = situacaoDaAlocacao(slot, a)
        atual.turnos.push({ dow, diaLabel: label, turno, situacao, alocacaoId: a.alocacaoId })
        atual.sessoesReais += a.sessoesReais
        atual.sessoesCapacidade += a.sessoesCapacidadeTurno
        if (a.terapiaNome && !atual.terapias.includes(a.terapiaNome)) atual.terapias.push(a.terapiaNome)
        porProfissional.set(a.profissionalNome, atual)
      })
    }
  }

  return [...porProfissional.values()]
    .map(linha => ({
      ...linha,
      terapias: linha.terapias.sort((a, b) => a.localeCompare(b, "pt-BR")),
      situacao: GRAVIDADE.find(g => linha.turnos.some(t => t.situacao === g)) ?? "livre",
    }))
    .sort((a, b) => a.profissionalNome.localeCompare(b.profissionalNome, "pt-BR"))
}

// ─── CHIPS DE FILTRO ATIVO ────────────────────────────────────────────────────

/**
 * `campo` + `valor` dizem à UI o que remover quando o usuário clica no "×" —
 * a tira de chips não decide nada, só renderiza o que esta função listou.
 * `isolada` e `soInconsistentes` entram aqui porque, para quem olha a tela,
 * são filtros como qualquer outro, mesmo morando em estados separados.
 */
export type CampoChipFiltro = keyof SalasFiltrosState | "isolada" | "soInconsistentes"

export interface ChipFiltro {
  campo: CampoChipFiltro
  /** Presente só em filtros de múltipla escolha — identifica QUAL valor remover. */
  valor?: string
  label: string
}

export function chipsDeFiltro(
  f: SalasFiltrosState,
  extras: { isolada?: string | null; soInconsistentes?: boolean } = {},
  rotulos: { status?: (codigo: string) => string } = {},
): ChipFiltro[] {
  const chips: ChipFiltro[] = []

  const multi: { campo: keyof SalasFiltrosState; titulo: string; valores: string[]; label?: (v: string) => string }[] = [
    { campo: "unidade", titulo: "Unidade", valores: f.unidade },
    { campo: "nucleo", titulo: "Núcleo", valores: f.nucleo },
    { campo: "andar", titulo: "Andar", valores: f.andar },
    { campo: "capacidade", titulo: "Capacidade", valores: f.capacidade, label: v => CAPACIDADE_LABEL_CURTO[v as SalaCapacidade] ?? v },
    { campo: "turno", titulo: "Turno", valores: f.turno },
    { campo: "status", titulo: "Status", valores: f.status, label: v => rotulos.status?.(v) ?? v },
  ]

  multi.forEach(({ campo, titulo, valores, label }) => {
    valores.forEach(v => chips.push({ campo, valor: v, label: `${titulo}: ${label ? label(v) : v}` }))
  })

  if (f.profissional.trim()) chips.push({ campo: "profissional", label: `Profissional: ${f.profissional.trim()}` })
  if (f.semSessao) chips.push({ campo: "semSessao", label: "Alocação sem sessão" })
  if (f.comExclusividade) chips.push({ campo: "comExclusividade", label: "Com exclusividade" })
  if (extras.soInconsistentes) chips.push({ campo: "soInconsistentes", label: "Só inconsistentes" })
  if (extras.isolada) chips.push({ campo: "isolada", label: `Mostrando só ${extras.isolada}` })

  return chips
}

/** Remove um chip do estado de filtro. `isolada`/`soInconsistentes` são tratados pelo chamador (vivem fora deste objeto). */
export function removerChipDeFiltro(f: SalasFiltrosState, chip: ChipFiltro): SalasFiltrosState {
  switch (chip.campo) {
    case "unidade":
    case "nucleo":
    case "andar":
      return { ...f, [chip.campo]: f[chip.campo].filter(v => v !== chip.valor) }
    case "capacidade":
      return { ...f, capacidade: f.capacidade.filter(v => v !== chip.valor) }
    case "turno":
      return { ...f, turno: f.turno.filter(v => v !== chip.valor) }
    case "status":
      return { ...f, status: f.status.filter(v => v !== chip.valor) }
    case "profissional":
      return { ...f, profissional: "" }
    case "semSessao":
      return { ...f, semSessao: false }
    case "comExclusividade":
      return { ...f, comExclusividade: false }
    default:
      return f
  }
}

/** Quantos filtros SECUNDÁRIOS (os que ficam atrás de "Mais filtros") estão ativos — sem essa contagem no botão, um filtro escondido fica invisível. */
export function contarFiltrosSecundarios(f: SalasFiltrosState): number {
  return f.andar.length + f.capacidade.length + f.turno.length + (f.semSessao ? 1 : 0) + (f.comExclusividade ? 1 : 0)
}
