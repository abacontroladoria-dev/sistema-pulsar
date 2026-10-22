import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createAppointmentSystemService, createSystemServices } from '../services'
import { MessageRepository } from '../repositories/message.repository'
import { AppointmentRepository } from '../repositories/appointment.repository'
import { AuditRepository } from '../repositories/audit.repository'
import { TagDefinitionRepository } from '../repositories/tag-definition.repository'
import { CampaignPhraseRepository } from '../repositories/campaign-phrase.repository'
import { resolverOrigem, temOrigem, type FraseCadastrada } from '../agente/origem-campanha'
import { TAG_TRABALHE_CONOSCO, pareceTrabalheConosco } from '../agente/tipo-contato'
import { montarContexto, LIMITE_HISTORICO } from '../agente/contexto'
import { classificarConversa, falasDoHistorico } from '../agente/classificacao'
import { extrairFicha } from '../agente/extracao-ficha'
import { createFichaService } from '../services/ficha.service'
import { FunilMaiaService } from '../services/funil-maia.service'
import { executarTurno } from '../agente/orquestrador'
import { FerramentasAgente } from '../agente/ferramentas'
import { openAiProvider } from '../llm/openai.provider'
import { lerAgentSettings } from '../agente/agent-settings'
import { CHAVE_MAIA_TRANSFERIU, maiaTransferiu } from '../agente/caixas'
import {
  TEXTO_ESCALADA_FALLBACK, TEXTO_SEM_AGENDAMENTO_NO_NUMERO, prometeAgendamento,
  textoEscaladaNoPlantao, textoSemAgendamentoNoPlantao,
} from '../agente/entrega'
import {
  HORARIO_PADRAO, formatarRetornoEquipe, situacaoExpediente,
  type FeriadoExpediente, type SituacaoExpediente,
} from '../agente/horario-comercial'
import { humanoDepoisDoFechamento, janelaDoPlantao, plantaoAnunciado, plantaoEncerrado } from '../agente/plantao'
import { PacienteRepository } from '../repositories/paciente.repository'
import { SessoesTitaRepository } from '../repositories/sessoes-tita.repository'
import type { AnuncioDaConversa, TagDefinition } from '../types/central.types'

// ============================================================================
// Maia sugere — números Evolution com a chave ligada
//
// Número Evolution é aberto ao público e atendido por gente; a Maia NUNCA envia
// por ele (trg_evolution_sem_ia segue travando ai_mode em 'off'). Com
// `inboxes.maia_sugestao` ligada, ela só escreve um RASCUNHO — a mesma bolha
// "Sugestão da Maia — não enviada" do modo 'assisted' — e a atendente decide.
//
// Não passa pela message_grouping_queue (formato da Meta). O debounce é a
// própria pergunta: a ÚLTIMA mensagem da conversa é do paciente e está parada
// há 15s? Rascunho gravado, ou resposta da atendente, deixa de ser a última — e
// a conversa sai da seleção sozinha.
//
// Turno `somenteLeitura`: só ferramentas de consulta. Sugestão descartável não
// pode ter agendado nem movido nada.
//
// "Maia responde" (`inboxes.maia_automatica`, exige maia_sugestao): o texto sai
// pelo envio normal em vez de virar rascunho, em TODAS as conversas do número
// (atribuída ou não — pedido do usuário em 08/10). Continua somenteLeitura e
// continua sem ai_mode.
//
// Por conversa, a chave Maia / Humano do cabeçalho (14/10) liga e desliga a
// mesma marca de transferida; gente que responde — pela tela ou pelo celular
// do número — vira a chave para Humano sozinha (maiaSaiQuandoHumanoResponde).
// Em Humano a Maia não some: volta ao rascunho, com a instrução de venda
// (sugestaoParaAtendente), e cada sugestão nova substitui a anterior.
//
// Agendar ela não pode. Quando a pessoa quer marcar, a Maia avisa e transfere
// para um atendente (pedido do usuário em 13/10): `escalar_para_humano` grava
// a marca de transferida na conversa (maiaTransferiu) — o worker deixa de
// responder ali. Turno que termina sem texto também transfere, com o aviso
// fixo: antes ele só ia para o log, e a reivindicação impedia nova tentativa —
// silêncio permanente. Texto que diga que agendou (prometeAgendamento) também
// transfere e vira aviso fixo.
//
// As únicas ferramentas de escrita liberadas onde ela envia são essa e
// `registrar_tags` (14/10): sem a de tags, nenhuma conversa do número ganhava
// classificação (Mateus, 13/10). No rascunho, nenhuma das duas.
//
// A ficha do paciente (nome, responsável, nascimento, idade, turno, plano)
// também não é ferramenta do turno: depois da resposta, nos dois modos, a
// extração obrigatória (agente/extracao-ficha.ts, 21/10) lê a conversa e grava.
//
// Plantão fora do horário (22/10): conversa em Humano num número com "Maia
// responde" volta a ser RESPONDIDA por ela quando a pessoa escreve depois do
// expediente (central.organizations + public.feriados). Ela avisa uma vez que
// está continuando o atendimento, e o que não resolve fica para a equipe "às
// 08h". A marca de transferida não muda — às 08h a conversa volta ao rascunho
// sozinha. Não entra se o atendente escreveu depois do fechamento (ainda está
// lá) nem depois de ela passar o assunto para a equipe nesta janela
// (agente/plantao.ts). Nada é varrido às 18h: sem mensagem da pessoa, a
// conversa segue intocada.
//
// Falha não é definitiva (13/10): erro de envio, da OpenAI ou limite de uso
// agenda nova tentativa da mesma mensagem (1 min, depois 5 min); esgotadas,
// a conversa vai para um atendente. Resposta da Maia com status 'failed' não
// conta como resposta.
// ============================================================================

