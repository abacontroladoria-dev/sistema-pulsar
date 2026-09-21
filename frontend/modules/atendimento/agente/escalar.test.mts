// A ferramenta `escalar_para_humano`, com ConversationService dublê.
//
//   npx tsx modules/atendimento/agente/escalar.test.mts
//
// Sem stack: ao contrário de ferramentas.test.mts (que exercita a agenda contra o
// Supabase local), aqui o que importa é a decisão, não a escrita. O service é
// dublado e as asserções são sobre o que a ferramenta PEDIU a ele.
//
// O que se prova:
//
//   1. ESCALAR ESCALA — e com a origem certa, que é o que separa "a Maia fez a
//      coisa certa" de "a Maia quebrou" na auditoria.
//   2. IDEMPOTÊNCIA — chamar duas vezes no mesmo turno não escreve duas vezes.
//      O detector de laço do orquestrador só pega repetição EXATA; trocar o
//      motivo escaparia dele e chegaria aqui.
//   3. NUNCA RECUSA por já estar escalada. Recusa é sinal de "tente outra coisa",
//      e a outra coisa seria o modelo insistir ou desistir de avisar a pessoa.
//   4. O FLAG DO TURNO só liga depois da escrita dar certo. É ele que faz o
//      worker mandar o texto de segurança — ligá-lo numa escalada que falhou
//      faria o sistema prometer um humano que ninguém chamou.
//   5. FALHA DE MONTAGEM (sem service, sem conversationId) vira recusa honesta,
//      não exceção.

import { FerramentasAgente, MOTIVO } from './ferramentas.js'
import type { AppointmentService } from '../services/appointment.service.js'
import type { AppointmentRepository } from '../repositories/appointment.repository.js'
import type { ConversationService } from '../services/conversation.service.js'

let falhas = 0
function checar(condicao: boolean, oque: string, extra?: unknown) {
  if (condicao) {
    console.log(`  ok    ${oque}`)
  } else {
    falhas++
    console.error(`  FALHA ${oque}`)
    if (extra !== undefined) console.error('        ', JSON.stringify(extra))
  }
}

const CONVERSA = '11111111-1111-1111-1111-111111111111'

interface Chamada { conversationId: string; motivoEscalada: string; origem: string }

// Dublê: registra o que foi pedido e responde o que o teste mandar.
function serviceDuble(opcoes: { jaEstavaEscalada?: boolean; lanca?: boolean } = {}) {
  const chamadas: Chamada[] = []
  const service = {
    async escalarParaAtendimentoHumano(
      conversationId: string, motivoEscalada: string, origem: string,
    ) {
      chamadas.push({ conversationId, motivoEscalada, origem })
      if (opcoes.lanca) throw new Error('falha de escrita simulada')
      return { jaEstavaEscalada: opcoes.jaEstavaEscalada ?? false }
    },
  } as unknown as ConversationService
  return { service, chamadas }
}

function ferramentas(service: ConversationService | null, conversationId: string | null = CONVERSA) {
  return new FerramentasAgente(
    null as unknown as AppointmentService,
    null as unknown as AppointmentRepository,
    { orgId: 'a0000000-0000-0000-0000-000000000001', contactId: 'ct1', conversationId },
    service,
  )
}

// ---------------------------------------------------------------------------
console.log('\n1. escalar escala')

{
  const { service, chamadas } = serviceDuble()
  const f = ferramentas(service)

  checar(f.escaladaPedida() === null, 'antes de tudo, nenhuma escalada pedida')

  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'pedido_do_usuario' }) as any

  checar(r.ok === true, 'devolve ok', r)
  checar(r.jaEstavaEscalada === false, 'e diz que a escalada é nova', r)
  checar(chamadas.length === 1, 'o service foi chamado uma vez', chamadas)
  checar(chamadas[0]?.conversationId === CONVERSA, 'na conversa do CONTEXTO', chamadas[0])
  checar(chamadas[0]?.motivoEscalada === 'pedido_do_usuario', 'com o motivo que o modelo deu', chamadas[0])
  checar(chamadas[0]?.origem === 'ferramenta_agente',
    "origem 'ferramenta_agente' — não é falha técnica", chamadas[0])
  checar(f.escaladaPedida()?.motivoEscalada === 'pedido_do_usuario',
    'e o flag do turno ficou ligado (é o que dispara o texto de segurança)', f.escaladaPedida())
}

