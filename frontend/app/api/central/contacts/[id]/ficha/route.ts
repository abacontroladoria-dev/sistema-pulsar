import type { NextRequest } from 'next/server'
import { extractUser }      from '@/lib/central/auth'
import { mapCentralError }  from '@/lib/central/errors'
import { ok, badRequest }   from '@/lib/central/response'
import { createFichaService } from '@/modules/atendimento/services/ficha.service'
import { ContactRepository } from '@/modules/atendimento/repositories/contact.repository'
import { ContactNotFoundError } from '@/modules/atendimento/types/errors.types'
import { CAMPOS_FICHA, type CampoFicha } from '@/modules/atendimento/types/central.types'

type Ctx = { params: Promise<{ id: string }> }

// ============================================================================
// A ficha do paciente de um contato.
//
// GET   — a ficha montada: cadastro do TiTa + o que a Maia coletou na conversa,
//         resolvidos campo a campo. Nunca escreve e nunca chama modelo.
// PATCH — a correção manual do atendente.
//
// POR QUE O PATCH NÃO É OPCIONAL
//
// A Maia vai ouvir "Sofia" e gravar "Sophia". Vai entender que o plano é a
// operadora quando o responsável disse o nome do plano. Sem um caminho de
// correção, o painel viraria uma afirmação errada que ninguém pode consertar — e
// errada num lugar onde o dado é lido por quem pede autorização ao convênio.
//
// O que o atendente corrige fica marcado como dele (`fonte: 'atendente'`), e é
// isso que a tela mostra: a diferença entre "a IA ouviu" e "uma pessoa
// conferiu" é a diferença entre um palpite e um dado.
// ============================================================================

export async function GET(_request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    const ficha = await createFichaService(supabase).montar(user.orgId, id)

    // Sem 404 quando não há nada coletado: "ninguém perguntou nada ainda" é uma
    // resposta legítima, e o painel a desenha como estado vazio. Um 404 faria o
    // hook tratar ausência de ficha como falha de rota.
    return ok(ficha)
  } catch (err) {
    return mapCentralError(err)
  }
}

// PATCH /api/central/contacts/[id]/ficha/
//
// Corpo: um objeto com os campos a mudar. `null` apaga o campo — é a forma de
// desfazer um registro errado da IA; campo ausente não é tocado.
//
// A BARRA FINAL NA URL DE QUEM CHAMA NÃO É DETALHE: com `trailingSlash: true`,
// um PATCH sem ela vira um 308 e o corpo nunca chega aqui. O sintoma é uma
// edição que "some" sem erro nenhum no console.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { user, supabase } = await extractUser()
    const { id } = await ctx.params

    // A checagem converte "id de outra organização" em 404. Sem ela a RLS
    // barraria só na escrita, e o atendente veria "não foi possível salvar" para
    // um contato que, da perspectiva dele, simplesmente não existe.
    const contato = await new ContactRepository(supabase).findById(id)
    if (!contato || contato.organization_id !== user.orgId) {
      throw new ContactNotFoundError(id)
    }

    const corpo = await request.json().catch(() => null)
    if (!corpo || typeof corpo !== 'object') {
      return badRequest('FICHA_CORPO_INVALIDO', 'Envie um objeto com os campos a alterar.')
    }

    // Allowlist: só os cinco campos coletáveis entram. Um corpo com
    // `organization_id` ou `coleta_concluida` não pode atravessar até o
    // repositório — a mesma razão pela qual o modelo não declara chaves de
    // contexto nos schemas das ferramentas.
    const patch: Partial<Record<CampoFicha, string | null>> = {}
    for (const campo of CAMPOS_FICHA) {
      if (campo in corpo) {
        const valor = (corpo as Record<string, unknown>)[campo]
        if (valor !== null && typeof valor !== 'string') {
          return badRequest('FICHA_VALOR_INVALIDO', `O campo ${campo} precisa ser texto ou null.`)
        }
        patch[campo] = valor
      }
    }

    if (Object.keys(patch).length === 0) {
      return badRequest('FICHA_SEM_CAMPOS', 'Nenhum campo conhecido foi enviado.')
    }

    const service = createFichaService(supabase)
    const { recusados } = await service.registrar(user.orgId, id, patch, 'atendente')

    // Uma data que o atendente digitou errado não pode ser aceita em silêncio: o
    // campo ficaria em branco e ele acharia que salvou. O motivo é o mesmo texto
    // que a Maia receberia, e serve igualmente bem a um humano.
    if (recusados.length > 0) {
      return badRequest('FICHA_VALOR_RECUSADO', recusados.map((r) => r.motivo).join(' '))
    }

    // Devolve a ficha inteira remontada, não só o que mudou: o merge pode alterar
    // a origem de outros campos, e o painel substitui o estado de uma vez em vez
    // de costurar um patch parcial sobre o que tinha em mãos.
    return ok(await service.montar(user.orgId, id))
  } catch (err) {
    return mapCentralError(err)
  }
}
