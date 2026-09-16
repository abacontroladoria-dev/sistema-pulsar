import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task, TaskStatus } from '../types/central.types'

// ============================================================================
// TaskRepository
//
// central.tasks (migration 20260916140000) — as pendências de atendimento.
//
// A tabela tem `ck_tasks_conclusao`, que amarra `status` e `completed_at`: um
// UPDATE que mude só um dos dois é recusado pelo banco. Por isso os métodos de
// mudança de estado escrevem os dois campos JUNTOS, e não há um `update` genérico
// que aceite `status` solto — a constraint existiria só para estourar 500.
// ============================================================================

const COLUNAS = `
  id, organization_id, contact_id, conversation_id,
  title, description, assigned_user_id, due_at,
  status, completed_at, created_by, created_at, updated_at
`

export interface CreateTaskInput {
  organization_id:   string
  contact_id?:       string | null
  conversation_id?:  string | null
  title:             string
  description?:      string | null
  assigned_user_id?: string | null
  due_at?:           string | null
  created_by:        string
}

export interface ListTasksInput {
  orgId:           string
  contactId?:      string
  conversationId?: string
  status?:         TaskStatus
  limit:           number
  offset:          number
}

export class TaskRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tasks')
      .insert({
        organization_id:  input.organization_id,
        contact_id:       input.contact_id      ?? null,
        conversation_id:  input.conversation_id ?? null,
        title:            input.title,
        description:      input.description      ?? null,
        assigned_user_id: input.assigned_user_id ?? null,
        due_at:           input.due_at           ?? null,
        created_by:       input.created_by,
        // status e completed_at ficam no default ('pending', null) — o par que
        // ck_tasks_conclusao aceita.
      })
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as Task
  }

  async findById(id: string): Promise<Task | null> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tasks')
      .select(COLUNAS)
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return (data ?? null) as Task | null
  }

  // Pendentes primeiro pelo prazo mais próximo; `nullsFirst: false` para que
  // tarefa SEM prazo não encabece a lista. Sem data não é urgente — é o
  // contrário: é o que se faz quando sobra tempo.
  async list(input: ListTasksInput): Promise<{ data: Task[]; count: number }> {
    let q = (this.supabase as any)
      .schema('central')
      .from('tasks')
      .select(COLUNAS, { count: 'exact' })
      .eq('organization_id', input.orgId)

    if (input.contactId)      q = q.eq('contact_id', input.contactId)
    if (input.conversationId) q = q.eq('conversation_id', input.conversationId)
    if (input.status)         q = q.eq('status', input.status)

    const { data, error, count } = await q
      .order('due_at',     { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(input.offset, input.offset + input.limit - 1)

    if (error) throw error
    return { data: (data ?? []) as Task[], count: count ?? 0 }
  }

  // Os dois campos que ck_tasks_conclusao amarra, sempre juntos.
  async mudarStatus(id: string, status: TaskStatus): Promise<Task> {
    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tasks')
      .update({
        status,
        completed_at: status === 'pending' ? null : new Date().toISOString(),
      })
      .eq('id', id)
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as Task
  }

  // Campos editáveis. `status` NÃO está aqui de propósito — ver mudarStatus.
  async update(
    id: string,
    input: {
      title?:            string
      description?:      string | null
      assigned_user_id?: string | null
      due_at?:           string | null
    },
  ): Promise<Task> {
    const patch: Record<string, unknown> = {}
    if (input.title            !== undefined) patch.title            = input.title
    if (input.description      !== undefined) patch.description      = input.description
    if (input.assigned_user_id !== undefined) patch.assigned_user_id = input.assigned_user_id
    if (input.due_at           !== undefined) patch.due_at           = input.due_at

    const { data, error } = await (this.supabase as any)
      .schema('central')
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select(COLUNAS)
      .single()

    if (error) throw error
    return data as Task
  }
}
