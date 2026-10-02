// ============================================================================
// Vagas oferecidas — o que atravessa de um turno para o seguinte
//
// O DEFEITO (teste do Comercial, 01/10/2026 — planilha, itens 14, 15 e 18)
//
// A Maia listava três horários, o responsável respondia "15h", "Sim",
// "Confirmado", e ela listava os mesmos três de novo até a conversa acabar
// perguntando se ele queria confirmar. Duas coisas somadas produziam isso:
//
// 1. `FerramentasAgente` nasce a cada turno (agrupamento.worker.ts), e com ela
//    a lista de vagas que o turno ofereceu. No turno do "15h" ela estava vazia.
// 2. O histórico que o modelo lê só tem o TEXTO das mensagens (contexto.ts). O
//    `profissionalId` saiu no resultado da ferramenta, nunca no texto — a Maia
//    não mostra id ao responsável.
//
// Sem o id em lugar nenhum, o único jeito de chamar `agendar_sessao` era
// consultar de novo, e consultando ela relistava. Guardar a lista na conversa
// devolve as duas coisas: o modelo agenda direto, e a conferência de
// `agendar_sessao` (vaga oferecida × vaga pedida) passa a valer entre turnos.
//
// ONDE MORA
//
// `central.conversations.ai_context`, chave `vagas_oferecidas`. A coluna existe
// desde 20260701010000 ("contexto acumulado do agente para esta conversa") e
// nada a usava. Conversa resolvida e reaberta é conversa nova, com ai_context
// vazio — o que é o certo: a lista era daquela conversa.
//
// O jsonb é lido como entrada NÃO confiável: qualquer item fora do formato é
// descartado em vez de virar argumento de ferramenta.
// ============================================================================

export interface VagaOferecida {
  profissionalId: number
  // YYYY-MM-DD e HH:MM, os formatos que `agendar_sessao` recebe.
  data:           string
  hora:           string
  profissional:   string | null
  diaSemana:      string | null
  terapia:        string | null
  unidade:        string | null
}

export interface VagasGuardadas {
  // Quando a lista foi consultada pela última vez. É o que o modelo vê no
  // bloco de contexto, e o que decide a validade.
  consultadoEm: string
  vagas:        VagaOferecida[]
}

export const CHAVE_AI_CONTEXT = 'vagas_oferecidas'

// Um dia. O responsável que escolhe "amanhã cedo" um horário listado à noite
// ainda está na mesma conversa; uma lista de três dias atrás já não descreve a
// agenda. Se a vaga tiver sido tomada nesse meio-tempo, o banco recusa com
// `vaga_tomada` e a Maia oferece outra — a validade só evita mostrar ao modelo
// uma lista velha como se fosse atual.
export const VALIDADE_HORAS = 24

// Teto do que se guarda. Três consultas de uma conversa longa somam bem menos
// que isto; o teto existe para o bloco de contexto não crescer sem limite.
export const TETO_VAGAS = 30

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/
const RE_HORA = /^\d{2}:\d{2}$/

function textoOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function lerVaga(bruto: unknown): VagaOferecida | null {
  if (!bruto || typeof bruto !== 'object') return null
  const v = bruto as Record<string, unknown>

  const profissionalId = v.profissionalId
  if (typeof profissionalId !== 'number' || !Number.isInteger(profissionalId) || profissionalId <= 0) return null
  if (typeof v.data !== 'string' || !RE_DATA.test(v.data)) return null
  if (typeof v.hora !== 'string' || !RE_HORA.test(v.hora)) return null

  return {
    profissionalId,
    data:         v.data,
    hora:         v.hora,
    profissional: textoOuNull(v.profissional),
    diaSemana:    textoOuNull(v.diaSemana),
    terapia:      textoOuNull(v.terapia),
    unidade:      textoOuNull(v.unidade),
  }
}

// A data de hoje em São Paulo, YYYY-MM-DD. `en-CA` é o locale que formata
// nessa ordem; o fuso é o da clínica, não o do servidor.
function hojeEmSaoPaulo(agoraISO: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(agoraISO))
}

/**
 * Lê a lista guardada em `conversations.ai_context`. Null quando não há lista,
 * quando ela está vencida ou quando nada nela é aproveitável. Vagas de dias que
 * já passaram saem da lista.
 */
export function lerVagasGuardadas(aiContext: unknown, agoraISO: string): VagasGuardadas | null {
  if (!aiContext || typeof aiContext !== 'object' || Array.isArray(aiContext)) return null
  const bruto = (aiContext as Record<string, unknown>)[CHAVE_AI_CONTEXT]
  if (!bruto || typeof bruto !== 'object') return null

  const { consultadoEm, vagas } = bruto as Record<string, unknown>
  if (typeof consultadoEm !== 'string' || !Array.isArray(vagas)) return null

  const consultado = Date.parse(consultadoEm)
  const agora      = Date.parse(agoraISO)
  if (Number.isNaN(consultado) || Number.isNaN(agora)) return null
  if (agora - consultado > VALIDADE_HORAS * 60 * 60 * 1000) return null

  const hoje = hojeEmSaoPaulo(agoraISO)
  const validas = vagas
    .map(lerVaga)
    .filter((v): v is VagaOferecida => v !== null && v.data >= hoje)

  if (validas.length === 0) return null
  return { consultadoEm, vagas: validas }
}

/**
 * Prepara a lista para gravar: só vagas agendáveis (data e hora no formato),
 * sem repetidas (a mesma vaga consultada duas vezes conta uma) e com no máximo
 * TETO_VAGAS, ficando as mais recentes. Null quando não sobra nada — é o sinal
 * para apagar a chave.
 */
export function paraGuardar(vagas: readonly VagaOferecida[], consultadoEm: string): VagasGuardadas | null {
  const porChave = new Map<string, VagaOferecida>()
  for (const v of vagas) {
    if (!RE_DATA.test(v.data) || !RE_HORA.test(v.hora)) continue
    const chave = `${v.profissionalId}|${v.data}|${v.hora}`
    // delete + set leva a repetida para o fim: a ordem passa a ser a da
    // consulta mais recente, que é a que o teto preserva.
    porChave.delete(chave)
    porChave.set(chave, v)
  }
  const unicas = [...porChave.values()].slice(-TETO_VAGAS)
  return unicas.length > 0 ? { consultadoEm, vagas: unicas } : null
}

/**
 * Devolve o ai_context com a chave de vagas trocada, preservando qualquer outra
 * chave que alguém tenha posto lá. `guardadas` null apaga a chave.
 */
export function mesclarAiContext(aiContext: unknown, guardadas: VagasGuardadas | null): Record<string, unknown> {
  const base = aiContext && typeof aiContext === 'object' && !Array.isArray(aiContext)
    ? { ...(aiContext as Record<string, unknown>) }
    : {}
  if (guardadas) base[CHAVE_AI_CONTEXT] = guardadas
  else delete base[CHAVE_AI_CONTEXT]
  return base
}
