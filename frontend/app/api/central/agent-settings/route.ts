import { extractUser }                    from '@/lib/central/auth'
import { mapCentralError }                from '@/lib/central/errors'
import { ok, badRequest, forbidden }      from '@/lib/central/response'
import { supabaseService }                from '@/lib/supabase/service'
import { createAgentSettingsService, createAgentSettingsSystemService } from '@/modules/atendimento/services'
import { parseSalvarConfiguracaoBody }    from '@/modules/atendimento/dto/agent-settings.dto'

// ============================================================================
// /api/central/agent-settings
//
// Configuração do agente e da voz da atendente virtual.
//
// Substitui a leitura e escrita diretas em `nina_settings` que a tela de
// Configurações fazia no browser. Aquela tabela pertence a outro projeto
// Supabase, que não existe mais — o host nem resolve em DNS. Por isso salvar a
// chave da ElevenLabs "funcionava" sem gravar nada: o cliente errava o alvo e o
// erro morria num console.error.
//
// A chave nunca sai por esta rota. GET devolve `chaveConfigurada` e os quatro
// últimos caracteres; a chave completa só circula servidor → ElevenLabs.
// ============================================================================

// admin e director, com os mesmos poderes. Houve uma etapa em que director
// podia gravar apenas `systemPrompt` e o recorte por campo morava aqui (RLS
// decide por linha, não por coluna, então a restrição não tinha como vir do
// banco). A diretoria passou a ter a página inteira — inclusive a chave da
// ElevenLabs, que é gravável ainda que nunca legível — e o recorte saiu.
//
// A checagem continua existindo para devolver 403 com mensagem em vez do
// "nenhuma linha encontrada" que a RLS produziria e que pareceria banco vazio.
//
// Acesso 'prompt' (15/10/2026): quem tem `usuarios.pode_editar_prompt_maia`
// sem ser admin/director vê a configuração e grava SÓ `systemPrompt`. A RLS
// de central.agent_settings é de admin/director, então essa escrita vai pelo
// servidor (service role), com o recorte de campo feito aqui — é este o
// portão. A marca só muda por admin, diretoria ou SQL (trava em
// 20261015170000/180000).
type Acesso = 'total' | 'prompt'

const NEGADO = 'Apenas administradores e diretoria podem ver ou alterar a configuração do agente'

async function acessoDe(user: { id: string; centralRole: string }): Promise<Acesso | null> {
  if (user.centralRole === 'admin' || user.centralRole === 'director') return 'total'
  const { data } = await supabaseService
    .from('usuarios')
    .select('ativo, pode_editar_prompt_maia')
    .eq('id', user.id)
    .maybeSingle()
  return data?.ativo && data.pode_editar_prompt_maia ? 'prompt' : null
}

export async function GET() {
  try {
    const { user, supabase } = await extractUser()

    const acesso = await acessoDe(user)
    if (!acesso) return forbidden(NEGADO)

    if (acesso === 'prompt') {
      const cfg = await createAgentSettingsSystemService().obter(user.orgId)
      // Nem o sufixo da chave da ElevenLabs: não é assunto de quem só edita o prompt.
      return ok({ ...cfg, chaveMascarada: null, acesso })
    }

    const service = createAgentSettingsService(supabase)
    return ok({ ...(await service.obter(user.orgId)), acesso })
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await extractUser()

    const acesso = await acessoDe(user)
    if (!acesso) return forbidden(NEGADO)

    const raw = await request.json().catch(() => null)
    const parsed = parseSalvarConfiguracaoBody(raw)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    if (acesso === 'prompt') {
      // Só o prompt; o resto do corpo (a tela manda modo e agendamento
      // inalterados) é ignorado, nunca gravado.
      if (parsed.data.systemPrompt === undefined) return badRequest('systemPrompt é obrigatório')
      const cfg = await createAgentSettingsSystemService()
        .salvar(user.orgId, { systemPrompt: parsed.data.systemPrompt }, user.id)
      return ok({ ...cfg, chaveMascarada: null, acesso })
    }

    const service = createAgentSettingsService(supabase)
    return ok({ ...(await service.salvar(user.orgId, parsed.data, user.id)), acesso })
  } catch (err) {
    return mapCentralError(err)
  }
}