// Curto: divide o maxDuration de 60s do tique com agrupamento e envio.
const ORCAMENTO_MS = 12_000
const ESPERA_MS = 15_000           // a pessoa terminar de escrever
// Conversa parada há mais que isso não ganha resposta. Era 30 min: worker fora
// do ar por meia hora (deploy, Evolution reconectando) deixava quem escreveu
// nesse intervalo sem resposta para sempre. 6 h cobre a queda e não ressuscita
// conversa do dia anterior.
const JANELA_MS = 6 * 3_600_000
// Quantas conversas da janela olhar por tique. A maioria já foi respondida e só
// custa a leitura; com 30 e a janela de 6 h, as novas ficavam de fora.
const CONVERSAS_POR_TIQUE = 200
const MAX_POR_TIQUE = 3
// Falha (envio, OpenAI, limite de uso) não encerra a tentativa: a mesma
// mensagem volta depois destas esperas. Esgotadas, a conversa vai para gente.
const ESPERAS_RETENTATIVA_MS = [60_000, 5 * 60_000]
const MAX_TENTATIVAS = ESPERAS_RETENTATIVA_MS.length + 1

// A marca em `ai_context.sugestao`. `em` é o carimbo da reivindicação — único
// por tentativa, é a condição do UPDATE que impede dois tiques no mesmo turno.
interface MarcaSugestao {
  ultima?: string
  em?: string
  tentativa?: number
  // Presente só depois de falha com tentativa sobrando.
  retentarApos?: string
}

export interface ResultadoSugestao {
  candidatas: number
  sugeridas: number
  enviadas: number
  falhas: number
}

interface ConversaCandidata {
  id: string
  inbox_id: string
  contact_id: string
  ai_context: Record<string, unknown> | null
  tags: string[] | null
  anuncio: AnuncioDaConversa | null
}

