// npx tsx modules/atendimento/services/status-automatico.test.mts
//
// Os fatos do ciclo movendo o status (ConversationService), com repositório de
// mentira. O que cada bloco protege:
//   1. Conversa nova nasce em Autoatendimento só onde a Maia atende — pelos
//      dois caminhos (número Evolution com "Maia responde"; modo efetivo
//      'autonomous' na Meta). Na dúvida, Aberto.
//   2. A Maia passou para a equipe → Aberto; só a partir de Autoatendimento.
//   3. Gente respondeu → Em atendimento; Aguardando fica (a leitura decide).
//   4. A escolha da equipe sempre vale e liga/desliga a Maia junto, para o
//      status nunca mentir sobre quem fala; e marca status_manual_em.
//   5. A Maia encerrando: sem performed_by, com o motivo, sem marca manual.
//   6. Reabrir volta para quem atende e impede a Maia de reencerrar.

import { ConversationService } from './conversation.service.js'
import type { Conversation } from '../types/central.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

interface Opcoes { maiaAutomatica?: boolean; modoPadrao?: string; falharLeitura?: boolean }

function montar(conversa: Conversation | null, opcoes: Opcoes = {}) {
  let atual = conversa
  const status: string[] = []
  const aiMode: (string | null)[] = []
  const manual: string[] = []
  const criadas: any[] = []
  const auditoria: any[] = []

  const repo = {
    findById: async () => atual,
    findActiveByContactAndChannel: async () => null,
    create: async (input: any) => { criadas.push(input); return { id: 'nova', ...input } },
    updateStatus: async (_id: string, s: string) => { status.push(s); if (atual) atual = { ...atual, status: s as any } },
    updateAiMode: async (_id: string, m: string | null) => { aiMode.push(m); if (atual) atual = { ...atual, ai_mode: m as any } },
    updateAssignee: async () => {},
    updatePriority: async () => {},
    updateAiContext: async (_id: string, ctx: any) => { if (atual) atual = { ...atual, ai_context: ctx } },
    marcarStatusManual: async (_id: string, quando: string) => { manual.push(quando) },
    inboxMaiaAutomatica: async () => {
      if (opcoes.falharLeitura) throw new Error('leitura falhou')
      return opcoes.maiaAutomatica === true
    },
    aiModePadrao: async () => {
      if (opcoes.falharLeitura) throw new Error('leitura falhou')
      return opcoes.modoPadrao ?? 'off'
    },
  }
  const audit  = { insert: async (linha: any) => { auditoria.push(linha) } }
  const events = { emit: () => {} }
  const service = new ConversationService(repo as any, audit as any, events as any)
  return { service, status, aiMode, manual, criadas, auditoria }
}

const BASE = {
  id: 'conv-1', organization_id: 'org-1', inbox_id: 'inbox-1', channel_id: 'ch-1',
  contact_id: 'ct-1', status: 'self_service', ai_mode: null, ai_context: null, assigned_user_id: null,
  priority: null, last_message_at: null, resolved_at: null, archived_at: null, created_at: '', updated_at: '',
} as unknown as Conversation

// --- 1 ---------------------------------------------------------------------------
console.log('\n1. status inicial')
for (const [nome, opcoes, esperado] of [
  ['Evolution com "Maia responde"', { maiaAutomatica: true }, 'self_service'],
  ['Meta com padrão autonomous',    { modoPadrao: 'autonomous' }, 'self_service'],
  ['Meta com padrão assisted',      { modoPadrao: 'assisted' }, 'open'],
  ['número só de gente',            { modoPadrao: 'off' }, 'open'],
  ['leitura falhou → Aberto',       { falharLeitura: true }, 'open'],
] as const) {
  const { service, criadas } = montar(null, opcoes)
  const origWarn = console.warn; console.warn = () => {}
  await service.findOrCreate('ct-1', 'ch-1', 'inbox-1', 'org-1')
  console.warn = origWarn
  checar(nome, criadas[0]?.status, esperado)
}

// --- 2 ---------------------------------------------------------------------------
console.log('\n2. a Maia passou para a equipe')
{
  const { service, status, auditoria } = montar({ ...BASE, ai_mode: 'autonomous' } as Conversation)
  await service.escalarParaAtendimentoHumano('conv-1', 'pedido_do_usuario', 'ferramenta_agente')
  checar('Meta: Autoatendimento → Aberto', status, ['open'])
  const ev = auditoria.find(l => l.event_type === 'conversation.status_changed')
  checar('evento sem performed_by, origem sistema', [ev?.performed_by, ev?.payload?.origem], [undefined, 'sistema'])
}
{
  const { service, status } = montar({ ...BASE, maiaAutomatica: true } as any, { maiaAutomatica: true })
  await service.transferirDoMaiaResponde('conv-1', 'fora_do_alcance', 'ferramenta_agente')
  checar('Evolution: Autoatendimento → Aberto', status, ['open'])
}
{
  const { service, status } = montar({ ...BASE, status: 'assigned', assigned_user_id: 'u1' } as Conversation)
  await service.escalarParaAtendimentoHumano('conv-1', 'falha', 'falha_tecnica')
  checar('já com gente: status fica', status, [])
}

