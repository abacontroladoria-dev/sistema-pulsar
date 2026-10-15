// npx tsx modules/atendimento/services/nota-interna.test.mts
//
// NotaInternaService.criar — as regras da nota interna:
//   - só se menciona quem enxerga a caixa da conversa;
//   - mencionar a si mesmo vale (lembrete); repetir a mesma pessoa, não;
//   - só se delega a quem foi mencionado, e nunca numa conversa encerrada;
//   - menções que falham desfazem a nota;
//   - delegar atribui (sem dono) ou transfere (com dono), com motivo FIXO —
//     o texto da nota nunca vai para a auditoria;
//   - transferência que falha tira o selo "Delegou para" e avisa;
//   - conversa invisível ou de outra organização é 404.
//
// Sem banco: os fakes devolvem o que o teste decide e registram o que iria
// para as tabelas.

import { NotaInternaService } from './nota-interna.service.js'
import { ConversationNotFoundError, NotaRecusadaError } from '../types/errors.types.js'
import type { Conversation, NotaInterna } from '../types/central.types'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

const ORG    = 'org-1'
const CONV   = 'conv-1'
const CAIXA  = 'caixa-1'
const JEN    = 'u-jen'
const DANI   = 'u-dani'
const CARLA  = 'u-carla'
const FORA   = 'u-fora'   // não enxerga a caixa

