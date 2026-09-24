import 'server-only'

import { randomBytes } from 'node:crypto'

import { supabaseService } from '@/lib/supabase/service'
import { chamarEvolution } from '../providers/evolution.api'
import { processarConexao } from './ingestao'
import { ChannelNotFoundError, ProviderError } from '../types/errors.types'

// ============================================================================
// Gestão dos números Evolution (só admin — a rota confere o papel)
//
// Service role em tudo: a connection guarda o segredo do webhook, que
// `authenticated` não lê, e criar inbox/canal exige a RPC security definer.
// O recorte por organização é responsabilidade DESTE módulo: toda função recebe
// o `orgId` da sessão e confere que o canal pertence a ela.
// ============================================================================

const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'SEND_MESSAGE']

export interface NumeroEvolution {
  channelId: string
  inboxId: string
  nome: string
  instancia: string | null
  status: string
  ultimaSincronizacao: string | null
  membros: number
}

interface CanalDoBanco {
  id: string
  inbox_id: string
  name: string
  status: string
  organization_id: string
  channel_connections: { provider_instance_id: string | null; last_sync_at: string | null }[] | { provider_instance_id: string | null; last_sync_at: string | null } | null
}

function primeiraConexao(c: CanalDoBanco['channel_connections']) {
  return Array.isArray(c) ? c[0] ?? null : c
}

export async function listarNumeros(orgId: string): Promise<NumeroEvolution[]> {
  const { data, error } = await supabaseService
    .schema('central')
    .from('channels')
    .select('id, inbox_id, name, status, organization_id, channel_connections(provider_instance_id, last_sync_at)')
    .eq('organization_id', orgId)
    .eq('provider', 'evolution')
    .eq('active', true)
    .order('name')
  if (error) throw error

  const canais = (data ?? []) as CanalDoBanco[]
  const inboxIds = canais.map(c => c.inbox_id)

  const contagem = new Map<string, number>()
  if (inboxIds.length) {
    const { data: membros, error: e2 } = await supabaseService
      .schema('central')
      .from('inbox_members')
      .select('inbox_id')
      .in('inbox_id', inboxIds)
    if (e2) throw e2
    for (const m of (membros ?? []) as { inbox_id: string }[]) {
      contagem.set(m.inbox_id, (contagem.get(m.inbox_id) ?? 0) + 1)
    }
  }

  return canais.map(c => {
    const conexao = primeiraConexao(c.channel_connections)
    return {
      channelId: c.id,
      inboxId: c.inbox_id,
      nome: c.name,
      instancia: conexao?.provider_instance_id ?? null,
      status: c.status,
      ultimaSincronizacao: conexao?.last_sync_at ?? null,
      membros: contagem.get(c.inbox_id) ?? 0,
    }
  })
}

export async function criarNumero(input: {
  orgId: string
  nome: string
  adminId: string
  baseUrlWebhook: string
}): Promise<{ channelId: string; qrBase64: string | null }> {
  const nome = input.nome.trim()
  const instancia = `org_${input.orgId.slice(0, 8)}_${slug(nome)}_${randomBytes(3).toString('hex')}`
  const webhookSecret = randomBytes(32).toString('hex')
  const instanceToken = randomBytes(24).toString('hex')

  const { data, error } = await supabaseService
    .schema('central')
    .rpc('criar_canal_evolution', {
      p_org_id: input.orgId,
      p_nome: nome,
      p_instance: instancia,
      p_metadata: { webhook_secret: webhookSecret, instance_token: instanceToken },
      p_admin_id: input.adminId,
    })
    .single<{ inbox_id: string; channel_id: string }>()
  if (error) throw error
  const channelId = data!.channel_id

  // A barra final é obrigatória: com trailingSlash do Next, a rota sem barra
  // responde 308 e a Evolution não segue redirect em POST.
  const urlWebhook = `${input.baseUrlWebhook.replace(/\/+$/, '')}/api/central/webhooks/evolution/${webhookSecret}/`

  try {
    const json = await chamarEvolution<{ qrcode?: { base64?: string } }>('POST', '/instance/create', {
      instanceName: instancia,
      token: instanceToken,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      readMessages: false,
      alwaysOnline: false,
      // Sem histórico: ao conectar um número antigo, a Evolution despejaria
      // milhares de mensagens de uma vez no webhook — e o pool pequeno do
      // PostgREST já derrubou o sistema inteiro por menos (504 geral).
      syncFullHistory: false,
      webhook: {
        url: urlWebhook,
        byEvents: false,
        // Mídia NÃO vem no webhook: é pedida depois, sob demanda.
        base64: false,
        events: EVENTOS_WEBHOOK,
      },
    })
    return { channelId, qrBase64: json.qrcode?.base64 ?? null }
  } catch (err) {
    // A Evolution recusou: o canal criado não serve para nada e não pode
    // aparecer na lista como se existisse.
    await supabaseService.schema('central').from('channels')
      .update({ active: false, status: 'error' }).eq('id', channelId)
    throw err
  }
}

