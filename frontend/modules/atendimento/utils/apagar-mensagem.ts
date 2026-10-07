import type { Message } from '../types/central.types'

// ----------------------------------------------------------------------------
// Apagar mensagem: some só do Pulsar, ou some também do WhatsApp do contato?
//
// Uma regra só, usada nos dois lados: o service decide o que fazer e a bolha
// decide o que prometer no aviso de confirmação. Se cada lado tivesse a sua, o
// aviso diria "apaga para todos" numa mensagem que o servidor só esconde.
//
// "Para todos" exige as quatro condições:
//   • saída — mensagem do contato não se apaga do celular dele;
//   • Evolution — a API oficial da Meta não tem apagar;
//   • id do WhatsApp — sem ele não há o que pedir para apagar (falha, pendente);
//   • dentro do prazo. O WhatsApp só aceita "apagar para todos" por um tempo
//     depois do envio (cerca de dois dias). Fora dele o pedido é ignorado em
//     silêncio: o Pulsar diria "apagada" e o contato continuaria lendo. 48h é
//     a margem segura.
//
// Sem módulo de servidor aqui: o adapter da tela importa este arquivo.
// ----------------------------------------------------------------------------

export const PRAZO_APAGAR_PARA_TODOS_MS = 48 * 60 * 60 * 1000

export function apagaParaTodos(
  m: Pick<Message, 'direction' | 'provider' | 'external_message_id' | 'sent_at' | 'created_at'>,
  agora: number = Date.now(),
): boolean {
  if (m.direction !== 'outbound' || m.provider !== 'evolution' || !m.external_message_id) return false
  const enviadaEm = new Date(m.sent_at ?? m.created_at).getTime()
  return Number.isFinite(enviadaEm) && agora - enviadaEm < PRAZO_APAGAR_PARA_TODOS_MS
}

// ----------------------------------------------------------------------------
// Editar mensagem: mesma ideia — uma regra só para a bolha e para o service.
//
//   • saída, Evolution, com id do WhatsApp — a Meta não tem edição;
//   • texto puro, escrito por gente (a Maia não roda em Evolution, mas a
//     guarda fica: editar fala de IA seria reescrever o que ela disse);
//   • dentro de 15 minutos — o prazo do próprio WhatsApp. Fora dele o pedido é
//     ignorado em silêncio e o Pulsar mostraria um texto que o contato não vê.
// ----------------------------------------------------------------------------

export const PRAZO_EDITAR_MS = 15 * 60 * 1000

export function podeEditar(
  m: Pick<Message, 'direction' | 'provider' | 'external_message_id' | 'sent_at' | 'created_at' | 'message_type' | 'sent_by_ai'>,
  agora: number = Date.now(),
): boolean {
  if (m.direction !== 'outbound' || m.provider !== 'evolution' || !m.external_message_id) return false
  if (m.message_type !== 'text' || m.sent_by_ai) return false
  const enviadaEm = new Date(m.sent_at ?? m.created_at).getTime()
  return Number.isFinite(enviadaEm) && agora - enviadaEm < PRAZO_EDITAR_MS
}
