import { NextResponse, type NextRequest } from 'next/server'

import { assinaturaMetaConfere } from '@/lib/central/webhook-signature'
import { despacharWorkerEmBreve } from '@/lib/central/despachar-worker'
import { supabaseService } from '@/lib/supabase/service'

// ============================================================================
// Webhook do WhatsApp (Meta Cloud API)
//
// Esta rota tem UMA responsabilidade: provar que a mensagem veio da Meta e
// colocá-la numa fila. Ela não chama a OpenAI, não consulta a agenda e não
// responde ao paciente — isso é do worker.
//
// POR QUE ENFILEIRAR EM VEZ DE PROCESSAR AQUI
//
// A Meta reentrega o webhook quando vê 5xx ou demora. Um turno completo
// (modelo + ferramentas + agenda) leva segundos e pode falhar; processá-lo em
// linha significaria a Meta reentregando o MESMO recado enquanto ainda estamos
// tratando o primeiro — laço que se alimenta do próprio erro, e resposta
// dobrada no WhatsApp de quem esperava uma. Enfileirar e responder 200 corta
// isso na raiz.
//
// A janela de debounce (`process_after` da message_grouping_queue) resolve outro
// problema humano: gente manda "oi", "queria marcar", "pra terça" em três
// mensagens seguidas. Sem ela, seriam três turnos e três respostas.
//
// A janela DESLIZA: cada mensagem nova empurra o prazo de todas as pendentes do
// mesmo remetente para 8 segundos à frente. Enquanto a pessoa digita, nada é
// processado; quando ela para, tudo vence junto e vira um turno só. Isso é feito
// dentro da RPC `central.enqueue_grouping_messages`, não aqui — ver a migration
// 20260915210000 para o porquê de ser atômico.
//
// Enfileirar não é o mesmo que esperar o cron. Depois de guardar, esta rota
// AGENDA o worker para quando a janela fechar (despacharWorkerEmBreve), sem
// esperar por ele. Isso tira a espera do cron da frente de cada resposta; o
// pg_cron continua existindo como rede de segurança, não como gatilho principal.
//
// AUTENTICAÇÃO
//
// É a primeira rota do repositório que NÃO usa `extractUser()`. Quem chama é a
// Meta, sem cookie de sessão. A prova de origem é o HMAC do corpo cru — ver
// lib/central/webhook-signature.ts, que documenta as três armadilhas.
// ============================================================================

// Node runtime: a verificação usa `node:crypto` (timingSafeEqual), que não
// existe no runtime edge.
export const runtime = 'nodejs'

// Nunca cachear: cada entrega é única e tem efeito colateral.
export const dynamic = 'force-dynamic'

// ----------------------------------------------------------------------------
// GET — handshake de verificação
//
// A Meta chama uma vez, ao salvar o Callback URL no painel, e espera receber o
// `hub.challenge` de volta como TEXTO PURO. Devolver JSON (`"123"` com aspas)
// faz a verificação falhar com uma mensagem genérica no painel, e o motivo não
// aparece em lugar nenhum — por isso o `new Response(texto)` explícito.
// ----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  const esperado = process.env.WHATSAPP_VERIFY_TOKEN

  if (!esperado) {
    console.error('[webhook whatsapp] WHATSAPP_VERIFY_TOKEN não configurado')
    return new NextResponse('forbidden', { status: 403 })
  }

  if (mode === 'subscribe' && token === esperado && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Sem detalhe: quem erra o token não precisa saber o que errou.
  return new NextResponse('forbidden', { status: 403 })
}

