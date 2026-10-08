// Convênio do paciente na tela Status Laudos e Senhas.
//
// Módulo PURO. A fonte é a GRADE do TiTa (função grade_convenio_por_paciente,
// migration 20260930140000) — o convênio do próximo agendamento, ou do último
// quando não há futuro. Pedido do usuário (28/09/2026): "o convênio você vai
// puxar do mesmo local que resulta de 'Grade · N horários'".
//
// Quando a grade não tem o paciente (19 de 358 laudos, medido em 28/09/2026 —
// sem nenhum agendamento), vale o `Plano` do relatório do Órbita, e a origem
// fica marcada: um laudo não pode ficar sem convênio só porque o paciente não
// está na agenda.

/** Uma linha de grade_convenio_por_paciente(). */
export interface ConvenioDaGrade {
  /** `paciente_id` da grade = `ID Favorecido` do laudo. */
  pacienteId: number
  convenio: string
  /** Data do agendamento que decidiu o convênio. */
  dataReferencia: string | null
  /** `true` = próximo agendamento; `false` = último agendamento passado. */
  futuro: boolean
}

export type OrigemConvenio = "grade" | "orbita"

/**
 * Chave do filtro para laudo sem convênio nenhum (nem na grade, nem no Órbita).
 * String vazia de propósito: nenhum convênio real tem nome vazio.
 */
export const SEM_CONVENIO = ""

/** Grafia exata da grade/Órbita. */
export const CONVENIO_ASSIM = "ASSIM Saúde"
export const CONVENIO_LEVE = "LEVE SAUDE"

/**
 * Os convênios com que a tela abre: ASSIM e LEVE, os dois cuja senha a tela
 * acompanha — pedido do usuário (29/09/2026): abrir em "Senhas ASSIM e LEVE".
 * Substitui o padrão de 28/09/2026, que abria só na ASSIM.
 */
export const CONVENIOS_PADRAO: readonly string[] = [CONVENIO_ASSIM, CONVENIO_LEVE]

/** Comparável: sem acento, sem caixa, espaços colapsados. */
function chave(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Convênios que deixaram de existir por incorporação: o nome antigo (como vem
 * da grade ou do Órbita) → o convênio que o absorveu.
 *
 * MEMORIAL SAÚDE LTDA → ASSIM Saúde: a ASSIM comprou a MEMORIAL (usuário,
 * 29/09/2026). Medido no mesmo dia: 20 laudos com MEMORIAL (14 pela grade, 6
 * pelo Órbita), todos de paciente inativo, nenhum no relatório de senhas.
 * Fusão nova = uma linha aqui.
 */
const CONVENIOS_INCORPORADOS: Record<string, string> = {
  [chave("MEMORIAL SAÚDE LTDA")]: CONVENIO_ASSIM,
}

/** O convênio é ASSIM? Casa a grafia da grade e do Órbita ("ASSIM Saúde"). */
export function planoEhAssim(plano: string): boolean {
  return /\bassim\b/.test(chave(plano))
}

/** O convênio é LEVE? Casa "LEVE SAUDE" (grade/Órbita) com ou sem acento. */
export function planoEhLeve(plano: string): boolean {
  return /\bleve\b/.test(chave(plano))
}

/**
 * Os convênios cuja senha a tela acompanha: ASSIM e LEVE — pedido do usuário
 * (29/09/2026). O relatório de autorizações traz os dois (medido no mesmo dia:
 * 791 autorizações ASSIM, 5 LEVE). Decide "Sem senha" × "não se aplica" quando
 * o laudo não aparece no relatório.
 */
export function convenioTemSenha(plano: string): boolean {
  return planoEhAssim(plano) || planoEhLeve(plano)
}

/** O nome do painel de senhas: "Senhas ASSIM", "Senhas LEVE" ou os dois. */
export type ConveniosDaSenha = "ASSIM" | "LEVE" | "ASSIM e LEVE"

/**
 * Qual convênio de senha o filtro "Convênio" deixa na tela. Vazio (= todos) ou
 * com os dois marcados → "ASSIM e LEVE"; só um dos dois marcado → ele. Sem
 * nenhum dos dois (ex.: só Particular), fica o nome completo: o painel não
 * deixa de ser o das senhas ASSIM e LEVE por o filtro apontar para outro lugar.
 */
export function conveniosDaSenha(convenios: Set<string>): ConveniosDaSenha {
  const nomes = [...convenios]
  const assim = nomes.some(planoEhAssim)
  const leve = nomes.some(planoEhLeve)
  if (assim && !leve) return "ASSIM"
  if (leve && !assim) return "LEVE"
  return "ASSIM e LEVE"
}

/** O convênio que vale hoje: o próprio, ou quem o incorporou. */
export function convenioVigente(nome: string): string {
  return CONVENIOS_INCORPORADOS[chave(nome)] ?? nome
}

/**
 * Aplica as incorporações a cada item, guardando o nome de origem em
 * `convenioOriginal` para o detalhe poder dizer "MEMORIAL na origem".
 *
 * Roda ANTES das senhas: é o convênio unificado que decide "Sem senha" (ASSIM) ×
 * outro convênio, e o filtro/contagem já nascem somando a MEMORIAL na ASSIM.
 */
export function unificarConvenios<
  T extends { convenio: string | null; convenioOriginal: string | null },
>(itens: T[]): T[] {
  return itens.map((item) => {
    if (!item.convenio) return item
    const vigente = convenioVigente(item.convenio)
    if (vigente === item.convenio) return item
    return { ...item, convenio: vigente, convenioOriginal: item.convenio }
  })
}

/**
 * Troca o convênio de cada item pelo da grade, quando a grade tem o paciente.
 * Sem o paciente na grade, o item fica como veio (o Plano do Órbita).
 *
 * Casa por `idFavorecido` = `paciente_id` — nunca por nome. A saída tem
 * exatamente os itens de entrada, na mesma ordem.
 */
export function juntarComConvenio<
  T extends { idFavorecido: number | null; convenio: string | null; convenioOrigem: OrigemConvenio | null },
>(itens: T[], daGrade: ConvenioDaGrade[]): { itens: T[]; pelaGrade: number } {
  const porPaciente = new Map<number, ConvenioDaGrade>()
  for (const c of daGrade) porPaciente.set(c.pacienteId, c)

  let pelaGrade = 0
  const saida = itens.map((item) => {
    const c = item.idFavorecido !== null ? porPaciente.get(item.idFavorecido) : undefined
    if (!c) return item
    pelaGrade++
    return { ...item, convenio: c.convenio, convenioOrigem: "grade" as const }
  })
  return { itens: saida, pelaGrade }
}

/**
 * As opções do filtro "Convênio": os convênios que APARECEM na lista, com
 * quantos laudos cada um tem, do mais frequente para o menos. "Sem convênio"
 * por último, e só se existir.
 *
 * Tirado dos itens, e não de uma lista fixa: convênio novo no TiTa aparece no
 * filtro sem mudar código, e um convênio sem laudo não vira opção morta.
 */
export function opcoesDeConvenio(
  itens: { convenio: string | null }[],
): { id: string; nome: string }[] {
  const contagem = new Map<string, number>()
  for (const i of itens) {
    const k = i.convenio ?? SEM_CONVENIO
    contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  return [...contagem.entries()]
    .sort(([a, x], [b, y]) => {
      if (a === SEM_CONVENIO) return 1
      if (b === SEM_CONVENIO) return -1
      return y - x || a.localeCompare(b, "pt-BR")
    })
    .map(([id, n]) => ({ id, nome: `${id === SEM_CONVENIO ? "Sem convênio" : id} (${n})` }))
}