export async function processarSugestoesEvolution(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoSugestao> {
  const r: ResultadoSugestao = { candidatas: 0, sugeridas: 0, enviadas: 0, falhas: 0 }
  const limite = Date.now() + ORCAMENTO_MS
  const db = supabase.schema('central')

  const { data: inboxes, error: e1 } = await db
    .from('inboxes')
    .select('id, maia_automatica')
    .eq('organization_id', orgId)
    .eq('maia_sugestao', true)
  if (e1) throw e1
  const lidas = (inboxes ?? []) as { id: string; maia_automatica: boolean }[]
  const inboxIds = lidas.map(i => i.id)
  const automaticas = new Set(lidas.filter(i => i.maia_automatica).map(i => i.id))
  if (inboxIds.length === 0) return r

  // Só onde ela pode enviar há plantão.
  const expediente = automaticas.size > 0 ? await lerExpediente(supabase, orgId) : null

  const agora = Date.now()
  const { data: conversas, error: e2 } = await db
    .from('conversations')
    .select('id, inbox_id, contact_id, ai_context, tags, anuncio')
    .eq('organization_id', orgId)
    .in('inbox_id', inboxIds)
    .gte('last_message_at', new Date(agora - JANELA_MS).toISOString())
    .order('last_message_at', { ascending: true })
    .limit(CONVERSAS_POR_TIQUE)
  if (e2) throw e2

  const mensagens = new MessageRepository(supabase)
  const pacientes = new PacienteRepository(supabase)
  const auditoria = new AuditRepository(supabase)
  const { conversationService, messageService } = createSystemServices()
  const fichas = createFichaService(supabase)

  // Catálogo de tags, lido uma vez por tique: para a ORIGEM que o sistema
  // aplica em toda conversa e para `registrar_tags`, que só vai onde ela
  // envia. Falha isolada, como no worker da Meta: sem catálogo o turno sai sem
  // classificação, não sem resposta.
  let porGrupoTags: Map<string, TagDefinition[]> | null = null
  try {
    porGrupoTags = await new TagDefinitionRepository(supabase).porGrupo(orgId)
  } catch (err) {
    console.warn('[sugestao evolution] catálogo de tags indisponível; turnos sem classificação', err)
  }
  // Frases de campanha: só lidas se alguma conversa do tique ainda não tiver ORIGEM.
  let frases: FraseCadastrada[] | null = null

  for (const conv of (conversas ?? []) as ConversaCandidata[]) {
    if (r.sugeridas + r.enviadas + r.falhas >= MAX_POR_TIQUE || Date.now() > limite) break
    // Transferida para um atendente (chave em Humano): a conversa é de gente,
    // e a Maia volta ao rascunho — sugere o texto para a atendente (14/10).
    const transferida = maiaTransferiu(conv.ai_context)
    // Ela ENVIA só no número com "Maia responde" e em conversa não
    // transferida — ou transferida, mas de plantão (decidido com o histórico,
    // abaixo); em todo o resto, sugere.
    let automatica = automaticas.has(conv.inbox_id) && !transferida
    let plantao: { janela: string; retornoEquipe: string; anunciar: boolean } | null = null
    // A reivindicação deste turno; o catch precisa dela para agendar a retentativa.
    let marca: MarcaSugestao | null = null
    // Transferência pelo sistema (falha do turno, promessa de agendamento). No
    // plantão a conversa já é do atendente: só encerra o plantão.
    const passarParaEquipe = (motivo: string) => plantao
      ? conversationService.encerrarPlantao(conv.id, plantao.janela, motivo)
      : conversationService.transferirDoMaiaResponde(conv.id, motivo, 'falha_tecnica')

    try {
      // Resposta da Maia que não saiu (status 'failed') não conta como resposta:
      // sem este filtro ela vira a "última mensagem" e a pessoa nunca mais é
      // atendida. Continua na conversa, visível como falha.
      //
      // Rascunho não enviado também sai: o paciente nunca o leu, e no
      // histórico ele passaria por fala da clínica. A volta à mesma mensagem
      // quem impede é a reivindicação (sugestao.ultima), não o rascunho.
      const historico = (await mensagens.listByConversation({
        conversationId: conv.id, limit: LIMITE_HISTORICO,
      })).filter(m => !(m.direction === 'outbound' && m.sent_by_ai
        && (m.status === 'failed' || (m.status === 'pending' && !m.external_message_id))))
      const ultima = historico[0]
      if (!ultima || ultima.direction !== 'inbound') continue
      if (Date.parse(ultima.created_at) > agora - ESPERA_MS) continue

      const sugestao = (conv.ai_context?.sugestao ?? null) as MarcaSugestao | null
      let tentativa = 1
      if (sugestao?.ultima === ultima.id) {
        // Já tentada: só volta se a falha deixou retentativa marcada e venceu.
        if (!sugestao.retentarApos || Date.parse(sugestao.retentarApos) > Date.now()) continue
        tentativa = (sugestao.tentativa ?? 1) + 1
      }
      r.candidatas++

      if (transferida && automaticas.has(conv.inbox_id) && expediente && !expediente.situacao.aberto) {
        const { proximaAbertura, fechadoDesde } = expediente.situacao
        const janela = janelaDoPlantao(proximaAbertura)
        if (!plantaoEncerrado(conv.ai_context, janela) && !humanoDepoisDoFechamento(historico, fechadoDesde)) {
          plantao = {
            janela,
            retornoEquipe: proximaAbertura
              ? formatarRetornoEquipe(proximaAbertura, new Date().toISOString(), expediente.timezone)
              : 'no próximo horário de atendimento',
            anunciar: !plantaoAnunciado(conv.ai_context, janela),
          }
          automatica = true
        }
      }

      // Reivindica ANTES do turno: dois tiques podem se cruzar, e o UPDATE
      // condicional deixa só um passar. Falha não libera na hora — agenda a
      // retentativa com espera (sem ela, uma OpenAI fora repetiria a cada 10s).
      marca = await reivindicar(supabase, conv, sugestao?.em ?? null, ultima.id, tentativa, transferida)
      if (!marca) continue

      // As mensagens do paciente desde a última fala nossa viram o turno.
      const doTurno: string[] = []
      for (const m of historico) {
        if (m.direction !== 'inbound') break
        if (m.message_type !== 'reaction') doTurno.unshift(m.body ?? '')
      }
      const n = historico.findIndex(m => m.direction !== 'inbound')
      const qtdInbound = n === -1 ? historico.length : n
      if (doTurno.filter(t => t.trim()).length === 0) continue

      // ORIGEM pelo sistema (15/10): a Maia nunca a aplicava, e toda conversa
      // deste número ficava sem. Decidida pela primeira mensagem da pessoa
      // (a mais antiga do histórico) — campanha, texto de anúncio ou Contato
      // Direto —, uma vez só: conversa que já tem ORIGEM não é tocada, nem a
      // posta pela Maia ou pela atendente. Vale também no rascunho: é
      // classificação da conversa, não fala de ninguém. Falha não cala o turno.
      if (porGrupoTags && !temOrigem(conv.tags, porGrupoTags)) {
        try {
          const primeira = [...historico].reverse().find(m => m.direction === 'inbound' && m.message_type !== 'reaction')
          if (primeira?.body?.trim()) {
            frases ??= await new CampaignPhraseRepository(supabase).listar(orgId)
            await conversationService.aplicarOrigemInicial(conv.id, resolverOrigem(primeira.body, frases, conv.anuncio), porGrupoTags)
          }
        } catch (err) {
          console.warn('[sugestao evolution] ORIGEM não aplicada; seguindo', { conversationId: conv.id, err })
        }
      }

      // TIPO DE CONTATO "Trabalhe conosco" pelo sistema (agente/tipo-contato.ts),
      // pelas mensagens deste turno; também no rascunho. Falha não cala o turno.
      if (porGrupoTags && pareceTrabalheConosco(doTurno)) {
        try {
          await conversationService.aplicarTipoContatoSeVazio(conv.id, TAG_TRABALHE_CONOSCO, porGrupoTags)
        } catch (err) {
          console.warn('[sugestao evolution] tag Trabalhe conosco não aplicada; seguindo', { conversationId: conv.id, err })
        }
      }

      // Contato que já é paciente (vínculo no TiTa): modo paciente (15/10). Em
      // 14/10 ele era transferido aqui, antes do turno; mas pais de pacientes
      // escrevem neste número para confirmar a sessão, e a mãe da Pérola ouviu
      // que não havia agendamento. Agora a Maia lê a agenda do TiTa e responde
      // só sobre as sessões; o resto ela transfere (INSTRUCAO_PACIENTE_VINCULADO).
      // No rascunho, o mesmo modo sem venda. Falha ao ler o vínculo segue como
      // lead — o prompt tem a rede para quando a conversa revela o paciente.
      const vinculados = await pacientesDoContato(pacientes, orgId, conv.contact_id)
      const modoPaciente = vinculados.length > 0

      const { data: contato } = await db
        .from('contacts')
        .select('id, name, ai_memory')
        .eq('id', conv.contact_id)
        .maybeSingle()
      const c = contato as { id: string; name: string | null; ai_memory: unknown } | null

      const settings = await lerAgentSettings(supabase, orgId, conv.inbox_id)

      const contexto = montarContexto({
        systemPrompt: settings.system_prompt,
        memoriaContato: c?.ai_memory ?? null,
        nomeContato: c?.name ?? null,
        ficha: null,
        historico: historico.slice(qtdInbound),
        agoraISO: new Date().toISOString(),
        vagasOferecidas: null,
        // No modo paciente a regra própria já proíbe agendar, e a desta linha
        // ("nunca escreva marcado/confirmado") calaria a resposta certa.
        semAgendamento: automatica && !modoPaciente,
        // Rascunho: quem envia é a atendente, e o texto é para converter.
        sugestaoParaAtendente: !automatica,
        pacientesVinculados: vinculados.map(v => v.nome),
        plantao: plantao && { anunciar: plantao.anunciar, retornoEquipe: plantao.retornoEquipe },
      })

      const ferramentas = new FerramentasAgente(
        createAppointmentSystemService(),
        new AppointmentRepository(supabase),
        {
          orgId, contactId: conv.contact_id, conversationId: conv.id, maiaRespondeNoNumero: automatica,
          titaPacienteIds: vinculados.map(v => v.titaPacienteId),
          plantao: plantao && { janela: plantao.janela, retornoEquipe: plantao.retornoEquipe },
        },
        // Para `escalar_para_humano`, só onde ela envia. No rascunho quem
        // responde já é gente — não há de quem transferir.
        automatica ? conversationService : null,
        null,
        // Sem catálogo: `registrar_tags` saiu do turno. Classificar é a chamada
        // própria depois da resposta (agente/classificacao.ts, abaixo).
        null,
        [],
        // Para a escalada marcar o card ("passado para a equipe") onde a Maia
        // envia. A coluna o worker do funil lê da conversa (funil.worker.ts).
        automatica ? new FunilMaiaService(supabase) : null,
        // Para `consultar_sessoes_do_paciente` (modo paciente).
        new SessoesTitaRepository(supabase),
      )

      const resultado = await executarTurno(
        { orgId, conversationId: conv.id, contactId: conv.contact_id, textosDoUsuario: doTurno },
        {
          provider: openAiProvider,
          ferramentas,
          contexto,
          agendamentoHabilitado: settings.ai_scheduling_enabled,
          somenteLeitura: true,
          permitirEscalada: automatica,
          modoPaciente,
          // O mesmo rastro do worker da Meta. Sem ele, desde 30/09 nenhuma
          // consulta da Maia ficava registrada: em 13/10 ela respondeu "houve um
          // erro ao buscar os horários" e não havia como saber o que a
          // ferramenta devolveu. Fire-and-forget: insert nunca rejeita.
          aoChamarFerramenta: (registro) => {
            void auditoria.insert({
              organization_id: orgId,
              conversation_id: conv.id,
              event_type:      'ai.tool_call',
              payload:         { ...registro },
            })
          },
        },
      )

      // Limite de uso da OpenAI é passageiro: volta para a vez em vez de
      // transferir na primeira. Na última tentativa segue o caminho de baixo.
      if (resultado.tipo === 'aguardar' && !ferramentas.escaladaPedida() && tentativa < MAX_TENTATIVAS) {
        await agendarRetentativa(supabase, conv.id, marca)
        r.falhas++
        console.warn('[sugestao evolution] turno adiado; nova tentativa agendada', {
          conversationId: conv.id, tentativa, detalhe: resultado.detalhe ?? null,
        })
        continue
      }

      // Classificação da conversa (agente/classificacao.ts), depois que a
      // resposta saiu ou virou rascunho — nos dois modos, como a ORIGEM: é
      // classificação da conversa, não fala de ninguém. Paciente vinculado
      // fica de fora (a taxonomia é comercial). Falha só vira aviso.
      //
      // A ficha do paciente vem junto, pela mesma razão e com o mesmo recorte
      // (vinculado tem cadastro no TiTa). As duas chamadas são independentes.
      const classificar = async (respostaDoTurno: string | null) => {
        if (modoPaciente) return
        const falas = falasDoHistorico(historico, respostaDoTurno)
        await Promise.all([
          porGrupoTags && classificarConversa(
            conv.id, falas,
            { provider: openAiProvider, porGrupo: porGrupoTags, conversas: conversationService },
          ).then((rc) => {
            if (!rc.ok) console.warn('[sugestao evolution] classificação não aplicada', { conversationId: conv.id, motivo: rc.motivo })
          }),
          extrairFicha(orgId, conv.contact_id, falas, { provider: openAiProvider, fichas }).then((rf) => {
            if (!rf.ok) console.warn('[sugestao evolution] ficha não extraída', { conversationId: conv.id, motivo: rf.motivo })
          }),
        ])
      }

      // Falha de envio sobe para o catch: a mensagem fica como 'failed' na
      // conversa (MessageService) e o catch agenda a retentativa.
      if (automatica) {
        // O turno leva segundos. Se nesse tempo alguém virou a chave para
        // Humano ou respondeu (maiaSaiQuandoHumanoResponde), nada sai — nem o
        // aviso de transferência: já tem gente na conversa. A transferência que
        // a própria Maia pediu neste turno também grava a marca, e o aviso dela
        // precisa sair — por isso o escaladaPedida.
        //
        // No plantão a marca já estava lá; o sinal de gente é a mensagem do
        // atendente depois da última da pessoa.
        const mudouDeDono = plantao
          ? await atendenteRespondeuDepois(supabase, conv.id, ultima.created_at)
          : await humanoAssumiu(supabase, conv.id)
        if (!ferramentas.escaladaPedida() && mudouDeDono) {
          console.warn('[sugestao evolution] humano assumiu durante o turno; resposta descartada', {
            conversationId: conv.id,
          })
          continue
        }
        let texto = resultado.tipo === 'responder' ? resultado.texto : null
        if (!texto) {
          // A reivindicação já impede outra tentativa: sem isto a pessoa fica
          // sem resposta para sempre. Transfere (se a ferramenta ainda não o
          // fez) e manda o aviso fixo — o modelo é que falhou aqui.
          if (!ferramentas.escaladaPedida()) {
            await passarParaEquipe(resultado.tipo === 'escalar' ? resultado.motivo : 'aguardar')
          }
          texto = plantao ? textoEscaladaNoPlantao(plantao.retornoEquipe) : TEXTO_ESCALADA_FALLBACK
          console.warn('[sugestao evolution] turno sem resposta; transferida para atendente', {
            conversationId: conv.id, tipo: resultado.tipo,
            detalhe: 'detalhe' in resultado ? resultado.detalhe : null,
          })
        } else if (prometeAgendamento(texto, { modoPaciente })) {
          // Ela não agenda aqui: texto que diz que agendou é falso (Ana, 13/10).
          // Quem tentou marcar quer marcar — transfere e troca pelo aviso fixo.
          if (!ferramentas.escaladaPedida()) await passarParaEquipe('fora_do_alcance')
          console.warn('[sugestao evolution] texto prometia agendamento; trocado pelo aviso', {
            conversationId: conv.id, texto,
          })
          texto = plantao ? textoSemAgendamentoNoPlantao(plantao.retornoEquipe) : TEXTO_SEM_AGENDAMENTO_NO_NUMERO
        }
        await messageService.send({ conversationId: conv.id, body: texto, sentByAi: true })
        r.enviadas++
        // Depois do envio e fora do caminho da falha: subindo para o catch, a
        // retentativa mandaria a mesma resposta de novo. Sem a marca, o pior é
        // ela se apresentar outra vez na próxima resposta.
        if (plantao) {
          try {
            await conversationService.registrarPlantaoAnunciado(conv.id, plantao.janela)
          } catch (err) {
            console.warn('[sugestao evolution] marca do plantão não gravada', { conversationId: conv.id, err })
          }
        }
        await classificar(texto)
        continue
      }

      if (resultado.tipo !== 'responder') {
        console.warn('[sugestao evolution] turno sem sugestão', {
          conversationId: conv.id, tipo: resultado.tipo,
          detalhe: 'detalhe' in resultado ? resultado.detalhe : null,
        })
        continue
      }

      // A atendente respondeu enquanto o turno rodava: a sugestão já nasceu
      // velha.
      if (await atendenteRespondeuDepois(supabase, conv.id, ultima.created_at)) continue

      // Uma sugestão viva por conversa: a anterior respondia a mensagens que
      // esta já cobre (o turno junta tudo desde a última fala enviada).
      const { error: eVelhas } = await db.from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('conversation_id', conv.id)
        .eq('direction', 'outbound')
        .eq('sent_by_ai', true)
        .eq('status', 'pending')
        .is('external_message_id', null)
        .is('deleted_at', null)
      if (eVelhas) throw eVelhas

      const { error } = await db.from('messages').insert({
        organization_id: orgId,
        conversation_id: conv.id,
        direction: 'outbound',
        message_type: 'text',
        body: resultado.texto,
        provider: 'evolution',
        status: 'pending',
        sent_by_ai: true,
      })
      if (error) throw error
      r.sugeridas++
      await classificar(resultado.texto)
    } catch (err) {
      r.falhas++
      const tentativa = marca?.tentativa ?? 1
      console.error('[sugestao evolution] falha', {
        conversationId: conv.id, tentativa,
        motivo: err instanceof Error ? err.message : String(err),
      })
      // Sem marca a falha foi antes de reivindicar: o próximo tique tenta sozinho.
      if (!marca) continue
      try {
        if (tentativa < MAX_TENTATIVAS) {
          await agendarRetentativa(supabase, conv.id, marca)
        } else if (automatica) {
          // Esgotou: a pessoa não pode ficar sem ninguém. Vai para a caixa de
          // gente; o aviso fixo não vai junto porque o envio é o que costuma
          // estar falhando.
          await passarParaEquipe('aguardar')
        }
      } catch (err2) {
        console.error('[sugestao evolution] falha ao tratar a falha', {
          conversationId: conv.id,
          motivo: err2 instanceof Error ? err2.message : String(err2),
        })
      }
    }
  }

  return r
}

// Devolve a marca gravada, ou null se outro tique chegou antes. A condição é o
// carimbo `em` da marca anterior (ou a ausência de marca).
async function reivindicar(
  supabase: SupabaseClient,
  conv: ConversaCandidata,
  emAnterior: string | null,
  ultimaId: string,
  tentativa: number,
  transferida: boolean,
): Promise<MarcaSugestao | null> {
  const marca: MarcaSugestao = { ultima: ultimaId, em: new Date().toISOString(), tentativa }
  const novo = { ...(conv.ai_context ?? {}), sugestao: marca }
  // A chave Maia / Humano precisa estar como foi lida: o `novo` sai da cópia do
  // começo do tique, e uma virada nesse meio-tempo seria desfeita por este
  // UPDATE (a marca de transferida apagada, ou ressuscitada).
  const chave = `ai_context->${CHAVE_MAIA_TRANSFERIU}`
  let q = supabase.schema('central').from('conversations')
    .update({ ai_context: novo })
    .eq('id', conv.id)
  q = transferida ? q.not(chave, 'is', null) : q.is(chave, null)
  q = emAnterior
    ? q.eq('ai_context->sugestao->>em', emAnterior)
    : q.is('ai_context->sugestao', null)
  const { data, error } = await q.select('id')
  if (error) throw error
  return (data ?? []).length > 0 ? marca : null
}

// Vínculo em central.contact_patient_links — o mesmo critério que tira o
// contato do funil comercial (20261013160000). Erro de leitura = "não sei",
// e "não sei" deixa a Maia atender como lead.
async function pacientesDoContato(
  pacientes: PacienteRepository,
  orgId: string,
  contactId: string,
): Promise<{ titaPacienteId: number; nome: string | null }[]> {
  try {
    return await pacientes.vinculadosDoContato(orgId, contactId)
  } catch (err) {
    console.warn('[sugestao evolution] vínculo de paciente indisponível; seguindo com o turno', err)
    return []
  }
}

// Gente da clínica escreveu depois da última mensagem da pessoa (pela tela ou
// pelo celular do número).
async function atendenteRespondeuDepois(supabase: SupabaseClient, conversationId: string, desdeISO: string): Promise<boolean> {
  const { data, error } = await supabase.schema('central').from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .eq('sent_by_ai', false)
    .gt('created_at', desdeISO)
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

// O expediente da organização agora, para o plantão. Falha de leitura vira
// null — sem plantão, como antes: erro de banco não pode pôr a Maia para falar
// em conversa de atendente. Os feriados cobrem as duas pontas que
// situacaoExpediente procura (reabertura e fechamento, 14 dias cada).
async function lerExpediente(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ situacao: SituacaoExpediente; timezone: string } | null> {
  try {
    const { data: org, error } = await supabase.schema('central').from('organizations')
      .select('timezone, business_hours_start, business_hours_end, business_days')
      .eq('id', orgId)
      .maybeSingle()
    if (error) throw error
    const o = org as {
      timezone: string | null; business_hours_start: string | null
      business_hours_end: string | null; business_days: number[] | null
    } | null
    const horario = {
      timezone: o?.timezone ?? HORARIO_PADRAO.timezone,
      inicio:   o?.business_hours_start ?? HORARIO_PADRAO.inicio,
      fim:      o?.business_hours_end ?? HORARIO_PADRAO.fim,
      dias:     o?.business_days ?? HORARIO_PADRAO.dias,
    }

    const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
    const { data: feriados, error: eFer } = await supabase.from('feriados')
      .select('data, tipo, horario_inicio, horario_fim')
      .gte('data', dia(-16))
      .lte('data', dia(16))
    if (eFer) throw eFer

    return {
      situacao: situacaoExpediente(new Date().toISOString(), horario, (feriados ?? []) as FeriadoExpediente[]),
      timezone: horario.timezone,
    }
  } catch (err) {
    console.warn('[sugestao evolution] horário comercial indisponível; sem plantão neste tique', err)
    return null
  }
}

async function humanoAssumiu(supabase: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.schema('central').from('conversations')
    .select('ai_context').eq('id', conversationId).maybeSingle()
  if (error) throw error
  return maiaTransferiu((data as { ai_context: unknown } | null)?.ai_context)
}

// Deixa a mesma mensagem voltar depois da espera da tentativa. Relê o
// ai_context (o turno pode ter gravado a transferência nele) e só grava se a
// marca ainda for a deste turno.
async function agendarRetentativa(
  supabase: SupabaseClient,
  conversationId: string,
  marca: MarcaSugestao,
): Promise<void> {
  const db = supabase.schema('central')
  const { data, error } = await db.from('conversations')
    .select('ai_context').eq('id', conversationId).maybeSingle()
  if (error) throw error
  const atual = ((data as { ai_context: Record<string, unknown> | null } | null)?.ai_context) ?? {}
  const espera = ESPERAS_RETENTATIVA_MS[(marca.tentativa ?? 1) - 1] ?? ESPERAS_RETENTATIVA_MS.at(-1)!
  const { error: e2 } = await db.from('conversations')
    .update({ ai_context: { ...atual, sugestao: { ...marca, retentarApos: new Date(Date.now() + espera).toISOString() } } })
    .eq('id', conversationId)
    .eq('ai_context->sugestao->>em', marca.em!)
  if (e2) throw e2
}