function montar(opcoes: {
  conversa?:        Partial<Conversation> | null
  falharMencoes?:   boolean
  falharTransfer?:  boolean
} = {}) {
  const registro = {
    notas:        [] as NotaInterna[],
    apagadas:     [] as string[],
    semDelegacao: [] as string[],
    mencoes:      [] as { mentioned_user_id: string }[],
    assign:       [] as unknown[],
    transfer:     [] as unknown[],
    auditoria:    [] as { event_type: string; payload?: Record<string, unknown> }[],
  }

  const conversa: Conversation | null = opcoes.conversa === null ? null : {
    id: CONV, organization_id: ORG, inbox_id: CAIXA, status: 'assigned', assigned_user_id: JEN,
    ...(opcoes.conversa ?? {}),
  } as Conversation

  const notas = {
    async criar(input: Omit<NotaInterna, 'id' | 'created_at'>) {
      const n = { ...input, id: `nota-${registro.notas.length + 1}`, created_at: '2026-10-15T12:00:00Z' } as NotaInterna
      registro.notas.push(n)
      return n
    },
    async apagar(id: string)          { registro.apagadas.push(id) },
    async limparDelegacao(id: string) { registro.semDelegacao.push(id) },
    async listarDaConversa()          { return registro.notas },
  }
  const mencoes = {
    async criarVarias(linhas: { mentioned_user_id: string }[]) {
      if (opcoes.falharMencoes) throw new Error('falha nas menções')
      registro.mencoes.push(...linhas)
    },
  }
  const conv = { async findById() { return conversa } }
  const usuarios = {
    async listarComAcessoACaixa() {
      return [JEN, DANI, CARLA].map(id => ({ id, nome: id, central_role: 'operator' }))
    },
    async nomesDe(_org: string, ids: string[]) { return new Map(ids.map(id => [id, `Nome ${id}`])) },
  }
  const conversas = {
    async assign(...args: unknown[]) {
      if (opcoes.falharTransfer) throw new Error('RLS recusou')
      registro.assign.push(args)
    },
    async transfer(input: unknown) {
      if (opcoes.falharTransfer) throw new Error('RLS recusou')
      registro.transfer.push(input)
    },
  }
  const audit = { async insert(e: { event_type: string; payload?: Record<string, unknown> }) { registro.auditoria.push(e) } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new NotaInternaService(notas as any, mencoes as any, conv as any, usuarios as any, conversas as any, audit as any)
  return { service, registro }
}

async function erroDe(p: Promise<unknown>): Promise<unknown> {
  try { await p; return null } catch (e) { return e }
}

console.log('1. nota simples, com menção')
{
  const { service, registro } = montar()
  const vista = await service.criar(ORG, CONV, { body: '  @Dani pode ver?  ', mencoes: [DANI, DANI, JEN] }, JEN)
  checar('texto aparado', registro.notas[0].body, '@Dani pode ver?')
  checar('a repetição sai; a própria autora fica (lembrete)', registro.notas[0].mentioned_user_ids, [DANI, JEN])
  checar('duas menções gravadas', registro.mencoes.map(m => m.mentioned_user_id), [DANI, JEN])
  checar('sem delegação', [registro.assign.length, registro.transfer.length], [0, 0])
  checar('nomes resolvidos', vista.mencionados, [{ id: DANI, nome: `Nome ${DANI}` }, { id: JEN, nome: `Nome ${JEN}` }])
  checar('auditoria sem o texto', registro.auditoria[0], {
    organization_id: ORG, conversation_id: CONV, event_type: 'conversation.note_added', performed_by: JEN,
    payload: { noteId: 'nota-1', mencionados: [DANI, JEN], delegouPara: null },
  })
}

console.log('2. mencionar quem não enxerga a caixa')
{
  const { service, registro } = montar()
  const e = await erroDe(service.criar(ORG, CONV, { body: 'oi', mencoes: [FORA] }, JEN))
  checar('recusa', e instanceof NotaRecusadaError, true)
  checar('nada gravado', [registro.notas.length, registro.mencoes.length], [0, 0])
}

console.log('3. delegar a quem não foi mencionado')
{
  const { service, registro } = montar()
  const e = await erroDe(service.criar(ORG, CONV, { body: 'oi', mencoes: [DANI], delegarPara: CARLA }, JEN))
  checar('recusa', e instanceof NotaRecusadaError, true)
  checar('nada gravado', registro.notas.length, 0)
}

console.log('4. delegar numa conversa encerrada')
{
  const { service, registro } = montar({ conversa: { status: 'resolved' } })
  const e = await erroDe(service.criar(ORG, CONV, { body: 'oi', mencoes: [DANI], delegarPara: DANI }, JEN))
  checar('recusa', e instanceof NotaRecusadaError, true)
  checar('nada gravado', registro.notas.length, 0)
}

console.log('5. nota sem delegar numa conversa encerrada é aceita')
{
  const { service, registro } = montar({ conversa: { status: 'resolved' } })
  await service.criar(ORG, CONV, { body: 'registro pós-encerramento', mencoes: [DANI] }, JEN)
  checar('gravada', registro.notas.length, 1)
}

console.log('6. menções falham: a nota é desfeita')
{
  const { service, registro } = montar({ falharMencoes: true })
  const e = await erroDe(service.criar(ORG, CONV, { body: 'oi', mencoes: [DANI] }, JEN))
  checar('erro sobe', e instanceof Error, true)
  checar('nota apagada', registro.apagadas, ['nota-1'])
  checar('sem auditoria', registro.auditoria.length, 0)
}

console.log('7. delegar conversa COM dono: transfere, motivo fixo')
{
  const { service, registro } = montar()
  await service.criar(ORG, CONV, { body: 'texto sigiloso da nota', mencoes: [DANI], delegarPara: DANI }, JEN)
  checar('transfer', registro.transfer, [{ conversationId: CONV, toUserId: DANI, actorId: JEN, reason: 'Delegada por nota interna' }])
  checar('selo gravado', registro.notas[0].delegated_to_user_id, DANI)
  checar('o texto não vai para a auditoria', JSON.stringify(registro.auditoria).includes('sigiloso'), false)
}

console.log('8. delegar conversa SEM dono: atribui')
{
  const { service, registro } = montar({ conversa: { assigned_user_id: null, status: 'open' } })
  await service.criar(ORG, CONV, { body: 'assume?', mencoes: [DANI], delegarPara: DANI }, JEN)
  checar('assign', registro.assign, [[CONV, DANI, JEN]])
  checar('sem transfer', registro.transfer.length, 0)
}

console.log('9. transferência falha: selo sai, pessoa continua avisada')
{
  const { service, registro } = montar({ falharTransfer: true })
  const e = await erroDe(service.criar(ORG, CONV, { body: 'oi', mencoes: [DANI], delegarPara: DANI }, JEN))
  checar('erro explica', e instanceof NotaRecusadaError && /não foi delegada/.test((e as Error).message), true)
  checar('selo limpo', registro.semDelegacao, ['nota-1'])
  checar('menção mantida', registro.mencoes.length, 1)
  checar('nota mantida', registro.apagadas.length, 0)
  checar('auditada sem delegação', registro.auditoria.map(a => a.payload?.delegouPara), [null])
}

console.log('10. conversa invisível ou de outra organização')
{
  const invisivel = montar({ conversa: null })
  checar('invisível = 404', (await erroDe(invisivel.service.criar(ORG, CONV, { body: 'x', mencoes: [] }, JEN))) instanceof ConversationNotFoundError, true)
  const outra = montar({ conversa: { organization_id: 'org-2' } })
  checar('outra org = 404', (await erroDe(outra.service.criar(ORG, CONV, { body: 'x', mencoes: [] }, JEN))) instanceof ConversationNotFoundError, true)
  checar('listar também', (await erroDe(outra.service.listar(ORG, CONV))) instanceof ConversationNotFoundError, true)
}

console.log('11. quem pode ser mencionado inclui quem pergunta')
{
  const { service } = montar()
  const lista = await service.mencionaveis(ORG, CONV)
  checar('com a própria pessoa', lista.map(u => u.id), [JEN, DANI, CARLA])
}

console.log('12. só a si mesmo')
{
  const { service, registro } = montar()
  await service.criar(ORG, CONV, { body: '@Jen ligar amanhã', mencoes: [JEN] }, JEN)
  checar('lembrete gravado', registro.mencoes.map(m => m.mentioned_user_id), [JEN])
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
