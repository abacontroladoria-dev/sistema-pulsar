import { extractUser }                from '@/lib/central/auth'
import { mapCentralError }            from '@/lib/central/errors'
import { ok, forbidden }              from '@/lib/central/response'
import { createAgentSettingsService } from '@/modules/atendimento/services'

// ============================================================================
// GET /api/central/voz/vozes
//
// Vozes que a chave gravada pode realmente usar, mais a cota da conta.
//
// Duas funções, e a segunda é a mais importante: esta rota é a verificação da
// credencial. Se responde 200, a chave é válida e há caracteres disponíveis. Se
// responde 502 com TTS_KEY_REJECTED, a chave foi recusada pela ElevenLabs — o
// que é uma informação diferente de "a chave não está salva" (422).
//
// A lista de vozes vem da conta, não de constantes no código. A tela antiga
// trazia 21 voice_ids fixos: voz que sai do catálogo público, ou voz clonada da
// clínica, produziam um erro que parecia problema de chave.
// ============================================================================

export async function GET() {
  try {
    const { user, supabase } = await extractUser()

    // Mesmos papéis de /api/central/agent-settings: quem pode gravar a chave
    // da ElevenLabs precisa poder verificar se ela funciona — é esta rota que
    // responde "a chave é válida", e sem ela a aba de APIs fica meio muda.
    if (user.centralRole !== 'admin' && user.centralRole !== 'director') {
      return forbidden('Apenas administradores e diretoria podem consultar as vozes da conta')
    }

    const service = createAgentSettingsService(supabase)
    return ok(await service.listarVozesDaConta(user.orgId))
  } catch (err) {
    return mapCentralError(err)
  }
}
