// Matcher de campanha (agente/origem-campanha.ts, Regra 5). Sem banco.
//
//   npx tsx modules/atendimento/agente/origem-campanha.test.mts

import { casarPrimeiraMensagem, origemAceitaAnuncio, origemSemCampanha, resolverOrigem, type FraseCadastrada } from './origem-campanha.js'

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

const FRASES: FraseCadastrada[] = [
  { origemTag: 'meta_ads', fraseExata: 'Gostaria de agendar pelo plano FUSEX.', campanha: 'Plano de Saúde | FUSEX', prontaParaMatch: true },
  { origemTag: 'site', fraseExata: 'Olá! Vim do site e quero saber mais sobre a Terapia Aba.', campanha: 'Site | Terapia ABA', prontaParaMatch: true },
  // Placeholder "(preencher)" — pronta_para_match: false, nunca casa.
  { origemTag: 'meta_ads', fraseExata: null, campanha: 'Fonoaudiologia', prontaParaMatch: false },
]

console.log('\n1. frase exata cadastrada')
{
  const r = casarPrimeiraMensagem('Gostaria de agendar pelo plano FUSEX.', FRASES)
  checar(r !== null && r.origemTag === 'meta_ads' && r.campanha === 'Plano de Saúde | FUSEX', 'casa e devolve origem+campanha certos', r)
}

console.log('\n2. frase não cadastrada')
{
  const r = casarPrimeiraMensagem('Oi, gostaria de saber mais informações', FRASES)
  checar(r === null, 'não casa — fica para o fallback da Maia (regra 5b)', r)
}

console.log('\n3. placeholder pronta_para_match=false nunca casa')
{
  // Mesmo com frase_exata null, uma comparação ingênua contra string vazia
  // não deveria casar com texto vazio nem com nada.
  const r = casarPrimeiraMensagem('', FRASES)
  checar(r === null, 'texto vazio não casa com placeholder', r)
}

console.log('\n4. anúncio pago manda sobre a frase (Regra 5)')
{
  const pago = { ad_id: '120210000000000001', ctwa_clid: 'clid', titulo: null, url: null, source_type: 'ad', plataforma: null, pago: true }
  const a = resolverOrigem('Olá! Vim do site e quero saber mais sobre a Terapia Aba.', FRASES, pago)
  checar(a.origemTag === 'meta_ads' && a.campanha === 'Site | Terapia ABA', 'origem meta_ads; campanha ainda vem da frase', a)
  const b = resolverOrigem('Oi', FRASES, pago)
  checar(b.origemTag === 'meta_ads' && b.campanha === null, 'texto qualquer + anúncio = meta_ads sem campanha', b)
  const c = resolverOrigem('Oi', FRASES, { ...pago, source_type: 'post', pago: false })
  checar(c.origemTag === 'contato_direto', 'post compartilhado não é anúncio pago', c)
  const d = resolverOrigem('Oi', FRASES, null)
  checar(d.origemTag === 'contato_direto', 'sem anúncio, regra de sempre', d)
}

// ORIGEM sem campanha (15/10/2026): texto de anúncio pela Regra 5b, o resto
// é Contato Direto — o caso Tici abriu com "Oi" e ficou sem ORIGEM.
for (const [texto, esperado] of [
  ['Oi', 'contato_direto'],
  ['Bom dia, vocês vão funcionar hoje?', 'contato_direto'],
  ['Gostaria de saber sobre fonoaudiologia', 'meta_ads'],
  ['Olá! Vim pelo site e quero informações', 'site'],
  ['Vim do Linktree', 'linktree'],
  ['tenho interesse em ABA', 'meta_ads'],
] as const) {
  checar(origemSemCampanha(texto) === esperado, `origem de "${texto}" = ${esperado}`, origemSemCampanha(texto))
}
{
  const frases: FraseCadastrada[] = [{ origemTag: 'meta_ads', fraseExata: 'Quero FUSEX', campanha: 'FUSEX', prontaParaMatch: true }]
  const c = resolverOrigem('Quero FUSEX', frases)
  checar(c.origemTag === 'meta_ads' && c.campanha === 'FUSEX', 'frase cadastrada vence e traz a campanha', c)
  const d = resolverOrigem('Oi', frases)
  checar(d.origemTag === 'contato_direto' && d.campanha === null, 'sem frase: contato_direto sem campanha', d)
}

{
  // Grupo origem do catálogo, só com o que o teste usa.
  const porGrupo = new Map([['origem', ['meta_ads', 'site', 'contato_direto'].map(key => ({ key }))]]) as never
  checar(origemAceitaAnuncio(null, porGrupo), 'sem tags: anúncio decide')
  checar(origemAceitaAnuncio(['contato_direto', 'outra'], porGrupo), 'contato_direto: anúncio substitui')
  checar(!origemAceitaAnuncio(['site'], porGrupo), 'origem explícita não é tocada')
}

if (falhas > 0) {
  console.error(`\n${falhas} falha(s)`)
  process.exit(1)
}
console.log('\nok — tudo passou')