// --- 3 ---------------------------------------------------------------------------
console.log('\n3. gente respondeu')
{
  const { service, status } = montar({ ...BASE } as Conversation)
  await service.statusAoHumanoResponder('conv-1')
  checar('Autoatendimento → Em atendimento', status, ['assigned'])
}
{
  const { service, status } = montar({ ...BASE, status: 'open' } as Conversation)
  await service.statusAoHumanoResponder('conv-1')
  checar('Aberto → Em atendimento', status, ['assigned'])
}
{
  const { service, status } = montar({ ...BASE, status: 'waiting', assigned_user_id: 'u1' } as Conversation)
  await service.statusAoHumanoResponder('conv-1')
  checar('Aguardando fica', status, [])
}

// --- 4 ---------------------------------------------------------------------------
console.log('\n4. a escolha da equipe')
{
  const { service, status, aiMode, manual } = montar({ ...BASE, status: 'assigned', ai_mode: 'off', assigned_user_id: 'u1' } as Conversation)
  await service.setStatus('conv-1', 'self_service', 'u1')
  checar('Autoatendimento liga a Maia (Meta)', aiMode, ['autonomous'])
  checar('termina em Autoatendimento', status.at(-1), 'self_service')
  checar('marca a escolha manual', manual.length, 1)
}
{
  const { service, status, aiMode } = montar({ ...BASE, ai_mode: 'autonomous' } as Conversation)
  await service.setStatus('conv-1', 'waiting', 'u1')
  checar('sair do Autoatendimento desliga a Maia', aiMode, ['off'])
  checar('termina no escolhido', status.at(-1), 'waiting')
}
{
  const { service, status, manual } = montar({ ...BASE, status: 'assigned', assigned_user_id: 'u1' } as Conversation)
  await service.setStatus('conv-1', 'waiting', 'u1')
  checar('Em atendimento → Aguardando à mão', status, ['waiting'])
  checar('marca manual', manual.length, 1)
}
{
  const { service, status, manual } = montar({ ...BASE, status: 'waiting', assigned_user_id: 'u1' } as Conversation)
  await service.setStatus('conv-1', 'waiting', 'u1')
  checar('mesmo status: confirma a escolha, sem escrever status', [status, manual.length], [[], 1])
}
{
  const { service, manual, auditoria } = montar({ ...BASE, status: 'assigned', assigned_user_id: 'u1' } as Conversation)
  await service.resolve('conv-1', 'u1')
  checar('Resolver pelo menu marca manual', manual.length, 1)
  checar('com performed_by', auditoria.find(l => l.event_type === 'conversation.resolved')?.performed_by, 'u1')
}

// --- 5 ---------------------------------------------------------------------------
console.log('\n5. a Maia encerrando')
{
  const { service, status, manual, auditoria } = montar({ ...BASE, status: 'assigned', assigned_user_id: 'u1' } as Conversation)
  await service.aplicarStatusDaMaia('conv-1', 'archived', 'Disse que não tem interesse.')
  const ev = auditoria.find(l => l.event_type === 'conversation.archived')
  checar('Fechado', status, ['archived'])
  checar('sem performed_by, com motivo', [ev?.performed_by, ev?.payload?.origem, ev?.payload?.motivo],
    [undefined, 'maia', 'Disse que não tem interesse.'])
  checar('não marca como escolha da equipe', manual.length, 0)
}
{
  const { service, status } = montar({ ...BASE, status: 'assigned', assigned_user_id: 'u1' } as Conversation)
  await service.aplicarStatusDaMaia('conv-1', 'waiting', 'Ficou de mandar a carteirinha.')
  checar('Aguardando pela Maia', status, ['waiting'])
}

// --- 6 ---------------------------------------------------------------------------
console.log('\n6. reabrir')
{
  const { service, status, manual } = montar({ ...BASE, status: 'resolved' } as Conversation, { maiaAutomatica: true })
  await service.reopen('conv-1', 'u1')
  checar('com a Maia: Autoatendimento', status, ['self_service'])
  checar('marca manual (a Maia não reencerra)', manual.length, 1)
}
{
  const { service, status } = montar({ ...BASE, status: 'archived' } as Conversation, { modoPadrao: 'off' })
  await service.reopen('conv-1', 'u1')
  checar('sem a Maia: Aberto', status, ['open'])
}

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
