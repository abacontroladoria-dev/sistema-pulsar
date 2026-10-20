// ─── Conferência de uma vaga contra a grade do TiTa AO VIVO ───────────────────
//
// A unidade de uma vaga não é um dado próprio: sai da sala (exU), e a sala sai
// de csv_grades_profissionais, que só é reescrita de madrugada (sync-grade-csv,
// 02:00). Entre uma rodada e outra o TiTa continua mudando, e a cópia não vê.
//
// Caso que motivou isto (medido em 19 e 20/10/2026): Lívia dos Santos Barboza
// (profissional_id 18987), quarta-feira. Às 14:10 de 19/10 a quarta dela foi
// refeita no TiTa — grade nova (grade_terapeuta_id 74283→74295) na Fazendinha,
// Sala 8, com 11 dos 13 horários já agendados. A cópia do Pulsar ainda a tinha
// em Realengo, Sala 23, com a quarta inteira Livre, e "Criar Novo Cronograma"
// ofereceu 10:40 e 11:20 com selo "Realengo" para um paciente com a unidade
// travada em Realengo. O sync da madrugada seguinte corrigiu a cópia sozinho
// (inativou as 13 linhas de Realengo como 'excluido' e inseriu as da
// Fazendinha) — a cópia não estava quebrada, estava velha.
//
// Não há como a cópia acompanhar o dia: o endpoint de agendamentos
// (csv_grade_profissionais) leva ~20s por dia de grade. O endpoint da GRADE
// (GET grade_profissionais, o mesmo que alimenta grade_profissionais_tita)
// responde um dia em ~4s e traz o que a conferência precisa — sala, status e
// grade_terapeuta_id —, sem dado de paciente. Medido em 20/10/2026, semana
// 02–06/11: os 5 dias em paralelo voltam em ~7s; das 691 vagas Livre da cópia,
// 691 casaram com o TiTa pela chave (profissional, data, hora), com nome e id de
// sala idênticos — nenhum falso-positivo de grafia entre os dois endpoints.
//
// O que NÃO se compara, e por quê: terapia. O id de terapia de uma vaga Livre
// diverge entre os dois endpoints em 72 das mesmas 691 vagas sem que nada
// esteja errado — compará-lo recusaria vaga boa.
//
// Este arquivo é só a regra (sem rede): quem busca é
// services/tita/gradeAoVivo.ts; quem usa é a rota de implantação
// (app/api/tita/confirmar-agendamento) e a oferta em gradeTitaOcupacao.ts.

import { exU } from "./helpers"

/** Uma linha de GET /integracao/grade_profissionais, só com o que a conferência usa. */
export interface LinhaGradeTita {
  profissional_id: number
  /** YYYY-MM-DD */
  data: string
  /** HH:MM:SS, como o TiTa manda. */
  hora_inicial: string
  status_agendamento: string | null
  id_sala: number | null
  sala: string | null
  grade_terapeuta_id: number | null
}

const hhmm = (hora: unknown): string => String(hora ?? "").slice(0, 5)
const dia = (data: unknown): string => String(data ?? "").slice(0, 10)

/** `profissionalId|||YYYY-MM-DD|||HH:MM` — a mesma chave exata da regra C2. */
export const chaveGradeTita = (profissionalId: number, data: unknown, hora: unknown): string =>
  `${profissionalId}|||${dia(data)}|||${hhmm(hora)}`

/**
 * Agrupa por chave. Mais de uma linha na mesma chave é sessão em grupo
 * (medido: 56 chaves na semana de 02–06/11, todas Agendado+Agendado).
 */
export function indexarGradeTita(linhas: LinhaGradeTita[]): Map<string, LinhaGradeTita[]> {
  const m = new Map<string, LinhaGradeTita[]>()
  for (const l of linhas) {
    const k = chaveGradeTita(l.profissional_id, l.data, l.hora_inicial)
    const lista = m.get(k)
    if (lista) lista.push(l)
    else m.set(k, [l])
  }
  return m
}

/**
 * Unidade de uma sala, ou null quando o nome não diz a unidade.
 *
 * "Desconhecida" vira null de propósito: sala fora do padrão "Unid. X - Sala N"
 * (a "Sala Teste" da homologação, texto digitado à mão) não é prova de
 * divergência, e recusar por ela esconderia vaga boa.
 */
export function unidadeDaSala(sala: string | null | undefined): string | null {
  const u = exU(sala)
  return u === "Desconhecida" ? null : u
}

/** O que a cópia do Pulsar diz sobre a vaga. */
export interface VagaLocal {
  profissionalId: number
  data: string
  horaInicial: string
  salaId?: number | null
  salaNome: string | null
}

