import { extractUser }                    from '@/lib/central/auth'
import { mapCentralError }                from '@/lib/central/errors'
import { ok, badRequest, forbidden }      from '@/lib/central/response'
import { createAgentSettingsService }     from '@/modules/atendimento/services'
import {
  parseSalvarConfiguracaoBody,
  type SalvarConfiguracaoBody,
} from '@/modules/atendimento/dto/agent-settings.dto'

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

// admin e director. A RLS de central.agent_settings (20260914190000) permite os
// mesmos dois, mas a checagem aqui devolve 403 com mensagem em vez de um
// "nenhuma linha encontrada" que pareceria banco vazio.
function exigirAcesso(centralRole: string): string | null {
  if (centralRole !== 'admin' && centralRole !== 'director') {
    return 'Apenas administradores e diretoria podem ver ou alterar a configuração do agente'
  }
  return null
}

// O recorte de director mora AQUI, e não na RLS, porque RLS decide por linha:
// liberar o UPDATE da linha para director libera junto toda coluna que o grant
// de 20260810120300 permite gravar — `elevenlabs_api_key` inclusive, que é
// gravável ainda que não legível. A diretoria edita o texto do agente; trocar a
// credencial da ElevenLabs ou desligar a atendente continua sendo de admin.
// Tipado como chave do DTO: renomear `systemPrompt` lá quebra a compilação aqui,
// em vez de silenciosamente transformar esta lista numa allowlist vazia — que
// bloquearia a diretoria de tudo sem nenhum erro aparecer.
const CAMPOS_DE_DIRECTOR: readonly (keyof SalvarConfiguracaoBody)[] = ['systemPrompt']

// Recusa explícita, não descarte silencioso: uma tela que aceita o submit e não
// grava a metade dos campos é pior que um 403 dizendo qual campo sobrou.
function recusarCamposForaDoPapel(
  centralRole: string,
  data: SalvarConfiguracaoBody,
): string | null {
  if (centralRole !== 'director') return null

  const permitidos: readonly string[] = CAMPOS_DE_DIRECTOR
  const proibidos = Object.keys(data).filter(campo => !permitidos.includes(campo))
  if (proibidos.length === 0) return null

  return `A diretoria pode alterar apenas o prompt do agente. Fora do permitido: ${proibidos.join(', ')}`
}

export async function GET() {
  try {
    const { user, supabase } = await extractUser()

    const negado = exigirAcesso(user.centralRole)
    if (negado) return forbidden(negado)

    const service = createAgentSettingsService(supabase)
    return ok(await service.obter(user.orgId))
  } catch (err) {
    return mapCentralError(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await extractUser()

    const negado = exigirAcesso(user.centralRole)
    if (negado) return forbidden(negado)

    const raw = await request.json().catch(() => null)
    const parsed = parseSalvarConfiguracaoBody(raw)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    // Depois do parse, e não antes: o DTO já descartou o que não é campo
    // conhecido, então o que sobrou aqui é exatamente o que iria ao banco.
    const foraDoPapel = recusarCamposForaDoPapel(user.centralRole, parsed.data)
    if (foraDoPapel) return forbidden(foraDoPapel)

    const service = createAgentSettingsService(supabase)
    return ok(await service.salvar(user.orgId, parsed.data, user.id))
  } catch (err) {
    return mapCentralError(err)
  }
}
