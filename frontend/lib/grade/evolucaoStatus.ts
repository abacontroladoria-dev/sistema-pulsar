import type { ResumoEvolucaoGrade, StatusVisualEvolucao } from "@/types/grade"

export type InfoStatusVisualEvolucao = {
  codigo: StatusVisualEvolucao
  rotulo: string
  descricaoCurta: string
}

/**
 * Extrai a data ("AAAA-MM-DD") e o horário ("HH:MM") no fuso de Brasília
 * (`America/Sao_Paulo`), garantindo que a virada de 09:59 → 10:01 funcione de
 * forma idêntica em qualquer dispositivo.
 */
export function agoraBrasiliaPartes(agora: Date = new Date()): { data: string; hhmm: string } {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const partes = fmt.formatToParts(agora)
  const map: Record<string, string> = {}
  for (const p of partes) {
    if (p.type !== "literal") map[p.type] = p.value
  }
  const ano = map.year ?? "1970"
  const mes = map.month ?? "01"
  const dia = map.day ?? "01"
  // Em alguns motores 24h meia-noite pode vir "24"
  const horaBruta = map.hour === "24" ? "00" : (map.hour ?? "00")
  const minuto = map.minute ?? "00"
  return {
    data: `${ano}-${mes}-${dia}`,
    hhmm: `${horaBruta}:${minuto}`,
  }
}

/**
 * Verifica se o horário agendado (`data` "AAAA-MM-DD" + `horaInicio` "HH:MM" ou "HH:MM:SS")
 * já passou no relógio de Brasília.
 *
 * Regra solicitada:
 * - Agendamento 10:00 e agora 09:59 (ou 10:00) → false (permanece azul, futuro)
 * - Agendamento 10:00 e agora 10:01 → true (fica amarelo, sem registro que já passou)
 */
export function sessaoJaPassou(
  dataSessao: string,
  horaInicioSessao: string,
  agora: Date = new Date(),
): boolean {
  const { data: hojeBr, hhmm: agoraHhmm } = agoraBrasiliaPartes(agora)
  const inicioHhmm = (horaInicioSessao || "00:00").slice(0, 5)
  if (dataSessao < hojeBr) return true
  if (dataSessao > hojeBr) return false
  return agoraHhmm > inicioHhmm
}

/**
 * Resolve o ícone/cor de evolução terapêutica ao lado do cartão da sessão em
 * `/cronograma/grade?visao=profissional`.
 *
 * Regra crítica de negócio:
 * - `inconsistencia` (recepção marcou falta + terapeuta marcou evoluído) SÓ pode
 *   aparecer para `ehAdmin = true`. Para o profissional (`ehAdmin = false`),
 *   nunca aparece a cor nem o termo "Inconsistência" — ele vê apenas que a
 *   recepção alegou falta (`cancelado` / vermelho).
 */
export function resolverStatusVisualEvolucao(params: {
  data: string
  horaInicio: string
  resumo?: ResumoEvolucaoGrade | null
  ehAdmin: boolean
  agora?: Date
}): InfoStatusVisualEvolucao {
  const { data, horaInicio, resumo, ehAdmin, agora = new Date() } = params

  const faltaRecepcao = Boolean(resumo?.falta_recepcao)
  const possuiTratativa = Boolean(resumo?.possui_tratativa)
  const statusExec = (resumo?.status_execucao ?? "").toLowerCase()
  const ehCancelado =
    statusExec.includes("cancel") ||
    statusExec === "falta" ||
    Boolean(resumo?.tipo_falta)

  // 1. Inconsistência (Recepção alegou falta, mas houve evolução)
  if (faltaRecepcao && (possuiTratativa || Boolean(resumo?.inconsistencia))) {
    if (ehAdmin) {
      return {
        codigo: "inconsistencia",
        rotulo: "Inconsistência",
        descricaoCurta: "Recepção marcou falta, mas consta evolução registrada",
      }
    }
    return {
      codigo: "cancelado",
      rotulo: "Falta informada pela recepção",
      descricaoCurta: "A recepção registrou falta neste atendimento",
    }
  }

  // 2. Evoluído (Verde)
  if (possuiTratativa) {
    const quem = resumo?.tratativa_profissional_nome
      ? `Realizado por ${resumo.tratativa_profissional_nome}`
      : "Atendimento evoluído"
    return {
      codigo: "evoluido",
      rotulo: "Evoluído",
      descricaoCurta: resumo?.substituicao ? `${quem} (Substituição)` : quem,
    }
  }

  // 3. Cancelado / Falta (Vermelho)
  if (ehCancelado || faltaRecepcao) {
    if (faltaRecepcao && !ehCancelado) {
      return {
        codigo: "cancelado",
        rotulo: "Falta informada pela recepção",
        descricaoCurta: "A recepção registrou falta neste atendimento",
      }
    }
    const tipo = resumo?.tipo_falta === "terapeuta"
      ? "Falta do profissional"
      : resumo?.tipo_falta === "paciente"
        ? "Falta do paciente"
        : "Agendamento cancelado (falta)"
    return {
      codigo: "cancelado",
      rotulo: tipo,
      descricaoCurta: tipo,
    }
  }

  // 4. Sem registro para atendimento que já passou (Amarelo) vs Futuro (Azul)
  if (sessaoJaPassou(data, horaInicio, agora)) {
    return {
      codigo: "sem_registro_passado",
      rotulo: "Sem registro",
      descricaoCurta: "Atendimento já passou e está sem evolução ou falta registrada",
    }
  }

  return {
    codigo: "futuro",
    rotulo: "Agendamento futuro",
    descricaoCurta: "Atendimento agendado (ainda não iniciado)",
  }
}

/**
 * Formata o cabeçalho exigido no painel lateral:
 * "Planejamento do dia DD/MM/AAAA - Hora HH:MM às HH:MM - Nome da Terapia"
 */
export function formatarPlanejamentoSessao(
  dataIso: string,
  horaInicio: string,
  horaFim: string,
  terapiaNome: string,
): string {
  const [ano, mes, dia] = (dataIso || "").split("-")
  const dataBr = dia && mes && ano ? `${dia}/${mes}/${ano}` : dataIso
  const ini = (horaInicio || "").slice(0, 5)
  const fim = (horaFim || "").slice(0, 5)
  return `Planejamento do dia ${dataBr} - Hora ${ini} às ${fim} - ${terapiaNome}`
}
