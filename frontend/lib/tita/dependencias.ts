// O que ainda lê as cópias do TiTa (levantamento de 15/10/2026). Enquanto esta
// lista não zerar, desligar o TiTa congela essas telas: elas continuariam
// mostrando a última cópia. Repontar cada uma para a agenda do Pulsar
// (grade_agendamentos) é a Etapa 4, fora do plano de independência atual.
//
// Ao repontar um módulo, tire-o daqui: a página "Carregar do TiTa" mostra esta
// lista e só considera o corte seguro com ela vazia.

export type DependenciaTita = { modulo: string; le: string; porque: string }

export const DEPENDENCIAS_TITA: DependenciaTita[] = [
  { modulo: "Ocupação, Reposição e Ocupar Profissionais", le: "csv_grades_profissionais", porque: "horários livres e ocupados vêm da grade do TiTa" },
  { modulo: "Indicadores (Pacientes, Unidade, Comparativo)", le: "csv_grades_profissionais", porque: "contam sessões da grade do TiTa" },
  { modulo: "Previsão de Receitas", le: "csv_grades_profissionais + csv_situacao_favorecidos", porque: "projeção e convênio vêm do TiTa" },
  { modulo: "Remuneração / RP", le: "csv_grades_profissionais (execução)", porque: "presença, falta e tratativas vêm do TiTa" },
  { modulo: "Auditoria de evoluções e PDI", le: "csv_grades_profissionais (evolução)", porque: "texto da evolução vem do TiTa" },
  { modulo: "Central de Terapeutas / Controle terapêutico", le: "agenda_tita", porque: "chave é o id do agendamento no TiTa" },
  { modulo: "Central / Maia (vagas livres)", le: "central.vw_vagas_livres", porque: "vagas oferecidas vêm da grade do TiTa" },
  { modulo: "Status Contratos", le: "vw_grade_atendimentos", porque: "terapia real do paciente vem do TiTa" },
  { modulo: "Ocupação Paciente → Confirmar implantação", le: "API do TiTa (escrita)", porque: "grava o agendamento no TiTa" },
]
