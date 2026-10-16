// Classificação da conversa (agente/classificacao.ts). Provider e conversas
// dublês: não gasta token, não toca banco.
//
//   npx tsx modules/atendimento/agente/classificacao.test.mts

import { classificarConversa, filtrarClassificacao, montarTranscricao } from './classificacao.js'
import type { ClassificacaoTags } from './tags.js'
import type { LLMProvider, LlmRequisicao, LlmResposta } from '../llm/tipos.js'
import type { TagDefinition } from '../types/central.types.js'

let falhas = 0
function checar(condicao: boolean, descricao: string, extra?: unknown) {
  if (condicao) console.log(`  ok   ${descricao}`)
  else { falhas++; console.error(`  FALHA ${descricao}`); if (extra !== undefined) console.error('        ', extra) }
}

const tag = (grupo: string, key: string, maia = true) => ({
  key, label: key, grupo_key: grupo, maia_pode_aplicar: maia, is_active: true,
}) as unknown as TagDefinition

const CATALOGO: Record<string, string[]> = {
  origem:                ['contato_direto', 'meta_ads', 'indicacao_medica', 'indicacao_escola'],
  tipo_de_contato:       ['lead', 'paciente_ativo', 'nao_paciente_trabalhe_conosco', 'nao_paciente_curso'],
  rota:                  ['rota_a_avaliacao_inicial', 'rota_e_tratamento_aba'],
  pagamento:             ['particular', 'convenio_credenciado'],
  etapa_convenio:        ['aguardando_documentos'],
  idade:                 ['crianca'],
  unidade:               ['unidade_realengo'],
  urgencia:              ['quer_comecar_logo'],
  servico_de_interesse:  ['fonoaudiologia', 'terapia_aba'],
  convenio:              ['fusex', 'assim'],
  laudo:                 ['com_laudo', 'sem_laudo'],
  diagnostico_informado: ['tea'],
}
const PORGRUPO = new Map(Object.entries(CATALOGO).map(([g, ks]) => [g, ks.map((k) => tag(g, k))]))

const vazia = (): ClassificacaoTags => ({
  origem: null, tipo_de_contato: null, rota: null, pagamento: null, etapa_convenio: null,
  idade: null, unidade: null, urgencia: null,
  servico_de_interesse: [], convenio: [], laudo: [], diagnostico_informado: [], objecao: null,
})

console.log('\n1. transcrição')
const t = montarTranscricao([
  { de: 'familia', texto: 'Oi, meu filho tem TEA' },
  { de: 'clinica', texto: '   ' },
  { de: 'clinica', texto: 'Olá! Qual o plano?' },
])
checar(t === 'Família: Oi, meu filho tem TEA\nClínica: Olá! Qual o plano?', 'ordem cronológica, rótulos, fala vazia some', t)
checar(montarTranscricao([{ de: 'familia', texto: 'x'.repeat(2000) }]).length < 900, 'fala longa cortada')

console.log('\n2. filtro: o que a classificação pode gravar')
{
  const c = { ...vazia(), pagamento: 'particular', servico_de_interesse: ['fonoaudiologia'], laudo: [] }
  const f = filtrarClassificacao(c, [], PORGRUPO)
  checar(JSON.stringify(f) === JSON.stringify({ pagamento: 'particular', servico_de_interesse: ['fonoaudiologia'] }),
    'só grupos com valor; vazio não apaga', f)
}
{
  const c = { ...vazia(), origem: 'indicacao_medica' }
  checar('origem' in filtrarClassificacao(c, ['contato_direto'], PORGRUPO), 'origem: contato_direto → indicação contada')
  checar(!('origem' in filtrarClassificacao(c, ['meta_ads'], PORGRUPO)), 'origem: não sobrescreve meta_ads (campanha)')
  checar(!('origem' in filtrarClassificacao({ ...vazia(), origem: 'meta_ads' }, ['contato_direto'], PORGRUPO)),
    'origem: anúncio não vem da classificação')
}
{
  const lead = { ...vazia(), tipo_de_contato: 'lead' }
  checar(!('tipo_de_contato' in filtrarClassificacao(lead, ['nao_paciente_trabalhe_conosco'], PORGRUPO)),
    'tipo: não troca o Trabalhe conosco do sistema por lead')
  checar(!('tipo_de_contato' in filtrarClassificacao(lead, ['lead'], PORGRUPO)), 'tipo: igual ao atual não regrava')
  checar('tipo_de_contato' in filtrarClassificacao({ ...vazia(), tipo_de_contato: 'nao_paciente_curso' }, ['lead'], PORGRUPO),
    'tipo: lead → curso, quando a conversa revela')
  checar(!('tipo_de_contato' in filtrarClassificacao({ ...vazia(), tipo_de_contato: 'paciente_ativo' }, [], PORGRUPO)),
    'tipo: paciente_ativo nunca vem da classificação')
}

