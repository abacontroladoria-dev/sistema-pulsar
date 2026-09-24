import type {
  Conversation,
  Message,
  MessageAttachment,
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
  // O que veio anexado, já traduzido para o que a bolha desenha. Vazio na
  // esmagadora maioria das mensagens — é `[]` e não `undefined` para o JSX não
  // precisar de guarda.
  anexos: AnexoUI[]
}

// ----------------------------------------------------------------------------
// Anexo, do ponto de vista da bolha
//
// `central.message_attachments` guarda DOIS endereços, e nenhum deles pode ir
// direto para a tela:
//
//   • `storage_path` — o arquivo no nosso bucket. O bucket é PRIVADO, então o
//     path não serve de src: quem exibe é uma URL assinada emitida pela rota
//     /api/central/anexos/[id] depois de conferir a sessão. Mandar o path ao
//     cliente também contaria, pelo padrão dele, quantas conversas a
//     organização tem e quando aconteceram.
//   • `external_url` — apesar do nome, guarda o MEDIA ID da Meta, não uma URL.
//     É deliberado: o id vale 7 dias para mídia recebida, enquanto a URL que a
//     Graph devolve em troca dele expira em 5 MINUTOS e exige o token da WABA
//     no header. Guardar a URL teria perdido toda mídia não aberta no mesmo
//     minuto.
//
// Por isso o anexo aqui é uma REFERÊNCIA (`id`) com o que dá para dizer sem
// baixar nada — o tipo, o nome, o tamanho. O endereço é resolvido no clique,
// em ChipAnexo: abrir uma conversa com trinta áudios não pode disparar trinta
// downloads dos quais o atendente vai ouvir um.
// ----------------------------------------------------------------------------
export interface AnexoUI {
  id:         string
  // Rótulo do tipo, já em português ('Imagem', 'Áudio', 'Documento'…).
  rotulo:     string
  // O nome do arquivo quando a Meta o informou. Documento quase sempre tem;
  // imagem e áudio quase nunca.
  nome:       string | null
  // '12s' ou '1,2 MB' — o que houver. Null quando não há nem duração nem
  // tamanho, o que acontece mais do que se imagina.
  detalhe:    string | null
  disponivel: boolean
}

const ROTULO_ANEXO: Record<string, string> = {
  image:    'Imagem',
  audio:    'Áudio',
  video:    'Vídeo',
  document: 'Documento',
  sticker:  'Figurinha',
}

// Rótulo pelo MIME, com o message_type como rede de segurança. O MIME é mais
// específico ('application/pdf' → Documento) e é o que a Meta informa com mais
// consistência; o message_type cobre a linha antiga que não guardou file_type.
function rotuloAnexo(a: MessageAttachment, messageType: string): string {
  const mime = a.file_type ?? ''
  if (mime.startsWith('image/')) return 'Imagem'
  if (mime.startsWith('audio/')) return 'Áudio'
  if (mime.startsWith('video/')) return 'Vídeo'
  if (mime) return 'Documento'
  return ROTULO_ANEXO[messageType] ?? 'Arquivo'
}

// Duração ganha do tamanho: para áudio, "12s" diz mais ao atendente do que
// "34 KB" — ele decide se para para ouvir.
function detalheAnexo(a: MessageAttachment): string | null {
  if (a.duration_secs && a.duration_secs > 0) return `${a.duration_secs}s`
  if (a.file_size && a.file_size > 0) {
    const mb = a.file_size / 1_048_576
    return mb >= 1
      ? `${mb.toFixed(1).replace('.', ',')} MB`
      : `${Math.max(1, Math.round(a.file_size / 1024))} KB`
  }
  return null
}

// Os placeholders que `meta-waba.normalizar.ts` escreve no body quando a mídia
// chega SEM legenda: '[áudio]', '[áudio de voz]', '[imagem]', '[vídeo]',
// '[figurinha]', '[documento]', '[documento: laudo.pdf]'.
//
// O casamento é sobre o corpo INTEIRO, e isso é proposital: naquele arquivo a
// legenda vence o placeholder (`caption?.trim() || '[imagem]'`), então um corpo
// que contém o marcador mas não é só ele foi escrito por uma pessoa — e apagar
// pedaço de mensagem de gente é pior do que deixar um marcador na tela.
const PLACEHOLDER_ANEXO =
  /^\[(áudio(?: de voz)?|imagem|vídeo|figurinha|documento(?::[^\]]*)?)\]$/i

function semPlaceholder(body: string | null): string {
  const texto = body?.trim() ?? ''
  return PLACEHOLDER_ANEXO.test(texto) ? '' : texto
}

