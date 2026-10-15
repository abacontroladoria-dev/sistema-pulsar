// ============================================================================
// Códigos de erro do PostgreSQL que a camada de serviço precisa distinguir.
//
// O padrão que aparece três vezes neste módulo é o mesmo: uma checagem prévia
// ("já existe?") seguida de um INSERT. Entre a checagem e o INSERT cabe outro
// processo — e quem garante a unicidade de verdade é o índice do banco, não a
// checagem. Tratar 23505 como "o outro chegou primeiro, siga" é o que transforma
// uma corrida em caminho normal em vez de erro 500.
//
// Onde vale:
//   ConversationService.findOrCreate  → uq_conversations_active_per_contact_channel
//   MessageService.receive            → uq_messages_ext_id (reentrega de webhook)
//   AppointmentService.agendarVaga    → uq_appointments_slot_ocupada
// ============================================================================

// unique_violation
export const PG_UNIQUE_VIOLATION = '23505'

// foreign_key_violation — usado onde a FK virou RESTRICT de propósito
// (send_queue, migration 20260810120200): apagar contato com envio pendente
// precisa falhar de forma reconhecível, não genérica.
export const PG_FOREIGN_KEY_VIOLATION = '23503'

// O supabase-js propaga o SQLSTATE em `code` no objeto de erro do postgrest.
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['code'] === PG_UNIQUE_VIOLATION
}

export function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  return (err as Record<string, unknown>)['code'] === PG_FOREIGN_KEY_VIOLATION
}

// A tabela não existe: 42P01 (undefined_table) vindo do Postgres, ou PGRST205
// quando o PostgREST não a acha no cache de schema. É o estado de uma migration
// ainda não aplicada — e o localhost usa o banco de produção, então a tela nova
// tem de sobreviver a ele em vez de estourar 500.
export function isTabelaAusente(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>)['code']
  return code === '42P01' || code === 'PGRST205'
}
