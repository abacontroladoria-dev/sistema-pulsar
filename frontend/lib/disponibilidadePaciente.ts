// Disponibilidade do paciente: o tempo que a criança pode passar na clínica.
//
// Módulo puro, sem import nenhum, de propósito: roda igual na aba interna, no
// formulário público (bundle de quem abre o link no celular — não pode arrastar
// lib/cronograma inteira junto), nos route handlers e no teste.
//
// O formato espelha a tabela pacientes_disponibilidade_versoes
// (20261005160000): horário da escola + UMA janela por dia, Seg–Sáb. É o mesmo
// desenho do CSV da Órbita que a clínica usava antes.

// ─── Dias ─────────────────────────────────────────────────────────────────────

export const DIAS = [
  { chave: "seg", curto: "Seg", longo: "Segunda-feira" },
  { chave: "ter", curto: "Ter", longo: "Terça-feira" },
  { chave: "qua", curto: "Qua", longo: "Quarta-feira" },
  { chave: "qui", curto: "Qui", longo: "Quinta-feira" },
  { chave: "sex", curto: "Sex", longo: "Sexta-feira" },
  { chave: "sab", curto: "Sáb", longo: "Sábado" },
] as const

export type DiaChave = (typeof DIAS)[number]["chave"]

/** Horários sempre em "HH:MM". `null` = não vem nesse dia. */
export type Janela = { inicio: string; fim: string } | null

export type Disponibilidade = {
  /** `null` = não informado; `false` = não frequenta (sem horário de escola). */
  frequenta_escola: boolean | null
  escola: Janela
  dias: Record<DiaChave, Janela>
}

export function disponibilidadeVazia(): Disponibilidade {
  return {
    frequenta_escola: null,
    escola: null,
    dias: { seg: null, ter: null, qua: null, qui: null, sex: null, sab: null },
  }
}

// ─── Horas ────────────────────────────────────────────────────────────────────

