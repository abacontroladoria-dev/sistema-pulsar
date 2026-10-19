// ============================================================================
// Matcher de campanha — Regra 5 da aba Regras
// (comercial_configuracao-crm-maia_2026-09-21_v4.xlsx)
//
// "Campanha não é tag: é frase cadastrada + campo." O SISTEMA compara a
// primeira mensagem da conversa com as frases de central.campaign_phrases
// (pronta_para_match = true): se casar, aplica a tag de ORIGEM e grava o
// nome da campanha no campo conversations.campanha — sem custo de LLM, antes
// do turno do agente.
//
// Se NADA casar, este módulo devolve null e quem chama segue o fluxo normal:
// a Maia reconhece o texto pré-preenchido pelo fallback da Regra 5b (prefixos
// "Gostaria de", "Vim do" etc — instrução em agente/tags.ts), aplica ORIGEM
// e deixa o campo Campanha vazio. Esse fallback é comportamento do MODELO,
// não deste módulo: não há nada determinístico para replicar aqui além do
// que a instrução já cobre.
//
// IDENTIFICADOR DE ANÚNCIO (Regra 5: manda sobre a frase quando existe). Desde
// 19/10 os dois normalizadores extraem o clique do anúncio — Meta pelo
// `referral`, Evolution pelo `contextInfo.externalAdReply` — e ele chega aqui
// como `AnuncioDaMensagem`. Anúncio PAGO fixa a ORIGEM em meta_ads, qualquer
// que seja o texto; a campanha continua vindo da frase cadastrada quando ela
// casa. O nome da campanha da Meta (Marketing API) chega depois, pelo
// catálogo (meta/catalogo-anuncios.ts), que preenche `campanha` se ainda
// estiver vazia.
// ============================================================================

import type { AnuncioDaMensagem, TagDefinition } from '../types/central.types'

export interface FraseCadastrada {
  origemTag:       string
  fraseExata:      string | null
  campanha:        string
  prontaParaMatch: boolean
}

export interface ResultadoMatchCampanha {
  origemTag: string
  campanha:  string
}

/**
 * Compara a primeira mensagem com o catálogo de frases cadastradas.
 * Comparação exata (não normaliza acento/caixa): a frase é a que o anúncio
 * pré-preenche literalmente no WhatsApp, e o marketing cadastra exatamente
 * esse texto (aba Frases de campanha). Uma comparação "aproximada" correria
 * o risco de casar uma mensagem digitada à mão com uma campanha errada.
 */
export function casarPrimeiraMensagem(
  textoPrimeiraMensagem:  string,
  frasesCadastradas:      readonly FraseCadastrada[],
): ResultadoMatchCampanha | null {
  const texto = textoPrimeiraMensagem.trim()
  if (texto === '') return null

  const casada = frasesCadastradas.find(
    (f) => f.prontaParaMatch && f.fraseExata !== null && f.fraseExata === texto,
  )
  if (!casada) return null

  return { origemTag: casada.origemTag, campanha: casada.campanha }
}

// ----------------------------------------------------------------------------
// ORIGEM sem campanha cadastrada — Regra 5b + Contato Direto (15/10/2026)
//
// Até aqui, sem frase casada, a ORIGEM ficava para a Maia (description do
// campo `origem` em agente/tags.ts). Ela nunca a aplicou: em 30 dias, nos dois
// números, `registrar_tags` não foi chamada uma única vez, e nenhuma conversa
// tinha ORIGEM. A regra é determinística, então quem decide é o sistema:
//
//   - primeira mensagem com cara de texto pré-preenchido por anúncio (os
//     prefixos da Regra 5b) → meta_ads, ou site / linktree se a palavra
//     aparecer;
//   - o resto → contato_direto ("quando não vem de anúncio/site/Meta Ads/
//     Google Ads/Linktree", regra do comercial em 15/10).
//
// A Maia ainda pode trocar depois, se a família contar (indicação médica,
// escola): o grupo é single e registrar_tags sobrescreve.
// ----------------------------------------------------------------------------

const PREFIXOS_ANUNCIO = [
  'gostaria de', 'vim do', 'vim pelo', 'ola vim', 'quero saber sobre', 'tenho interesse em',
] as const

export type OrigemSemCampanha = 'meta_ads' | 'site' | 'linktree' | 'contato_direto'

export function origemSemCampanha(textoPrimeiraMensagem: string): OrigemSemCampanha {
  // Sem acento, sem pontuação, espaço simples: "Olá! Vim pelo site" → "ola vim pelo site".
  const t = textoPrimeiraMensagem
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!PREFIXOS_ANUNCIO.some((p) => t.startsWith(p))) return 'contato_direto'
  if (/\blinktree\b/.test(t)) return 'linktree'
  if (/\bsite\b/.test(t)) return 'site'
  return 'meta_ads'
}

// Anúncio pago primeiro (Regra 5: o identificador manda); depois a frase
// cadastrada (traz a campanha); sem as duas, a regra acima.
export function resolverOrigem(
  textoPrimeiraMensagem: string,
  frasesCadastradas:     readonly FraseCadastrada[],
  anuncio?:              AnuncioDaMensagem | null,
): { origemTag: string; campanha: string | null } {
  const casada = casarPrimeiraMensagem(textoPrimeiraMensagem, frasesCadastradas)
  if (anuncio?.pago) return { origemTag: 'meta_ads', campanha: casada?.campanha ?? null }
  if (casada) return casada
  return { origemTag: origemSemCampanha(textoPrimeiraMensagem), campanha: null }
}

// A conversa já tem alguma tag do grupo ORIGEM (posta pelo sistema, pela Maia
// ou pela atendente)? Quem decide a origem só age quando não tem.
export function temOrigem(tags: readonly string[] | null, porGrupo: Map<string, TagDefinition[]>): boolean {
  const doGrupo = new Set((porGrupo.get('origem') ?? []).map(t => t.key))
  return (tags ?? []).some(t => doGrupo.has(t))
}

// Anúncio pago pode decidir a ORIGEM? Sim quando não há nenhuma, ou quando a
// que há é contato_direto — o "nenhum sinal" da regra de texto. Até 19/10 todo
// lead de anúncio da Evolution caía nela (12 de 12 em 14 dias), porque o texto
// pré-preenchido do anúncio nem sempre começa com os prefixos da Regra 5b.
// Origem explícita (site, indicação, a escolhida pela atendente) não é tocada.
export function origemAceitaAnuncio(tags: readonly string[] | null, porGrupo: Map<string, TagDefinition[]>): boolean {
  const doGrupo = new Set((porGrupo.get('origem') ?? []).map(t => t.key))
  return (tags ?? []).filter(t => doGrupo.has(t)).every(t => t === 'contato_direto')
}
