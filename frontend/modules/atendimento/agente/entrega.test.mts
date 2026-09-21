// O que sai para o responsável no fim do turno. Função pura: sem banco, sem LLM.
//
//   npx tsx modules/atendimento/agente/entrega.test.mts
//
// O que se prova, e por que importa:
//
//   1. O CAMINHO NORMAL não muda. O texto do modelo sai uma vez, e o fallback
//      não é acrescentado junto — duas mensagens dizendo a mesma coisa.
//   2. FALHA TÉCNICA SEM ESCALADA continua muda. Inventar uma frase ali
//      mascararia o defeito e mentiria para o responsável.
//   3. ESCALADA SEM DESPEDIDA recebe o texto de segurança. É o teste central: sem
//      ele a conversa fica 'off' e NUNCA MAIS fala com a pessoa, porque o worker
//      passa a responder `silencio` para toda mensagem seguinte.
//   4. 'assisted' NUNCA ENVIA, nem o fallback. A clínica configurou revisão
//      humana; furá-la é o tipo de erro que se descobre por mensagem entregue.
//   5. `aguardar` + escalada também recebe o texto — o caso que parece
//      inofensivo ("volta pra fila") e é tão terminal quanto `escalar`.

import { decidirEntrega, TEXTO_ESCALADA_FALLBACK } from './entrega.js'

let falhas = 0
function checar(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok    ${oque}`)
  } else {
    falhas++
    console.error(`  FALHA ${oque}`)
    if (extra !== undefined) console.error('        ', extra)
  }
}

// ---------------------------------------------------------------------------
console.log('\n1. caminho normal — o modelo respondeu')

{
  const r = decidirEntrega({ tipo: 'responder', texto: 'Oi! Tenho terça às 9h.' }, false, 'autonomous')
  checar(r.acao === 'enviar' && r.texto === 'Oi! Tenho terça às 9h.' && !r.fallback,
    'responder sem escalada → envia o texto do modelo', r)
}

{
  // Com escalada, ainda é o texto do MODELO que sai: ele se despediu por conta
  // própria. O fallback existe para quando ele não consegue.
  const r = decidirEntrega({ tipo: 'responder', texto: 'Já chamo alguém da equipe.' }, true, 'autonomous')
  checar(r.acao === 'enviar' && r.texto === 'Já chamo alguém da equipe.' && !r.fallback,
    'responder COM escalada → o texto do modelo, sem duplicar com o fallback', r)
}

{
  const r = decidirEntrega({ tipo: 'responder', texto: 'Oi!' }, false, 'assisted')
  checar(r.acao === 'rascunho', 'assisted → rascunho, nunca envio', r)
}

// ---------------------------------------------------------------------------
console.log('\n2. falha técnica SEM escalada — silêncio, como sempre foi')

for (const tipo of ['escalar', 'aguardar'] as const) {
  const r = decidirEntrega({ tipo }, false, 'autonomous')
  checar(r.acao === 'nada', `${tipo} sem escalada → nada sai (comportamento preservado)`, r)
}

// ---------------------------------------------------------------------------
console.log('\n3. escalada sem despedida — a rede')

// O cenário: o modelo chamou escalar_para_humano na iteração 2, a conversa já
// está 'off', e o turno morreu antes de produzir texto (truncou, entrou em loop,
// o provider caiu). Sem esta rede a pessoa pediu ajuda e recebeu silêncio — e o
// silêncio é PERMANENTE, porque o worker responde `silencio` a partir daí.
{
  const r = decidirEntrega({ tipo: 'escalar' }, true, 'autonomous')
  checar(r.acao === 'enviar' && r.texto === TEXTO_ESCALADA_FALLBACK && r.fallback === true,
    'escalar + escalada → texto de segurança é enviado', r)
}

{
  // O mais fácil de esquecer. `aguardar` parece recuperável, mas o retry vai
  // encontrar a conversa em 'off' e sair pelo silêncio do worker.
  const r = decidirEntrega({ tipo: 'aguardar' }, true, 'autonomous')
  checar(r.acao === 'enviar' && r.texto === TEXTO_ESCALADA_FALLBACK && r.fallback === true,
    'aguardar + escalada → texto de segurança (o retry não vai responder)', r)
}

{
  // Defesa de borda: 'responder' com texto vazio não deveria existir (o
  // orquestrador o converte em escalar/sem_texto), mas se chegar, não pode virar
  // uma mensagem em branco no WhatsApp.
  const r = decidirEntrega({ tipo: 'responder', texto: '   ' }, true, 'autonomous')
  checar(r.acao === 'enviar' && r.texto === TEXTO_ESCALADA_FALLBACK,
    'responder com texto vazio + escalada → cai na rede, não envia vazio', r)
}

{
  const r = decidirEntrega({ tipo: 'responder', texto: '' }, false, 'autonomous')
  checar(r.acao === 'nada', 'responder vazio SEM escalada → nada (não inventa texto)', r)
}

// ---------------------------------------------------------------------------
console.log('\n4. assisted não envia nem o texto de segurança')

{
  const r = decidirEntrega({ tipo: 'escalar' }, true, 'assisted')
  checar(r.acao === 'rascunho' && r.texto === TEXTO_ESCALADA_FALLBACK && r.fallback === true,
    'escalada em assisted → RASCUNHO com o texto de segurança, nunca envio', r)
}

{
  const r = decidirEntrega({ tipo: 'aguardar' }, true, 'assisted')
  checar(r.acao === 'rascunho', 'aguardar + escalada em assisted → rascunho', r)
}

// ---------------------------------------------------------------------------
console.log('\n5. o texto de segurança cumpre as mesmas restrições do modelo')

// As mesmas regras que a description da ferramenta impõe: sem prazo, sem nome de
// pessoa. Aqui ele substitui o modelo, então não pode prometer o que o modelo
// está proibido de prometer.
checar(!/\d+\s*(minuto|hora|dia|min)/i.test(TEXTO_ESCALADA_FALLBACK),
  'não promete prazo', TEXTO_ESCALADA_FALLBACK)
checar(TEXTO_ESCALADA_FALLBACK.length <= 120,
  'é curto, como mensagem de WhatsApp', TEXTO_ESCALADA_FALLBACK.length)

// ---------------------------------------------------------------------------
console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
