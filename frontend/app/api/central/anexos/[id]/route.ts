import type { NextRequest }     from 'next/server'
import { extractUser }          from '@/lib/central/auth'
import { mapCentralError }      from '@/lib/central/errors'
import { ok }                   from '@/lib/central/response'
import { createMessageService } from '@/modules/atendimento/services'

// ============================================================================
// GET /api/central/anexos/[id]
//
// Devolve uma URL ASSINADA e de curta duração para o arquivo. Não devolve o
// arquivo: fazer o Next transmitir 16 MB seria pagar banda e memória por algo
// que o CDN do storage faz melhor, e cada <img> da conversa passaria pelo
// servidor da aplicação.
//
// POR QUE NÃO O PATH
//
// O bucket é privado e o `storage_path` nunca vai ao cliente. Se fosse, um
// cliente poderia montar caminhos de outras conversas — a policy os barraria,
// mas o padrão do path já contaria quantas conversas a organização tem e
// quando aconteceram. A URL assinada não revela nada além do que ela serve.
//
// O DOWNLOAD SOB DEMANDA
//
// Um anexo 'pending' é mídia recebida que ninguém trouxe da Meta ainda. O
// service busca na hora, em vez de devolver "indisponível" e esperar um worker
// que não existe: quem abriu a conversa está olhando para ela agora.
//
// A primeira abertura paga a espera (uma ida à Graph + uma subida ao bucket);
// as seguintes leem do bucket. É o mesmo padrão de "baixa uma vez, serve
// sempre" que o pipeline de dois estágios da 20260701000600 descrevia — só que
// disparado por quem precisa, e não por varredura.
// ============================================================================

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const service = createMessageService(supabase)
    // A conferência de organização é do service: ele colapsa "não existe" e
    // "não é seu" num 404 só, para não confirmar a existência de um anexo
    // alheio a quem tentou adivinhar o id.
    const url = await service.urlDoAnexo(id, user.orgId)

    return ok({ url })
  } catch (err) {
    return mapCentralError(err)
  }
}