// ---------------------------------------------------------------------------
console.log('\n2. o conversationId vem do runtime, nunca do modelo')

{
  const { service, chamadas } = serviceDuble()
  const f = ferramentas(service)

  // Mesmo que o modelo tente indicar outra conversa, semChavesDeContexto filtra
  // antes. É a mesma defesa das ferramentas de agenda, e vale aqui porque o
  // caminho do agente roda com service role, sem RLS para segurar o erro.
  await f.executar('escalar_para_humano', {
    motivoEscalada: 'pedido_do_usuario',
    conversationId: '99999999-9999-9999-9999-999999999999',
  })

  checar(chamadas[0]?.conversationId === CONVERSA,
    'a conversa escalada é a do contexto, não a que o modelo mandou', chamadas[0])
}

// ---------------------------------------------------------------------------
console.log('\n3. idempotência dentro do turno')

{
  const { service, chamadas } = serviceDuble()
  const f = ferramentas(service)

  await f.executar('escalar_para_humano', { motivoEscalada: 'pedido_do_usuario' })
  // Motivo DIFERENTE: escapa do detector de laço do orquestrador (que compara
  // nome + JSON exatos) e chega até aqui.
  const r2 = await f.executar('escalar_para_humano', { motivoEscalada: 'insatisfacao' }) as any

  checar(chamadas.length === 1, 'a segunda chamada NÃO foi ao service', chamadas)
  checar(r2.ok === true, 'e mesmo assim devolve ok — já escalada é sucesso', r2)
  checar(r2.jaEstavaEscalada === true, 'sinalizando que já estava', r2)
}

// ---------------------------------------------------------------------------
console.log('\n4. conversa que JÁ estava escalada antes do turno')

{
  const { service, chamadas } = serviceDuble({ jaEstavaEscalada: true })
  const f = ferramentas(service)

  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'insatisfacao' }) as any

  checar(r.ok === true, 'não recusa', r)
  checar(r.jaEstavaEscalada === true, 'repassa o que o service disse', r)
  checar(chamadas.length === 1, 'consultou o service (que decidiu não reescrever)', chamadas)
  checar(f.escaladaPedida() !== null,
    'o flag liga mesmo assim — o responsável ainda precisa ser avisado neste turno')
}

// ---------------------------------------------------------------------------
console.log('\n5. falha de escrita não mente')

{
  const { service } = serviceDuble({ lanca: true })
  const f = ferramentas(service)

  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'pedido_do_usuario' }) as any

  checar(r.ok === false, 'vira recusa', r)
  checar(f.escaladaPedida() === null,
    'e o flag NÃO liga — senão o worker prometeria um humano que ninguém chamou')
}

// ---------------------------------------------------------------------------
console.log('\n6. montagem incompleta vira recusa, não exceção')

{
  // Worker não passou o service (ou um caller antigo construiu com 3 argumentos).
  const f = ferramentas(null)
  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'pedido_do_usuario' }) as any
  checar(r.ok === false && r.motivo === MOTIVO.ERRO_INTERNO, 'sem service → recusa', r)
  checar(f.escaladaPedida() === null, 'e sem flag', f.escaladaPedida())
}

{
  const { service, chamadas } = serviceDuble()
  const f = ferramentas(service, null)
  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'pedido_do_usuario' }) as any
  checar(r.ok === false, 'sem conversationId → recusa', r)
  checar(chamadas.length === 0, 'e não chama o service', chamadas)
}

// ---------------------------------------------------------------------------
console.log('\n7. motivo inválido não impede a escalada')

{
  const { service, chamadas } = serviceDuble()
  const f = ferramentas(service)

  // O enum do schema já restringe, mas `strict` pode estar desligado para
  // depurar. Recusar a escalada por causa de um RÓTULO seria trocar o que
  // importa (a pessoa chegar ao humano) pelo que não importa (a etiqueta).
  const r = await f.executar('escalar_para_humano', { motivoEscalada: 'inventado' }) as any

  checar(r.ok === true, 'escala mesmo assim', r)
  checar(chamadas[0]?.motivoEscalada === 'fora_do_alcance',
    'e grava um valor válido na auditoria', chamadas[0])
}

// ---------------------------------------------------------------------------
console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} teste(s) FALHARAM.`)
process.exit(falhas === 0 ? 0 : 1)
