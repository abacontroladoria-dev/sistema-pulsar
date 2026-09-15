import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createSystemServices, createAppointmentSystemService } from '../services'
import { ContactRepository } from '../repositories/contact.repository'
import { MessageRepository } from '../repositories/message.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { AuditRepository } from '../repositories/audit.repository'
import { normalizarMensagemMeta } from '../providers/meta-waba.normalizar'
import { montarContexto, LIMITE_HISTORICO } from '../agente/contexto'
import { executarTurno } from '../agente/orquestrador'
import { FerramentasAgente } from '../agente/ferramentas'
import { openAiProvider } from '../llm/openai.provider'

// ============================================================================
// Worker de agrupamento — o miolo do pipeline
//
// Pega o que o webhook enfileirou, resolve quem é a pessoa, grava a mensagem,
// chama a IA e enfileira a resposta. É onde as peças construídas separadamente
// se encontram.
//
// POR QUE AGRUPAR
//
// Gente escreve no WhatsApp como fala: "oi", "queria marcar uma sessão", "pra
// terça de manhã" — três mensagens em quinze segundos. Sem agrupamento seriam
// três turnos, três chamadas à OpenAI (três vezes o custo) e três respostas
// atropelando o responsável. O `process_after = now() + 15s` da fila é o que dá
// tempo de a pessoa terminar de escrever; este worker junta o que chegou do
// mesmo contato e trata como um recado só.
//
// O QUE ACONTECE QUANDO DÁ ERRADO
//
// Cada item reivindicado termina em exatamente um de três estados, e nenhum
// deles é "sumiu":
//
//   completed — houve resposta (ou uma decisão explícita de não responder)
//   pending   — devolvido à fila para tentar de novo mais tarde (rate limit)
//   failed    — desistimos, com o motivo escrito e visível em
//               central.queue_dead_letter_overview
//
// A mensagem do responsável é gravada em central.messages ANTES de a IA ser
// chamada. Assim, se a OpenAI estiver fora do ar, a conversa ainda aparece na
// Central e alguém pode responder à mão. Gravar depois faria a mensagem existir
// só enquanto o turno desse certo.
// ============================================================================

// Lote pequeno de propósito: o worker roda a cada 10s e tem orçamento de tempo
// próprio. Lote grande faria um item lento atrasar todos os outros do lote.
const TAMANHO_LOTE = 5

// Quanto tempo o worker se dá antes de parar de reivindicar. Fica abaixo do
// intervalo do cron para dois tiques não se empilharem; o lease de 2 minutos
// recupera o que ficar pela metade.
const ORCAMENTO_MS = 25_000

export interface ResultadoAgrupamento {
  reivindicados: number
  respondidos: number
  escalados: number
  adiados: number
  falhados: number
}

interface ItemFila {
  id: string
  organization_id: string
  whatsapp_message_id: string
  phone_number_id: string
  message_data: unknown
  contacts_data: unknown
  // Coluna gerada (20260915210000). Opcional no tipo porque o claim de uma
  // linha anterior à migration não a traz preenchida.
  sender_key?: string | null
}

