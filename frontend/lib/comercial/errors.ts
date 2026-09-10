import { NextResponse } from 'next/server'
import {
  DealNotFoundError,
  PipelineStageNotFoundError,
  DealJaAbertoParaContatoError,
  EstagioComNegociosError,
  SemPermissaoComercialError,
} from '@/modules/comercial/types/errors.types'
import { mapCentralError } from '@/lib/central/errors'
import { notFound, conflict, forbidden } from '@/lib/central/response'

// ============================================================================
// mapComercialError
//
// Trata os erros do domínio CRM e DELEGA o resto para mapCentralError — que já
// cobre autenticação, providers e os erros do schema central. Sem essa
// delegação, um UnauthenticatedError vindo de extractUser() cairia no fallback
// e viraria 500 em vez de 401.
//
// Ordem importa: os casos específicos vêm antes do catch-all.
// ============================================================================
export function mapComercialError(err: unknown): NextResponse {
  if (err instanceof DealNotFoundError)          return notFound(err.code, err.message)
  if (err instanceof PipelineStageNotFoundError) return notFound(err.code, err.message)

  // 409: já existe deal aberto para o contato (uq_open_deal_per_contact).
  // Retentar igual nunca resolve; o cliente deve recarregar e usar o existente.
  if (err instanceof DealJaAbertoParaContatoError) return conflict(err.code, err.message)

  // 409: o estágio ainda tem deals (FK ON DELETE RESTRICT). É estado a
  // resolver — mover os deals — não erro de requisição.
  if (err instanceof EstagioComNegociosError)     return conflict(err.code, err.message)

  // 403: a policy barrou. Vale registrar, porque em produção isso costuma
  // significar central_role ausente ou errado no usuário — não ataque.
  if (err instanceof SemPermissaoComercialError) {
    console.error('[CRM API] policy barrou a operação', {
      code:    err.code,
      message: err.message,
      context: err.context,
    })
    return forbidden(err.message)
  }

  return mapCentralError(err)
}
