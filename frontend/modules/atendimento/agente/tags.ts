import type { LlmFerramenta } from '../llm/tipos'
import type { TagDefinition } from '../types/central.types'

// ============================================================================
// Classificação de tags — o contrato de saída da taxonomia da Maia
//
// 144 tags em 13 grupos (aba "Taxonomia" do documento
// comercial_configuracao-crm-maia_2026-09-21_v4.xlsx, replicada em
// frontend/app/central-atendimento/maia-tags/maia_tags_catalog.json e no
// schema maia_tags_output.schema.json). Este arquivo NÃO hardcoda o
// vocabulário: monta os enums a partir do catálogo (central.tag_definitions,
// via TagDefinitionRepository.porGrupo) para que desativar ou renomear uma
// tag no banco não exija deploy de código.
//
// Fora do escopo desta ferramenta, porque já são cobertos em outro lugar:
//   - campanha            → só o matcher de campanha grava (agente/origem-campanha.ts,
//                            Regra 5). A Maia nunca decide este campo.
//   - data_nascimento      → já coletado por registrar_dados_do_paciente.
//   - escalar_humano/
//     tags_sugeridas       → já é escalar_para_humano (ferramentas.ts).
//   - paciente_ativo/
//     paciente_inativo     → computados pelo sistema (central.contact_patient_status,
//                            Passo 5), não pela Maia. O enum de tipo_de_contato
//                            os inclui (a Maia pode ler o que já está aplicado),
//                            mas o executor não deixa a Maia sobrescrevê-los —
//                            ver ferramentas.ts.
//
// MESMA REGRA DE SEGURANÇA DO RESTO DO MÓDULO (contexto.ts, sentimento.ts):
// nada vindo do WhatsApp é montado com papel `system`. Esta ferramenta não
// monta prompt — quem faz isso é contexto.ts — mas a descrição de cada campo
// é lida pelo modelo como parte da instrução, então o texto abaixo nunca deve
// incorporar conteúdo de mensagem.
// ============================================================================

// Os 8 grupos de cardinalidade single (uma tag ou nenhuma) e os 4 de multi
// (zero ou mais), na ordem da aba Taxonomia. 'juridico' fica de fora: é
// grupo `requer_humano` inteiro (uso interno, nunca aparece para a família —
// aba Taxonomia, grupo 8), e não faz parte do que a Maia classifica.
const GRUPOS_SINGLE = [
  'origem', 'tipo_de_contato', 'rota', 'pagamento',
  'etapa_convenio', 'idade', 'unidade', 'urgencia',
] as const

const GRUPOS_MULTI = [
  'servico_de_interesse', 'convenio', 'laudo', 'diagnostico_informado',
] as const

type GrupoSingle = typeof GRUPOS_SINGLE[number]
type GrupoMulti  = typeof GRUPOS_MULTI[number]

export type ClassificacaoTags =
  & { [K in GrupoSingle]: string | null }
  & { [K in GrupoMulti]:  string[] }
  & { objecao: string | null }

// ----------------------------------------------------------------------------
// Montagem da ferramenta
// ----------------------------------------------------------------------------

const NOMES_GRUPO: Record<string, string> = {
  origem:                 'ORIGEM',
  tipo_de_contato:        'TIPO DE CONTATO',
  servico_de_interesse:   'SERVIÇO DE INTERESSE',
  rota:                   'ROTA',
  pagamento:              'PAGAMENTO',
  convenio:               'CONVÊNIO (nome da operadora)',
  etapa_convenio:         'ETAPA CONVÊNIO (só Rota E)',
  laudo:                  'LAUDO',
  diagnostico_informado:  'DIAGNÓSTICO INFORMADO (o que a família disse, não conclusão clínica)',
  idade:                  'IDADE',
  unidade:                'UNIDADE',
  urgencia:                'URGÊNCIA',
}

