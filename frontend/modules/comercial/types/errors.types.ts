// ============================================================================
// CRM — Domain Errors
//
// Estende CentralError para que `mapCentralError` (lib/central/errors.ts)
// consiga tratá-los: erros que não descendem de CentralError caem no fallback
// e o operador recebe "Internal server error" no lugar do motivo real — foi o
// que aconteceu com JanelaAtendimentoFechadaError, documentado lá.
//
// Os erros específicos daqui são mapeados em lib/comercial/errors.ts.
// ============================================================================

import { CentralError } from '@/modules/atendimento/types/errors.types'

export class DealNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Negócio ${id} não encontrado`, 'DEAL_NOT_FOUND', { id })
  }
}

export class PipelineStageNotFoundError extends CentralError {
  constructor(id: string) {
    super(`Estágio ${id} não encontrado`, 'PIPELINE_STAGE_NOT_FOUND', { id })
  }
}

// ----------------------------------------------------------------------------
// Um deal 'open' por contato/org — garantido pelo índice parcial único
// uq_open_deal_per_contact (20260701020100_crm_tables.sql).
//
// O índice é parcial (WHERE status = 'open'), então:
//   - múltiplos deals won/lost do mesmo contato são permitidos
//   - reabrir um deal lost funciona quando não há outro open
//
// A violação chega do Postgres como código 23505. É condição de corrida
// legítima (dois webhooks simultâneos para o mesmo contato), não bug —
// por isso vira 409, que diz ao cliente "recarregue e use o deal existente".
// ----------------------------------------------------------------------------
export class DealJaAbertoParaContatoError extends CentralError {
  constructor(contactId: string) {
    super(
      `Já existe um negócio aberto para este contato`,
      'DEAL_ALREADY_OPEN_FOR_CONTACT',
      { contactId }
    )
  }
}

// ----------------------------------------------------------------------------
// stage_id é ON DELETE RESTRICT: o banco recusa apagar estágio com deals.
// A UI deve mover os deals antes. Chega como código 23503.
// ----------------------------------------------------------------------------
export class EstagioComNegociosError extends CentralError {
  constructor(stageId: string) {
    super(
      `Este estágio ainda tem negócios e não pode ser removido. Mova-os antes.`,
      'STAGE_HAS_DEALS',
      { stageId }
    )
  }
}

// ----------------------------------------------------------------------------
// As policies de crm exigem ca_current_role() in ('admin','director') para
// operar, e apenas 'admin' para deletar. Quando a policy barra, o PostgREST
// devolve 0 linhas afetadas em vez de erro — o service transforma isso neste
// erro para não "falhar em silêncio" (a UI mostraria sucesso sem ter gravado).
// ----------------------------------------------------------------------------
export class SemPermissaoComercialError extends CentralError {
  constructor(operacao: string) {
    super(
      `Sem permissão para ${operacao}. Requer perfil admin ou diretor na Central.`,
      'CRM_FORBIDDEN',
      { operacao }
    )
  }
}