// ----------------------------------------------------------------------------
// POST — entrega de mensagem
// ----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // CORPO CRU ANTES DE QUALQUER PARSE. O HMAC é sobre estes bytes; um
  // `req.json()` aqui tornaria a assinatura impossível de conferir (ver o
  // comentário 1 de webhook-signature.ts).
  const corpoCru = await req.text()

  const confere = assinaturaMetaConfere(
    corpoCru,
    req.headers.get('x-hub-signature-256'),
    process.env.WHATSAPP_APP_SECRET,
  )

  if (!confere) {
    // 401 sem corpo. A Meta não reentrega em 4xx, que é o que queremos: se a
    // assinatura não confere, reentregar não vai fazer conferir.
    console.warn('[webhook whatsapp] assinatura inválida ou ausente')
    return new NextResponse(null, { status: 401 })
  }

  let payload: PayloadMeta
  try {
    payload = JSON.parse(corpoCru) as PayloadMeta
  } catch {
    // Assinado por quem tem o segredo, mas ilegível. Não é ataque; é defeito.
    // 200 para não gerar reentrega infinita de algo que nunca vai parsear.
    console.error('[webhook whatsapp] corpo assinado porém não é JSON')
    return NextResponse.json({ ok: true, ignorado: 'corpo ilegível' })
  }

  const linhas = extrairMensagens(payload)

  if (linhas.length === 0) {
    // Caso ROTINEIRO, não erro: a Meta envia webhooks de status de entrega
    // (sent/delivered/read) pelo mesmo endereço. Nesta entrega eles são
    // ignorados de propósito — status de entrega é o item 3 da lista de corte.
    return NextResponse.json({ ok: true, enfileiradas: 0 })
  }

  // Uma RPC, e não um upsert, porque enfileirar e DESLIZAR a janela de debounce
  // das mensagens já pendentes do mesmo remetente precisa ser atômico: em dois
  // round-trips, um processo que morre no meio deixa a mensagem nova com a
  // janela nova e a anterior com a antiga — e saem duas respostas, que é o
  // defeito que a janela deslizante corrige. Ver a migration
  // 20260915210000_central_janela_debounce_deslizante.sql.
  //
  // A idempotência continua vindo do índice uq_grouping_wa_msg (20260810120100):
  // a função usa `on conflict do nothing`, então a reentrega da Meta não insere
  // nada e, de propósito, também não empurra a janela de ninguém.
  const { data, error } = await supabaseService
    .schema('central')
    .rpc('enqueue_grouping_messages', {
      p_organization_id: linhas[0].organization_id,
      p_rows: linhas.map(({ organization_id: _org, ...resto }) => resto),
    })
    .single<{ inseridas: number; process_after: string | null }>()

  if (error) {
    // AQUI o 5xx é desejado: a mensagem do paciente ainda não está guardada em
    // lugar nenhum, e a reentrega da Meta é a nossa segunda chance.
    console.error('[webhook whatsapp] falha ao enfileirar', error)
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  // Acorda o worker quando a janela de debounce fechar, em vez de esperar o
  // próximo tique do cron. É o que aproxima isto de uma plataforma de
  // atendimento de verdade, onde um consumidor vivo reage à chegada da mensagem.
  //
  // O prazo vem do BANCO (`process_after` devolvido pela RPC), não de uma
  // constante somada aqui: com a janela deslizando, esta entrega pode ter
  // empurrado mensagens anteriores, e só o banco sabe para quando. Repetir o
  // valor da janela em Node faria os dois relógios discordarem no dia em que
  // ela mudasse.
  //
  // Sem `await`: a Meta reentrega se demorarmos, e o 200 não pode ficar preso
  // atrás de um turno de IA. O despacho é agendado e a resposta sai agora.
  //
  // Isto NÃO substitui o pg_cron. Se o container reiniciar entre a entrega e o
  // despacho, o timer morre com ele — o cron é quem garante que nada fica na
  // fila para sempre. Ver lib/central/despachar-worker.ts.
  despacharWorkerEmBreve(linhas[0].organization_id, data?.process_after ?? null)

  return NextResponse.json({
    ok: true,
    recebidas: linhas.length,
    enfileiradas: data?.inseridas ?? 0,
  })
}

// ----------------------------------------------------------------------------
// Extração
//
// O payload da Meta é aninhado em três níveis (entry → changes → value) e
// qualquer um deles pode faltar. Tudo é opcional no tipo de propósito: o que
// chega é dado externo, e um `?? []` é mais barato que um turno perdido por
// TypeError.
//
// A mensagem é guardada CRUA em `message_data`. Normalizar aqui obrigaria a
// rota a conhecer todos os formatos (texto, áudio, imagem, botão, reação) para
// só então enfileirar — mais código no caminho crítico, e uma mensagem de tipo
// desconhecido seria perdida em vez de guardada. O worker normaliza depois, com
// o payload inteiro à disposição.
// ----------------------------------------------------------------------------
interface PayloadMeta {
  object?: string
  entry?: {
    id?: string
    changes?: {
      field?: string
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string }
        contacts?: unknown[]
        messages?: { id?: string; from?: string; type?: string }[]
        statuses?: unknown[]
      }
    }[]
  }[]
}

interface LinhaFila {
  organization_id: string
  whatsapp_message_id: string
  phone_number_id: string
  message_data: unknown
  contacts_data: unknown
}

function extrairMensagens(payload: PayloadMeta): LinhaFila[] {
  // Uma instalação, uma organização. Quando houver multi-tenant, o mapeamento
  // certo é phone_number_id → channel_connections → organization_id; deixar
  // como env agora evita uma consulta no caminho crítico do webhook.
  const orgId = process.env.CENTRAL_ORGANIZATION_ID
  if (!orgId) {
    console.error('[webhook whatsapp] CENTRAL_ORGANIZATION_ID não configurado')
    return []
  }

  const linhas: LinhaFila[] = []

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id
      if (!phoneNumberId) continue

      for (const mensagem of value?.messages ?? []) {
        // Sem id não há como deduplicar, e sem dedup a reentrega da Meta vira
        // resposta dobrada. Descartar é a opção correta.
        if (!mensagem?.id) continue

        linhas.push({
          organization_id: orgId,
          whatsapp_message_id: mensagem.id,
          phone_number_id: phoneNumberId,
          message_data: mensagem,
          // `contacts` traz o nome de perfil (`profile.name`) e o `wa_id`. É o
          // que permite criar o contato com nome de verdade em vez de só o
          // telefone, na primeira mensagem de alguém desconhecido.
          contacts_data: value?.contacts ?? null,
        })
      }
    }
  }

  return linhas
}
