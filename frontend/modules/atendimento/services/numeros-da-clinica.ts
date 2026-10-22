import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import { chamarEvolution, evolutionConfigurada } from '../providers/evolution.api'
import { digitosDoJid, variantesBr } from '../utils/telefone-br'

// ============================================================================
// Os números de WhatsApp da própria clínica
//
// O banco não guarda o número de cada canal: na Evolution ele é do celular que
// escaneou o QR (`ownerJid` da instância), e na Meta é o `display_phone_number`
// da conexão. Serve ao cartão de contato compartilhado: quando a pessoa manda
// um cartão com o número da clínica, quase sempre é queixa de atendimento
// ("tentei esse número e ninguém responde" — 22/10, 5521920043824), e a
// atendente precisa ver isso de cara.
//
// Cache de 10 min por organização: número de canal muda quando alguém escaneia
// outro celular, coisa rara, e o cartão não pode custar uma ida à Evolution a
// cada abertura de conversa. Evolution fora do ar não derruba nada — fica só o
// que a Meta disser.
// ============================================================================

const VALIDADE_MS = 10 * 60_000
const cache = new Map<string, { quando: number; numeros: Map<string, string> }>()

interface ConexaoDoBanco {
  provider_instance_id: string | null
  provider_metadata:    Record<string, unknown> | null
}

interface InstanciaEvolution {
  name?:      string
  ownerJid?:  string | null
  // v1: { instance: { instanceName, owner } }
  instance?:  { instanceName?: string; owner?: string | null }
}

// dígitos (todas as variantes do 9º dígito) → nome do canal
export async function numerosDaClinica(orgId: string): Promise<Map<string, string>> {
  const guardado = cache.get(orgId)
  if (guardado && Date.now() - guardado.quando < VALIDADE_MS) return guardado.numeros

  const { data, error } = await supabaseService
    .schema('central')
    .from('channels')
    .select('name, provider, channel_connections(provider_instance_id, provider_metadata)')
    .eq('organization_id', orgId)
    .eq('active', true)
  if (error) throw error

  const canais = (data ?? []) as { name: string; provider: string; channel_connections: ConexaoDoBanco[] | ConexaoDoBanco | null }[]
  const numeros = new Map<string, string>()
  const guardar = (digitos: string, canal: string) => {
    if (digitos.length < 10) return
    for (const v of variantesBr(digitos)) numeros.set(v, canal)
  }

  const canalDaInstancia = new Map<string, string>()
  for (const canal of canais) {
    const conexoes = Array.isArray(canal.channel_connections) ? canal.channel_connections : canal.channel_connections ? [canal.channel_connections] : []
    for (const c of conexoes) {
      if (canal.provider === 'evolution' && c.provider_instance_id) canalDaInstancia.set(c.provider_instance_id, canal.name)
      const exibido = c.provider_metadata?.display_phone_number
      if (typeof exibido === 'string') guardar(exibido.replace(/\D/g, ''), canal.name)
    }
  }

  if (canalDaInstancia.size && evolutionConfigurada()) {
    try {
      const instancias = await chamarEvolution<InstanciaEvolution[]>('GET', '/instance/fetchInstances')
      for (const i of Array.isArray(instancias) ? instancias : []) {
        const nome = i.name ?? i.instance?.instanceName
        const dono = i.ownerJid ?? i.instance?.owner
        const canal = nome ? canalDaInstancia.get(nome) : undefined
        if (canal && dono) guardar(digitosDoJid(dono), canal)
      }
    } catch (err) {
      console.warn('[numeros-da-clinica] Evolution sem resposta; seguem só os números da Meta:', (err as Error).message)
    }
  }

  cache.set(orgId, { quando: Date.now(), numeros })
  return numeros
}
