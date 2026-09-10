import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { DealRepository }          from '../repositories/deal.repository'
import { PipelineStageRepository } from '../repositories/pipeline-stage.repository'
import { DealActivityRepository }  from '../repositories/deal-activity.repository'
import { DealService }             from './deal.service'

// ============================================================================
// Factories do módulo comercial
//
// Mesmo padrão de modules/atendimento/services/index.ts: o client vem de
// extractUser() e é REUTILIZADO — nunca criar um segundo client no mesmo
// handler.
//
// O client carrega a sessão do usuário, então as policies de RLS do schema crm
// (admin|director) valem. Usar supabaseService aqui bypassaria o RLS e daria a
// qualquer autenticado acesso ao funil inteiro de qualquer organização.
// ============================================================================

export function createDealService(supabase: SupabaseClient): DealService {
  return new DealService(
    new DealRepository(supabase),
    new PipelineStageRepository(supabase),
    new DealActivityRepository(supabase)
  )
}

export function createPipelineStageRepository(supabase: SupabaseClient): PipelineStageRepository {
  return new PipelineStageRepository(supabase)
}

export function createDealActivityRepository(supabase: SupabaseClient): DealActivityRepository {
  return new DealActivityRepository(supabase)
}

export { DealService, DealRepository, PipelineStageRepository, DealActivityRepository }
