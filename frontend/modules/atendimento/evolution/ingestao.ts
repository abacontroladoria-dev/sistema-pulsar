import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSystemServices } from '../services'
import { ContactRepository } from '../repositories/contact.repository'
import type { EventoEvolution } from '../providers/evolution.normalizar'
import { statusDoEstado } from '../providers/evolution.provider'
import { variantesBr } from '../utils/telefone-br'

// ============================================================================
// Ingestão dos eventos da Evolution
//
// Diferente da Meta, NÃO passa pela message_grouping_queue: aquela fila existe
// para a janela de debounce da Maia, e o único consumidor dela roda o turno da
// IA. Número Evolution é atendimento humano — a mensagem vai direto para a
// conversa, e a atendente a vê no próximo polling do inbox.
//
// Tudo com service role (sem sessão: quem chama é a Evolution). A organização
// vem da connection do canal, nunca de parâmetro da requisição.
// ============================================================================

export interface CanalEvolution {
  organization_id: string
  channel_id: string
  inbox_id: string
}

// Janela para reconhecer o ECO de uma mensagem que nós mesmos enviamos pela
// tela: a Evolution avisa o envio pelo webhook, às vezes ANTES de a nossa
// chamada receber a resposta e gravar o external_message_id.
const JANELA_ECO_MS = 60_000

export async function processarEventoEvolution(
  supabase: SupabaseClient,
  canal: CanalEvolution,
  evento: EventoEvolution,
): Promise<void> {
  switch (evento.tipo) {
    case 'mensagem':
      return processarMensagem(supabase, canal, evento)
    case 'status':
      return processarStatus(canal, evento)
    case 'conexao':
      return processarConexao(supabase, canal, evento.estado)
    case 'ignorado':
      return
  }
}

async function processarMensagem(
  supabase: SupabaseClient,
  canal: CanalEvolution,
  evento: Extract<EventoEvolution, { tipo: 'mensagem' }>,
): Promise<void> {
  const { conversationService, messageService } = createSystemServices()
  const orgId = canal.organization_id
  const m = evento.mensagem

  const contato = await acharOuCriarContato(
    new ContactRepository(supabase), orgId, evento.telefone, evento.nomePerfil,
  )

  // O ai_mode 'off' é imposto pela trigger trg_evolution_sem_ia no INSERT.
  const { conversation } = await conversationService.findOrCreate(
    contato.id, canal.channel_id, canal.inbox_id, orgId,
  )

  if (!evento.fromMe) {
    await messageService.receive({
      conversationId: conversation.id,
      orgId,
      externalMessageId: m.externalMessageId,
      messageType: m.messageType,
      body: m.body,
      provider: 'evolution',
      sentAt: m.sentAt,
      replyToExternalId: m.replyToExternalId,
      attachments: m.attachments,
    })
    return
  }

  // fromMe: ou é o eco do que a atendente mandou pela tela, ou alguém
  // respondeu direto pelo celular do número.
  const { data: existente, error: erroBusca } = await supabase
    .schema('central')
    .from('messages')
    .select('id')
    .eq('organization_id', orgId)
    .eq('provider', 'evolution')
    .eq('external_message_id', m.externalMessageId)
    .maybeSingle()
  if (erroBusca) throw erroBusca
  if (existente) return

  const desde = new Date(Date.now() - JANELA_ECO_MS).toISOString()
  const { data: pendente, error: erroPendente } = await supabase
    .schema('central')
    .from('messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('direction', 'outbound')
    .eq('status', 'pending')
    .is('external_message_id', null)
    .eq('body', m.body ?? '')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (erroPendente) throw erroPendente

  if (pendente) {
    // O envio pela tela ainda vai chamar confirmarEnvio com o mesmo id. Gravar
    // aqui primeiro só antecipa; o índice único impede duplicar.
    const { error } = await supabase
      .schema('central')
      .from('messages')
      .update({ external_message_id: m.externalMessageId, status: 'sent', sent_at: m.sentAt ?? new Date().toISOString() })
      .eq('id', (pendente as { id: string }).id)
      .is('external_message_id', null)
    if (error && (error as { code?: string }).code !== '23505') throw error
    return
  }

  // Enviada pelo celular: fica no histórico como outbound sem autor no sistema.
  const { error } = await supabase.schema('central').from('messages').insert({
    organization_id: orgId,
    conversation_id: conversation.id,
    external_message_id: m.externalMessageId,
    direction: 'outbound',
    message_type: m.messageType,
    body: m.body,
    provider: 'evolution',
    status: 'sent',
    sent_by_ai: false,
    sent_at: m.sentAt ?? new Date().toISOString(),
  })
  if (error && (error as { code?: string }).code !== '23505') throw error
}

async function processarStatus(
  canal: CanalEvolution,
  evento: Extract<EventoEvolution, { tipo: 'status' }>,
): Promise<void> {
  const { messageService } = createSystemServices()
  await messageService.updateDeliveryStatus({
    externalMessageId: evento.externalId,
    orgId: canal.organization_id,
    provider: 'evolution',
    status: evento.status,
  })
}

export async function processarConexao(
  supabase: SupabaseClient,
  canal: CanalEvolution,
  estado: string | undefined,
): Promise<void> {
  const status = statusDoEstado(estado)
  const agora = new Date().toISOString()

  const { error: e1 } = await supabase
    .schema('central')
    .from('channel_connections')
    .update({ connection_status: status, last_sync_at: agora })
    .eq('channel_id', canal.channel_id)
  if (e1) throw e1

  const { error: e2 } = await supabase
    .schema('central')
    .from('channels')
    .update({ status })
    .eq('id', canal.channel_id)
  if (e2) throw e2
}

// Procura o contato pelas duas formas do celular brasileiro (com e sem o 9º
// dígito), para não duplicar quem já conversou com a Maia pela Meta. Não achou:
// cria provisório, com o telefone exatamente como o WhatsApp o identifica.
async function acharOuCriarContato(
  repo: ContactRepository,
  orgId: string,
  telefone: string,
  nomePerfil: string | null,
) {
  for (const variante of variantesBr(telefone)) {
    const existente = await repo.findByIdentifier(variante, 'wa_id', orgId)
    if (existente) return existente
  }

  const criado = await repo.create({
    organization_id: orgId,
    name: nomePerfil ?? undefined,
    display_phone: telefone,
    contact_type: 'other',
    source: 'whatsapp',
    is_provisional: true,
  })

  await repo.upsertIdentifier({
    organization_id: orgId,
    contact_id: criado.id,
    identifier_type: 'wa_id',
    identifier_value: telefone,
    is_primary: true,
  })

  return criado
}
