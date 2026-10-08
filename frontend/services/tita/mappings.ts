import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { TABELA_GRADE } from "@/lib/grade/fonte"
import { ABA_EXIB_PSICO_IDS, EXIB_ID } from "@/lib/cronograma/constants"
import type { GradeProfissionalRow } from "./types"

/**
 * IDs cuja terapia_exibicao_id é sempre a própria terapia de ação (não Grupo 1,
 * nem Aplicador ABA (AE)/(HS) — que dependem de laudo + convênio do paciente,
 * ver terapiaExibicaoIdCondicional em payload.ts).
 *
 * Confirmado com auditoria de dados reais (2026-08-05, cruzando terapia_id ×
 * terapia_exibicao_id em ~1000 amostras por terapia em grade_profissionais_tita):
 * Apoio Operacional, Avaliação Neuropsicológica, Equoterapia, Especialista
 * Técnico de Área, Estágio, Facilitador Técnico, Fisioterapia, Fonoaudiologia,
 * Psiquiatra/Neurologista, Operações Clínicas, Técnico Terapêutico Particular,
 * Terapia Ocupacional, Triagem — 100% dos casos históricos batem com a própria
 * terapia; Psicomotricidade/Psicopedagogia/Musicoterapia — ≥96,8%. Aplicador
 * Suporte, Psicologia, Fisioterapia Aquática e Terapia Alimentar têm exceções
 * reais no histórico (8–18% dos casos vieram como "Psicologia ABA"), mas
 * confirmado pelo usuário como regra de negócio para ESCREVER novos
 * agendamentos: sempre a própria terapia, independente do que o histórico
 * mostra (as exceções refletem sessões que já eram tratamento, não escrita
 * nova via este fluxo).
 */
const GRUPO2_EXIBICAO_PROPRIA_IDS = new Set([
  2280, 2268, 2267, 2281, 2277, 2278, 2258, 2250, 2695, 2279, 2289, 2255, 2270,
  2251, 2253, 2254,
  2331, 2259, 2249, 2274,
])

/**
 * Regra fixa de terapia_exibicao_id por terapia_id — usada só quando
 * grade_profissionais_tita não tem o valor sincronizado para aquele
 * grade_terapeuta_id em NENHUMA data do seu histórico (ver resolverGradeTerapeuta
 * abaixo). Não cobre Aplicador ABA (AE)/(HS) — ver terapiaExibicaoIdCondicional
 * em payload.ts, que depende de laudo + convênio do paciente.
 */
export function terapiaExibicaoIdPorRegraFixa(terapiaId: number): number | null {
  if (ABA_EXIB_PSICO_IDS.has(terapiaId)) return EXIB_ID.PSICOLOGIA_ABA
  if (GRUPO2_EXIBICAO_PROPRIA_IDS.has(terapiaId)) return terapiaId
  return null
}

/**
 * Busca o registro completo de csv_grades_profissionais pelo seu UUID (coluna id)
 * — identificador único, sem ambiguidade (ver auditoria da página de Ocupação de
 * Paciente). É a partir desse registro que id_favorecido, id_terapia_clinica,
 * id_terapia_exibicao e id_sala são obtidos para montarPayloadAgendamento.
 *
 * EXCEÇÃO deliberada ao ponto único de leitura (lib/grade/fonte.ts): precisa de
 * `sala_id`, que vw_grade_base não projeta, e busca UMA linha por chave primária
 * — nada aqui se beneficia da view. Continua na tabela crua.
 */
export async function buscarGradePorId(
  csvGradeId: string,
  client?: SupabaseClient,
): Promise<GradeProfissionalRow | null> {
  const supabase = client ?? (await createClient())

  const { data, error } = await supabase
    .from(TABELA_GRADE)
    .select("*")
    .eq("id", csvGradeId)
    // Aqui o filtro é uma trava, não só deduplicação: se o TiTa alterou ou removeu
    // este slot depois que a tela foi montada, o sync o deixou com ativo=false
    // (migration 20260805160000). Devolver null faz o chamador responder
    // "grade_not_found", que é o certo — agendar sobre um slot que não existe mais
    // criaria um atendimento fantasma no TiTa.
    .eq("ativo", true)
    .maybeSingle()

  if (error) throw error
  return (data as GradeProfissionalRow | null) ?? null
}

