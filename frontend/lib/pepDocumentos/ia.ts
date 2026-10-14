import 'server-only'

// Leitura do conteúdo pela IA (OpenAI — OPENAI_API_KEY e OPENAI_MODEL do
// Coolify, os mesmos da auditoria de evoluções). Só para as siglas com régua.
// Desde 15/10/2026 as réguas moram no banco (pep_reguas_versoes, versionadas,
// publicadas por RP/admin na tela Auditoria de Documentos PEP); quem chama
// passa a régua vigente. REGUAS_PADRAO abaixo é só o plano B — o texto da v1,
// usado se a tabela não existir no ambiente.
//
// Tudo o que a IA aponta é "Pode conter erros", nunca "Está errado": é
// julgamento, e quem decide é a pessoa. O trecho citado pela IA só é mostrado
// se existir de verdade no documento (a IA às vezes "cita" o que não está lá).

import { anonimizarDocumento } from './anonimizar'
import { NOMES_DOCUMENTO_PEP } from './rotulos'
import { normalizar } from './texto'
import type { Achado } from './tipos'

/** Uma versão de régua. O documento guarda com qual foi lido: "PIC@v2". */
export type Regua = { sigla: string; versao: number; conteudo: string }
export const rotuloRegua = (r: Pick<Regua, 'sigla' | 'versao'>) => `${r.sigla.toUpperCase()}@v${r.versao}`

/** Nome de cada documento, para o prompt. */
export const NOMES_DOCUMENTO = NOMES_DOCUMENTO_PEP

const TEXTO_MAX = 60000
const MAX_ACHADOS = 12

const COMUM = `As conferências automáticas JÁ apontam, e você NÃO deve repetir: textos entre colchetes, linhas "______", "//____", campos com rótulo e sem valor, datas que não existem, horário de término antes do início, nome do paciente diferente da pasta. Foque no que exige leitura.`

/** Régua de cada documento — o texto dos documentos do usuário, adaptado para a IA. */
export const REGUAS_PADRAO: Record<string, { nome: string; regua: string }> = {
  OE: {
    nome: 'Orientação Escolar (OE)',
    regua: `Identificação: data do registro preenchida e completa; horário de início e de término preenchidos, claros e coerentes.
Participantes: nome do paciente; nome do psicólogo ou da psicóloga responsável; nome do representante da escola; cargo ou função do representante da escola.
Procure especificamente: campos com nomes ou informações faltantes; textos de exemplo ou instruções de preenchimento que ficaram; placeholders como "inserir informação" ou expressões equivalentes; seções inteiras sem conteúdo; campos preenchidos só em parte; datas ou horários que pareçam inconsistentes.`,
  },
  ETC: {
    nome: 'Estudo Técnico de Caso (ETC)',
    regua: `Verifique: data da reunião, completa e válida; horário de início; horário de término; coerência entre data e horários.
Procure especificamente: datas não preenchidas; horários incompletos; participantes não identificados; seções inteiras sem conteúdo; linhas de preenchimento vazias; placeholders como "inserir informação"; textos genéricos que não descrevam o alinhamento efetivamente realizado (ex.: "foi discutido o caso" sem dizer o que foi discutido e decidido).`,
  },
  PIC: {
    nome: 'Plano Individualizado Comportamental (PIC)',
    regua: `Verifique se o PIC está completamente preenchido, sem instruções ou exemplos do modelo, com informações coerentes entre as seções, suficientes para sustentar tecnicamente os objetivos, com dados objetivos e mensuráveis quando solicitado, e coerência entre avaliação, resultados, conclusão e objetivos. Diferencie campo preenchido de campo preenchido ADEQUADAMENTE. Quando faltar algo, diga exatamente o que falta; quando algo parecer inadequado ou incoerente, explique o motivo.
1. Informações gerais: paciente; financiadora; data de nascimento; responsável; idade; período de vigência do PIC; equipe responsável; coordenação; supervisão técnica.
2. Informações sobre o paciente — o texto apresenta: mês e ano do diagnóstico; diagnóstico; profissional responsável pelo diagnóstico; necessidades de intervenção; com quem o paciente mora; escola, quando aplicável; acompanhamento terapêutico; interesses/preferências; repertórios já desenvolvidos; comportamentos que precisam ser desenvolvidos; prioridades dos responsáveis; medicações, data aproximada de início e indicação; outras questões médicas relevantes, quando existirem.
3. Coerência interna (segunda leitura, transversal): sobras como "listar", "descrever", "xx", "ex.", "exemplo", "incluir gráfico"; instruções destinadas ao profissional; textos duplicados do modelo; objetivos sem critério mensurável; objetivo sem relação com a avaliação.
4. Assinaturas e finalização: assinatura do coordenador; nome do coordenador; data. Se não houver como ver assinatura (só texto), diga "assinatura não verificável no texto" apenas se também faltarem o nome e a data.`,
  },
}

