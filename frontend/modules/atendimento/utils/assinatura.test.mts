// Assinatura da atendente na mensagem que sai pelo WhatsApp.
//
//   npx tsx modules/atendimento/utils/assinatura.test.mts
//
// Sem framework, como os outros testes do módulo.

import { assinar, semAssinatura } from './assinatura.js'

let falhas = 0
function eq<T>(obtido: T, esperado: T, nome: string) {
  const ok = obtido === esperado
  if (!ok) falhas++
  console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${nome} (recebido: ${JSON.stringify(obtido)})`)
}

eq(assinar('Stefani França', 'valeu'), '*Stefani França*\nvaleu', 'nome em negrito na primeira linha')
eq(assinar('  Stefani   França ', 'valeu'), '*Stefani França*\nvaleu', 'espaços do cadastro não vazam')
eq(assinar('Ana *Maria*_', 'oi'), '*Ana Maria*\noi', 'marcação no nome não quebra o negrito')
eq(assinar(null, 'oi'), 'oi', 'sem nome, sai sem assinatura')
eq(assinar('', 'oi'), 'oi', 'nome vazio, sai sem assinatura')
eq(assinar('Ana', ''), '*Ana*', 'mídia sem legenda leva só o nome')

eq(semAssinatura('*Stefani França*\nvaleu'), 'valeu', 'eco perde a assinatura')
eq(semAssinatura('valeu'), 'valeu', 'sem assinatura volta igual')
eq(semAssinatura('*Ana*'), '', 'só a assinatura vira vazio')
eq(semAssinatura('*Ana*\n*Pedro*\noi'), '*Pedro*\noi', 'tira só a primeira linha')
eq(semAssinatura(assinar('Ana', 'linha 1\nlinha 2')), 'linha 1\nlinha 2', 'ida e volta preserva o texto')

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) falharam.`)
  process.exit(1)
}
console.log('\nTodos os testes passaram.')