/** Dados da grade do terapeuta no TiTa necessários para montar o payload de agendamento. */
export interface GradeTerapeutaInfo {
  gradeTerapeutaId: number
  idSala: number | null
  terapiaExibicaoId: number | null
}

/**
 * Resolve a grade do terapeuta no TiTa a partir de grade_profissionais_tita.
 *
 * Chave validada com dados reais de produção (ver relatório de auditoria):
 * profissional_id + data + hora_inicial nunca produziu mais de uma correspondência
 * em ~21 mil linhas comparadas — não é preciso reforçar a chave com hora_final,
 * terapia_id, sala_id ou unidade_id.
 *
 * id_sala e terapia_exibicao_id vêm desta tabela (não de csv_grades_profissionais):
 * validado com dados reais que csv_grades_profissionais.terapia_exibicao_id é NULL em
 * 100% das linhas "Livre" (é a origem de todo csvGradeId — ver invariante em
 * OcupPacMode.tsx), e que terapia_id não mapeia 1:1 para terapia_exibicao_id (ex.:
 * "Psicologia" aparece com 3 terapia_exibicao_id distintos), então não é seguro
 * inferir a partir de terapia_id. id_sala vem sempre preenchido na linha casada;
 * terapia_exibicao_id costuma vir NULL para horários vagos e é recuperado por
 * fallback do MESMO grade_terapeuta_id em outra data, com guard de unicidade (ver
 * bloco abaixo). Quando nem assim há um valor seguro, terapia_exibicao_id retorna
 * null e o chamador deve tratar como "não é possível agendar esta grade", não
 * adivinhar um valor.
 *
 * Retorna null (não lança) quando não encontrar correspondência: a causa mais
 * provável é o registro ainda não ter sido sincronizado por sync_tita_grade
 * (defasagem observada de poucos dias em relação a csv_grades_profissionais), não
 * um erro.
 */
export async function resolverGradeTerapeuta(
  profissionalId: number,
  data: string,
  horaInicial: string,
  client?: SupabaseClient,
): Promise<GradeTerapeutaInfo | null> {
  const supabase = client ?? (await createClient())

  const { data: row, error } = await supabase
    .from("grade_profissionais_tita")
    .select("grade_terapeuta_id, id_sala, terapia_exibicao_id")
    .eq("profissional_id", profissionalId)
    .eq("data", data)
    .eq("hora_inicial", horaInicial)
    .maybeSingle()

  if (error) throw error

  const gradeTerapeutaId = (row?.grade_terapeuta_id as number | null | undefined) ?? null

  if (gradeTerapeutaId == null) {
    console.warn(
      "[tita:resolverGradeTerapeuta] Nenhuma correspondência em grade_profissionais_tita",
      JSON.stringify({ profissionalId, data, horaInicial }),
    )
    return null
  }

  const idSala = (row?.id_sala as number | null | undefined) ?? null
  let terapiaExibicaoId = (row?.terapia_exibicao_id as number | null | undefined) ?? null

  // Fallback de terapia_exibicao_id (achado real: o TiTa não publica esse campo
  // para horários vagos — em agosto/2026, 3073 de 3194 slots "Livre" vinham com
  // terapia_exibicao_id NULL, embora id_sala estivesse 100% presente). Não é
  // inferência: grade_terapeuta_id identifica o mesmo slot-template recorrente do
  // terapeuta, e sua terapia_exibicao_id é estável entre datas — validado com
  // dados reais que 98,2% dos grade_terapeuta_id mapeiam para um único
  // terapia_exibicao_id. Recupera-se o valor de OUTRA data do MESMO
  // grade_terapeuta_id, e só quando há exatamente um valor distinto (guard de
  // unicidade). Se o template for ambíguo (>1 valor) ou nunca tiver exibição
  // sincronizada, permanece NULL e o chamador bloqueia — nunca chuta um valor,
  // porque enviar sala/terapia errada criaria um agendamento errado no TiTa.
  if (terapiaExibicaoId == null) {
    const { data: exibRows, error: exibError } = await supabase
      .from("grade_profissionais_tita")
      .select("terapia_exibicao_id")
      .eq("grade_terapeuta_id", gradeTerapeutaId)
      .not("terapia_exibicao_id", "is", null)

    if (exibError) throw exibError

    const distintos = Array.from(
      new Set(
        (exibRows ?? [])
          .map(r => r.terapia_exibicao_id as number | null | undefined)
          .filter((v): v is number => v != null),
      ),
    )
    if (distintos.length === 1) {
      terapiaExibicaoId = distintos[0]
    } else {
      console.warn(
        "[tita:resolverGradeTerapeuta] terapia_exibicao_id não recuperável (template ambíguo ou sem referência)",
        JSON.stringify({ gradeTerapeutaId, valores_distintos: distintos.length }),
      )
    }
  }

  return {
    gradeTerapeutaId,
    idSala,
    terapiaExibicaoId,
  }
}

