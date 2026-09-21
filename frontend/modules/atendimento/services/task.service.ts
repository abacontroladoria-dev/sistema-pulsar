import type { TaskRepository, ListTasksInput } from '../repositories/task.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { Task, TaskStatus } from '../types/central.types'
import { TaskNotFoundError } from '../types/errors.types'

// ============================================================================
// TaskService
//
// Regras, e só elas:
//   1. organização divergente vira TaskNotFoundError — nunca "403 existe, mas
//      não é sua", que já confirma a existência de uma tarefa de outra clínica.
//      É a mesma escolha de ContactService.
//   2. organization_id e created_by vêm SEMPRE do caller (sessão validada),
//      nunca do corpo da requisição.
//   3. audit.insert é fire-and-forget: trilha que falha não pode derrubar a
//      ação que o operador acabou de fazer.
// ============================================================================

export interface CriarTarefaInput {
  title:           string
  description?:    string | null
  contactId?:      string
  conversationId?: string
  assignedUserId?: string | null
  dueAt?:          string | null
}

export interface AtualizarTarefaInput {
  title?:          string
  description?:    string | null
  assignedUserId?: string | null
  dueAt?:          string | null
}

export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly audit: AuditRepository,
  ) {}

  async listar(params: ListTasksInput): Promise<{ data: Task[]; count: number }> {
    return this.tasks.list(params)
  }

  async criar(orgId: string, input: CriarTarefaInput, actorId: string): Promise<Task> {
    const tarefa = await this.tasks.create({
      organization_id:  orgId,
      contact_id:       input.contactId       ?? null,
      conversation_id:  input.conversationId  ?? null,
      title:            input.title,
      description:      input.description     ?? null,
      assigned_user_id: input.assignedUserId  ?? null,
      due_at:           input.dueAt           ?? null,
      created_by:       actorId,
    })

    void this.audit.insert({
      organization_id: orgId,
      conversation_id: input.conversationId ?? undefined,
      event_type:      'task.created',
      performed_by:    actorId,
      payload:         { taskId: tarefa.id, title: tarefa.title, contactId: tarefa.contact_id },
    })

    return tarefa
  }

  // Lê antes de escrever para conferir a organização. A RLS já barraria, mas
  // ela responderia "0 linhas atualizadas" — que o cliente leria como sucesso.
  private async exigirDaOrg(orgId: string, id: string): Promise<Task> {
    const tarefa = await this.tasks.findById(id)
    if (!tarefa || tarefa.organization_id !== orgId) throw new TaskNotFoundError(id)
    return tarefa
  }

  async mudarStatus(orgId: string, id: string, status: TaskStatus, actorId: string): Promise<Task> {
    const anterior = await this.exigirDaOrg(orgId, id)
    const tarefa   = await this.tasks.mudarStatus(id, status)

    void this.audit.insert({
      organization_id: orgId,
      conversation_id: tarefa.conversation_id ?? undefined,
      event_type:      'task.status_changed',
      performed_by:    actorId,
      payload:         { taskId: id, de: anterior.status, para: status },
    })

    return tarefa
  }

  async atualizar(orgId: string, id: string, input: AtualizarTarefaInput, actorId: string): Promise<Task> {
    await this.exigirDaOrg(orgId, id)

    const tarefa = await this.tasks.update(id, {
      title:            input.title,
      // Espalhados condicionalmente: null limpa, ausente não toca.
      ...('description'    in input ? { description:      input.description    } : {}),
      ...('assignedUserId' in input ? { assigned_user_id: input.assignedUserId } : {}),
      ...('dueAt'          in input ? { due_at:           input.dueAt          } : {}),
    })

    void this.audit.insert({
      organization_id: orgId,
      conversation_id: tarefa.conversation_id ?? undefined,
      event_type:      'task.updated',
      performed_by:    actorId,
      payload:         { taskId: id, campos: Object.keys(input) },
    })

    return tarefa
  }
}