function systemPrompt(sigla: string, regua: string) {
  return `Você é revisor técnico da Clínica Universo ABA e confere o preenchimento de um documento do tipo ${NOMES_DOCUMENTO[sigla] ?? sigla}, entregue por um prestador.

RÉGUA DE CONFERÊNCIA
${regua}

REGRAS
- Não invente informações que não estejam no documento. Não altere o documento: só analise.
- Os nomes de pessoas e instituições foram trocados por marcadores ([PACIENTE], [PROFISSIONAL], [NOME PREENCHIDO], [DATA PREENCHIDA], [CPF]…). Um marcador significa que o campo ESTÁ preenchido: não aponte como ausente nem como erro.
- ${COMUM}
- Aponte só problemas. Documento sem problema → lista vazia.
- No máximo ${MAX_ACHADOS} problemas, os mais importantes primeiro.
- "trecho": copie LITERALMENTE do documento (até 200 caracteres) o pedaço que mostra o problema. Se o problema é uma AUSÊNCIA, deixe "trecho" vazio e diga em "descricao" exatamente o que falta.
- Escreva em português do Brasil, frases curtas, sem jargão de informática.

Responda APENAS com JSON neste formato:
{"achados":[{"titulo":"frase curta do problema","descricao":"o que falta ou por que está inadequado","trecho":"","secao":"seção do documento, se houver"}],"resumo":"uma frase sobre o documento"}`
}

export class ErroLeituraIA extends Error {
  constructor(motivo: string) {
    super(`IA: ${motivo}`)
    this.name = 'ErroLeituraIA'
  }
}

export type ResultadoIA = { achados: Achado[]; resumo: string | null; modelo: string; regua: string }

/** O trecho que a IA citou existe no documento? Comparação sem acento e espaço. */
function trechoExiste(trecho: string, texto: string) {
  const t = normalizar(trecho)
  return t.length >= 6 && normalizar(texto).includes(t)
}

export async function lerDocumentoComIA(params: {
  sigla: string
  texto: string
  /** A régua vigente da sigla (reguas.ts). */
  regua: Regua
  pacientes: (string | null | undefined)[]
  profissionais: (string | null | undefined)[]
}): Promise<ResultadoIA> {
  const sigla = params.sigla.toUpperCase()
  if (!params.regua?.conteudo?.trim()) throw new ErroLeituraIA(`sem régua para ${sigla}`)
  const apiKey = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!apiKey) throw new ErroLeituraIA('OPENAI_API_KEY não configurada no ambiente')
  const model = (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim()

  // LGPD: nenhum nome sai para a API externa (anonimizar.ts).
  const anonimo = anonimizarDocumento(params.texto.slice(0, TEXTO_MAX), {
    pacientes: params.pacientes, profissionais: params.profissionais,
  })

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt(sigla, params.regua.conteudo) },
        { role: 'user', content: `Documento (${NOMES_DOCUMENTO[sigla] ?? sigla}):\n"""\n${anonimo}\n"""` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) {
    // Só o status: o corpo do erro pode ecoar parte do pedido.
    throw new ErroLeituraIA(`OpenAI respondeu ${res.status}`)
  }
  const data = await res.json()
  const bruto = data?.choices?.[0]?.message?.content
  if (!bruto) throw new ErroLeituraIA('resposta sem conteúdo')

  let json: { achados?: unknown; resumo?: unknown }
  try { json = JSON.parse(bruto) } catch { throw new ErroLeituraIA('resposta não é JSON') }
  if (!Array.isArray(json.achados)) throw new ErroLeituraIA('resposta sem a lista "achados"')

  const achados: Achado[] = []
  for (const a of json.achados.slice(0, MAX_ACHADOS)) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    const titulo = typeof o.titulo === 'string' ? o.titulo.trim().slice(0, 160) : ''
    if (!titulo) continue
    const trecho = typeof o.trecho === 'string' ? o.trecho.trim().slice(0, 220) : ''
    achados.push({
      codigo: 'ia', familia: 'qualidade', nivel: 'atencao', origem: 'ia', titulo,
      descricao: typeof o.descricao === 'string' ? o.descricao.trim().slice(0, 400) || undefined : undefined,
      trecho: trecho && trechoExiste(trecho, anonimo) ? trecho : undefined,
      secao: typeof o.secao === 'string' ? o.secao.trim().slice(0, 80) || undefined : undefined,
    })
  }
  const resumo = typeof json.resumo === 'string' ? json.resumo.trim().slice(0, 300) || null : null
  return { achados, resumo, modelo: model, regua: rotuloRegua(params.regua) }
}
