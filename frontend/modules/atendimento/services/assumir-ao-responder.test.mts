// npx tsx modules/atendimento/services/assumir-ao-responder.test.mts
//
// "Quem responde, assume" — sem banco e sem rede, com repositórios de mentira.
//
// O que cada bloco protege:
//   1. A REGRA DE DISPARO. `sent_by_ai` é a condição mais importante do recurso:
//      o worker da Maia também envia outbound, e sem esse recorte TODA conversa
//      atendida pela IA migraria para a caixa "Humano" — o inverso exato do
//      defeito que isto corrige. Um teste que só verificasse o caminho feliz
//      passaria com esse bug dentro.
//   2. NÃO ROUBAR conversa já atribuída.
//   3. Os três writes andando JUNTOS (assignee + status + ai_mode). Assumir sem
//      desligar a Maia faz os dois responderem o mesmo paciente.
//   4. O CAMINHO DE VOLTA: religar a Maia solta a conversa; desligar não mexe.
//   5. Falha de escrita não derruba o envio — a mensagem já foi para o WhatsApp.

import { ConversationService } from './conversation.service.js'
import type { Conversation } from '../types/central.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

// --- dublês -----------------------------------------------------------------

interface Escritas { assignee: (string | null)[]; status: string[]; aiMode: (string | null)[] }

function montar(conversa: Conversation, opcoes: { falharNoAssignee?: boolean } = {}) {
  const escritas: Escritas = { assignee: [], status: [], aiMode: [] }
  const eventos: string[] = []
  const auditoria: any[] = []

  const repo = {
    updateAssignee: async (_id: string, userId: string | null) => {
      if (opcoes.falharNoAssignee) throw new Error('RLS recusou o update')
      escritas.assignee.push(userId)
    },
    updateStatus: async (_id: string, status: string) => { escritas.status.push(status) },
    updateAiMode: async (_id: string, modo: string | null) => { escritas.aiMode.push(modo) },
    findById: async () => conversa,
  }
  const audit  = { insert: async (linha: any) => { auditoria.push(linha) } }
  const events = { emit: (nome: string) => { eventos.push(nome) } }

  const service = new ConversationService(repo as any, audit as any, events as any)
  return { service, escritas, eventos, auditoria }
}

const BASE: Conversation = {
  id: 'conv-1', organization_id: 'org-1', inbox_id: 'inbox-1', channel_id: 'ch-1',
  contact_id: 'ct-1', status: 'open', ai_mode: null, assigned_user_id: null,
  priority: null, last_message_at: null, created_at: '', updated_at: '',
} as unknown as Conversation

const USUARIO = 'user-abc'

// --- 1 e 3: assumir ---------------------------------------------------------

console.log('\nassumirAoResponder')
{
  const { service, escritas, eventos, auditoria } = montar({ ...BASE })
  const assumiu = await service.assumirAoResponder({ ...BASE }, USUARIO)
  checar('conversa livre é assumida',        assumiu, true)
  checar('grava o responsável',              escritas.assignee, [USUARIO])
  checar('status vai para assigned',         escritas.status,   ['assigned'])
  // Sem isto, a Maia e o humano respondem o mesmo paciente.
  checar('desliga a Maia junto',             escritas.aiMode,   ['off'])
  checar('emite conversation.assigned',      eventos, ['conversation.assigned'])
  checar('audita com quem assumiu',          auditoria[0]?.performed_by, USUARIO)
}
{
  // ai_mode já 'off' (o caso da conversa escalada pela Maia): não reescreve à toa.
  const conv = { ...BASE, ai_mode: 'off' } as Conversation
  const { service, escritas } = montar(conv)
  await service.assumirAoResponder(conv, USUARIO)
  checar('não reescreve ai_mode já off',     escritas.aiMode, [])
  checar('mas assume assim mesmo',           escritas.assignee, [USUARIO])
}

// --- 2: não roubar ----------------------------------------------------------
{
  const conv = { ...BASE, assigned_user_id: 'outra-pessoa' } as Conversation
  const { service, escritas, eventos } = montar(conv)
  const assumiu = await service.assumirAoResponder(conv, USUARIO)
  checar('não rouba conversa de outro',      assumiu, false)
  checar('não escreve nada',                 escritas, { assignee: [], status: [], aiMode: [] })
  checar('não emite evento',                 eventos, [])
}

// --- 5: falha não derruba o envio -------------------------------------------
{
  const conv = { ...BASE }
  const { service, eventos } = montar(conv, { falharNoAssignee: true })
  let lancou = false
  let resultado: boolean | undefined
  try { resultado = await service.assumirAoResponder(conv, USUARIO) } catch { lancou = true }
  // A mensagem já saiu para o WhatsApp: estourar aqui faria a interface reportar
  // como falha um envio que o paciente recebeu.
  checar('não lança quando o write falha',   lancou, false)
  checar('devolve false',                    resultado, false)
  checar('não emite evento de assunção',     eventos, [])
}

// --- 4: caminho de volta ----------------------------------------------------

console.log('\nsetAiMode — soltar a conversa')
{
  const conv = { ...BASE, assigned_user_id: USUARIO, status: 'assigned', ai_mode: 'off' } as Conversation
  const { service, escritas, auditoria } = montar(conv)
  await service.setAiMode('conv-1', 'autonomous', USUARIO)
  checar('religar a Maia limpa o responsável', escritas.assignee, [null])
  // 'assigned' sem responsável seria um estado contraditório.
  checar('status volta para open',             escritas.status,   ['open'])
  checar('trilha guarda quem foi liberado',    auditoria[0]?.payload?.responsavelLiberado, USUARIO)
}
{
  // Desligar a Maia é o humano continuando no comando — não pode soltar nada.
  const conv = { ...BASE, assigned_user_id: USUARIO, status: 'assigned' } as Conversation
  const { service, escritas } = montar(conv)
  await service.setAiMode('conv-1', 'off', USUARIO)
  checar('desligar a Maia não solta',          escritas.assignee, [])
  checar('desligar não mexe no status',        escritas.status,   [])
}
{
  // Conversa da Maia que ninguém assumiu: nada a soltar.
  const conv = { ...BASE, ai_mode: 'off' } as Conversation
  const { service, escritas } = montar(conv)
  await service.setAiMode('conv-1', 'autonomous', USUARIO)
  checar('sem responsável, nada a soltar',     escritas.assignee, [])
}

console.log(falhas === 0 ? '\nTudo certo.\n' : `\n${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