export async function processarAgrupamento(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoAgrupamento> {
  const limite = Date.now() + ORCAMENTO_MS
  const r: ResultadoAgrupamento = {
    reivindicados: 0, respondidos: 0, escalados: 0, adiados: 0, falhados: 0,
  }

  const { data, error } = await supabase.schema('central').rpc(
    'claim_message_grouping_batch',
    { p_organization_id: orgId, p_batch_size: TAMANHO_LOTE },
  )

  if (error) throw error

  const itens = (data ?? []) as ItemFila[]
  r.reivindicados = itens.length
  if (itens.length === 0) return r

  // Agrupa por remetente ANTES de processar. Dois itens do mesmo contato viram
  // um turno só; sem isso o agrupamento não existiria de fato — a fila apenas
  // atrasaria mensagens que continuariam sendo tratadas uma a uma.
  const porContato = new Map<string, { from: string; itens: ItemFila[] }>()
  for (const item of itens) {
    const from = remetenteDe(item)
    if (!from) {
      await concluir(supabase, item.id, 'failed', 'mensagem sem remetente identificável')
      r.falhados++
      continue
    }
    // A chave inclui o phone_number_id — o NOSSO número que recebeu. O mesmo
    // responsável pode escrever para dois números da clínica, e juntar as duas
    // conversas num turno só daria uma resposta com o contexto trocado.
    // `resolverCanal` usa itens[0].phone_number_id, então o grupo precisa ser
    // homogêneo nesse campo. É a mesma chave do empurrão em
    // central.enqueue_grouping_messages.
    // O `from` viaja junto com o grupo em vez de ser remontado da chave: um
    // separador escolhido a dedo é uma aposta sobre o formato de um campo que
    // vem de fora.
    const chave = `${item.phone_number_id}\u0000${from}`
    const grupo = porContato.get(chave) ?? { from, itens: [] }
    grupo.itens.push(item)
    porContato.set(chave, grupo)
  }

  for (const { from, itens: doContato } of porContato.values()) {
    if (Date.now() > limite) {
      // Orçamento esgotado. Os itens ficam em 'processing' e o lease os devolve
      // — melhor que processá-los com pressa e estourar o tempo do handler.
      break
    }

    try {
      const desfecho = await processarContato(supabase, orgId, from, doContato)

      switch (desfecho.tipo) {
        case 'respondido':
          r.respondidos++
          await concluirVarios(supabase, doContato, 'completed', null)
          break
        case 'escalado':
          r.escalados++
          // 'completed', não 'failed': o item FOI processado; o que ele produziu
          // foi uma escalada, que já está registrada na conversa. Marcar
          // 'failed' faria o lease tentar de novo e a IA repetir a mesma falha.
          await concluirVarios(supabase, doContato, 'completed', desfecho.detalhe)
          break
        case 'adiado':
          r.adiados++
          await adiar(supabase, doContato, desfecho.esperarMs)
          break
        case 'silencio':
          r.respondidos++
          await concluirVarios(supabase, doContato, 'completed', desfecho.detalhe)
          break
      }
    } catch (err) {
      r.falhados++
      const motivo = err instanceof Error ? err.message : String(err)
      console.error('[worker agrupamento] falha ao processar contato', { from, motivo })
      await concluirVarios(supabase, doContato, 'failed', motivo)
    }
  }

  return r
}

// ----------------------------------------------------------------------------

type Desfecho =
  | { tipo: 'respondido' }
  | { tipo: 'escalado'; detalhe: string }
  | { tipo: 'adiado'; esperarMs: number | null }
  | { tipo: 'silencio'; detalhe: string }

async function processarContato(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  itens: ItemFila[],
): Promise<Desfecho> {
  const { conversationService, messageService } = createSystemServices()
  const contatos = new ContactRepository(supabase)

  // 1. Canal. Resolvido pelo phone_number_id que a Meta mandou — é o que
  //    permite, no futuro, mais de um número na mesma instalação.
  const canal = await resolverCanal(supabase, orgId, itens[0]!.phone_number_id)

  // 2. Contato. Criado na primeira mensagem de um desconhecido, com o nome do
  //    perfil do WhatsApp quando ele veio no payload.
  const contato = await acharOuCriarContato(contatos, orgId, from, itens)

  // 3. Conversa. `findOrCreate` já trata a corrida por 23505.
  const { conversation } = await conversationService.findOrCreate(
    contato.id, canal.id, canal.inbox_id, orgId,
  )

  // 4. Gravar as mensagens recebidas ANTES de chamar a IA. Se a OpenAI falhar,
  //    a conversa já está na Central e um humano pode assumir.
  const textos: string[] = []
  for (const item of itens) {
    const normalizada = normalizarMensagemMeta(item.message_data)
    await messageService.receive({
      conversationId: conversation.id,
      orgId,
      externalMessageId: normalizada.externalMessageId,
      messageType: normalizada.messageType,
      body: normalizada.body,
      provider: 'meta_waba',
      sentAt: normalizada.sentAt,
      replyToExternalId: normalizada.replyToExternalId,
      attachments: normalizada.attachments,
    })
    // Reação não merece turno da IA — responder a um 👍 com uma frase é ruído.
    // Fica gravada no histórico, mas não provoca resposta.
    if (normalizada.messageType !== 'reaction') {
      textos.push(normalizada.body ?? '')
    }
  }

  if (textos.filter((t) => t.trim()).length === 0) {
    return { tipo: 'silencio', detalhe: 'nada que peça resposta (ex.: só reação)' }
  }

  // 5. Configuração da atendente para esta organização.
  const settings = await lerAgentSettings(supabase, orgId, canal.inbox_id)

  // `ai_mode` tem TRÊS estados (20260811100000), e confundir dois deles é o
  // erro mais caro possível aqui:
  //
  //   'off'        não aciona o agente; nenhuma chamada ao LLM acontece
  //   'assisted'   o agente responde, a resposta fica como RASCUNHO e NÃO é
  //                enviada; um humano revisa antes
  //   'autonomous' o agente responde e a resposta é enfileirada para envio
  //
  // Tratar 'assisted' como autônomo faria a clínica descobrir, por uma
  // mensagem já entregue ao responsável, que a revisão humana que ela
  // configurou nunca aconteceu. Por isso o switch é explícito e o default é
  // fechado: um valor novo na coluna não pode virar "envia".
  if (settings.ai_mode === 'off') {
    // Desligada de propósito. A mensagem está gravada e visível na Central para
    // um humano responder — que é exatamente o que 'off' significa.
    return { tipo: 'silencio', detalhe: 'ai_mode=off; aguardando atendimento humano' }
  }

  if (settings.ai_mode !== 'assisted' && settings.ai_mode !== 'autonomous') {
    return {
      tipo: 'silencio',
      detalhe: `ai_mode='${settings.ai_mode}' desconhecido; nada enviado por segurança`,
    }
  }

  // 6. Contexto e ferramentas.
  const historico = await new MessageRepository(supabase).listByConversation({
    conversationId: conversation.id,
    limit: LIMITE_HISTORICO,
  })

  const contexto = montarContexto({
    systemPrompt: settings.system_prompt,
    memoriaContato: (contato as { ai_memory?: unknown }).ai_memory ?? null,
    nomeContato: contato.name,
    // O histórico já inclui as mensagens recém-gravadas; a última é a própria
    // fala do turno, que o orquestrador acrescenta. Cortá-la aqui evita que o
    // modelo a leia duas vezes.
    historico: historico.slice(textos.length),
    agoraISO: new Date().toISOString(),
  })

  const ferramentas = new FerramentasAgente(
    createAppointmentSystemService(),
    new AppointmentRepository(supabase),
    { orgId, contactId: contato.id, conversationId: conversation.id },
  )

  // 7. O turno.
  //
  // O rastro de tool calls é fornecido AQUI, e não montado dentro do
  // orquestrador, porque o laço não pode depender de banco — é isso que o mantém
  // testável sem stack. O worker é quem já tem o cliente service role.
  //
  // `insert` do AuditRepository é fire-and-forget e nunca rejeita, então não há
  // await: esperar o insert de auditoria atrasaria a resposta ao responsável
  // por algo que não muda a resposta.
  const auditoria = new AuditRepository(supabase)

  const resultado = await executarTurno(
    { orgId, conversationId: conversation.id, contactId: contato.id, textosDoUsuario: textos },
    {
      provider: openAiProvider,
      ferramentas,
      contexto,
      agendamentoHabilitado: settings.ai_scheduling_enabled,
      aoChamarFerramenta: (registro) => {
        void auditoria.insert({
          organization_id: orgId,
          conversation_id: conversation.id,
          event_type:      'ai.tool_call',
          // performed_by ausente: quem chamou foi o agente, não um operador.
          payload:         { ...registro },
        })
      },
    },
  )

  switch (resultado.tipo) {
    case 'responder':
      if (settings.ai_mode === 'assisted') {
        // Rascunho: grava a resposta na conversa SEM enfileirar envio. A
        // recepcionista lê, corrige se quiser, e envia pela Central. É o que
        // 'assisted' promete, e é o modo com que se deve estrear em produção.
        await gravarRascunho(supabase, orgId, conversation.id, resultado.texto)
        return { tipo: 'respondido' }
      }

      await enfileirarEnvio(supabase, orgId, conversation.id, contato.id, resultado.texto)
      return { tipo: 'respondido' }

    case 'aguardar':
      // Registrado porque, sem isto, "a atendente não respondeu" fica sem
      // explicação: o item volta para a fila em silêncio e quem investiga não
      // tem como distinguir rate limit de fila vazia.
      console.warn('[worker agrupamento] turno adiado', {
        conversationId: conversation.id,
        esperarMs: resultado.esperarMs,
        detalhe: resultado.detalhe,
      })
      return { tipo: 'adiado', esperarMs: resultado.esperarMs }

    case 'escalar':
      // Escalar SEMPRE produz efeito visível — é a regra do orquestrador, e é
      // aqui que ela se cumpre. Sem isto, o turno morreria em silêncio e o
      // responsável ficaria esperando uma resposta que ninguém sabe que deve.
      await escalarParaHumano(supabase, conversation.id, resultado.motivo, resultado.detalhe)
      return { tipo: 'escalado', detalhe: `${resultado.motivo}: ${resultado.detalhe}` }
  }
}

// ----------------------------------------------------------------------------
// Auxiliares
// ----------------------------------------------------------------------------

function remetenteDe(item: ItemFila): string | null {
  // `sender_key` é coluna gerada a partir de message_data->>'from'
  // (20260915210000) e é a mesma chave que a RPC de enfileiramento usa para
  // deslizar a janela. Preferi-la mantém fila e worker agrupando pelo MESMO
  // critério; o fallback cobre linhas anteriores à migration.
  if (typeof item.sender_key === 'string' && item.sender_key) return item.sender_key
  const m = (item.message_data ?? {}) as { from?: unknown }
  return typeof m.from === 'string' && m.from ? m.from : null
}

async function resolverCanal(
  supabase: SupabaseClient,
  orgId: string,
  phoneNumberId: string,
): Promise<{ id: string; inbox_id: string }> {
  const { data, error } = await supabase
    .schema('central')
    .from('channel_connections')
    .select('channel_id, channels!inner(id, inbox_id, organization_id)')
    .eq('organization_id', orgId)
    .contains('provider_metadata', { phone_number_id: phoneNumberId })
    .maybeSingle()

  if (error) throw error

  const canal = (data as { channels?: { id: string; inbox_id: string } } | null)?.channels
  if (!canal?.id) {
    throw new Error(
      `nenhum canal com phone_number_id=${phoneNumberId} na org ${orgId}. `
      + 'Rode a migration de seed do canal (20260831100000).',
    )
  }
  return { id: canal.id, inbox_id: canal.inbox_id }
}

async function acharOuCriarContato(
  repo: ContactRepository,
  orgId: string,
  from: string,
  itens: ItemFila[],
) {
  const existente = await repo.findByIdentifier(from, 'wa_id', orgId)
  if (existente) return existente

  const criado = await repo.create({
    organization_id: orgId,
    // `contacts_data[].profile.name` é o nome que a pessoa pôs no WhatsApp.
    // Melhor que só o telefone, e é grátis — vem no mesmo payload.
    name: nomeDoPerfil(itens) ?? undefined,
    display_phone: from,
    contact_type: 'other',
    source: 'whatsapp',
    // Provisório: criado por uma mensagem, não por cadastro. Marca que os dados
    // não foram conferidos por ninguém.
    is_provisional: true,
  })

  await repo.upsertIdentifier({
    organization_id: orgId,
    contact_id: criado.id,
    identifier_type: 'wa_id',
    identifier_value: from,
    is_primary: true,
  })

  return criado
}

function nomeDoPerfil(itens: ItemFila[]): string | null {
  for (const item of itens) {
    const contatos = item.contacts_data as { profile?: { name?: unknown } }[] | null
    const nome = contatos?.[0]?.profile?.name
    if (typeof nome === 'string' && nome.trim()) return nome.trim()
  }
  return null
}

async function lerAgentSettings(
  supabase: SupabaseClient,
  orgId: string,
  inboxId: string,
): Promise<{ ai_mode: string; ai_scheduling_enabled: boolean; system_prompt: string | null }> {
  // Configuração da inbox vence a da organização; a da org é o padrão. É o que
  // o par de índices únicos parciais de agent_settings já previa.
  const { data, error } = await supabase
    .schema('central')
    .from('agent_settings')
    .select('ai_mode, ai_scheduling_enabled, system_prompt, inbox_id')
    .eq('organization_id', orgId)
    .or(`inbox_id.eq.${inboxId},inbox_id.is.null`)
    .order('inbox_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error

  if (!data) {
    // Sem configuração é DESLIGADA, não ligada. Falha fechada: uma instalação
    // sem seed não deve começar a responder pacientes sozinha.
    return { ai_mode: 'off', ai_scheduling_enabled: false, system_prompt: null }
  }

  return data as { ai_mode: string; ai_scheduling_enabled: boolean; system_prompt: string | null }
}

// Modo 'assisted': a resposta existe na conversa mas NÃO sai. Fica como
// outbound 'pending' e sem passar pela send_queue — a recepcionista a vê na
// Central e decide. `sent_by_ai` marca a autoria, para ninguém confundir
// rascunho de máquina com fala de gente.
async function gravarRascunho(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string,
  texto: string,
): Promise<void> {
  const { error } = await supabase.schema('central').from('messages').insert({
    organization_id: orgId,
    conversation_id: conversationId,
    direction: 'outbound',
    message_type: 'text',
    body: texto,
    provider: 'meta_waba',
    status: 'pending',
    sent_by_ai: true,
  })
  if (error) throw error
}

async function enfileirarEnvio(
  supabase: SupabaseClient,
  orgId: string,
  conversationId: string,
  contactId: string,
  texto: string,
): Promise<void> {
  const { error } = await supabase.schema('central').from('send_queue').insert({
    organization_id: orgId,
    conversation_id: conversationId,
    contact_id: contactId,
    message_type: 'text',
    direction: 'outbound',
    body: texto,
    status: 'pending',
    scheduled_at: new Date().toISOString(),
  })
  if (error) throw error
}

// Marca a conversa para atendimento humano e deixa o motivo registrado. Sem
// isto, "escalar" seria só uma palavra no log.
async function escalarParaHumano(
  supabase: SupabaseClient,
  conversationId: string,
  motivo: string,
  detalhe: string,
): Promise<void> {
  const { error } = await supabase
    .schema('central')
    .from('conversations')
    .update({ ai_mode: 'off', priority: 'high' })
    .eq('id', conversationId)

  if (error) {
    console.error('[worker agrupamento] falha ao escalar conversa', { conversationId, error })
  }

  console.warn('[worker agrupamento] conversa escalada para humano', {
    conversationId, motivo, detalhe,
  })
}

async function concluir(
  supabase: SupabaseClient,
  id: string,
  status: 'completed' | 'failed',
  motivo: string | null,
): Promise<void> {
  await supabase
    .schema('central')
    .from('message_grouping_queue')
    .update({
      status,
      processed_at: new Date().toISOString(),
      ...(motivo ? { error_message: motivo.slice(0, 500) } : {}),
    })
    .eq('id', id)
}

async function concluirVarios(
  supabase: SupabaseClient,
  itens: ItemFila[],
  status: 'completed' | 'failed',
  motivo: string | null,
): Promise<void> {
  for (const item of itens) await concluir(supabase, item.id, status, motivo)
}

// Devolve à fila. `pending` de novo, com `process_after` no futuro — e sem
// tocar em `attempts`, porque rate limit da OpenAI não é instabilidade DESTE
// worker, e contá-lo como tal esgotaria as tentativas por um motivo alheio.
async function adiar(
  supabase: SupabaseClient,
  itens: ItemFila[],
  esperarMs: number | null,
): Promise<void> {
  const quando = new Date(Date.now() + (esperarMs ?? 60_000)).toISOString()
  for (const item of itens) {
    await supabase
      .schema('central')
      .from('message_grouping_queue')
      .update({ status: 'pending', process_after: quando, claimed_at: null })
      .eq('id', item.id)
  }
}
