import type {
  Conversation,
  Message,
  Contact,
} from '@/modules/atendimento/types/central.types'
import { resolverModoEfetivo } from '@/modules/atendimento/agente/modo-efetivo'
import {
  MessageDirection,
  MessageType,
  type ConversationStatus,
  type MessageFromType,
  type UIConversation,
  type UIMessage,
} from '@/types/nina'

// ============================================================================
// Fronteira central → Nina
//
// A tela do Nina e o schema `central` nasceram em projetos diferentes e falam
// vocabulários diferentes para as mesmas coisas: 'incoming' vs 'inbound',
// 'content' vs 'body', 'phone_number' vs 'display_phone'. Este arquivo é o
// ÚNICO lugar do repositório onde essa tradução acontece.
//
// A regra vale mesmo quando parece exagero para um campo só: espalhar
// `direction === 'inbound' ? 'incoming' : 'outgoing'` pelos componentes é como
// se perde a conta de quantos lugares precisam mudar quando o schema muda.
//
// Sem React de propósito — é função pura, testável sem montar componente.
// ============================================================================

export interface NinaMessage extends UIMessage {
  // Rascunho da IA no modo 'assisted': a resposta foi gerada mas NÃO saiu, está
  // esperando um humano revisar. A UI precisa distingui-la de uma mensagem
  // enviada, senão o operador acredita que o responsável já recebeu.
  isAiDraft: boolean
  // status 'failed' — a Meta recusou. Também não pode exibir tique de enviado.
  failed: boolean
  // Ainda não há confirmação do provider. Ou está em trânsito (a janela normal
  // entre persistir e a Meta responder), ou o processo morreu no meio e a
  // mensagem ficou órfã — visto em produção: linha 'pending' de humano, sem
  // external_message_id e sem nada na send_queue.
  //
  // Em nenhum dos dois casos ela foi entregue, então não recebe tique. Antes
  // desta flag, o `else` final da bolha desenhava um Check para qualquer status
  // fora de read/delivered, e uma mensagem que nunca saiu parecia enviada.
  emTransito: boolean
}

// `Omit` de messages e clientMemory antes de reintroduzi-los:
//
//  • messages — uma interseção com UIConversation manteria UIMessage[] e a tela
//    não enxergaria isAiDraft/failed. Precisa SUBSTITUIR, não somar.
//  • clientMemory — é obrigatório em UIConversation e não temos origem para ele.
//    Preenchê-lo com o objeto vazio de 4 níveis (como faz o transform legado)
//    produziria `qualification_score: 0` — um zero que a tela mostraria como
//    medida real. Sai do tipo em vez de virar dado falso.
export type NinaConversation = Omit<UIConversation, 'messages' | 'clientMemory'> & {
  messages: NinaMessage[]
  // Rótulo já resolvido do contact_type. Vai junto da conversa porque a tela
  // não recebe o Contact cru — e derivá-lo no JSX espalharia o de-para.
  rotuloTipo: string
}

// ----------------------------------------------------------------------------
// Status: dois eixos do `central` colapsando em três badges do Nina
//
// `status` (open|assigned|waiting|resolved|archived) e `ai_mode`
// (off|assisted|autonomous) são ORTOGONAIS no banco. A badge do Nina mistura os
// dois: 'nina' é sobre quem conduz, 'human'/'paused' é sobre o andamento.
//
// Por isso 'nina' sai de `ai_mode`, não de `status`. Mapear open → 'nina' só
// para a demo ter roxo na tela afirmaria que a IA está atendendo quando ela
// está desligada.
//
// E sai do ai_mode EFETIVO, nunca da coluna crua. `conversations.ai_mode` é NULL
// na maioria das linhas — significa "ninguém decidiu nesta conversa, vale o
// padrão da clínica" (ver 20260915220000) — então comparar a coluna com
// 'autonomous' marcava como "humano" justamente as conversas que a Maia atende
// por herança. Era o que acontecia: a mesma conversa aparecia na coluna Maia da
// triagem (que resolve a herança no servidor) e com a badge de humano no inbox.
//
// `modoPadrao` é o ai_mode da clínica já resolvido, que só o servidor conhece.
// Ele é OBRIGATÓRIO de propósito: com um default aqui, um chamador que
// esquecesse de passá-lo voltaria a errar em silêncio, que é exatamente o modo
// como este bug passou despercebido.
//
// PERDA CONHECIDA: open e assigned viram ambos 'human'. A badge não distingue
// "ninguém assumiu" de "alguém assumiu" — que é a distinção mais importante
// numa central de verdade. Fica como dívida; resolver exige uma badge nova.
export function mapStatus(c: Conversation, modoPadrao: string): ConversationStatus {
  const { modo } = resolverModoEfetivo(c.ai_mode, modoPadrao)
  if (modo === 'autonomous') return 'nina'
  if (c.status === 'open' || c.status === 'assigned') return 'human'
  return 'paused'
}

export function mapDirection(d: Message['direction']): MessageDirection {
  return d === 'inbound' ? MessageDirection.INCOMING : MessageDirection.OUTGOING
}

// Quem falou. No `central` isso é a combinação de duas colunas; no Nina é um
// campo só. Inbound é sempre o contato, independentemente do resto.
export function mapFromType(m: Message): MessageFromType {
  if (m.direction === 'inbound') return 'user'
  return m.sent_by_ai ? 'nina' : 'human'
}

// O tipo do Nina só conhece text/image/audio. Documento e vídeo caem em texto —
// a bolha mostra o corpo, que é melhor que não renderizar nada.
function mapType(messageType: string): MessageType {
  switch (messageType) {
    case 'image': return MessageType.IMAGE
    case 'audio': return MessageType.AUDIO
    default:      return MessageType.TEXT
  }
}