/** "HH:MM" ou "HH:MM:SS" → minutos. `null` se não for horário. */
export function paraMinutos(hora: string | null | undefined): number | null {
  if (!hora) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hora.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** minutos → "HH:MM". */
export function deMinutos(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`
}

/** "13:00:00" (Postgres `time`) → "13:00". Vazio/inválido → null. */
export function horaCurta(hora: string | null | undefined): string | null {
  const m = paraMinutos(hora)
  return m === null ? null : deMinutos(m)
}

// ─── Grade de sessões ─────────────────────────────────────────────────────────
// Sessão de 40 min. Manhã 08:00–12:00, almoço 12:00–13:00, tarde 13:00 até a
// última sessão das 19:00 (termina 19:40). É a grade em que a clínica atende —
// HORAS_GRID em lib/cronograma/constants.ts vai só até 17:00 porque descreve a
// grade padrão do cronograma; o CSV da Órbita mostra famílias disponíveis até
// 19:40, e a disponibilidade precisa caber nelas.

const DURACAO_SESSAO = 40

function faixa(de: number, ate: number, passo: number): number[] {
  const lista: number[] = []
  for (let m = de; m <= ate; m += passo) lista.push(m)
  return lista
}

/** Inícios de sessão, em minutos. */
const INICIOS_MIN = [...faixa(8 * 60, 11 * 60 + 20, DURACAO_SESSAO), ...faixa(13 * 60, 19 * 60, DURACAO_SESSAO)]

/** Fins de sessão, em minutos (início + 40). */
const FINS_MIN = INICIOS_MIN.map((m) => m + DURACAO_SESSAO)

export const INICIOS_SESSAO: readonly string[] = INICIOS_MIN.map(deMinutos)
export const FINS_SESSAO: readonly string[] = FINS_MIN.map(deMinutos)

/**
 * Horários da escola: de 10 em 10 min, 06:00–19:00. A escola NÃO segue a grade
 * da clínica (entra 07:30, sai 11:30, 12:30…), então a lista é outra.
 */
export const HORARIOS_ESCOLA: readonly string[] = faixa(6 * 60, 19 * 60, 10).map(deMinutos)

export type OpcaoHorario = { valor: string; foraDaGrade: boolean }

/**
 * Opções de uma lista de horário, incluindo o valor ATUAL quando ele não está
 * na grade (veio da importação da Órbita: 15:20, 15:30, 18:00). Sem isto o
 * `<select>` não teria a opção, mostraria "Selecione" e o valor sumiria no
 * primeiro salvar.
 */
function comAtual(grade: readonly string[], atual: string | null | undefined, depoisDe?: string | null): OpcaoHorario[] {
  const piso = paraMinutos(depoisDe ?? null)
  const valores = new Set(grade.filter((h) => piso === null || (paraMinutos(h) as number) > piso))
  const atualCurto = horaCurta(atual)
  const foraDaGrade = atualCurto !== null && !grade.includes(atualCurto)
  if (atualCurto) valores.add(atualCurto)

  return [...valores]
    .sort((a, b) => (paraMinutos(a) as number) - (paraMinutos(b) as number))
    .map((valor) => ({ valor, foraDaGrade: foraDaGrade && valor === atualCurto }))
}

export function opcoesInicio(atual?: string | null): OpcaoHorario[] {
  return comAtual(INICIOS_SESSAO, atual)
}

/** Fins possíveis — só os que vêm DEPOIS do início escolhido. */
export function opcoesFim(inicio: string | null, atual?: string | null): OpcaoHorario[] {
  return comAtual(FINS_SESSAO, atual, inicio)
}

export function opcoesEscola(atual?: string | null, depoisDe?: string | null): OpcaoHorario[] {
  return comAtual(HORARIOS_ESCOLA, atual, depoisDe)
}

// ─── Totais ───────────────────────────────────────────────────────────────────

/**
 * Sessões de 40 min que cabem INTEIRAS na janela, contadas pela grade.
 *
 * Não é `(fim − início) / 40`: uma janela 09:20–17:40 atravessa o almoço, e a
 * conta simples daria 12 sessões onde a clínica só consegue encaixar 11 (4 de
 * manhã + 7 à tarde). É a mesma regra do CSV da Órbita — conferida contra as
 * 289 linhas da carga inicial.
 */
export function sessoesNaJanela(janela: Janela): number {
  if (!janela) return 0
  const ini = paraMinutos(janela.inicio)
  const fim = paraMinutos(janela.fim)
  if (ini === null || fim === null || fim <= ini) return 0
  return INICIOS_MIN.filter((s) => s >= ini && s + DURACAO_SESSAO <= fim).length
}

/** Minutos brutos da janela (o almoço conta — é tempo em que a criança está livre). */
export function minutosNaJanela(janela: Janela): number {
  if (!janela) return 0
  const ini = paraMinutos(janela.inicio)
  const fim = paraMinutos(janela.fim)
  if (ini === null || fim === null || fim <= ini) return 0
  return fim - ini
}

export function calcularTotais(d: Disponibilidade): { minutosSemana: number; sessoes40: number; diasDisponiveis: number } {
  let minutosSemana = 0
  let sessoes40 = 0
  let diasDisponiveis = 0
  for (const { chave } of DIAS) {
    const j = d.dias[chave]
    if (!j) continue
    diasDisponiveis += 1
    minutosSemana += minutosNaJanela(j)
    sessoes40 += sessoesNaJanela(j)
  }
  return { minutosSemana, sessoes40, diasDisponiveis }
}

/** 500 → "8h20" — o formato do CSV da Órbita, que a equipe já lê. */
export function formatarHoras(minutos: number): string {
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`
}

// ─── Conflito com a escola ────────────────────────────────────────────────────

/** Dias em que a escola funciona. Sábado fica de fora: o horário escolar é um só e descreve a semana útil. */
const DIAS_DE_ESCOLA: readonly DiaChave[] = ["seg", "ter", "qua", "qui", "sex"]

/**
 * Trecho em que a janela do dia se sobrepõe ao horário da escola, ou `null`.
 *
 * Não bloqueia nada: a família pode declarar de propósito (sai mais cedo da
 * escola às terças, por exemplo). É um ALERTA para a equipe conferir antes de
 * montar o cronograma — a criança não está em dois lugares ao mesmo tempo.
 * Encostar não é conflito: escola até 12:00 e clínica a partir de 12:00 é ok.
 */
export function conflitoComEscola(d: Disponibilidade, dia: DiaChave): Janela {
  if (d.frequenta_escola === false || !d.escola || !DIAS_DE_ESCOLA.includes(dia)) return null
  const j = d.dias[dia]
  if (!j) return null
  const ini = Math.max(paraMinutos(j.inicio) ?? 0, paraMinutos(d.escola.inicio) ?? 0)
  const fim = Math.min(paraMinutos(j.fim) ?? 0, paraMinutos(d.escola.fim) ?? 0)
  return fim > ini ? { inicio: deMinutos(ini), fim: deMinutos(fim) } : null
}

// ─── Validação ────────────────────────────────────────────────────────────────

export type ErroDisponibilidade = { campo: DiaChave | "escola"; mensagem: string }

/**
 * Os mesmos limites dos CHECKs da tabela, ditos em português. Validar antes de
 * enviar transforma "não foi possível salvar" em "Segunda: o fim precisa ser
 * depois do início".
 */
export function validar(d: Disponibilidade): ErroDisponibilidade[] {
  const erros: ErroDisponibilidade[] = []

  const conferir = (campo: DiaChave | "escola", rotulo: string, j: Janela) => {
    if (!j) return
    const ini = paraMinutos(j.inicio)
    const fim = paraMinutos(j.fim)
    if (ini === null || fim === null) {
      erros.push({ campo, mensagem: `${rotulo}: escolha o horário de início e de fim.` })
    } else if (fim <= ini) {
      erros.push({ campo, mensagem: `${rotulo}: o fim precisa ser depois do início.` })
    }
  }

  if (d.frequenta_escola === true) conferir("escola", "Escola", d.escola)
  for (const dia of DIAS) conferir(dia.chave, dia.longo, d.dias[dia.chave])

  return erros
}

// ─── Rascunho (o que o editor manipula) ───────────────────────────────────────
// A tela precisa de um estado intermediário que `Disponibilidade` não aceita:
// "marcou segunda mas ainda não escolheu o fim". O rascunho guarda isso, e
// `lerRascunho` converte de volta dizendo o que falta. A aba interna e o
// formulário público usam os dois — a regra de "o que é um dia válido" é uma só.

export type DiaEditavel = { ativo: boolean; inicio: string; fim: string }

export type Rascunho = {
  frequenta_escola: boolean | null
  escolaInicio: string
  escolaFim: string
  dias: Record<DiaChave, DiaEditavel>
}

export function rascunhoDe(d: Disponibilidade): Rascunho {
  const dias = {} as Record<DiaChave, DiaEditavel>
  for (const { chave } of DIAS) {
    const j = d.dias[chave]
    dias[chave] = { ativo: !!j, inicio: j?.inicio ?? "", fim: j?.fim ?? "" }
  }
  return {
    frequenta_escola: d.frequenta_escola,
    escolaInicio: d.escola?.inicio ?? "",
    escolaFim: d.escola?.fim ?? "",
    dias,
  }
}

export function lerRascunho(r: Rascunho): { disponibilidade: Disponibilidade; erros: ErroDisponibilidade[] } {
  const erros: ErroDisponibilidade[] = []
  const d = disponibilidadeVazia()
  d.frequenta_escola = r.frequenta_escola

  if (r.frequenta_escola === true) {
    if (r.escolaInicio && r.escolaFim) d.escola = { inicio: r.escolaInicio, fim: r.escolaFim }
    else erros.push({ campo: "escola", mensagem: "Escola: escolha o horário de entrada e de saída." })
  }

  for (const dia of DIAS) {
    const e = r.dias[dia.chave]
    if (!e.ativo) continue
    if (e.inicio && e.fim) d.dias[dia.chave] = { inicio: e.inicio, fim: e.fim }
    else erros.push({ campo: dia.chave, mensagem: `${dia.longo}: escolha o horário de início e de fim.` })
  }

  return { disponibilidade: d, erros: [...erros, ...validar(d)] }
}

// ─── Banco ↔ tela ─────────────────────────────────────────────────────────────

/** Colunas de conteúdo da tabela (o que o jsonb das RPCs carrega). */
export type ColunasDisponibilidade = {
  frequenta_escola: boolean | null
  escola_inicio: string | null
  escola_fim: string | null
} & { [K in `${DiaChave}_inicio` | `${DiaChave}_fim`]: string | null }

function janelaDe(inicio: string | null | undefined, fim: string | null | undefined): Janela {
  const i = horaCurta(inicio)
  const f = horaCurta(fim)
  return i && f ? { inicio: i, fim: f } : null
}

export function deColunas(linha: Partial<ColunasDisponibilidade>): Disponibilidade {
  const dias = {} as Record<DiaChave, Janela>
  for (const { chave } of DIAS) dias[chave] = janelaDe(linha[`${chave}_inicio`], linha[`${chave}_fim`])
  const frequenta = linha.frequenta_escola ?? null
  return {
    frequenta_escola: frequenta,
    escola: frequenta === false ? null : janelaDe(linha.escola_inicio, linha.escola_fim),
    dias,
  }
}

export function paraColunas(d: Disponibilidade): ColunasDisponibilidade {
  const escola = d.frequenta_escola === false ? null : d.escola
  const colunas = {
    frequenta_escola: d.frequenta_escola,
    escola_inicio: escola?.inicio ?? null,
    escola_fim: escola?.fim ?? null,
  } as ColunasDisponibilidade
  for (const { chave } of DIAS) {
    colunas[`${chave}_inicio`] = d.dias[chave]?.inicio ?? null
    colunas[`${chave}_fim`] = d.dias[chave]?.fim ?? null
  }
  return colunas
}

// ─── Histórico ────────────────────────────────────────────────────────────────

const fmtJanela = (j: Janela) => (j ? `${j.inicio}–${j.fim}` : "—")
const mesmaJanela = (a: Janela, b: Janela) => (a?.inicio ?? null) === (b?.inicio ?? null) && (a?.fim ?? null) === (b?.fim ?? null)

/**
 * O que mudou de uma versão para a outra, em frases curtas para a linha do
 * tempo. Lista vazia = nada mudou (o envio só confirmou).
 */
export function diferencas(anterior: Disponibilidade, atual: Disponibilidade): string[] {
  const mudancas: string[] = []

  if (anterior.frequenta_escola !== atual.frequenta_escola && atual.frequenta_escola === false) {
    mudancas.push("Escola: passou a não frequentar")
  } else if (anterior.frequenta_escola === false && atual.frequenta_escola === true) {
    mudancas.push(`Escola: passou a frequentar${atual.escola ? ` (${fmtJanela(atual.escola)})` : ""}`)
  } else if (!mesmaJanela(anterior.escola, atual.escola)) {
    mudancas.push(`Escola: ${fmtJanela(anterior.escola)} → ${fmtJanela(atual.escola)}`)
  }

  for (const dia of DIAS) {
    const a = anterior.dias[dia.chave]
    const b = atual.dias[dia.chave]
    if (mesmaJanela(a, b)) continue
    if (!a && b) mudancas.push(`${dia.curto}: incluído ${fmtJanela(b)}`)
    else if (a && !b) mudancas.push(`${dia.curto}: removido (era ${fmtJanela(a)})`)
    else mudancas.push(`${dia.curto}: ${fmtJanela(a)} → ${fmtJanela(b)}`)
  }

  return mudancas
}

function normalizarTexto(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export type Declarante = { nome: string | null; parentesco: string | null }

/**
 * A pessoa da família que declarou mudou de uma versão para a outra?
 *
 * É o alerta do caso pai × mãe. Só compara quando AS DUAS versões têm nome: a
 * edição da equipe sem "informado por" e a importação sem responsável não dizem
 * quem era, e acusar troca de pessoa nesses casos seria ruído.
 */
export function mudouQuemPreenche(anterior: Declarante, atual: Declarante): boolean {
  const a = normalizarTexto(anterior.nome)
  const b = normalizarTexto(atual.nome)
  if (!a || !b) return false
  return a !== b || normalizarTexto(anterior.parentesco) !== normalizarTexto(atual.parentesco)
}

// ─── Privacidade ──────────────────────────────────────────────────────────────

const CONECTIVOS = new Set(["da", "de", "do", "das", "dos", "e"])

/**
 * "Maria Silva Oliveira" → "Maria S. O."
 *
 * O formulário público acha o paciente pelo CPF. Quem digitar um CPF qualquer
 * não deve sair com o nome completo de uma criança em tratamento (dado de saúde,
 * LGPD); a família, que sabe o nome, reconhece pelas iniciais.
 */
export function nomeMascarado(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return ""
  const [primeiro, ...resto] = partes
  const iniciais = resto
    .filter((p) => !CONECTIVOS.has(p.toLowerCase()))
    .map((p) => `${p.charAt(0).toUpperCase()}.`)
  const primeiroFormatado = primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
  return [primeiroFormatado, ...iniciais].join(" ")
}
