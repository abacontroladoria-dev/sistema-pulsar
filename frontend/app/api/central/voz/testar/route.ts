import { extractUser }                from '@/lib/central/auth'
import { mapCentralError }            from '@/lib/central/errors'
import { ok, badRequest, forbidden }  from '@/lib/central/response'
import { createAgentSettingsService } from '@/modules/atendimento/services'
import { parseTestarVozBody }         from '@/modules/atendimento/dto/agent-settings.dto'

// ============================================================================
// POST /api/central/voz/testar
//
// Sintetiza um texto curto com a voz e os parâmetros gravados, para o admin
// ouvir antes de a atendente virtual usar aquela voz com um responsável.
//
// A chave não vem no corpo da requisição. A tela antiga mandava
// `apiKey: settings.elevenlabs_api_key` do browser em cada teste — o que exige
// devolver a chave ao cliente na leitura, e a coloca no corpo de uma requisição
// e em qualquer log de rede. Aqui o servidor lê a chave do banco.
//
// Retorna o áudio em base64 e não como binário porque o corpo carrega também as
// estatísticas do teste (tempo de geração, tamanho, caracteres cobrados), e o
// player da tela monta o Blob a partir disso. O custo é ~33% de overhead num
// mp3 de poucos KB.
// ============================================================================

export async function POST(request: Request) {
  try {
    const { user, supabase } = await extractUser()

    // Mesmos papéis de /api/central/agent-settings. Ouvir a voz antes de ela
    // falar com um responsável é parte de configurar a aba de APIs, que a
    // diretoria agora administra por inteiro.
    if (user.centralRole !== 'admin' && user.centralRole !== 'director') {
      return forbidden('Apenas administradores e diretoria podem gerar áudio de teste')
    }

    const raw = await request.json().catch(() => null)
    const parsed = parseTestarVozBody(raw)
    if (!parsed.ok) return badRequest(parsed.errors.join('; '))

    const service = createAgentSettingsService(supabase)
    return ok(await service.testarVoz(user.orgId, parsed.data.texto))
  } catch (err) {
    return mapCentralError(err)
  }
}