export type ConferenciaVaga =
  /** O TiTa tem o horário Livre na mesma unidade. `linha` é a que casou. */
  | { situacao: "confere"; linha: LinhaGradeTita }
  /** O horário existe no TiTa, mas ninguém o oferece Livre. */
  | { situacao: "ocupado" }
  /** O TiTa não tem o horário (grade fechada, refeita ou removida). */
  | { situacao: "ausente" }
  /** Livre no TiTa, mas em OUTRA unidade — o caso da Lívia. */
  | { situacao: "unidade_divergente"; unidadePulsar: string; unidadeTita: string; salaTita: string }

/**
 * Confere uma vaga Livre da cópia contra as linhas do TiTa da mesma chave.
 *
 * Entre várias linhas Livre, ganha a da mesma sala (por id, depois por nome) e,
 * na falta dela, a da mesma unidade: troca de sala DENTRO da unidade não muda
 * nada para a família, e quem escreve no TiTa já usa a sala da grade, não a da
 * cópia (montarPayloadAgendamento).
 */
export function conferirVaga(vaga: VagaLocal, linhasDoSlot: LinhaGradeTita[] | undefined): ConferenciaVaga {
  if (!linhasDoSlot || linhasDoSlot.length === 0) return { situacao: "ausente" }

  const livres = linhasDoSlot.filter(l => l.status_agendamento === "Livre")
  if (livres.length === 0) return { situacao: "ocupado" }

  const mesmaSala = livres.find(l =>
    (vaga.salaId != null && l.id_sala === vaga.salaId)
    || (!!vaga.salaNome && !!l.sala && l.sala.trim() === vaga.salaNome.trim()),
  )
  if (mesmaSala) return { situacao: "confere", linha: mesmaSala }

  const unidadePulsar = unidadeDaSala(vaga.salaNome)
  // Sem unidade legível na cópia não há o que divergir: fica com a primeira.
  if (unidadePulsar === null) return { situacao: "confere", linha: livres[0] }

  const mesmaUnidade = livres.find(l => {
    const u = unidadeDaSala(l.sala)
    return u === null || u === unidadePulsar
  })
  if (mesmaUnidade) return { situacao: "confere", linha: mesmaUnidade }

  const outra = livres[0]
  return {
    situacao: "unidade_divergente",
    unidadePulsar,
    unidadeTita: unidadeDaSala(outra.sala) ?? "outra unidade",
    salaTita: outra.sala ?? "",
  }
}

export type ConferenciaEscrita =
  | ConferenciaVaga
  /**
   * A unidade bate, mas a grade ou a sala que a implantação mandaria ao TiTa
   * (resolvidas em grade_profissionais_tita, a cópia de madrugada) não são mais
   * as de lá: a grade do profissional foi refeita depois da cópia.
   */
  | { situacao: "alterado" }

/**
 * Confere o que a implantação VAI GRAVAR, não só a vaga que a tela mostrou.
 *
 * O payload (montarPayloadAgendamento) leva `id_grade_terapeuta` e `id_sala`
 * da cópia grade_profissionais_tita. Se a grade foi refeita no TiTa depois da
 * cópia — como a da Lívia, com grade_terapeuta_id novos —, esses ids apontam
 * para uma grade que não existe mais ou para a sala antiga. Por isso, além da
 * unidade (conferirVaga), a linha do TiTa com o MESMO grade_terapeuta_id tem
 * de existir, estar Livre e estar na mesma sala.
 */
export function conferirEscrita(
  vaga: VagaLocal,
  linhasDoSlot: LinhaGradeTita[] | undefined,
  escrita: { gradeTerapeutaId: number; idSala: number },
): ConferenciaEscrita {
  const base = conferirVaga(vaga, linhasDoSlot)
  if (base.situacao !== "confere") return base

  const destino = (linhasDoSlot ?? []).find(l => l.grade_terapeuta_id === escrita.gradeTerapeutaId)
  if (!destino) return { situacao: "alterado" }
  if (destino.status_agendamento !== "Livre") return { situacao: "ocupado" }

  const unidadePulsar = unidadeDaSala(vaga.salaNome)
  const unidadeDestino = unidadeDaSala(destino.sala)
  if (unidadePulsar !== null && unidadeDestino !== null && unidadeDestino !== unidadePulsar) {
    return { situacao: "unidade_divergente", unidadePulsar, unidadeTita: unidadeDestino, salaTita: destino.sala ?? "" }
  }
  if (destino.id_sala !== escrita.idSala) return { situacao: "alterado" }
  return { situacao: "confere", linha: destino }
}
