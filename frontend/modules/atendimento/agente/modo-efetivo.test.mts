// A regra de precedência da chave Maia / Atendente, sem banco e sem rede.
//
// `resolverModoEfetivo` é pura de propósito: a decisão de QUEM responde é a mais
// cara de errar no pipeline, e uma regra que só pode ser exercitada com stack de
// pé acaba não sendo exercitada. A leitura do agent_settings (essa sim com I/O)
// fica no mesmo módulo, mas fora desta função.
//
// O que cada caso prova:
//   1. A conversa vence o padrão da clínica — é o defeito que 20260915220000
//      corrige: escalar para humano não segurava nada.
//   2. NULL na conversa NÃO é 'off': cai no padrão. Confundir os dois faria toda
//      conversa nascer muda (a coluna era `not null default 'off'`).
//   3. 'off' explícito na conversa resiste a um padrão ligado — é o que faz o
//      botão "Atendente" continuar valendo no turno seguinte.
//
// Rodar:
//   npx tsx modules/atendimento/agente/modo-efetivo.test.mts

import { resolverModoEfetivo } from './modo-efetivo.js'

let falhas = 0
function checar(cond: boolean, desc: string, extra?: unknown) {
  if (cond) console.log(`  ok    ${desc}`)
  else {
    falhas++
    console.log(`  FALHA ${desc}`)
    if (extra !== undefined) console.log('        ', JSON.stringify(extra))
  }
}

console.log('\nmodo efetivo — precedência conversa > padrão\n')

// 1. A conversa manda quando tem valor.
{
  const r = resolverModoEfetivo('off', 'autonomous')
  checar(r.modo === 'off' && r.origem === 'conversa',
    'conversa off vence padrão autonomous (escalar para humano segura)', r)

  const r2 = resolverModoEfetivo('autonomous', 'off')
  checar(r2.modo === 'autonomous' && r2.origem === 'conversa',
    'conversa autonomous vence padrão off (religar a Maia numa clínica desligada)', r2)
}

// 2. NULL herda — e NÃO é 'off'.
{
  const r = resolverModoEfetivo(null, 'autonomous')
  checar(r.modo === 'autonomous' && r.origem === 'padrao',
    'conversa intocada segue o padrão da clínica', r)

  const r2 = resolverModoEfetivo(null, 'off')
  checar(r2.modo === 'off' && r2.origem === 'padrao',
    'padrão desligado alcança a conversa intocada (botão de emergência da org)', r2)
}

// 3. 'assisted' atravessa os dois níveis sem virar outra coisa. Tratá-lo como
//    autônomo entregaria ao paciente uma mensagem que a clínica mandou revisar.
{
  checar(resolverModoEfetivo('assisted', 'autonomous').modo === 'assisted',
    'assisted da conversa não é promovido a autonomous')
  checar(resolverModoEfetivo(null, 'assisted').modo === 'assisted',
    'assisted do padrão atravessa a herança intacto')
}

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
