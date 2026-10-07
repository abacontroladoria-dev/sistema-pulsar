import "server-only"

import { buscarGradePorId, resolverGradeTerapeuta, resolverIdFavorecido, terapiaExibicaoIdPorRegraFixa } from "./mappings"
import { montarPayloadAgendamento } from "./payload"
import type { AgendaFavorecidoTita, AgendamentoTitaPayload, DisponibilidadeResponse, GradeProfissionalRow, TitaApiResult } from "./types"

export interface PreparacaoAgendamento {
  ok: boolean
  payload?: AgendamentoTitaPayload
  erro?: string
  /**
   * A linha de csv_grades_profissionais que originou o payload.
   *
   * Devolvida porque o aviso de inclusão ao cronograma (ver
   * services/tita/inclusaoTerapia.ts) precisa de paciente, terapia,
   * profissional, sala, unidade e CONVÊNIO — e todos já foram lidos aqui, por
   * `select("*")`. Sem isto a rota teria de reler a mesma linha depois da
   * criação, uma ida ao banco por sessão sem nada em troca.
   *
   * O convênio é o caso que justifica sozinho: na tela ele vem do CSV de laudos,
   * que só existe no navegador — daqui o servidor não depende do cliente.
   */
  grade?: GradeProfissionalRow
}

/**
 * Busca a grade, resolve id_grade_terapeuta e monta o payload do TiTa para uma
 * sessão — sem fazer nenhuma chamada HTTP ao TiTa. Usado como fase de preparação
 * antes de checar disponibilidade e criar o agendamento (ver confirmar-agendamento
 * route handler), para que uma sessão com dado ausente/inconsistente seja
 * descartada antes de qualquer efeito colateral externo.
 */
export async function prepararAgendamento(
  csvGradeId: string,
  pacienteNome: string,
  terapiaExibicaoOverride?: number,
  idFavorecidoFallback?: number,
): Promise<PreparacaoAgendamento> {
  try {
    const grade = await buscarGradePorId(csvGradeId)
    if (!grade) {
      console.error("[tita:prepararAgendamento] grade_nao_encontrada", JSON.stringify({ csvGradeId }))
      return { ok: false, erro: "grade_nao_encontrada" }
    }
    if (grade.profissional_id == null || !grade.hora_inicial) {
      console.error(
        "[tita:prepararAgendamento] grade_sem_profissional_id_ou_hora_inicial",
        JSON.stringify({ csvGradeId, grade }),
      )
      return { ok: false, erro: "grade_sem_profissional_id_ou_hora_inicial" }
    }

    const gradeTerapeuta = await resolverGradeTerapeuta(
      grade.profissional_id,
      grade.data,
      grade.hora_inicial,
    )
    if (gradeTerapeuta == null) {
      // resolverGradeTerapeuta já loga o detalhe (profissionalId/data/horaInicial)
      // no ponto exato da falha — aqui só é preciso registrar qual sessão foi cancelada.
      console.error(
        "[tita:prepararAgendamento] id_grade_terapeuta_nao_encontrado — sincronização cancelada",
        JSON.stringify({ csvGradeId }),
      )
      return { ok: false, erro: "id_grade_terapeuta_nao_encontrado" }
    }
    // Prioridade: override do cliente (Aplicador ABA AE/HS — depende de laudo +
    // convênio do paciente, dado que só existe no navegador, ver
    // terapiaExibicaoOverride em OcupPacMode.tsx) > valor sincronizado de
    // grade_profissionais_tita > regra fixa por terapia_id (ver
    // terapiaExibicaoIdPorRegraFixa em mappings.ts, usada quando o
    // grade_terapeuta_id nunca teve histórico sincronizado — comum em slots
    // nunca antes reservados no TiTa).
    const terapiaExibicaoId = terapiaExibicaoOverride
      ?? gradeTerapeuta.terapiaExibicaoId
      ?? (grade.terapia_id != null ? terapiaExibicaoIdPorRegraFixa(grade.terapia_id) : null)

    if (gradeTerapeuta.idSala == null || terapiaExibicaoId == null) {
      // Diagnóstico de cobertura de dados (achado da homologação: ~9% das grades
      // "Livre" têm terapia_exibicao_id sincronizado). Registrar exatamente os
      // campos que permitem localizar e corrigir a sincronização, sem tentar
      // inferir um valor — inferir arriscaria enviar sala/terapia errada ao TiTa.
      console.error(
        "[tita:prepararAgendamento] grade_terapeuta_sem_sala_ou_exibicao",
        JSON.stringify({
          profissional_id: grade.profissional_id,
          profissional_nome: grade.profissional_nome,
          data: grade.data,
          hora_inicial: grade.hora_inicial,
          grade_terapeuta_id: gradeTerapeuta.gradeTerapeutaId,
          id_sala: gradeTerapeuta.idSala,
          terapia_exibicao_id: gradeTerapeuta.terapiaExibicaoId,
          terapia_id: grade.terapia_id,
        }),
      )
      return { ok: false, erro: "grade_terapeuta_sem_sala_ou_exibicao" }
    }

    // csvGradeId sempre aponta para uma linha "Livre" (sem paciente próprio) — o
    // id_favorecido vem de uma linha "Agendado" existente do mesmo paciente, ou do
    // laudo quando o paciente ainda não tem nenhuma (ver resolverIdFavorecido).
    const idFavorecido = await resolverIdFavorecido(pacienteNome, idFavorecidoFallback)
    if (idFavorecido == null) {
      console.error(
        "[tita:prepararAgendamento] id_favorecido_nao_encontrado — sincronização cancelada",
        JSON.stringify({ csvGradeId, pacienteNome }),
      )
      return { ok: false, erro: "id_favorecido_nao_encontrado" }
    }

    const payload = montarPayloadAgendamento(grade, idFavorecido, { ...gradeTerapeuta, terapiaExibicaoId })
    return { ok: true, payload, grade }
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error("[tita:prepararAgendamento] erro inesperado", JSON.stringify({ csvGradeId, mensagem }))
    return { ok: false, erro: mensagem }
  }
}