// Regra 5b: quando a primeira mensagem NÃO casou com nenhuma frase cadastrada
// em central.campaign_phrases (o matcher determinístico de
// agente/origem-campanha.ts já rodou antes deste turno e não achou nada), a
// Maia reconhece texto pré-preenchido por anúncio e aplica ORIGEM sozinha.
// Esta instrução só aparece na description do campo `origem` porque é o
// único lugar em que o modelo de fato lê e decide isso — description de
// outro campo não influenciaria a escolha deste.
const DESCRICAO_ORIGEM =
  'ORIGEM — no máximo uma, ou null se ainda não apareceu na conversa. '
  + 'Regra 5b: se a PRIMEIRA mensagem do responsável começar com "Gostaria de", "Vim do", '
  + '"Vim pelo", "Olá! Vim", "Quero saber sobre", "Tenho interesse em", ou repetir nome de '
  + 'serviço/plano sem cumprimento (sinal de texto pré-preenchido por anúncio que o sistema '
  + 'não tinha cadastrado), aplique "meta_ads" — exceto se a palavra "site" ou "linktree" '
  + 'aparecer no texto, aí aplique "site" ou "linktree" respectivamente. Isso só vale para a '
  + 'PRIMEIRA mensagem da conversa; em qualquer outro momento, decida ORIGEM só pelo que a '
  + 'família disse explicitamente (indicação, ligou, apareceu na clínica etc.).'

// Só as tags que a Maia tem permissão de aplicar (maia_pode_aplicar = true)
// entram no enum — filtro em duas camadas, junto com a revalidação em
// interpretarArgumentosTags: mesmo que este filtro falhe, a segunda camada
// rejeita no backend (Regra 3 do maia_tagging_BUILD.md).
function enumDoGrupo(porGrupo: Map<string, TagDefinition[]>, grupoKey: string): string[] {
  const tags = porGrupo.get(grupoKey) ?? []
  return tags.filter((t) => t.maia_pode_aplicar).map((t) => t.key)
}

export function montarFerramentaRegistrarTags(porGrupo: Map<string, TagDefinition[]>): LlmFerramenta {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const grupo of GRUPOS_SINGLE) {
    const enumValues = enumDoGrupo(porGrupo, grupo)
    properties[grupo] = {
      type: ['string', 'null'],
      enum: [...enumValues, null],
      description: grupo === 'origem'
        ? DESCRICAO_ORIGEM
        : `${NOMES_GRUPO[grupo]} — no máximo uma, ou null se ainda não apareceu na conversa.`,
    }
    required.push(grupo)
  }

  // Sem `uniqueItems`: o modo estrito da OpenAI recusa a palavra-chave com
  // HTTP 400 (invalid_function_parameters) e derruba o TURNO INTEIRO — a Maia
  // escala toda conversa para humano como falha técnica. A deduplicação fica
  // em interpretarArgumentosTags (`new Set`).
  for (const grupo of GRUPOS_MULTI) {
    const enumValues = enumDoGrupo(porGrupo, grupo)
    properties[grupo] = {
      type: 'array',
      items: { type: 'string', enum: enumValues },
      description: `${NOMES_GRUPO[grupo]} — pode ter mais de uma. Array vazio se nenhuma apareceu.`,
    }
    required.push(grupo)
  }

  properties.objecao = {
    type: ['string', 'null'],
    description:
      'Frase curta do motivo de recuo da família, se houver (ex.: "achou caro a mensalidade"). '
      + 'Campo, não tag (aba Regras, item 8). null se não houve objeção.',
  }
  required.push('objecao')

  return {
    type: 'function',
    function: {
      name: 'registrar_tags',
      description:
        'Registra a classificação da conversa nos grupos da taxonomia comercial. '
        + 'Envie APENAS o que já apareceu na conversa até agora — null (ou array vazio) '
        + 'no que ainda não foi dito. Chame de novo sempre que uma informação nova aparecer '
        + 'ou mudar (ex.: a família muda de "só pesquisando" para "quero começar essa semana"). '
        + 'Não invente, não deduza além do que foi dito — exceto ROTA e URGÊNCIA, que são '
        + 'dedução sua a partir do que a família contou (não pergunte esses dois diretamente).',
      strict: true,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  }
}

// ----------------------------------------------------------------------------
// Interpretação dos argumentos
//
// `strict: true` garante o formato E o vocabulário (o enum já veio do
// catálogo), mas a revalidação aqui não é redundante: é a fronteira entre "o
// que o modelo mandou" e "o que vai para conversations.tags" — sem FK nem
// CHECK na coluna (é TEXT[], ver o comentário de 20260701010000). Ela também
// é onde uma tag que o catálogo mudou DEPOIS que o enum foi montado (corrida
// rara, mas possível) é pega antes de gravar.
// ----------------------------------------------------------------------------

