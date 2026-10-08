import 'server-only'

import { randomBytes } from 'node:crypto'

import { supabaseService } from '@/lib/supabase/service'
import { chamarEvolution } from '../providers/evolution.api'
import { processarConexao } from './ingestao'
import { ChannelNotFoundError, ProviderError } from '../types/errors.types'
import { digitosDoJid, variantesBr } from '../utils/telefone-br'

// ============================================================================
// Gestão dos números Evolution (admin e diretoria — a rota confere o papel)
//
// Service role em tudo: a connection guarda o segredo do webhook, que
// `authenticated` não lê, e criar inbox/canal exige a RPC security definer.
// O recorte por organização é responsabilidade DESTE módulo: toda função recebe
// o `orgId` da sessão e confere que o canal pertence a ela.
// ============================================================================

const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'SEND_MESSAGE']

// Quem cria, conecta (QR), reinicia, remove e distribui os números. É o ÚNICO
// portão: tudo abaixo roda com service role e a RPC criar_canal_evolution não
// confere papel. A diretoria entrou em 02/10/2026 a pedido — antes ela abria
// /connect/settings inteira e tomava 403 só neste bloco.
export function podeGerenciarNumeros(centralRole: string): boolean {
  return centralRole === 'admin' || centralRole === 'director'
}

export const MENSAGEM_SEM_PERMISSAO_NUMEROS = 'Apenas administradores e diretoria gerenciam os números'

export interface NumeroEvolution {
  channelId: string
  inboxId: string
  nome: string
  instancia: string | null
  status: string
  ultimaSincronizacao: string | null
  membros: number
  // Chave "Maia sugere" (central.inboxes.maia_sugestao). Só rascunho, nunca envio.
  maiaSugere: boolean
  // Chave "Maia responde" (central.inboxes.maia_automatica). Envia sozinha em
  // todas as conversas do número; implica maiaSugere.
  maiaResponde: boolean
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

  const sugere = new Set<string>()
  const responde = new Set<string>()
  if (inboxIds.length) {
    const { data: inboxes, error: e3 } = await supabaseService
      .schema('central')
      .from('inboxes')
      .select('id, maia_automatica')
      .in('id', inboxIds)
      .eq('maia_sugestao', true)
    if (e3) throw e3
    for (const i of (inboxes ?? []) as { id: string; maia_automatica: boolean }[]) {
      sugere.add(i.id)
      if (i.maia_automatica) responde.add(i.id)
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
      maiaSugere: sugere.has(c.inbox_id),
      maiaResponde: responde.has(c.inbox_id),
    }
  })
}

// Liga/desliga a sugestão da Maia no número. Não toca em ai_mode: a Maia
// continua sem enviar nada por número Evolution (trg_evolution_sem_ia).
export async function definirMaiaSugestao(orgId: string, channelId: string, ligar: boolean): Promise<void> {
  const { inboxId } = await instanciaDoCanal(orgId, channelId)
  const { error } = await supabaseService.schema('central').from('inboxes')
    // Desligar a sugestão desliga a resposta automática junto (CHECK no banco).
    .update(ligar ? { maia_sugestao: true } : { maia_sugestao: false, maia_automatica: false })
    .eq('id', inboxId).eq('organization_id', orgId)
  if (error) throw error
}

