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
// IDENTIFICADOR DE ANÚNCIO (referral/ctwa_clid da Meta, UTM do Google):
// manda sobre a frase quando disponível (Regra 5). Aceito como parâmetro
// aqui, mas hoje NENHUM provider deste módulo o extrai —
// providers/meta-waba.normalizar.ts não lê referral/ctwa_clid do payload do
// webhook. A pergunta que a aba Leia-me deixa em aberto ("a ferramenta
// recebe o identificador do anúncio junto com a primeira mensagem?") segue
// sem resposta no código: até o normalizador do provider passar a extrair
// esse dado, `identificadorAnuncio` chega sempre `null` na prática, e o
// matcher decide só pela frase.
// ============================================================================

export interface FraseCadastrada {
  origemTag:       string
  fraseExata:      string | null
  campanha:        string
  prontaParaMatch: boolean
}

export interface IdentificadorAnuncio {
  tipo:  'meta_referral' | 'meta_ctwa_clid' | 'google_utm'
  valor: string
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
  identificadorAnuncio?:  IdentificadorAnuncio | null,
): ResultadoMatchCampanha | null {
  // Identificador de anúncio manda sobre a frase — mas sem nenhum provider
  // extraindo isso hoje (ver comentário do topo), este ramo nunca é
  // exercitado em produção. Fica pronto para quando o normalizador passar a
  // repassar o dado: por ora, qualquer chamador que já tenha o identificador
  // deve resolver ORIGEM/campanha por conta própria antes de chegar aqui —
  // este módulo não tem tabela de UTM→campanha para consultar.
  if (identificadorAnuncio) {
    return null
  }

  const texto = textoPrimeiraMensagem.trim()
  if (texto === '') return null

  const casada = frasesCadastradas.find(
    (f) => f.prontaParaMatch && f.fraseExata !== null && f.fraseExata === texto,
  )
  if (!casada) return null

  return { origemTag: casada.origemTag, campanha: casada.campanha }
}
