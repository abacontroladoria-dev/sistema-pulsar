import { pm, exU } from "@/lib/cronograma/helpers"
import { buscarGrade, fixMojibake } from "@/lib/grade/fonte"
import type { CsvRow } from "@/types/cronograma"
import type { GradeComparativoRaw } from "@/lib/cronograma/comparativoSessoes"

// profissional_id entra junto de profissional_nome (e não no lugar dele): o nome
// continua sendo o que a tela mostra e o que o resto do módulo casa, mas o
// cruzamento com grade_profissionais_tita em gradeTitaOcupacao.ts precisa de uma
// chave que não sofra com grafia divergente nem com o prefixo "INATIVO-".
// tita_agendamento_id entra para reconciliarAgendaTita casar as linhas
// 'Agendado' com a agenda_tita. É a única chave que sobrevive a remarcação (a
// coordenada física muda justamente quando a sessão troca de horário) e a que
// permite distinguir "a agenda_tita corrigiu esta sessão" de "a agenda_tita não
// conhece esta sessão" — ver o caso da Equoterapia terceirizada lá.
const FIELDS = "id, tita_agendamento_id, paciente_id, paciente_nome, dia_semana, hora_inicial, hora_final, profissional_id, profissional_nome, terapia_nome, terapia_exibicao_nome, status_agendamento, convenio_nome, sala_nome, data, unidade_nome"

const FIELDS_COMPARATIVO = "paciente_id, paciente_nome, sala_nome, convenio_nome, status_agendamento, data, hora_inicial, terapia_id, terapia_nome, dia_semana, profissional_id, profissional_nome"

// Reexportado porque metade do módulo de cronograma já importa fixMojibake
// daqui. A implementação (mojibake de UTF-8 + entidades HTML cruas, ex.:
// "D&#039;avila" — ver decodeEntidadesHtml em constants.ts) vive em
// lib/grade/fonte.ts, junto da leitura.
export { fixMojibake }

export async function buscarGradeComoCSVRows(dataInicio: string, dataFim: string): Promise<CsvRow[]> {
  // Fonte "base" com unidade explícita, não "atendimentos": esta consulta
  // devolve o status_agendamento adiante (vira "Status do Agendamento" no
  // CsvRow), então precisa enxergar também os slots 'Livre'.
  const all = await buscarGrade<Record<string, string | null>>({
    campos: FIELDS,
    fonte: "base",
    unidade: 280,
    de: dataInicio,
    ate: dataFim,
    ordem: [
      { coluna: "data" },
      { coluna: "hora_inicial" },
      { coluna: "id" },   // desempate único — paginação estável, sem pular/duplicar linhas
    ],
  })

  return all.map((r: Record<string, string | null>) => {
    const hi_str   = String(r.hora_inicial ?? "").slice(0, 5)
    const salaNome = fixMojibake(r.sala_nome)
    return {
      CsvGradeId:               r.id ?? undefined,
      TitaAgendamentoId:        r.tita_agendamento_id === null || r.tita_agendamento_id === undefined ? null : Number(r.tita_agendamento_id),
      PacienteId:               r.paciente_id === null || r.paciente_id === undefined ? null : Number(r.paciente_id),
      ProfissionalId:           r.profissional_id === null || r.profissional_id === undefined ? null : Number(r.profissional_id),
      "Nome Favorecido":        fixMojibake(r.paciente_nome),
      "Dia da Semana":          r.dia_semana            ?? "",
      "Hora Inicial":           hi_str,
      "Terapia":                fixMojibake(r.terapia_nome),
      "Terapia Exibição":       fixMojibake(r.terapia_exibicao_nome),
      "Profissional":           fixMojibake(r.profissional_nome),
      "Status do Agendamento":  r.status_agendamento    ?? "",
      "Convênio":               fixMojibake(r.convenio_nome),
      "Sala":                   salaNome,
      "Data":                   r.data                  ?? "",
      HI_str:                   hi_str,
      HI:                       pm(hi_str),
      Unidade:                  exU(salaNome),
    } as unknown as CsvRow
  })
}

/**
 * Busca sessões de csv_grades_profissionais pra comparativo entre períodos —
 * sem filtro de unidade (o Comparativo de Sessões precisa de TODAS as
 * unidades, ao contrário de buscarGradeComoCSVRows que serve o fluxo
 * operacional restrito à unidade 280) e já trazendo paciente_id, necessário
 * pra excluir pacientes fictícios/administrativos por ID (ver
 * PACIENTES_FICTICIOS_IDS em comparativoSessoes.ts).
 */
export async function buscarGradeComparativo(dataInicio: string, dataFim: string): Promise<GradeComparativoRaw[]> {
  // Sem `unidade`: é justamente o que distingue esta consulta da anterior.
  const all = await buscarGrade<Record<string, string | number | null>>({
    campos: FIELDS_COMPARATIVO,
    fonte: "base",
    de: dataInicio,
    ate: dataFim,
    ordem: [{ coluna: "data" }, { coluna: "id" }],
  })

  return all.map(r => ({
    paciente_id:        r.paciente_id === null || r.paciente_id === undefined ? null : Number(r.paciente_id),
    paciente_nome:       fixMojibake(r.paciente_nome as string | null),
    sala_nome:           fixMojibake(r.sala_nome as string | null),
    convenio_nome:       fixMojibake(r.convenio_nome as string | null),
    status_agendamento:  (r.status_agendamento as string | null) ?? "",
    data:                (r.data as string | null) ?? "",
    hora_inicial:        (r.hora_inicial as string | null) ?? null,
    terapia_id:          r.terapia_id === null || r.terapia_id === undefined ? null : Number(r.terapia_id),
    terapia_nome:        fixMojibake(r.terapia_nome as string | null),
    dia_semana:          (r.dia_semana as string | null) ?? null,
    profissional_id:     r.profissional_id === null || r.profissional_id === undefined ? null : Number(r.profissional_id),
    profissional_nome:   fixMojibake(r.profissional_nome as string | null),
  }))
}
