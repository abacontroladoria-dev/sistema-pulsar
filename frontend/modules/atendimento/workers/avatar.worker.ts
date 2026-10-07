import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { chamarEvolution, evolutionConfigurada } from '../providers/evolution.api'

// ============================================================================
// Worker de foto de perfil
//
// Busca a foto do WhatsApp de quem conversou recentemente e guarda uma CÓPIA no
// bucket privado `central-avatares` (20261007130000). O link que a Evolution
// devolve é do WhatsApp e expira em dias — guardá-lo seria ter foto quebrada
// na semana seguinte.
//
// No tique, e não no webhook, pelo mesmo motivo do sentimento: o webhook só
// confere e enfileira. Foto é enfeite; se um tique pular, o próximo pega.
//
// Qualquer número Evolution conectado consegue consultar a foto de qualquer
// telefone, então contatos que só falam com a Maia (Meta, que não tem essa
// consulta) também ganham foto.
// ============================================================================

const BUCKET          = 'central-avatares'
const TETO_POR_TIQUE  = 5
const VALIDADE_MS     = 7 * 24 * 60 * 60 * 1000
const ATIVIDADE_DIAS  = 30
const ORCAMENTO_MS    = 8_000

export interface ResultadoAvatar {
  conferidos: number
  com_foto:   number
  sem_foto:   number
  falhados:   number
  interrompido?: string
}

interface Candidato {
  contactId: string
  telefone:  string
  canalId:   string
}

export async function processarAvatares(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoAvatar> {
  const r: ResultadoAvatar = { conferidos: 0, com_foto: 0, sem_foto: 0, falhados: 0 }
  if (!evolutionConfigurada()) return { ...r, interrompido: 'Evolution não configurada' }

  const limite = Date.now() + ORCAMENTO_MS
  const db = supabase.schema('central')

  // Números Evolution ativos: canal → instância. Sem nenhum, não há como
  // consultar foto de ninguém.
  const { data: conexoes, error: erroConexoes } = await db
    .from('channels')
    .select('id, status, channel_connections(provider_instance_id)')
    .eq('organization_id', orgId)
    .eq('provider', 'evolution')
    .eq('active', true)
  if (erroConexoes) throw erroConexoes

  const instancias = new Map<string, string>()
  let qualquer: string | null = null
  for (const c of (conexoes ?? []) as { id: string; status: string; channel_connections: { provider_instance_id: string | null }[] | { provider_instance_id: string | null } | null }[]) {
    const lista = Array.isArray(c.channel_connections) ? c.channel_connections : c.channel_connections ? [c.channel_connections] : []
    const inst = lista[0]?.provider_instance_id
    if (!inst) continue
    instancias.set(c.id, inst)
    if (c.status === 'active' && !qualquer) qualquer = inst
  }
  qualquer ??= instancias.values().next().value ?? null
  if (!qualquer) return { ...r, interrompido: 'nenhum número Evolution conectado' }

  const candidatos = await buscarCandidatos(supabase, orgId)

  for (const cand of candidatos) {
    if (Date.now() > limite) break
    r.conferidos++
    const instancia = instancias.get(cand.canalId) ?? qualquer
    try {
      const achou = await atualizar(supabase, orgId, cand, instancia)
      if (achou) r.com_foto++
      else r.sem_foto++
    } catch (err) {
      r.falhados++
      console.warn('[avatar] falha ao buscar foto', {
        contactId: cand.contactId,
        erro: err instanceof Error ? err.message : String(err),
      })
      // Marca como conferido mesmo assim: um número que a Evolution recusa
      // (telefone inválido, @lid) não pode ocupar a vaga em todo tique.
      await marcar(supabase, cand.contactId, null)
    }
  }

  return r
}

// Contatos com conversa nos últimos 30 dias cuja foto nunca foi conferida ou
// venceu. Os que falaram por último primeiro — são os que estão na tela.
async function buscarCandidatos(supabase: SupabaseClient, orgId: string): Promise<Candidato[]> {
  const desde   = new Date(Date.now() - ATIVIDADE_DIAS * 86_400_000).toISOString()
  const vencido = new Date(Date.now() - VALIDADE_MS).toISOString()

  const { data, error } = await supabase
    .schema('central')
    .from('conversations')
    .select('channel_id, last_message_at, contacts!inner(id, display_phone, avatar_checked_at)')
    .eq('organization_id', orgId)
    .gte('last_message_at', desde)
    .not('contacts.display_phone', 'is', null)
    .or(`avatar_checked_at.is.null,avatar_checked_at.lt.${vencido}`, { referencedTable: 'contacts' })
    .order('last_message_at', { ascending: false })
    .limit(TETO_POR_TIQUE * 4)
  if (error) throw error

  const vistos = new Set<string>()
  const lista: Candidato[] = []
  for (const row of (data ?? []) as unknown as { channel_id: string; contacts: { id: string; display_phone: string | null } }[]) {
    const c = row.contacts
    if (!c?.display_phone || vistos.has(c.id)) continue
    vistos.add(c.id)
    lista.push({ contactId: c.id, telefone: c.display_phone, canalId: row.channel_id })
    if (lista.length >= TETO_POR_TIQUE) break
  }
  return lista
}

async function atualizar(
  supabase: SupabaseClient,
  orgId: string,
  cand: Candidato,
  instancia: string,
): Promise<boolean> {
  const json = await chamarEvolution<{ profilePictureUrl?: string | null }>(
    'POST',
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instancia)}`,
    { number: cand.telefone.replace(/\D/g, '') },
  )
  const url = json?.profilePictureUrl
  if (!url) {
    // Foto escondida ou inexistente: mantém a que já temos (esconder a foto
    // não torna a antiga errada) e só marca a conferência.
    await marcar(supabase, cand.contactId, null)
    return false
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!res.ok) throw new Error(`download da foto falhou: ${res.status}`)
  const tipo = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const bytes = await res.arrayBuffer()

  const path = `${orgId}/${cand.contactId}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: ['image/png', 'image/webp'].includes(tipo) ? tipo : 'image/jpeg', upsert: true })
  if (error) throw error

  // A tela lê pela rota autenticada; o `v` muda a URL quando a foto muda, para
  // o navegador não ficar com a antiga em cache.
  await marcar(supabase, cand.contactId, `/api/central/contacts/${cand.contactId}/foto/?v=${Date.now()}`)
  return true
}

async function marcar(supabase: SupabaseClient, contactId: string, avatarUrl: string | null): Promise<void> {
  const patch: Record<string, unknown> = { avatar_checked_at: new Date().toISOString() }
  if (avatarUrl) patch.avatar_url = avatarUrl
  const { error } = await supabase.schema('central').from('contacts').update(patch).eq('id', contactId)
  if (error) throw error
}