export class ClassificacaoInvalidaError extends Error {}

export function interpretarArgumentosTags(
  bruto: unknown,
  porGrupo: Map<string, TagDefinition[]>,
): ClassificacaoTags {
  if (typeof bruto !== 'object' || bruto === null) {
    throw new ClassificacaoInvalidaError('registrar_tags veio sem argumentos')
  }
  const args = bruto as Record<string, unknown>
  const resultado = {} as ClassificacaoTags

  for (const grupo of GRUPOS_SINGLE) {
    const valor = args[grupo]
    if (valor !== null && typeof valor !== 'string') {
      throw new ClassificacaoInvalidaError(`${grupo} deveria ser string ou null, veio ${JSON.stringify(valor)}`)
    }
    if (valor !== null) {
      const validos = enumDoGrupo(porGrupo, grupo)
      if (!validos.includes(valor)) {
        throw new ClassificacaoInvalidaError(`${grupo}: tag "${valor}" não existe no catálogo ou a Maia não pode aplicá-la`)
      }
    }
    resultado[grupo] = valor
  }

  for (const grupo of GRUPOS_MULTI) {
    const valor = args[grupo]
    if (!Array.isArray(valor)) {
      throw new ClassificacaoInvalidaError(`${grupo} deveria ser array, veio ${JSON.stringify(valor)}`)
    }
    const validos = new Set(enumDoGrupo(porGrupo, grupo))
    const limpo = [...new Set(valor)].filter((v): v is string => {
      if (typeof v !== 'string' || !validos.has(v)) {
        throw new ClassificacaoInvalidaError(`${grupo}: tag "${String(v)}" não existe no catálogo ou a Maia não pode aplicá-la`)
      }
      return true
    })
    resultado[grupo] = limpo
  }

  const objecao = args.objecao
  if (objecao !== null && typeof objecao !== 'string') {
    throw new ClassificacaoInvalidaError(`objecao deveria ser string ou null, veio ${JSON.stringify(objecao)}`)
  }
  resultado.objecao = objecao && objecao.trim() !== '' ? objecao.trim() : null

  return resultado
}

// Grupos que a Regra 1 exige para todo lead (ORIGEM · TIPO · SERVIÇO ·
// PAGAMENTO — CONVÊNIO só quando houver). "Sinaliza, não bloqueia": quem usa
// isto devolve a lista ao modelo para ele continuar perguntando, nunca
// recusa a gravação por faltar algo.
export const GRUPOS_OBRIGATORIOS_LEAD: readonly GrupoSingle[] = ['origem', 'pagamento']
export const GRUPOS_OBRIGATORIOS_LEAD_MULTI: readonly GrupoMulti[] = ['servico_de_interesse']

export function gruposFaltantesParaLead(
  classificacao: ClassificacaoTags,
  tagsResultantes: readonly string[],
  porGrupo: Map<string, TagDefinition[]>,
): string[] {
  const faltam: string[] = []

  for (const grupo of GRUPOS_OBRIGATORIOS_LEAD) {
    const chaves = new Set((porGrupo.get(grupo) ?? []).map((t) => t.key))
    const temAlgumaDoGrupo = tagsResultantes.some((k) => chaves.has(k))
    if (!temAlgumaDoGrupo) faltam.push(NOMES_GRUPO[grupo])
  }
  for (const grupo of GRUPOS_OBRIGATORIOS_LEAD_MULTI) {
    const chaves = new Set((porGrupo.get(grupo) ?? []).map((t) => t.key))
    const temAlgumaDoGrupo = tagsResultantes.some((k) => chaves.has(k))
    if (!temAlgumaDoGrupo) faltam.push(NOMES_GRUPO[grupo])
  }
  // TIPO DE CONTATO tem sub-caminho especial (paciente_ativo/inativo vêm do
  // sistema), mas "alguma tag do grupo presente" continua a mesma checagem.
  const chavesTipo = new Set((porGrupo.get('tipo_de_contato') ?? []).map((t) => t.key))
  if (!tagsResultantes.some((k) => chavesTipo.has(k))) faltam.push(NOMES_GRUPO.tipo_de_contato)

  return faltam
}