/**
 * Traduz um código de erro interno para uma mensagem amigável ao usuário final.
 * Códigos não mapeados caem no fallback genérico — nunca expõe mensagem técnica
 * bruta (stack, JSON de resposta HTTP, etc.) na interface.
 */
// Mensagens orientadas ao usuário — falam de "implantação" (fluxo atual, imediato)
// e nunca expõem termos técnicos internos (nomes de tabela, IDs, "sincronização",
// "CSV", "API"). Cada código interno mapeia para a causa como o usuário a percebe.
const MENSAGENS_AMIGAVEIS: Record<string, string> = {
  grade_nao_encontrada: "Este horário ainda não está disponível para implantação. Aguarde alguns minutos e tente novamente.",
  grade_sem_profissional_id_ou_hora_inicial: "Este horário ainda não está totalmente configurado para implantação. Tente novamente mais tarde.",
  id_grade_terapeuta_nao_encontrado: "Este horário ainda não está disponível para implantação. Aguarde alguns minutos e tente novamente.",
  id_favorecido_nao_encontrado: "Não foi possível preparar este paciente para implantação. Contate o suporte.",
  grade_terapeuta_sem_sala_ou_exibicao: "Este horário ainda não está totalmente configurado para implantação. Tente novamente mais tarde.",
  indisponivel_na_tita: "Este horário não está mais disponível para implantação. Gere uma nova sugestão.",
  erro_ao_verificar_disponibilidade: "Não foi possível verificar a disponibilidade deste horário agora. Tente novamente em instantes.",
}

export function mensagemAmigavel(codigoErro: string | undefined): string {
  if (!codigoErro) return "Não foi possível concluir a implantação. Tente novamente."
  return MENSAGENS_AMIGAVEIS[codigoErro] ?? "Não foi possível concluir a implantação. Tente novamente ou contate o suporte."
}

/**
 * Único status possível ao interpretar get_disponibilidade — todo código que
 * decide se uma grade está disponível deve passar por interpretarDisponibilidade,
 * nunca ler resultado.data diretamente (elimina a leitura ad-hoc/legada).
 */
export type StatusDisponibilidade = "disponivel" | "indisponivel" | "erro_verificacao"