// O Nina espera `status` já reduzido a sent|delivered|read porque é o que os
// tiques sabem desenhar. pending e failed não têm tique — quem os identifica
// são as flags isAiDraft/failed, não este campo.
function mapMessageStatus(s: Message['status']): UIMessage['status'] {
  return s === 'read' || s === 'delivered' ? s : 'sent'
}

export function toUIMessage(m: Message): NinaMessage {
  // Rascunho = a IA escreveu, está pendente, e nunca recebeu id da Meta.
  // As três condições juntas: `pending` sozinho também acontece no instante
  // entre persistir e o provider confirmar, e ali NÃO é rascunho.
  const isAiDraft =
    m.sent_by_ai && m.status === 'pending' && !m.external_message_id

  return {
    id:        m.id,
    // `body` é nullable no banco (mensagem só com anexo, por exemplo).
    content:   m.body ?? '',
    timestamp: horaDoRelogio(m.sent_at ?? m.created_at),
    direction: mapDirection(m.direction),
    type:      mapType(m.message_type),
    fromType:  mapFromType(m),
    status:    mapMessageStatus(m.status),
    isAiDraft,
    failed:    m.status === 'failed',
    // Rascunho já é sinalizado à parte; aqui só o que tentou sair e não
    // confirmou.
    emTransito: !isAiDraft && m.status === 'pending' && !m.external_message_id,
  }
}

export function toUIConversation(
  c:         Conversation,
  contato:   Contact | null,
  // Já em ordem cronológica ASC. Quem chama é responsável por reverter o DESC
  // que vem do banco — a inversão acontece uma vez, na borda do hook.
  mensagens: Message[],
  // O ai_mode da clínica, para resolver a herança da badge. Ver mapStatus.
  modoPadrao: string,
): NinaConversation {
  const uiMensagens = mensagens.map(toUIMessage)
  const ultima      = uiMensagens.at(-1)

  const nome = contato?.name?.trim()
    || contato?.display_phone
    // 'Unknown' era o default do transform legado. Em português e explícito é
    // melhor: diz que o contato existe mas não tem nome, não que houve erro.
    || 'Contato sem nome'

  return {
    id:           c.id,
    contactId:    c.contact_id,
    contactName:  nome,
    contactPhone: contato?.display_phone ?? '',
    contactEmail: contato?.display_email ?? undefined,
    // Nullable no banco. A UI decide entre <img> e iniciais — por isso string
    // vazia em vez de um caminho de imagem que pode não existir.
    contactAvatar: contato?.avatar_url ?? '',
    status:        mapStatus(c, modoPadrao),
    // Não existe no schema: não há registro de leitura por usuário. Zero, e a
    // UI não desenha a badge. Um número inventado faria o operador confiar e
    // deixar de abrir a conversa que tem mensagem nova de verdade.
    unreadCount:  0,
    // Vazio de propósito, e não por ausência de dado: as colunas `tags`
    // existem (em conversations E em contacts, TEXT[] desde a 20260701010000),
    // mas as tags do produto vivem no CONTATO e quem as mostra é o painel de
    // detalhamento, que lê o `central` cru. A lista de conversas não as desenha
    // em lugar nenhum — preenchê-las aqui seria carregar dado para ninguém.
    tags:         [],
    messages:     uiMensagens,
    lastMessage:  ultima?.content || 'Sem mensagens',
    lastMessageTime: horaCurta(c.last_message_at ?? c.created_at),
    lastMessageAt:   c.last_message_at ?? c.created_at,
    assignedUserId:  c.assigned_user_id,
    rotuloTipo:      rotuloTipoContato(contato),
    // clientMemory não aparece aqui: está fora do tipo (ver NinaConversation).
    // `contacts.ai_memory` existe no banco, mas com outra forma — adaptá-la é
    // trabalho próprio, não um preenchimento de campo.
  }
}

// Traduz o tipo de contato para o vocabulário de quem atende. Substitui o
// rótulo fixo "Lead Qualificado", que era decoração — este é dado do banco.
const ROTULO_TIPO: Record<Contact['contact_type'], string> = {
  guardian:  'Responsável',
  patient:   'Paciente',
  therapist: 'Terapeuta',
  physician: 'Médico',
  employee:  'Colaborador',
  lead:      'Primeiro contato',
  supplier:  'Fornecedor',
  other:     'Outro',
}

export function rotuloTipoContato(c: Contact | null): string {
  if (!c) return 'Contato'
  const base = ROTULO_TIPO[c.contact_type] ?? 'Contato'
  // is_provisional = criado automaticamente pelo webhook, ninguém confirmou
  // quem é. Vale dizer: muda o que o atendente pergunta na primeira frase.
  return c.is_provisional ? `${base} · não confirmado` : base
}

// ----------------------------------------------------------------------------
// Formatação de tempo
//
// Copiadas de components/central/useCentralData.ts, que será apagado junto com
// a tela descontinuada. São 3 funções pequenas — copiar custa menos que fazer o
// módulo novo depender de um arquivo marcado para deleção.

// Hoje → hora. Esta semana → dia. Antes → data curta.
export function horaCurta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const agora = new Date()
  if (d.toDateString() === agora.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const dias = (agora.getTime() - d.getTime()) / 86_400_000
  if (dias < 7) {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'short' })
    return s.charAt(0).toUpperCase() + s.slice(1, 3)
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export function horaDoRelogio(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function iniciais(nome: string | null | undefined): string {
  if (!nome) return '?'
  return nome.trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}
