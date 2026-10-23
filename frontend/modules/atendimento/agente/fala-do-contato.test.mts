// A fala do contato, inclusive por áudio. Função pura.
//
//   npx tsx modules/atendimento/agente/fala-do-contato.test.mts
//
// O que se prova:
//   1. ÁUDIO TRANSCRITO chega marcado — a Maia sabe que não foi digitado.
//   2. SEM TEXTO, O AVISO FICA — falha, processando ou nunca tentado: a Maia
//      não pode inventar o que não leu.
//   3. ÁUDIO MUDO não vira mensagem vazia (que o contexto descartaria).
//   4. A CLASSIFICAÇÃO E O STATUS leem a mesma fala que a Maia.

import { falaDaMensagem, MARCA_AUDIO_TRANSCRITO, AUDIO_SEM_FALA } from './fala-do-contato.js'
import { falasDoHistorico } from './classificacao.js'
import { falasParaStatus } from './status-atendimento.js'
import type { Message } from '../types/central.types.js'

let falhas = 0
function eq(recebido: unknown, esperado: unknown, oque: string) {
  if (recebido === esperado) { console.log(`  ok   ${oque}`); return }
  falhas++
  console.error(`  FALHA ${oque}\n         esperado: ${JSON.stringify(esperado)}\n         recebido: ${JSON.stringify(recebido)}`)
}

const audio = (
  transcricao: string | null,
  transcricao_status: 'processing' | 'completed' | 'failed' | null,
  direction: 'inbound' | 'outbound' = 'inbound',
) => ({
  direction, body: '[áudio de voz]', message_type: 'audio', deleted_at: null,
  sent_by_ai: false, status: 'delivered', external_message_id: 'x', created_at: '2026-10-23T12:00:00Z',
  attachments: [{ transcricao, transcricao_status }],
}) as unknown as Message

console.log('\n1. áudio transcrito')
eq(falaDaMensagem(audio('  Quero remarcar.  ', 'completed')), `${MARCA_AUDIO_TRANSCRITO} Quero remarcar.`, 'texto marcado e aparado')
eq(falaDaMensagem(audio('Texto antigo', 'failed')), `${MARCA_AUDIO_TRANSCRITO} Texto antigo`, 'refazer que falhou mantém o texto')
eq(falaDaMensagem(audio('Texto antigo', 'processing')), `${MARCA_AUDIO_TRANSCRITO} Texto antigo`, 'refazendo: o texto anterior vale')

console.log('\n2. sem texto, o aviso')
eq(falaDaMensagem(audio(null, null)), '[áudio de voz]', 'nunca tentado')
eq(falaDaMensagem(audio(null, 'processing')), '[áudio de voz]', 'transcrevendo')
eq(falaDaMensagem(audio(null, 'failed')), '[áudio de voz]', 'falhou')
eq(falaDaMensagem({ direction: 'inbound', body: 'oi' }), 'oi', 'texto comum, sem anexo')

console.log('\n3. áudio mudo')
eq(falaDaMensagem(audio('', 'completed')), AUDIO_SEM_FALA, 'completed vazio vira aviso próprio')

console.log('\n4. o que a clínica manda não usa transcrição')
eq(falaDaMensagem(audio('não devia aparecer', 'completed', 'outbound')), '[áudio de voz]', 'outbound fica com o body')

console.log('\n5. classificação e status leem a mesma fala')
eq(falasDoHistorico([audio('Meu filho tem 4 anos', 'completed')], null)[0]?.texto,
  `${MARCA_AUDIO_TRANSCRITO} Meu filho tem 4 anos`, 'falasDoHistorico (classificação e ficha)')
eq(falasParaStatus([audio('Pode cancelar', 'completed')])[0]?.texto,
  `${MARCA_AUDIO_TRANSCRITO} Pode cancelar`, 'falasParaStatus (status e funil)')

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
