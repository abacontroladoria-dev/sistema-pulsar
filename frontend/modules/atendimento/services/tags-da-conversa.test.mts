// npx tsx modules/atendimento/services/tags-da-conversa.test.mts
//
// ConversationService.atualizarTags — merge por grupo, as duas camadas de
// validação (catálogo + maia_pode_aplicar) e a regra de que
// paciente_ativo/paciente_inativo, uma vez calculados pelo sistema, a Maia
// não sobrescreve.
//
// Sem banco: os fakes devolvem o que o teste decide, e `patches` captura o
// que de fato iria para o UPDATE — mesmo padrão de tags-do-contato.test.mts.

import { ConversationService } from './conversation.service.js'
import { TagDefinitionService } from './tag-definition.service.js'
import { TagDesconhecidaError, TagNaoAplicavelPelaMaiaError } from '../types/errors.types.js'
import type { Conversation, TagDefinition } from '../types/central.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

const ORG = 'org-1'

function tag(id: string, grupoKey: string, opts: Partial<TagDefinition> = {}): TagDefinition {
  return {
    id: 'x', organization_id: ORG, key: id, label: id, color: null,
    category: null, is_active: true, created_at: '', updated_at: '',
    grupo_key: grupoKey, grupo_ordem: 1, cardinalidade: 'single',
    maia_pode_aplicar: true, automatico_sistema: false, requer_humano: false,
    ...opts,
  }
}

const PORGRUPO = new Map<string, TagDefinition[]>([
  ['origem', [tag('meta_ads', 'origem'), tag('site', 'origem')]],
  ['tipo_de_contato', [
    tag('lead', 'tipo_de_contato'),
    tag('paciente_ativo', 'tipo_de_contato', { maia_pode_aplicar: false, automatico_sistema: true }),
    tag('paciente_inativo', 'tipo_de_contato', { maia_pode_aplicar: false, automatico_sistema: true }),
  ]],
])

const CATALOGO_ATIVAS = [...PORGRUPO.values()].flat()

function montarConversationService(conv: Conversation) {
  const patches: Record<string, unknown>[] = []

  const convRepo = {
    findById: async () => conv,
    updateTags: async (_id: string, tags: string[]) => { patches.push({ tags }) },
  }
  const audit = { insert: async () => {} }
  const events = { emit: () => {} }
  const tagRepo = {
    chavesAtivas: async () => new Set(CATALOGO_ATIVAS.map((t) => t.key)),
    listarAtivas: async () => CATALOGO_ATIVAS,
  }

  const service = new ConversationService(
    convRepo as any, audit as any, events as any,
    new TagDefinitionService(tagRepo as any),
  )
  return { service, patches }
}

function conversa(tags: string[]): Conversation {
  return {
    id: 'conv-1', organization_id: ORG, inbox_id: 'inbox-1', channel_id: 'channel-1',
    contact_id: 'contact-1', assigned_user_id: null, status: 'open', priority: null,
    intent: null, sentiment: null, ai_mode: null, tags, campanha: null, objecao: null,
    last_message_at: null, last_read_at: null, resolved_at: null,
  } as unknown as Conversation
}

// ----------------------------------------------------------------------------
console.log('\nmerge por grupo')
{
  const { service, patches } = montarConversationService(conversa(['site']))
  await service.atualizarTags('conv-1', { origem: 'meta_ads' }, PORGRUPO, 'maia', null)
  checar('troca o valor do MESMO grupo, não acumula', patches[0]!.tags, ['meta_ads'])
}

{
  const { service, patches } = montarConversationService(conversa(['site', 'lead']))
  await service.atualizarTags('conv-1', { origem: 'meta_ads' }, PORGRUPO, 'maia', null)
  const resultado = patches[0]!.tags as string[]
  checar('não mexe em grupo que não foi passado', resultado.includes('lead'), true)
  checar('troca só o grupo passado', resultado.includes('meta_ads') && !resultado.includes('site'), true)
}

// ----------------------------------------------------------------------------
console.log('\nvalidação — origem maia')
{
  const { service } = montarConversationService(conversa([]))
  let erro: unknown
  try {
    await service.atualizarTags('conv-1', { origem: 'tag_inventada' }, PORGRUPO, 'maia', null)
  } catch (e) { erro = e }
  checar('recusa chave fora do catálogo', erro instanceof TagDesconhecidaError, true)
}

{
  const { service } = montarConversationService(conversa([]))
  let erro: unknown
  try {
    // paciente_ativo tem maia_pode_aplicar=false — a Maia não pode aplicar
    // diretamente (só o sistema, via Passo 5).
    await service.atualizarTags('conv-1', { tipo_de_contato: 'paciente_ativo' }, PORGRUPO, 'maia', null)
  } catch (e) { erro = e }
  checar('recusa tag humano/sistema-only vinda da Maia', erro instanceof TagNaoAplicavelPelaMaiaError, true)
}

{
  // 'sistema' não passa pelo filtro maia_pode_aplicar — é assim que o cálculo
  // de status do paciente (Passo 5) consegue gravar paciente_ativo.
  const { service, patches } = montarConversationService(conversa([]))
  await service.atualizarTags('conv-1', { tipo_de_contato: 'paciente_ativo' }, PORGRUPO, 'sistema', null)
  checar('origem sistema pode gravar tag automatico_sistema', patches[0]!.tags, ['paciente_ativo'])
}

// ----------------------------------------------------------------------------
console.log('\nstatus do paciente é autoritativo do sistema')
{
  // Conversa já tem paciente_ativo (calculado pelo sistema). A Maia tenta
  // classificar tipo_de_contato como 'lead' — o grupo inteiro é ignorado
  // nesta chamada, sem gerar erro (a Maia só não tem esse poder aqui).
  const { service, patches } = montarConversationService(conversa(['paciente_ativo']))
  const { tagsResultantes } = await service.atualizarTags(
    'conv-1', { tipo_de_contato: 'lead', origem: 'meta_ads' }, PORGRUPO, 'maia', null,
  )
  checar('paciente_ativo sobrevive à tentativa da Maia', tagsResultantes.includes('paciente_ativo'), true)
  checar('lead NÃO entra por cima do status do sistema', tagsResultantes.includes('lead'), false)
  checar('outro grupo da mesma chamada (origem) continua sendo aplicado', tagsResultantes.includes('meta_ads'), true)
}

if (falhas > 0) {
  console.log(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\nok — tudo passou')
