import type { NextRequest } from 'next/server'

import { extractUser } from '@/lib/central/auth'
import { mapCentralError } from '@/lib/central/errors'
import { ok, created, badRequest, forbidden, serviceUnavailable } from '@/lib/central/response'
import { evolutionConfigurada } from '@/modules/atendimento/providers/evolution.api'
import { listarNumeros, criarNumero } from '@/modules/atendimento/evolution/instancias'

// GET  /api/central/evolution/instances — números Evolution da organização
// POST /api/central/evolution/instances — cria um número { nome }
//
// Só admin da Central. Números novos entram com ai_mode travado em 'off'
// (atendimento humano) e o criador como primeiro membro.

export async function GET() {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')

    return ok({
      configurada: evolutionConfigurada(),
      numeros: await listarNumeros(user.orgId),
    })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await extractUser()
    if (user.centralRole !== 'admin') return forbidden('Apenas administradores gerenciam os números')

    if (!evolutionConfigurada()) {
      return serviceUnavailable('EVOLUTION_NAO_CONFIGURADA', 'A Evolution API ainda não está configurada no servidor')
    }

    const corpo = (await request.json().catch(() => ({}))) as { nome?: unknown }
    const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : ''
    if (nome.length < 2 || nome.length > 60) return badRequest('Informe um nome de 2 a 60 caracteres', 'nome')

    const baseUrlWebhook =
      process.env.EVOLUTION_WEBHOOK_BASE_URL
      ?? process.env.NEXT_PUBLIC_SITE_URL
      ?? request.nextUrl.origin

    return created(await criarNumero({ orgId: user.orgId, nome, adminId: user.id, baseUrlWebhook }))
  } catch (err) {
    return mapCentralError(err)
  }
}
