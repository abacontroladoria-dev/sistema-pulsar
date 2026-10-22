// O expediente que decide o plantão da Maia, sem banco e sem relógio.
//
//   npx tsx modules/atendimento/agente/horario-comercial.test.mts
//
// O que se prova:
//   1. A BORDA DAS 18h. 17:59 ainda é do atendente; 18:00 já é da Maia.
//   2. A REABERTURA certa: quinta à noite → sexta 08h; sexta à noite e sábado →
//      segunda 08h; madrugada → hoje 08h. É ela que identifica a janela do
//      plantão — errar aqui faz a Maia se anunciar de novo no meio da noite.
//   3. FERIADO: integral fecha o dia inteiro; parcial fecha só a janela dele.
//   4. CONFIGURAÇÃO ILEGÍVEL vale como aberto: erro de cadastro não põe a Maia
//      em conversa de atendente.
//   5. A MARCA do plantão é por janela: a noite seguinte começa do zero.

import {
  HORARIO_PADRAO, formatarRetornoEquipe, situacaoExpediente, type FeriadoExpediente,
} from './horario-comercial.js'
import { humanoDepoisDoFechamento, plantaoAnunciado, plantaoEncerrado } from './plantao.js'

let falhas = 0
function ok(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}`)
  if (extra !== undefined) console.error('        ', extra)
}

// São Paulo é UTC-3 (sem horário de verão desde 2019). 22/10/2026 é quinta.
const local = (dataHora: string) => new Date(`${dataHora}:00-03:00`).toISOString()
const sit = (agora: string, feriados: FeriadoExpediente[] = []) =>
  situacaoExpediente(local(agora), HORARIO_PADRAO, feriados)

console.log('\n1. a borda das 18h')
{
  ok(sit('2026-10-22T17:59').aberto, '17:59 de quinta: aberto')
  const s = sit('2026-10-22T18:00')
  ok(!s.aberto, '18:00 de quinta: fechado')
  ok(sit('2026-10-22T08:00').aberto, '08:00 de quinta: aberto')
  ok(!sit('2026-10-22T07:59').aberto, '07:59 de quinta: fechado')
}

console.log('\n2. a reabertura')
{
  ok(sit('2026-10-22T18:30').proximaAbertura === local('2026-10-23T08:00'), 'quinta 18:30 → sexta 08h', sit('2026-10-22T18:30'))
  ok(sit('2026-10-23T19:00').proximaAbertura === local('2026-10-26T08:00'), 'sexta 19h → segunda 08h')
  ok(sit('2026-10-24T10:00').proximaAbertura === local('2026-10-26T08:00'), 'sábado 10h → segunda 08h')
  ok(sit('2026-10-22T02:00').proximaAbertura === local('2026-10-22T08:00'), 'madrugada → hoje 08h')
  ok(sit('2026-10-22T10:00').proximaAbertura === null, 'aberto não tem reabertura')

  const agora = local('2026-10-22T18:30')
  ok(formatarRetornoEquipe(local('2026-10-23T08:00'), agora, 'America/Sao_Paulo') === 'amanhã (sexta-feira, 23/10), às 08h',
    'texto: amanhã', formatarRetornoEquipe(local('2026-10-23T08:00'), agora, 'America/Sao_Paulo'))
  ok(formatarRetornoEquipe(local('2026-10-26T08:00'), local('2026-10-23T19:00'), 'America/Sao_Paulo') === 'segunda-feira, 26/10, às 08h',
    'texto: dia da semana', formatarRetornoEquipe(local('2026-10-26T08:00'), local('2026-10-23T19:00'), 'America/Sao_Paulo'))
  ok(formatarRetornoEquipe(local('2026-10-22T08:00'), local('2026-10-22T02:00'), 'America/Sao_Paulo') === 'hoje, às 08h', 'texto: hoje')
  ok(formatarRetornoEquipe(local('2026-10-22T14:30'), local('2026-10-22T13:00'), 'America/Sao_Paulo') === 'hoje, às 14h30', 'texto: minutos')
}

console.log('\n3. feriado')
{
  const segunda: FeriadoExpediente = { data: '2026-10-26', tipo: 'integral', horario_inicio: null, horario_fim: null }
  ok(sit('2026-10-23T19:00', [segunda]).proximaAbertura === local('2026-10-27T08:00'), 'segunda feriado: sexta à noite → terça 08h')
  ok(!sit('2026-10-26T10:00', [segunda]).aberto, 'no feriado integral, 10h é fechado')

  const meio: FeriadoExpediente = { data: '2026-10-22', tipo: 'parcial', horario_inicio: '12:00:00', horario_fim: '14:00:00' }
  ok(sit('2026-10-22T11:00', [meio]).aberto, 'parcial: antes da janela, aberto')
  const s = sit('2026-10-22T13:00', [meio])
  ok(!s.aberto && s.proximaAbertura === local('2026-10-22T14:00'), 'parcial: dentro da janela, fechado até 14h', s)
  ok(sit('2026-10-22T15:00', [meio]).aberto, 'parcial: depois da janela, aberto')

  const tarde: FeriadoExpediente = { data: '2026-10-22', tipo: 'parcial', horario_inicio: '12:00', horario_fim: '23:59' }
  ok(sit('2026-10-22T13:00', [tarde]).proximaAbertura === local('2026-10-23T08:00'), 'parcial até o fim do dia: reabre amanhã')
}

console.log('\n4. configuração ilegível vale como aberto')
{
  const agora = local('2026-10-24T03:00')
  ok(situacaoExpediente(agora, { ...HORARIO_PADRAO, dias: [] }, []).aberto, 'sem dias')
  ok(situacaoExpediente(agora, { ...HORARIO_PADRAO, inicio: '18:00', fim: '08:00' }, []).aberto, 'início depois do fim')
  ok(situacaoExpediente(agora, { ...HORARIO_PADRAO, inicio: 'x' }, []).aberto, 'hora ilegível')
  ok(situacaoExpediente('lixo', HORARIO_PADRAO, []).aberto, 'agora ilegível')
}

console.log('\n5. a marca do plantão é por janela')
{
  const janela = local('2026-10-23T08:00')
  const ctx = { plantao_maia: { janela, anunciadoEm: local('2026-10-22T18:31') } }
  ok(plantaoAnunciado(ctx, janela), 'anunciado nesta janela')
  ok(!plantaoAnunciado(ctx, local('2026-10-26T08:00')), 'na janela seguinte, anuncia de novo')
  ok(!plantaoEncerrado(ctx, janela), 'não encerrado')
  ok(plantaoEncerrado({ plantao_maia: { janela, encerradoEm: 'x' } }, janela), 'encerrado nesta janela')
  ok(!plantaoEncerrado({ plantao_maia: { janela, encerradoEm: 'x' } }, local('2026-10-26T08:00')), 'encerrado ontem não cala hoje')

  ok(plantaoAnunciado(null, janela) === false && plantaoAnunciado([], janela) === false, 'ai_context vazio ou estranho')
}

console.log('\n6. atendente que ficou depois do fechamento')
{
  ok(sit('2026-10-22T18:30').fechadoDesde === local('2026-10-22T18:00'), 'quinta 18:30: fechado desde 18h de hoje')
  ok(sit('2026-10-24T10:00').fechadoDesde === local('2026-10-23T18:00'), 'sábado: fechado desde sexta 18h')
  ok(sit('2026-10-22T02:00').fechadoDesde === local('2026-10-21T18:00'), 'madrugada: fechado desde ontem 18h')
  const meio: FeriadoExpediente = { data: '2026-10-22', tipo: 'parcial', horario_inicio: '12:00', horario_fim: '14:00' }
  ok(sit('2026-10-22T13:00', [meio]).fechadoDesde === local('2026-10-22T12:00'), 'parcial: fechado desde o início da janela')
  ok(sit('2026-10-22T10:00').fechadoDesde === null, 'aberto: null')

  const desde = local('2026-10-22T18:00')
  const h = (direction: string, sent_by_ai: boolean, hora: string) => ({ direction, sent_by_ai, created_at: local(`2026-10-22T${hora}`) })
  ok(!humanoDepoisDoFechamento([h('inbound', false, '18:30'), h('outbound', false, '17:55')], desde), 'atendente falou às 17:55: a Maia entra')
  ok(humanoDepoisDoFechamento([h('inbound', false, '18:30'), h('outbound', false, '18:10')], desde), 'atendente falou às 18:10: ainda está lá')
  ok(!humanoDepoisDoFechamento([h('inbound', false, '18:40'), h('outbound', true, '18:31')], desde), 'resposta da própria Maia não conta')
  ok(!humanoDepoisDoFechamento([h('outbound', false, '18:10')], null), 'sem fechadoDesde: não sabe, entra')
}

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
