// Classificação de tags (agente/tags.ts) — contrato da ferramenta e validação
// dos argumentos que o modelo devolve. Sem banco, sem LLM: um Map em memória
// no formato que TagDefinitionRepository.porGrupo devolveria.
//
//   npx tsx modules/atendimento/agente/tags.test.mts

import {
  montarFerramentaRegistrarTags,
  interpretarArgumentosTags,
  gruposFaltantesParaLead,
  ClassificacaoInvalidaError,
} from './tags.js'
import type { TagDefinition } from '../types/central.types'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok   ${descricao}`)
  } else {
    falhas++
    console.error(`  FALHA ${descricao}`)
    if (extra !== undefined) console.error('        ', extra)
  }
}

// --- catálogo de teste, só os grupos que os casos abaixo exercitam ---------

function tag(id: string, grupoKey: string, opts: Partial<TagDefinition> = {}): TagDefinition {
  return {
    id: 'x', organization_id: 'org-1', key: id, label: id, color: null,
    category: null, is_active: true, created_at: '', updated_at: '',
    grupo_key: grupoKey, grupo_ordem: 1, cardinalidade: 'single',
    maia_pode_aplicar: true, automatico_sistema: false, requer_humano: false,
    ...opts,
  }
}

const PORGRUPO = new Map<string, TagDefinition[]>([
  ['origem', [
    tag('meta_ads', 'origem'),
    tag('indicacao_advogado', 'origem', { maia_pode_aplicar: false, requer_humano: true }),
  ]],
  ['tipo_de_contato', [tag('lead', 'tipo_de_contato')]],
  ['servico_de_interesse', [
    tag('terapia_aba', 'servico_de_interesse', { cardinalidade: 'multi' }),
    tag('fonoaudiologia', 'servico_de_interesse', { cardinalidade: 'multi' }),
  ]],
  ['rota', [tag('rota_a_avaliacao_inicial', 'rota')]],
  ['pagamento', [tag('particular', 'pagamento')]],
  ['convenio', [tag('assim', 'convenio', { cardinalidade: 'multi' })]],
  ['etapa_convenio', [tag('aguardando_documentos', 'etapa_convenio')]],
  ['laudo', [tag('com_laudo', 'laudo', { cardinalidade: 'multi' })]],
  ['diagnostico_informado', [tag('tea', 'diagnostico_informado', { cardinalidade: 'multi' })]],
  ['idade', [tag('crianca', 'idade')]],
  ['unidade', [tag('unidade_realengo', 'unidade')]],
  ['urgencia', [tag('quer_comecar_logo', 'urgencia')]],
])

function argsVazios(): Record<string, unknown> {
  return {
    origem: null, tipo_de_contato: null, rota: null, pagamento: null,
    etapa_convenio: null, idade: null, unidade: null, urgencia: null,
    servico_de_interesse: [], convenio: [], laudo: [], diagnostico_informado: [],
    objecao: null,
  }
}

// ----------------------------------------------------------------------------
console.log('\n1. contrato da ferramenta (strict mode)')
{
  const f = montarFerramentaRegistrarTags(PORGRUPO)
  const params = f.function.parameters as { required: string[]; additionalProperties: boolean; properties: Record<string, any> }

  checar(f.function.strict === true, 'strict: true')
  checar(params.additionalProperties === false, 'additionalProperties: false')
  checar(
    new Set(params.required).size === Object.keys(params.properties).length
      && Object.keys(params.properties).every((k) => params.required.includes(k)),
    'toda propriedade está em required',
  )
  // origem só lista meta_ads: indicacao_advogado (maia_pode_aplicar=false) não
  // pode aparecer no enum — é a primeira camada de defesa da Regra 3.
  checar(
    params.properties.origem.enum.includes('meta_ads') && !params.properties.origem.enum.includes('indicacao_advogado'),
    'enum de origem exclui tag humano-only',
    params.properties.origem.enum,
  )
  checar(params.properties.servico_de_interesse.type === 'array', 'servico_de_interesse é array (multi)')
}

// ----------------------------------------------------------------------------
console.log('\n2. interpretarArgumentosTags — casos válidos')
{
  const args = { ...argsVazios(), origem: 'meta_ads', tipo_de_contato: 'lead', servico_de_interesse: ['terapia_aba'] }
  const r = interpretarArgumentosTags(args, PORGRUPO)
  checar(r.origem === 'meta_ads', 'grava single válido')
  checar(r.servico_de_interesse.length === 1 && r.servico_de_interesse[0] === 'terapia_aba', 'grava multi válido')
  checar(r.objecao === null, 'objecao null passa')
}

// ----------------------------------------------------------------------------
console.log('\n3. interpretarArgumentosTags — rejeições')
{
  let erro: unknown
  try { interpretarArgumentosTags({ ...argsVazios(), origem: ['meta_ads'] }, PORGRUPO) } catch (e) { erro = e }
  checar(erro instanceof ClassificacaoInvalidaError, 'grupo single recebendo array falha')

  erro = undefined
  try { interpretarArgumentosTags({ ...argsVazios(), servico_de_interesse: 'terapia_aba' }, PORGRUPO) } catch (e) { erro = e }
  checar(erro instanceof ClassificacaoInvalidaError, 'grupo multi recebendo string falha')

  // Mesmo que o enum da ferramenta já devesse ter impedido isso: segunda
  // camada de defesa, revalidando o que "chegou" como se o strict mode
  // tivesse falhado.
  erro = undefined
  try { interpretarArgumentosTags({ ...argsVazios(), origem: 'indicacao_advogado' }, PORGRUPO) } catch (e) { erro = e }
  checar(erro instanceof ClassificacaoInvalidaError, 'tag humano-only rejeitada mesmo vinda "direto"')

  erro = undefined
  try { interpretarArgumentosTags({ ...argsVazios(), origem: 'tag_que_nao_existe' }, PORGRUPO) } catch (e) { erro = e }
  checar(erro instanceof ClassificacaoInvalidaError, 'tag fora do catálogo rejeitada')
}

// ----------------------------------------------------------------------------
console.log('\n4. gruposFaltantesParaLead — sinaliza, não bloqueia')
{
  const classificacao = interpretarArgumentosTags({ ...argsVazios(), tipo_de_contato: 'lead' }, PORGRUPO)
  const faltam = gruposFaltantesParaLead(classificacao, ['lead'], PORGRUPO)
  checar(faltam.includes('ORIGEM'), 'acusa ORIGEM faltando', faltam)
  checar(faltam.includes('PAGAMENTO'), 'acusa PAGAMENTO faltando', faltam)
  checar(faltam.includes('SERVIÇO DE INTERESSE'), 'acusa SERVIÇO faltando', faltam)
  checar(!faltam.includes('TIPO DE CONTATO'), 'não acusa TIPO DE CONTATO, que já veio', faltam)

  const completo = interpretarArgumentosTags(
    { ...argsVazios(), tipo_de_contato: 'lead', origem: 'meta_ads', pagamento: 'particular', servico_de_interesse: ['terapia_aba'] },
    PORGRUPO,
  )
  const semFaltantes = gruposFaltantesParaLead(
    completo, ['lead', 'meta_ads', 'particular', 'terapia_aba'], PORGRUPO,
  )
  checar(semFaltantes.length === 0, 'nenhum obrigatório faltando quando os 4 vieram', semFaltantes)
}

// ----------------------------------------------------------------------------
if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\nok — tudo passou')