// Liga/desliga "Maia responde": ligar liga a sugestão junto (mesmo worker).
// Desligar volta ao modo sugestão. ai_mode segue 'off' (trg_evolution_sem_ia).
export async function definirMaiaAutomatica(orgId: string, channelId: string, ligar: boolean): Promise<void> {
  const { inboxId } = await instanciaDoCanal(orgId, channelId)
  const { error } = await supabaseService.schema('central').from('inboxes')
    .update(ligar ? { maia_sugestao: true, maia_automatica: true } : { maia_automatica: false })
    .eq('id', inboxId).eq('organization_id', orgId)
  if (error) throw error
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

// ============================================================================
// Importar contatos do WhatsApp do número
//
// Traz a agenda do aparelho (/chat/findContacts) para central.contacts, para a
// atendente achar o contato antes de ele mandar a primeira mensagem. Só JID de
// pessoa (@s.whatsapp.net): grupo, lista de transmissão e @lid ficam de fora.
//
// Contato já existente — por qualquer das variantes do 9º dígito — não é
// duplicado; só ganha nome se ainda não tinha. Em lote: a agenda tem milhares
// de linhas e um findByIdentifier por linha estouraria o tempo da requisição.
// ============================================================================

export interface ResultadoImportacao {
  lidos: number
  importados: number
  atualizados: number
  descartados: number
  // A agenda veio vazia e a sincronização foi ligada agora: só chega depois
  // de reconectar o número (QR).
  precisaReconectar?: boolean
}

const LOTE = 500

export async function importarContatos(orgId: string, channelId: string): Promise<ResultadoImportacao> {
  const { instancia } = await instanciaDoCanal(orgId, channelId)
  const db = supabaseService.schema('central')

  type Bruto = {
    remoteJid?: string | null; pushName?: string | null; name?: string | null
    verifiedName?: string | null; isGroup?: boolean | null
    phoneNumber?: string | null; remoteJidAlt?: string | null
  }
  // `where: {}` é o que a v2 espera; sem ele algumas versões devolvem vazio.
  const brutos = await chamarEvolution<Bruto[]>(
    'POST', `/chat/findContacts/${encodeURIComponent(instancia)}`, { where: {} },
  )
  const lista = Array.isArray(brutos) ? brutos : []

  // O WhatsApp só entrega contatos (e os nomes salvos no celular) junto da
  // sincronização de histórico, que os números nascem sem (criarNumero). Ligar
  // é seguro: o histórico chega como MESSAGES_SET, que o webhook não assina, e
  // DATABASE_SAVE_DATA_HISTORIC=false faz a Evolution não guardar as mensagens.
  if (lista.length === 0) {
    await ligarSincronizacao(instancia)
    return { lidos: 0, importados: 0, atualizados: 0, descartados: 0, precisaReconectar: true }
  }

  // Hoje boa parte da agenda vem como @lid (identificador interno, não é
  // telefone). Quando a Evolution traz o telefone ao lado (phoneNumber /
  // remoteJidAlt), usa ele; senão o contato fica de fora — um @lid gravado
  // como wa_id nunca casaria com a mensagem que chega pelo telefone.
  const daAgenda = new Map<string, string | null>()
  let descartados = 0
  for (const c of lista) {
    if (c.isGroup) { descartados++; continue }
    const jid = [c.remoteJid, c.remoteJidAlt, c.phoneNumber]
      .find(j => j && (j.endsWith('@s.whatsapp.net') || /^\+?\d{10,15}$/.test(j)))
    const tel = jid ? digitosDoJid(jid) : ''
    if (tel.length < 10) { descartados++; continue }
    const nome = (c.pushName || c.name || c.verifiedName)?.trim() || null
    if (!daAgenda.has(tel) || (nome && !daAgenda.get(tel))) daAgenda.set(tel, nome)
  }
  if (daAgenda.size === 0) {
    console.warn('[evolution] findContacts sem telefone utilizável', {
      instancia, total: lista.length, amostra: lista.slice(0, 3),
    })
  }

  // Todos os wa_id da organização, paginando: o PostgREST corta em 1000 linhas.
  const existentes = new Map<string, string>()
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from('contact_identifiers')
      .select('identifier_value, contact_id')
      .eq('organization_id', orgId)
      .eq('identifier_type', 'wa_id')
      .range(de, de + 999)
    if (error) throw error
    for (const r of (data ?? []) as { identifier_value: string; contact_id: string }[]) {
      existentes.set(r.identifier_value, r.contact_id)
    }
    if (!data || data.length < 1000) break
  }

  const novos: { telefone: string; nome: string | null }[] = []
  const nomearPorId = new Map<string, string>()
  for (const [tel, nome] of daAgenda) {
    const achado = variantesBr(tel).map(v => existentes.get(v)).find(Boolean)
    if (achado) { if (nome) nomearPorId.set(achado, nome) }
    else novos.push({ telefone: tel, nome })
  }

  for (let i = 0; i < novos.length; i += LOTE) {
    const fatia = novos.slice(i, i + LOTE)
    const { data, error } = await db
      .from('contacts')
      .insert(fatia.map(n => ({
        organization_id: orgId,
        name: n.nome,
        display_phone: n.telefone,
        contact_type: 'other',
        status: 'active',
        source: 'whatsapp_import',
        is_provisional: true,
      })))
      .select('id, display_phone')
    if (error) throw error

    const { error: errId } = await db
      .from('contact_identifiers')
      .upsert(
        ((data ?? []) as { id: string; display_phone: string }[]).map(c => ({
          organization_id: orgId,
          contact_id: c.id,
          identifier_type: 'wa_id',
          identifier_value: c.display_phone,
          is_primary: true,
        })),
        { onConflict: 'contact_id,identifier_type,identifier_value', ignoreDuplicates: true },
      )
    if (errId) throw errId
  }

  // Nome só para quem ainda não tem: o nome que a equipe digitou vale mais que
  // o do perfil do WhatsApp.
  let atualizados = 0
  const ids = [...nomearPorId.keys()]
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await db
      .from('contacts')
      .select('id')
      .in('id', ids.slice(i, i + LOTE))
      .is('name', null)
    if (error) throw error
    for (const { id } of (data ?? []) as { id: string }[]) {
      const { error: e } = await db.from('contacts').update({ name: nomearPorId.get(id) }).eq('id', id)
      if (e) throw e
      atualizados++
    }
  }

  return { lidos: lista.length, importados: novos.length, atualizados, descartados }
}

async function ligarSincronizacao(instancia: string): Promise<void> {
  const atual = await chamarEvolution<Record<string, unknown> | null>(
    'GET', `/settings/find/${encodeURIComponent(instancia)}`,
  ).catch(() => null)
  if (atual?.syncFullHistory === true) return
  await chamarEvolution('POST', `/settings/set/${encodeURIComponent(instancia)}`, {
    rejectCall:      atual?.rejectCall      ?? false,
    msgCall:         atual?.msgCall         ?? '',
    groupsIgnore:    atual?.groupsIgnore    ?? true,
    alwaysOnline:    atual?.alwaysOnline    ?? false,
    readMessages:    atual?.readMessages    ?? false,
    readStatus:      atual?.readStatus      ?? false,
    syncFullHistory: true,
  })
}
