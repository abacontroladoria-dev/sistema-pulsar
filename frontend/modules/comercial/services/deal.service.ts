import 'server-only'

import type { DealRepository }          from '../repositories/deal.repository'
import type { PipelineStageRepository } from '../repositories/pipeline-stage.repository'
import type { DealActivityRepository }  from '../repositories/deal-activity.repository'
import type {
  DealRow,
  DealWithContactRow,
  CreateDealInput,
  UpdateDealInput,
  ListDealsFilters,
  PipelineStageRow,
} from '../types/crm.types'
import {
  DealNotFoundError,
  PipelineStageNotFoundError,
} from '../types/errors.types'

// ============================================================================
// DealService
//
// Orquestra as regras que o banco NÃO aplica sozinho.
//
// A principal é auto_win / auto_lose: crm.pipeline_stages tem essas flags e a
// migration as documenta ("mover um deal para este estágio fecha-o como
// won/lost automaticamente"), mas NÃO existe trigger que faça isso. Sem esta
// camada, arrastar um card para "Ganho" mudaria a coluna e deixaria o deal
// como 'open' — o Kanban mostraria o card em Ganho e o Dashboard não contaria
// a conversão. É exatamente o tipo de divergência silenciosa que faz relatório
// mentir.
// ============================================================================

export class DealService {
  constructor(
    private readonly deals:      DealRepository,
    private readonly stages:     PipelineStageRepository,
    private readonly activities: DealActivityRepository
  ) {}

  async list(filters: ListDealsFilters) {
    return this.deals.list(filters)
  }

  async findById(id: string, orgId: string): Promise<DealWithContactRow> {
    const deal = await this.deals.findById(id, orgId)
    if (!deal) throw new DealNotFoundError(id)
    return deal
  }

  async listStages(orgId: string): Promise<PipelineStageRow[]> {
    return this.stages.list(orgId)
  }

  // --------------------------------------------------------------------------
  // criar
  //
  // Quando stage_id não vem, o deal entra no PRIMEIRO estágio do funil (menor
  // position) — mesmo comportamento do trigger crm.auto_create_deal_on_lead().
  //
  // Se a org não tem estágio nenhum, falha explicitamente. Criar deal com
  // stage_id inválido violaria a FK e daria erro obscuro de constraint; a
  // mensagem daqui diz o que fazer (configurar o funil).
  // --------------------------------------------------------------------------
  async criar(
    input: Omit<CreateDealInput, 'stage_id'> & { stage_id?: string },
    autorId: string | null
  ): Promise<DealRow> {
    let stageId = input.stage_id

    if (!stageId) {
      const stages = await this.stages.list(input.organization_id)
      if (stages.length === 0) {
        throw new PipelineStageNotFoundError(
          '(nenhum estágio configurado para esta organização)'
        )
      }
      stageId = stages[0].id
    }

    const deal = await this.deals.create({ ...input, stage_id: stageId })

    await this.registrarAtividadeSemQuebrar(
      input.organization_id,
      deal.id,
      `Negócio criado em "${(await this.stages.findById(stageId, input.organization_id))?.title ?? 'etapa inicial'}"`,
      autorId
    )

    return deal
  }

  async atualizar(
    id: string,
    orgId: string,
    patch: UpdateDealInput
  ): Promise<DealRow> {
    const atualizado = await this.deals.update(id, orgId, patch)
    // null aqui significa "não existe OU a policy barrou" — o PostgREST não
    // distingue. DealNotFoundError é a leitura correta para o operador: se ele
    // não pode ver/editar aquele deal, para ele o deal não existe.
    if (!atualizado) throw new DealNotFoundError(id)
    return atualizado
  }

