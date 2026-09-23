import { montarMensagemAuditoria, montarSystemPrompt } from './prompts'
import type { CriteriosAuditoria } from '@/types/auditoriaCriterios'
import { CHAVES_PILARES, CHAVES_STATUS_RISCO } from '@/types/auditoriaCriterios'
import type {
  StatusRiscoEvolucao,
  ChecklistPerguntas,
  ApontamentoAuditoria
} from '@/types/auditoriaEvolucoes'

export interface ResultadoAuditoriaIA {
  status_risco: StatusRiscoEvolucao
  resumo_justificativa: string
  checklist_perguntas: ChecklistPerguntas
  inconsistencias_estruturais: string[]
  apontamentos: ApontamentoAuditoria[]
  texto_revisado: string
  modelo_usado: string
}

/**
 * A IA respondeu algo que não dá para tratar como veredito.
 *
 * Existe para NÃO inventar resultado. Antes, resposta inválida virava
 * 'risco_especifico' e texto_revisado caía no original — a auditoria parecia
 * ter acontecido. Com critérios editáveis isso ficou inaceitável: uma
 * configuração ruim produziria vereditos plausíveis e errados, e ninguém veria.
 */
/** Espelha a união ApontamentoAuditoria['tipo'] e o schema enviado à IA. */
const TIPOS_APONTAMENTO: readonly string[] = [
  'estrutura_incompleta',
  'termo_vago',
  'negacao_sem_contexto',
  'termo_absoluto',
  'julgamento_subjetivo',
  'procedimento_aversivo',
  'foco_tempo',
  'sigla_sem_contexto',
  'sigilo_cfp',
  'inconsistencia_estrutural',
  'outro'
]

/**
 * Marcadores neutros, não "o paciente": trocar "Gael chegou acompanhada" por
 * "o paciente chegou acompanhada" fabricava um erro de concordância que a IA
 * apontava como objeção.
 */
export const MARCADOR_PACIENTE = '[PACIENTE]'
export const MARCADOR_TERAPEUTA = '[TERAPEUTA]'

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * `\b` do JS não entende acento ("Eloá" nunca casava) — por isso as bordas são
 * por \p{L}. Nome completo antes do primeiro nome: na ordem inversa, "Gael
 * Silva" virava "[PACIENTE] Silva" e o sobrenome vazava.
 */
