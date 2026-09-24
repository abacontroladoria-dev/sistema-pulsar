/** DD/MM/YYYY e HH:MI:SS em horário de Brasília — formato das colunas data/hora de aumentar_ocupacao_paciente_auditoria. */
export function dataHoraBrasilia(agora: Date = new Date()): { data: string; hora: string } {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(agora)
  const get = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? ""
  return {
    data: `${get("day")}/${get("month")}/${get("year")}`,
    hora: `${get("hour")}:${get("minute")}:${get("second")}`,
  }
}
