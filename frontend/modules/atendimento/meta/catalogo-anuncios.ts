import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { AnuncioCatalogado } from '../types/central.types'

// ============================================================================
// Catálogo de anúncios da Meta (central.meta_ad_catalog, 20261019160000)
//
// O clique num anúncio deixa só o ID (18 dígitos) na conversa. Este módulo
// troca o ID pelos nomes de anúncio, conjunto e campanha na Marketing API e
// guarda no catálogo — uma consulta por ID, na primeira vez que ele aparece.
//
// Token: env META_ADS_TOKEN, de um Usuário do Sistema do Business Manager com
// `ads_read` nas contas de anúncio. NÃO é o META_WABA_TOKEN (que fala com o
// WhatsApp e não enxerga anúncio). Fica em env, nunca no banco, pelo mesmo
// motivo de providers/meta-waba.provider.ts. Sem ele, nada é consultado e a
// conversa fica só com o ID — a atribuição em si não depende disto.
//
// Nunca lança para quem chama: nome de campanha é enfeite perto da mensagem.
// Adaptado do integra-connect (backend/src/channels/meta/MetaAdsCatalog.ts).
// ============================================================================

// Mesma versão de providers/meta-waba.provider.ts.
const GRAPH = 'https://graph.facebook.com/v21.0'
const CAMPOS = 'name,effective_status,account_id,adset{id,name},campaign{id,name}'
// Teto de ids por `?ids=` na Graph.
const LOTE = 50
// Linha com lookup_error volta a ser tentada depois disto.
const RETENTAR_ERRO_MS = 24 * 60 * 60 * 1000
// Conversas olhadas pelo tique para achar ID sem catálogo.
const JANELA_PENDENTES_DIAS = 30

type Linha = Omit<AnuncioCatalogado, 'fetched_at'>

// O que a Graph devolve para um anúncio com CAMPOS (tudo opcional: dado externo).
interface AnuncioGraph {
  name?: string
  effective_status?: string
  account_id?: string
  adset?: { id?: string; name?: string }
  campaign?: { id?: string; name?: string }
  error?: { message?: string }
}

export function tokenAnuncios(): string | null {
  return process.env.META_ADS_TOKEN?.trim() || null
}

function linhaResolvida(adId: string, ad: AnuncioGraph): Linha {
  return {
    ad_id:         adId,
    ad_name:       ad.name ?? null,
    ad_status:     ad.effective_status ?? null,
    adset_id:      ad.adset?.id ?? null,
    adset_name:    ad.adset?.name ?? null,
    campaign_id:   ad.campaign?.id ?? null,
    campaign_name: ad.campaign?.name ?? null,
    ad_account_id: ad.account_id ? `act_${ad.account_id}` : null,
    lookup_error:  null,
  }
}

function linhaComErro(adId: string, erro: string): Linha {
  return {
    ad_id: adId, ad_name: null, ad_status: null, adset_id: null, adset_name: null,
    campaign_id: null, campaign_name: null, ad_account_id: null, lookup_error: erro.slice(0, 500),
  }
}

