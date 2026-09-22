import { SYSTEM_PROMPT_AUDITORIA_EVOLUCAO, montarMensagemAuditoria } from './prompts'
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

export async function auditarEvolucaoComIA(params: {
  pacienteNome: string
  profissionalNome: string
  terapiaNome?: string | null
  dataSessao: string
  textoOriginal: string
}): Promise<ResultadoAuditoriaIA> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no ambiente.')
  }

  const model = (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim()

  // Sanitização de privacidade / LGPD: mascara o nome do paciente e do profissional se citado no texto
  let textoAnonimizado = params.textoOriginal
  if (params.pacienteNome && params.pacienteNome.length > 2) {
    const primeiroNome = params.pacienteNome.split(' ')[0]
    if (primeiroNome.length > 2) {
      textoAnonimizado = textoAnonimizado.replace(new RegExp(`\\b${primeiroNome}\\b`, 'gi'), 'o paciente')
    }
    textoAnonimizado = textoAnonimizado.replace(new RegExp(params.pacienteNome, 'gi'), 'o paciente')
  }

  if (params.profissionalNome && params.profissionalNome.length > 2) {
    const primeiroNomeProf = params.profissionalNome.split(' ')[0]
    if (primeiroNomeProf.length > 2) {
      textoAnonimizado = textoAnonimizado.replace(new RegExp(`\\b${primeiroNomeProf}\\b`, 'gi'), 'o terapeuta')
    }
    textoAnonimizado = textoAnonimizado.replace(new RegExp(params.profissionalNome, 'gi'), 'o terapeuta')
  }

  const userContent = montarMensagemAuditoria({
    terapiaNome: params.terapiaNome,
    dataSessao: params.dataSessao,
    textoOriginal: textoAnonimizado
  })

  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_AUDITORIA_EVOLUCAO },
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

    const parsed = JSON.parse(rawContent)

    const statusRisco: StatusRiscoEvolucao = ['sem_risco', 'risco_especifico', 'risco_relevante'].includes(parsed.status_risco)
      ? parsed.status_risco
      : 'risco_especifico'

    const checklist: ChecklistPerguntas = {
      chegou: Boolean(parsed.checklist_perguntas?.chegou),
      objetivo: Boolean(parsed.checklist_perguntas?.objetivo),
      recursos: Boolean(parsed.checklist_perguntas?.recursos),
      reacao_saida: Boolean(parsed.checklist_perguntas?.reacao_saida)
    }

    const apontamentos: ApontamentoAuditoria[] = Array.isArray(parsed.apontamentos)
      ? parsed.apontamentos.map((ap: any) => ({
          tipo: ap.tipo || 'outro',
          titulo: ap.titulo || 'Apontamento de auditoria',
          descricao: ap.descricao || '',
          trecho: ap.trecho || undefined,
          gravidade: ['alta', 'media', 'baixa'].includes(ap.gravidade) ? ap.gravidade : 'media'
        }))
      : []

    return {
      status_risco: statusRisco,
      resumo_justificativa: parsed.resumo_justificativa || 'Análise concluída.',
      checklist_perguntas: checklist,
      inconsistencias_estruturais: Array.isArray(parsed.inconsistencias_estruturais) ? parsed.inconsistencias_estruturais : [],
      apontamentos,
      texto_revisado: parsed.texto_revisado || params.textoOriginal,
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