/**
 * Resolve id_favorecido (paciente no TiTa) a partir do nome do paciente no Pulsar.
 *
 * csvGradeId sempre aponta para uma linha "Livre" de csv_grades_profissionais (ver
 * invariante em OcupPacMode.tsx), e toda linha Livre tem paciente_id NULL — é um
 * horário vago, ninguém está agendado ali ainda. O paciente_id correto vem de
 * qualquer outra linha "Agendado" desse mesmo paciente: validado com dados reais
 * de produção que paciente_nome mapeia 1:1 para paciente_id (298 pacientes, 298
 * IDs distintos, nenhuma ambiguidade).
 *
 * `idFavorecidoFallback` cobre justamente o paciente que nunca foi agendado: a API
 * de laudos publica o id_favorecido dele (LaudoApi.id_favorecido), então a
 * modalidade "Criar Novo Cronograma" — que existe só pra quem tem ZERO linhas
 * Agendado — envia esse valor junto da sessão. A linha Agendado continua tendo
 * prioridade quando existe: vem da mesma tabela que o resto do payload, enquanto o
 * laudo é uma fonte externa que pode estar defasada.
 *
 * Retorna null (não lança) quando não há linha Agendado nem fallback — caso em que
 * o chamador deve bloquear a implantação em vez de adivinhar um paciente.
 */
export async function resolverIdFavorecido(
  pacienteNome: string,
  idFavorecidoFallback?: number,
  client?: SupabaseClient,
): Promise<number | null> {
  const supabase = client ?? (await createClient())

  // EXCEÇÃO deliberada ao ponto único de leitura (lib/grade/fonte.ts): as views
  // impõem `ativo`, e aqui NÃO se quer isso. Diferente das outras consultas da
  // grade, esta não conta nem exibe sessões: só traduz nome → id_favorecido da
  // TiTa. Esse id não muda, então uma linha inativada (sessão remarcada ou
  // removida) ainda carrega a resposta certa. Passar pela view só tornaria a
  // busca capaz de falhar para um paciente cujas linhas foram todas inativadas,
  // sem ganho de correção.
  const { data: rows, error } = await supabase
    .from(TABELA_GRADE)
    .select("paciente_id")
    .eq("paciente_nome", pacienteNome)
    .eq("status_agendamento", "Agendado")
    .limit(1)

  if (error) throw error

  const idFavorecido = (rows?.[0]?.paciente_id as number | null | undefined) ?? null
  if (idFavorecido != null) return idFavorecido

  if (idFavorecidoFallback != null) {
    console.log(
      "[tita:resolverIdFavorecido] sem linha Agendado — usando id_favorecido do laudo",
      JSON.stringify({ pacienteNome, idFavorecidoFallback }),
    )
    return idFavorecidoFallback
  }

  console.warn(
    "[tita:resolverIdFavorecido] Paciente sem nenhuma linha Agendado em csv_grades_profissionais e sem fallback do laudo",
    JSON.stringify({ pacienteNome }),
  )
  return null
}
