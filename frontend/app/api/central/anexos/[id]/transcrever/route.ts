import type { NextRequest }          from 'next/server'
import { extractUser }               from '@/lib/central/auth'
import { mapCentralError }           from '@/lib/central/errors'
import { ok }                        from '@/lib/central/response'
import { createTranscricaoService }  from '@/modules/atendimento/services'

// ============================================================================
// POST /api/central/anexos/[id]/transcrever
//
// O botão "Transcrever" / "Tentar de novo" da bolha de áudio. Síncrono: o
// áudio de WhatsApp volta em poucos segundos, e quem clicou está esperando o
// texto — mandar para a fila e esperar o próximo poll seria só demora.
//
// O acesso é o mesmo de ouvir o áudio: o anexo é lido com o client do usuário
// (RLS de message_attachments) antes de qualquer coisa. O texto também vai
// gravado no anexo, então o polling do detalhe o traz para as outras abas.
//
// Erros com dono diferente saem com status diferente (lib/central/errors.ts):
// 409 já transcrevendo, 422 mídia indisponível ou não é áudio, 502 a OpenAI
// recusou, 503 sem chave/sem saldo/limite de taxa.
// ============================================================================

export const runtime = 'nodejs'
// Download da Meta + transcrição, com folga para o teto de 60s do provider.
export const maxDuration = 90

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const service = createTranscricaoService(supabase)
    const texto = await service.transcreverPorPedido(id, user.orgId, user.id)

    return ok({ texto })
  } catch (err) {
    return mapCentralError(err)
  }
}
