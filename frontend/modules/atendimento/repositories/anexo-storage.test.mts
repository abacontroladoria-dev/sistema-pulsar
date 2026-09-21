// Verifica a convenção de path do bucket de anexos. Função pura: não toca
// storage, não pede rede.
//
//   npx tsx modules/atendimento/repositories/anexo-storage.test.mts
//
// O QUE SE PROVA, E POR QUE IMPORTA
//
// O path não é cosmético: a policy de INSERT de storage.objects o VALIDA
// (20260921160000). Os três primeiros segmentos precisam ser organização,
// conversa e mensagem, e o primeiro é comparado com
// `central.current_organization_id()`. Um path fora da convenção falha com
// "new row violates row-level security policy" — uma mensagem que não diz nada
// sobre o formato do nome, e que levaria horas para ligar à causa.
//
// E o nome do arquivo NÃO pode ser o original: "laudo-joao-silva.pdf" num log
// de storage ou numa URL assinada vaza o nome de um paciente para quem só
// deveria ver um identificador.

import { montarPath, extensaoDe } from './anexo-storage.repository.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}
function eq<T>(recebido: T, esperado: T, oque: string) {
  ok(recebido === esperado, oque, `recebido: ${JSON.stringify(recebido)}`)
}

const ORG  = '11111111-1111-1111-1111-111111111111'
const CONV = '22222222-2222-2222-2222-222222222222'
const MSG  = '33333333-3333-3333-3333-333333333333'

console.log('\n1. a convenção que a policy valida')

{
  const path = montarPath(ORG, CONV, MSG, 'application/pdf')
  const seg  = path.split('/')

  eq(seg.length, 4, 'quatro segmentos: org / conversa / mensagem / arquivo')
  eq(seg[0], ORG,  'a ORGANIZAÇÃO é o primeiro — é o que a policy compara')
  eq(seg[1], CONV, 'a conversa é o segundo')
  eq(seg[2], MSG,  'a mensagem é o terceiro')
  ok(seg[3].endsWith('.pdf'), 'a extensão vem do MIME', seg[3])

  // O regex da policy: os segmentos 2 e 3 precisam casar ^[0-9a-f-]{36}$.
  const comoNaPolicy = /^[0-9a-f-]{36}$/i
  ok(comoNaPolicy.test(seg[1]) && comoNaPolicy.test(seg[2]),
    'segmentos 2 e 3 casam o regex da policy de INSERT')
}

{
  // O NOME ORIGINAL NUNCA APARECE. Este é o teste que protege dado de paciente.
  const path = montarPath(ORG, CONV, MSG, 'application/pdf')
  ok(!path.includes('laudo'), 'o nome do arquivo é gerado, não o original', path)
  ok(/\/\d+\.pdf$/.test(path), 'o nome é um carimbo de tempo com extensão', path)
}

{
  // Dois anexos da MESMA mensagem não podem colidir no mesmo instante... mas
  // podem: `Date.now()` tem resolução de milissegundo. Isso é aceitável porque
  // uma mensagem da Central carrega no máximo um anexo (o webhook da Meta manda
  // um por mensagem, e o envio pela tela é um arquivo por vez). Se um dia
  // carregar mais, este teste é o lugar onde a suposição está escrita.
  const a = montarPath(ORG, CONV, MSG, 'image/png')
  const b = montarPath(ORG, CONV, 'outra-mensagem', 'image/png')
  ok(a !== b, 'mensagens diferentes produzem paths diferentes')
}

console.log('\n2. extensão pelo MIME, nunca pelo nome')

eq(extensaoDe('image/jpeg'), '.jpg', 'jpeg')
eq(extensaoDe('application/pdf'), '.pdf', 'pdf')
eq(extensaoDe('audio/ogg'), '.ogg', 'ogg')

// O WhatsApp manda `audio/ogg; codecs=opus`. Sem cortar no `;`, a busca no mapa
// erra e o arquivo fica SEM extensão — o navegador de quem baixa não sabe o que
// abrir.
eq(extensaoDe('audio/ogg; codecs=opus'), '.ogg', 'parâmetro do MIME é ignorado')
eq(extensaoDe('IMAGE/JPEG'), '.jpg', 'MIME em maiúsculas')

// Tipo que não está no mapa não inventa extensão: melhor sem do que errada.
eq(extensaoDe('application/x-coisa'), '', 'MIME desconhecido não inventa extensão')

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