async function instanciaDoCanal(orgId: string, channelId: string): Promise<{ instancia: string; inboxId: string }> {
  const { data, error } = await supabaseService
    .schema('central')
    .from('channels')
    .select('id, inbox_id, provider, organization_id, channel_connections(provider_instance_id)')
    .eq('id', channelId)
    .maybeSingle()
  if (error) throw error

  const canal = data as (CanalDoBanco & { provider: string }) | null
  if (!canal || canal.organization_id !== orgId || canal.provider !== 'evolution') {
    throw new ChannelNotFoundError(channelId)
  }
  const instancia = primeiraConexao(canal.channel_connections)?.provider_instance_id
  if (!instancia) throw new ProviderError('evolution', new Error(`canal ${channelId} sem instância`))
  return { instancia, inboxId: canal.inbox_id }
}

// QR novo a cada chamada — o do WhatsApp expira em ~20s. Nunca é gravado.
export async function pedirQr(orgId: string, channelId: string): Promise<{ qrBase64: string | null; conectado: boolean }> {
  const { instancia } = await instanciaDoCanal(orgId, channelId)
  const json = await chamarEvolution<{ base64?: string; instance?: { state?: string } }>(
    'GET', `/instance/connect/${encodeURIComponent(instancia)}`,
  )
  return { qrBase64: json.base64 ?? null, conectado: json.instance?.state === 'open' }
}

export async function consultarStatus(orgId: string, channelId: string): Promise<string> {
  const { instancia, inboxId } = await instanciaDoCanal(orgId, channelId)
  const json = await chamarEvolution<{ instance?: { state?: string } }>(
    'GET', `/instance/connectionState/${encodeURIComponent(instancia)}`,
  )
  const estado = json.instance?.state
  await processarConexao(supabaseService, { organization_id: orgId, channel_id: channelId, inbox_id: inboxId }, estado)
  return estado ?? 'desconhecido'
}

export async function reiniciar(orgId: string, channelId: string): Promise<void> {
  const { instancia } = await instanciaDoCanal(orgId, channelId)
  const caminho = `/instance/restart/${encodeURIComponent(instancia)}`
  // v2 usa POST; versões anteriores, PUT.
  try {
    await chamarEvolution('POST', caminho)
  } catch {
    await chamarEvolution('PUT', caminho)
  }
}

export async function desconectar(orgId: string, channelId: string): Promise<void> {
  const { instancia, inboxId } = await instanciaDoCanal(orgId, channelId)
  await chamarEvolution('DELETE', `/instance/logout/${encodeURIComponent(instancia)}`)
  await processarConexao(supabaseService, { organization_id: orgId, channel_id: channelId, inbox_id: inboxId }, 'close')
}

// Remove da Evolution e DESATIVA no Pulsar. Não apaga: as conversas apontam
// para o canal (FK RESTRICT) e o histórico de atendimento fica.
export async function removerNumero(orgId: string, channelId: string): Promise<void> {
  const { instancia } = await instanciaDoCanal(orgId, channelId)
  await chamarEvolution('DELETE', `/instance/logout/${encodeURIComponent(instancia)}`).catch(() => {})
  await chamarEvolution('DELETE', `/instance/delete/${encodeURIComponent(instancia)}`).catch(err => {
    console.warn('[evolution] delete da instância falhou; desativando mesmo assim', err)
  })
  const { error } = await supabaseService.schema('central').from('channels')
    .update({ active: false, status: 'disconnected' }).eq('id', channelId)
  if (error) throw error
}

export async function listarMembros(orgId: string, channelId: string): Promise<string[]> {
  const { inboxId } = await instanciaDoCanal(orgId, channelId)
  const { data, error } = await supabaseService
    .schema('central')
    .from('inbox_members')
    .select('user_id')
    .eq('inbox_id', inboxId)
  if (error) throw error
  return ((data ?? []) as { user_id: string }[]).map(m => m.user_id)
}

// Substitui a lista inteira. `usuariosValidos` vem de listarAtribuiveis(orgId):
// ninguém de fora da organização entra por um id forjado no corpo.
export async function definirMembros(
  orgId: string,
  channelId: string,
  userIds: string[],
  usuariosValidos: Set<string>,
): Promise<string[]> {
  const { inboxId } = await instanciaDoCanal(orgId, channelId)
  const alvo = [...new Set(userIds)].filter(id => usuariosValidos.has(id))
  const atuais = await listarMembros(orgId, channelId)

  const remover = atuais.filter(id => !alvo.includes(id))
  const incluir = alvo.filter(id => !atuais.includes(id))

  if (remover.length) {
    const { error } = await supabaseService.schema('central').from('inbox_members')
      .delete().eq('inbox_id', inboxId).in('user_id', remover)
    if (error) throw error
  }
  if (incluir.length) {
    const { error } = await supabaseService.schema('central').from('inbox_members')
      .insert(incluir.map(user_id => ({ organization_id: orgId, inbox_id: inboxId, user_id })))
    if (error) throw error
  }
  return alvo
}

function slug(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    .slice(0, 24) || 'numero'
}