export function toAnexoUI(a: MessageAttachment, messageType: string): AnexoUI {
  return {
    id:      a.id,
    rotulo:  rotuloAnexo(a, messageType),
    nome:    a.file_name?.trim() || null,
    detalhe: detalheAnexo(a),
    // O arquivo JÁ é nosso? 'stored' é o único estado em que ele está no
    // bucket. 'pending' e 'failed' não impedem abrir — o primeiro clique busca
    // na Meta e guarda —, mas mudam o que a bolha promete: o primeiro acesso
    // paga uma ida à Graph, os seguintes leem do bucket.
    disponivel: a.storage_status === 'stored',
  }
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
  // "Tem mensagem depois da última leitura?" — derivada das duas colunas da
  // conversa, sem depender do histórico. É o que a LISTA usa, onde `messages`
  // chega vazio e `unreadCount` não teria como ser calculado. Ver temNaoLidas.
  naoLida: boolean
  // Rótulo já resolvido do contact_type. Vai junto da conversa porque a tela
  // não recebe o Contact cru — e derivá-lo no JSX espalharia o de-para.
  rotuloTipo: string
  // O número (canal) por onde a conversa chega — Maia (Meta) ou um número
  // Evolution. É o que o seletor de números filtra e a badge da lista nomeia.
  canalId: string
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

  const anexos = (m.attachments ?? []).map(a => toAnexoUI(a, m.message_type))

  return {
    id:        m.id,
    // `body` é nullable no banco (mensagem só com anexo, por exemplo).
    //
    // Quando há anexo, o webhook grava um placeholder textual no body
    // ('[imagem]', '[documento: laudo.pdf]') — ver message.service.ts. O chip
    // do anexo diz a mesma coisa e diz melhor, então o placeholder sai: repetir
    // "[imagem]" acima de um chip escrito "Imagem" é ruído, e um WhatsApp com
    // legenda ficaria com a legenda enterrada sob o marcador.
    content:   anexos.length > 0 ? semPlaceholder(m.body) : (m.body ?? ''),
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
    anexos,
  }
}

// ----------------------------------------------------------------------------
// Não lidas (20260921140000)
//
// Uma COMPARAÇÃO, não um contador guardado. A conta é feita sobre as mensagens
// que a tela já tem em mãos: quantas entradas do contato são mais novas que a
// marca d'água.
//
// `last_read_at` NULL significa "ninguém abriu" — toda mensagem do contato
// conta. É por isso que a migration não faz backfill: a alternativa seria
// marcar tudo como lido e apagar de uma vez as conversas que esperam retorno.
//
// LIMITE CONHECIDO, e ele é real: a LISTA de conversas não carrega mensagens
// (o hook passa `[]` de propósito — só o detalhe traz o histórico). Então o
// número exato só existe na conversa aberta. Para a lista, o que importa não é
// "quantas" e sim "tem?", e isso `temNaoLidas` responde com as duas colunas da
// própria conversa, sem carregar mensagem nenhuma.
// ----------------------------------------------------------------------------
export function contarNaoLidas(mensagens: Message[], lastReadAt: string | null): number {
  const marca = lastReadAt ? new Date(lastReadAt).getTime() : 0
  return mensagens.filter(m => {
    if (m.direction !== 'inbound') return false
    const quando = m.sent_at ?? m.created_at
    if (!quando) return false
    return new Date(quando).getTime() > marca
  }).length
}

// A pergunta que a lista consegue responder sem carregar o histórico: existe
// mensagem depois da marca? `last_message_at` inclui as NOSSAS mensagens, então
// isto superestima — uma conversa onde o atendente foi o último a falar e
// ninguém reabriu apareceria como não lida.
//
// Na prática isso não acontece, porque responder abre a conversa e abrir marca
// como lida. E o erro, quando ocorre, é para o lado seguro: acende um ponto a
// mais, nunca esconde mensagem que chegou. O contrário — deixar de acender —
// é o defeito que fez a badge ser removida desta tela em primeiro lugar.
export function temNaoLidas(c: Conversation): boolean {
  if (!c.last_message_at) return false
  if (!c.last_read_at)    return true
  return new Date(c.last_message_at).getTime() > new Date(c.last_read_at).getTime()
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
    // Agora tem lastro: `last_read_at` existe desde 20260921140000 e o número
    // é contado sobre as mensagens em mãos. Na LISTA, `mensagens` vem vazio de
    // propósito e isto dá 0 — quem acende o ponto lá é `temNaoLidas`, que não
    // precisa do histórico. Ver o comentário em contarNaoLidas.
    unreadCount:  contarNaoLidas(mensagens, c.last_read_at),
    // A pergunta binária, que vale inclusive sem histórico carregado.
    naoLida:      temNaoLidas(c),
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
    canalId:         c.channel_id,
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