// Token no cabeçalho, não na URL: URL vai parar em log.
async function graphGet(caminho: string, token: string): Promise<{ ok: boolean; json: Record<string, AnuncioGraph> & AnuncioGraph }> {
  const resp = await fetch(`${GRAPH}/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  const json = (await resp.json().catch(() => ({}))) as Record<string, AnuncioGraph> & AnuncioGraph
  return { ok: resp.ok, json }
}

/**
 * Consulta os IDs e grava uma linha por ID no catálogo — resolvida, ou com
 * `lookup_error`. Um lote `?ids=` falha inteiro quando UM id é inacessível, então
 * lote que falha é refeito um a um para isolar o culpado.
 */
export async function consultarAnuncios(supabase: SupabaseClient, adIds: string[]): Promise<Linha[]> {
  const token = tokenAnuncios()
  if (!token || adIds.length === 0) return []

  const linhas: Linha[] = []
  for (let i = 0; i < adIds.length; i += LOTE) {
    const lote = adIds.slice(i, i + LOTE)
    const r = await graphGet(`?ids=${lote.join(',')}&fields=${CAMPOS}`, token)
    if (r.ok) {
      for (const id of lote) {
        linhas.push(r.json[id] ? linhaResolvida(id, r.json[id]) : linhaComErro(id, 'não retornado pela Graph API'))
      }
      continue
    }
    for (const id of lote) {
      const um = await graphGet(`${id}?fields=${CAMPOS}`, token)
      linhas.push(um.ok ? linhaResolvida(id, um.json) : linhaComErro(id, um.json?.error?.message ?? 'erro desconhecido da Graph API'))
    }
  }

  const agora = new Date().toISOString()
  const { error } = await supabase.schema('central').from('meta_ad_catalog')
    .upsert(linhas.map(l => ({ ...l, fetched_at: agora })), { onConflict: 'ad_id' })
  if (error) throw error

  // Conversa que chegou antes do nome: preenche `campanha` se ainda vazia
  // (frase cadastrada, quando casou, já ocupou o campo e vence).
  for (const l of linhas) {
    if (!l.campaign_name) continue
    const { error: e } = await supabase.schema('central').from('conversations')
      .update({ campanha: l.campaign_name })
      .eq('anuncio->>ad_id', l.ad_id)
      .is('campanha', null)
    if (e) throw e
  }

  return linhas
}

/**
 * Caminho ao vivo: chamado quando uma conversa ganha anúncio. Consulta só se o
 * ID ainda não está no catálogo. Nunca lança.
 */
export async function catalogarAnuncio(supabase: SupabaseClient, adId: string | null): Promise<void> {
  if (!adId || !tokenAnuncios()) return
  try {
    const { data, error } = await supabase.schema('central').from('meta_ad_catalog')
      .select('ad_id').eq('ad_id', adId).maybeSingle()
    if (error) throw error
    if (data) return
    const [linha] = await consultarAnuncios(supabase, [adId])
    if (linha?.lookup_error) console.warn('[catalogo anuncios] Graph não resolveu', { adId, erro: linha.lookup_error })
  } catch (err) {
    console.warn('[catalogo anuncios] consulta falhou', { adId, err })
  }
}

export interface ResultadoCatalogo {
  consultados: number
  resolvidos:  number
  interrompido?: string
}

/**
 * Tique: IDs das conversas recentes que ainda não têm catálogo, e os que
 * falharam há mais de um dia. Pega o que o caminho ao vivo perdeu (token que
 * entrou depois, Graph fora, backfill).
 */
export async function catalogarPendentes(supabase: SupabaseClient, orgId: string): Promise<ResultadoCatalogo> {
  if (!tokenAnuncios()) return { consultados: 0, resolvidos: 0, interrompido: 'META_ADS_TOKEN não configurado' }

  const desde = new Date(Date.now() - JANELA_PENDENTES_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const { data: conversas, error } = await supabase.schema('central').from('conversations')
    .select('anuncio->>ad_id')
    .eq('organization_id', orgId)
    .not('anuncio', 'is', null)
    .gte('created_at', desde)
    .limit(500)
  if (error) throw error

  const ids = [...new Set(((conversas ?? []) as { ad_id: string | null }[]).map(c => c.ad_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return { consultados: 0, resolvidos: 0 }

  const { data: catalogo, error: e2 } = await supabase.schema('central').from('meta_ad_catalog')
    .select('ad_id, lookup_error, fetched_at').in('ad_id', ids)
  if (e2) throw e2

  const conhecidos = new Map(((catalogo ?? []) as Pick<AnuncioCatalogado, 'ad_id' | 'lookup_error' | 'fetched_at'>[]).map(c => [c.ad_id, c]))
  const limiteErro = Date.now() - RETENTAR_ERRO_MS
  const pendentes = ids.filter(id => {
    const c = conhecidos.get(id)
    return !c || (c.lookup_error !== null && Date.parse(c.fetched_at) < limiteErro)
  }).slice(0, LOTE)
  if (pendentes.length === 0) return { consultados: 0, resolvidos: 0 }

  const linhas = await consultarAnuncios(supabase, pendentes)
  return { consultados: linhas.length, resolvidos: linhas.filter(l => !l.lookup_error).length }
}