  // --------------------------------------------------------------------------
  // moverParaEstagio — o coração do Kanban (drag & drop).
  //
  // Ordem das operações:
  //   1. valida que o estágio destino existe NA MESMA org
  //   2. move o deal
  //   3. aplica auto_win / auto_lose se o estágio destino as tiver
  //   4. registra a atividade na timeline
  //
  // O passo 1 não é paranoia: sem ele, um stage_id de outra organização passa
  // pela FK (a constraint é só para crm.pipeline_stages, não filtra org) e o
  // deal desaparece do Kanban de todo mundo — some do board de origem e não
  // aparece no de destino, porque a listagem filtra por org.
  //
  // O passo 4 é deliberadamente não-fatal: o movimento já foi persistido, e
  // falhar aqui faria a UI acusar erro numa operação que deu certo.
  // --------------------------------------------------------------------------
  async moverParaEstagio(
    id: string,
    orgId: string,
    stageId: string,
    autorId: string | null
  ): Promise<DealRow> {
    const estagio = await this.stages.findById(stageId, orgId)
    if (!estagio) throw new PipelineStageNotFoundError(stageId)

    const movido = await this.deals.update(id, orgId, { stage_id: stageId })
    if (!movido) throw new DealNotFoundError(id)

    // auto_win / auto_lose: a flag do estágio decide o status do deal.
    // Sem isto o card fica em "Ganho" com status 'open' e o funil mente.
    let resultado = movido
    if (estagio.auto_win && movido.status !== 'won') {
      resultado = (await this.deals.updateStatus(id, orgId, 'won')) ?? movido
    } else if (estagio.auto_lose && movido.status !== 'lost') {
      resultado = (await this.deals.updateStatus(id, orgId, 'lost')) ?? movido
    }

    const sufixo = estagio.auto_win  ? ' (ganho)'
                 : estagio.auto_lose ? ' (perdido)'
                 : ''
    await this.registrarAtividadeSemQuebrar(
      orgId, id, `Movido para "${estagio.title}"${sufixo}`, autorId
    )

    return resultado
  }

  // Fecha como ganho. Independe de o estágio ter auto_win — a UI oferece o
  // botão "Ganhou" em qualquer coluna.
  async marcarGanho(id: string, orgId: string, autorId: string | null): Promise<DealRow> {
    const deal = await this.deals.updateStatus(id, orgId, 'won')
    if (!deal) throw new DealNotFoundError(id)

    await this.registrarAtividadeSemQuebrar(orgId, id, 'Negócio marcado como GANHO', autorId)
    return deal
  }

  // Fecha como perdido. O motivo é obrigatório na UI (LostReasonModal) — é o
  // dado que alimenta a análise de perda.
  async marcarPerdido(
    id: string,
    orgId: string,
    motivo: string,
    autorId: string | null
  ): Promise<DealRow> {
    const deal = await this.deals.updateStatus(id, orgId, 'lost', motivo)
    if (!deal) throw new DealNotFoundError(id)

    await this.registrarAtividadeSemQuebrar(
      orgId, id, `Negócio marcado como PERDIDO — motivo: ${motivo}`, autorId
    )
    return deal
  }

  // Reabre um deal fechado. Pode colidir com uq_open_deal_per_contact se o
  // contato já tiver outro aberto — o repositório traduz isso em
  // DealJaAbertoParaContatoError (409).
  async reabrir(id: string, orgId: string, autorId: string | null): Promise<DealRow> {
    const deal = await this.deals.updateStatus(id, orgId, 'open')
    if (!deal) throw new DealNotFoundError(id)

    await this.registrarAtividadeSemQuebrar(orgId, id, 'Negócio reaberto', autorId)
    return deal
  }

  async excluir(id: string, orgId: string): Promise<void> {
    // O repositório lança SemPermissaoComercialError quando a policy
    // admin-only barra (director recebe 0 linhas, sem erro).
    await this.deals.delete(id, orgId)
  }

  // --------------------------------------------------------------------------
  // Registro de atividade que NUNCA derruba a operação principal.
  //
  // A timeline é desejável, não crítica. Se a inserção falhar (policy, rede,
  // constraint), o movimento do deal já está persistido: propagar o erro faria
  // a UI reverter visualmente algo que o banco aceitou.
  //
  // O log fica, para que a perda não seja silenciosa.
  // --------------------------------------------------------------------------
  private async registrarAtividadeSemQuebrar(
    orgId:     string,
    dealId:    string,
    descricao: string,
    autorId:   string | null
  ): Promise<void> {
    try {
      await this.activities.registrarMudancaDeStatus({
        organization_id: orgId,
        deal_id:         dealId,
        descricao,
        created_by:      autorId,
      })
    } catch (err) {
      console.error('[CRM] falha ao registrar atividade (operação principal foi mantida)', {
        dealId, descricao, err,
      })
    }
  }
}