/**
 * Interpreta a resposta de POST /integracao/get_disponibilidade.
 * Schema confirmado por chamada real (Sprint 2.1 de homologação), não pelo PDF
 * (que só dizia "Resposta: JSON"): { total_horarios, horarios_ocupados,
 * horarios_livres, percentual }. Não é um booleano — cobre a série semanal
 * inteira entre data_inicial e data_final, podendo ter ocupação parcial.
 *
 * IMPORTANTE (achado real, ver relatório de homologação): agendamento/create
 * NÃO rejeita a criação quando há ocupação parcial — ele cria a série inteira e
 * marca as ocorrências já ocupadas com status_str "Conflito", mantendo as demais
 * como "Planejado". horarios_livres > 0 aqui só decide se vale a pena chamar
 * create (há pelo menos uma ocorrência aproveitável); não garante que a série
 * inteira ficará livre de conflito — ver interpretarResultadoCriacao.
 */
export function interpretarDisponibilidade(resultado: TitaApiResult<DisponibilidadeResponse>): StatusDisponibilidade {
  if (!resultado.ok) return "erro_verificacao"
  if (typeof resultado.data?.horarios_livres === "number") {
    return resultado.data.horarios_livres > 0 ? "disponivel" : "indisponivel"
  }
  // Formato de resposta inesperado (nunca observado em produção): não bloqueia,
  // pois não há como interpretá-lo com segurança.
  return "disponivel"
}

/** Resumo de uma chamada a agendamento/create, já contando ocorrências por resultado. */
export interface ResumoCriacao {
  status: "success" | "partial_success" | "failed" | "erro_api"
  idAgendaFav?: number
  criadas: number
  conflitos: number
  /** Ocorrências com status_str diferente de "Planejado"/"Conflito" — nunca observado, tratado defensivamente. */
  rejeitadas: number
  total: number
}

/**
 * Única função que interpreta o resultado de agendamento/create. Achado da
 * homologação: o TiTa cria a série inteira e retorna status por ocorrência
 * ("Planejado" | "Conflito") em vez de aceitar ou rejeitar tudo — não é
 * transacional. Esta função traduz isso em contagens estáveis para a rota e
 * para as mensagens ao usuário.
 */
export function interpretarResultadoCriacao(resultado: TitaApiResult<AgendaFavorecidoTita[]>): ResumoCriacao {
  const agenda = resultado.ok ? resultado.data?.[0] : undefined
  if (!resultado.ok || !agenda || !Array.isArray(agenda.itens)) {
    return { status: "erro_api", criadas: 0, conflitos: 0, rejeitadas: 0, total: 0 }
  }

  let criadas = 0
  let conflitos = 0
  let rejeitadas = 0
  for (const item of agenda.itens) {
    if (item.status_str === "Planejado") criadas++
    else if (item.status_str === "Conflito") conflitos++
    else rejeitadas++
  }
  const total = criadas + conflitos + rejeitadas

  const status: ResumoCriacao["status"] =
    total === 0 ? "erro_api" : criadas === total ? "success" : criadas === 0 ? "failed" : "partial_success"

  return { status, idAgendaFav: agenda.id, criadas, conflitos, rejeitadas, total }
}

/**
 * Mensagem de negócio para o resultado da implantação — frases orientadas ao que
 * aconteceu com as sessões (Sprint 3), alinhadas ao fluxo de implantação imediata
 * no TiTa (Sprint 4.1). É o texto exibido no toast; sucesso total usa a frase
 * padrão, sucesso parcial detalha quantas foram implantadas × ocupadas.
 */
export function mensagemResumoCriacao(resumo: ResumoCriacao): string {
  if (resumo.status === "erro_api") {
    return "Não foi possível concluir a implantação. Tente novamente ou contate o suporte."
  }

  const naoImplantadas = resumo.conflitos + resumo.rejeitadas
  if (naoImplantadas === 0) {
    return "Implantação realizada com sucesso."
  }
  if (resumo.criadas === 0) {
    return "Nenhuma sessão pôde ser implantada porque os horários já estavam ocupados."
  }
  return (
    `${resumo.criadas} ${resumo.criadas === 1 ? "sessão implantada" : "sessões implantadas"}. ` +
    `${naoImplantadas} ${naoImplantadas === 1 ? "não pôde ser implantada" : "não puderam ser implantadas"} porque já ${naoImplantadas === 1 ? "estava ocupada" : "estavam ocupadas"}.`
  )
}