export function mascararNome(texto: string, nome: string | undefined, marcador: string): string {
  const completo = nome?.trim()
  if (!completo || completo.length <= 2) return texto
  const trocar = (t: string, alvo: string) =>
    t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(alvo)}(?![\\p{L}\\p{N}])`, 'giu'), marcador)
  let saida = trocar(texto, completo)
  const primeiro = completo.split(/\s+/)[0]
  if (primeiro.length > 2 && primeiro !== completo) saida = trocar(saida, primeiro)
  return saida
}

/** O texto revisado vai para o prontuário: marcador não pode sobrar nele. */
export function restaurarMarcadores(texto: string): string {
  return texto
    .replaceAll(MARCADOR_PACIENTE, 'paciente')
    .replaceAll(MARCADOR_TERAPEUTA, 'terapeuta')
}

export class ErroAuditoriaInvalida extends Error {
  constructor(motivo: string) {
    super(`Resposta inválida da IA: ${motivo}`)
    this.name = 'ErroAuditoriaInvalida'
  }
}

export async function auditarEvolucaoComIA(params: {
  pacienteNome: string
  profissionalNome: string
  terapiaNome?: string | null
  dataSessao: string
  posicaoNoDia?: string
  textoOriginal: string
  /** Critérios vigentes. Obrigatório: quem chama resolve a versão e a registra. */
  criterios: CriteriosAuditoria
}): Promise<ResultadoAuditoriaIA> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no ambiente.')
  }

  const model = (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim()

  // LGPD: nenhum nome sai para a API externa.
  const textoAnonimizado = mascararNome(
    mascararNome(params.textoOriginal, params.pacienteNome, MARCADOR_PACIENTE),
    params.profissionalNome,
    MARCADOR_TERAPEUTA
  )

  const userContent = montarMensagemAuditoria({
    terapiaNome: params.terapiaNome,
    dataSessao: params.dataSessao,
    posicaoNoDia: params.posicaoNoDia,
    textoOriginal: textoAnonimizado
  })

  const payload = {
    model,
    messages: [
      { role: 'system', content: montarSystemPrompt(params.criterios) },
      { role: 'user', content: userContent }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45_000)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`OpenAI retornou status ${res.status}: ${errorText.slice(0, 300)}`)
    }

    const data = await res.json()
    const rawContent = data.choices?.[0]?.message?.content

    if (!rawContent) {
      throw new Error('OpenAI retornou uma resposta sem conteúdo.')
    }

    // `Record<string, any>` e não um tipo fechado: isto é JSON de fora, e a
    // validação de cada campo vem logo abaixo. Tipar como se já fosse a
    // resposta certa daria uma garantia que o parse não tem.
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawContent) as Record<string, unknown>
    } catch {
      throw new ErroAuditoriaInvalida('o conteúdo devolvido não é JSON válido.')
    }

    // --- Veredito: sem fallback. Errado aqui é erro, não palpite. ---

    if (!CHAVES_STATUS_RISCO.includes(parsed.status_risco as StatusRiscoEvolucao)) {
      throw new ErroAuditoriaInvalida(
        `status_risco "${parsed.status_risco}" fora dos valores aceitos (${CHAVES_STATUS_RISCO.join(', ')}).`
      )
    }
    const statusRisco = parsed.status_risco as StatusRiscoEvolucao

    const checklistBruto = parsed.checklist_perguntas as Record<string, unknown> | undefined
    if (!checklistBruto || typeof checklistBruto !== 'object') {
      throw new ErroAuditoriaInvalida('checklist_perguntas ausente.')
    }
    for (const chave of CHAVES_PILARES) {
      if (typeof checklistBruto[chave] !== 'boolean') {
        throw new ErroAuditoriaInvalida(`checklist_perguntas.${chave} não veio como booleano.`)
      }
    }
    const checklist: ChecklistPerguntas = {
      // O laço acima já provou que as quatro são booleanas.
      chegou: checklistBruto.chegou as boolean,
      objetivo: checklistBruto.objetivo as boolean,
      recursos: checklistBruto.recursos as boolean,
      reacao_saida: checklistBruto.reacao_saida as boolean
    }

    // Cair no texto original mascararia "a IA não revisou nada" como revisão.
    if (typeof parsed.texto_revisado !== 'string' || parsed.texto_revisado.trim() === '') {
      throw new ErroAuditoriaInvalida('texto_revisado vazio.')
    }

    // `tipo` e `gravidade` seguem tolerantes: são rótulos de classificação, não
    // veredito, e não têm CHECK no banco. Mas agora o desvio aparece no log.
    const apontamentos: ApontamentoAuditoria[] = Array.isArray(parsed.apontamentos)
      ? parsed.apontamentos.map((bruto: unknown) => {
          const ap = (bruto ?? {}) as Record<string, unknown>
          const tipo = ap.tipo as ApontamentoAuditoria['tipo']
          if (ap.tipo && !TIPOS_APONTAMENTO.includes(tipo)) {
            console.warn(`[auditoria] tipo de apontamento desconhecido: "${String(ap.tipo)}"`)
          }
          const gravidade = ap.gravidade as ApontamentoAuditoria['gravidade']
          return {
            tipo: TIPOS_APONTAMENTO.includes(tipo) ? tipo : 'outro',
            titulo: (ap.titulo as string) || 'Apontamento de auditoria',
            descricao: (ap.descricao as string) || '',
            trecho: (ap.trecho as string) || undefined,
            gravidade: ['alta', 'media', 'baixa'].includes(gravidade) ? gravidade : 'media'
          }
        })
      : []

    return {
      status_risco: statusRisco,
      resumo_justificativa: (parsed.resumo_justificativa as string) || 'Análise concluída.',
      checklist_perguntas: checklist,
      inconsistencias_estruturais: Array.isArray(parsed.inconsistencias_estruturais) ? parsed.inconsistencias_estruturais : [],
      apontamentos,
      texto_revisado: restaurarMarcadores(parsed.texto_revisado),
      modelo_usado: model
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      throw new Error('A requisição para a OpenAI expirou (timeout de 45s).')
    }
    throw err
  }
}