console.log('\n3. de ponta a ponta com dublês')

function providerQueChama(args: unknown | null): { provider: LLMProvider; reqs: LlmRequisicao[] } {
  const reqs: LlmRequisicao[] = []
  return {
    reqs,
    provider: {
      nome: 'dublê',
      async chat(r) {
        reqs.push(r)
        return {
          conteudo: null,
          chamadas: args === null ? [] : [{ id: 'c1', nome: 'registrar_tags', argumentosJson: JSON.stringify(args) }],
          uso: { modelo: 'x', tokensEntrada: 1, tokensSaida: 1 },
          motivoParada: args === null ? 'stop' : 'tool_calls',
          latenciaMs: 1,
        } satisfies LlmResposta
      },
    },
  }
}

function conversasDe(tags: string[]) {
  const gravados: { valores: Record<string, unknown>; origem: string }[] = []
  const objecoes: (string | null)[] = []
  return {
    gravados, objecoes,
    conversas: {
      async getById() { return { tags } },
      async atualizarTags(_id: string, valores: Record<string, unknown>, _pg: unknown, origem: string) {
        gravados.push({ valores, origem }); return { tagsResultantes: [] }
      },
      async atualizarObjecao(_id: string, o: string | null) { objecoes.push(o) },
    },
  }
}

const FALAS = [{ de: 'familia' as const, texto: 'Quero fono pro meu filho de 5 anos, particular. Achei caro.' }]

{
  const { provider, reqs } = providerQueChama({
    ...vazia(), tipo_de_contato: 'lead', pagamento: 'particular', idade: 'crianca',
    servico_de_interesse: ['fonoaudiologia'], objecao: 'achou caro',
  })
  const c = conversasDe(['contato_direto'])
  const r = await classificarConversa('conv-1', FALAS, { provider, porGrupo: PORGRUPO, conversas: c.conversas })
  checar(r.ok && r.aplicado, 'classificou e gravou', r)
  checar(reqs[0]?.escolhaFerramenta === 'registrar_tags', 'chamada OBRIGA registrar_tags', reqs[0]?.escolhaFerramenta)
  checar(reqs[0]?.mensagens[0]?.papel === 'system' && !reqs[0].mensagens[0].conteudo.includes('fono pro meu filho'),
    'transcrição fora do papel system')
  checar(c.gravados[0]?.origem === 'maia', 'grava como maia (passa pelo filtro maia_pode_aplicar)')
  checar(JSON.stringify(c.objecoes) === JSON.stringify(['achou caro']), 'objeção gravada')
}
{
  const { provider } = providerQueChama(null)
  const c = conversasDe([])
  const r = await classificarConversa('conv-1', FALAS, { provider, porGrupo: PORGRUPO, conversas: c.conversas })
  checar(!r.ok && c.gravados.length === 0, 'modelo sem chamada: não grava, não lança', r)
}
{
  const { provider } = providerQueChama({ ...vazia(), pagamento: 'tag_inventada' })
  const c = conversasDe([])
  const r = await classificarConversa('conv-1', FALAS, { provider, porGrupo: PORGRUPO, conversas: c.conversas })
  checar(!r.ok && c.gravados.length === 0, 'tag fora do catálogo: recusa sem gravar', r)
}
{
  const provider: LLMProvider = { nome: 'cai', async chat() { throw new Error('rede caiu') } }
  const c = conversasDe([])
  const r = await classificarConversa('conv-1', FALAS, { provider, porGrupo: PORGRUPO, conversas: c.conversas })
  checar(!r.ok && r.motivo === 'rede caiu', 'provider falha: devolve motivo, não lança', r)
}
{
  const { provider, reqs } = providerQueChama(vazia())
  const c = conversasDe([])
  const r = await classificarConversa('conv-1', [{ de: 'familia', texto: '  ' }], { provider, porGrupo: PORGRUPO, conversas: c.conversas })
  checar(r.ok && !r.aplicado && reqs.length === 0, 'conversa sem texto: nem chama o modelo')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
