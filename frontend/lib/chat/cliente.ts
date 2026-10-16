import { getSupabaseClient } from '@/lib/supabase/client'

// ============================================================================
// Chat da equipe — chamadas do navegador (migrations 20261016120000,
// 20261016150000 e 20261016170000)
//
// Leitura direta das tabelas, sob RLS (só os fios de quem está logado). Escrita
// SÓ pelas RPCs chat_*: as tabelas não aceitam INSERT/UPDATE de authenticated,
// e é dentro das RPCs que se confere permissão e participação.
//
// Sem rota de API no meio: a fronteira é o banco, e o pool do PostgREST é o
// mesmo de qualquer jeito.
// ============================================================================

export const EVENTO_CHAT_MENSAGEM          = 'chat:mensagem'           // detail: MensagemChat (INSERT do tempo real)
export const EVENTO_CHAT_MENSAGEM_ALTERADA = 'chat:mensagem-alterada'  // detail: MensagemChat (UPDATE: editou, apagou, reagiu)
export const EVENTO_CHAT_LEITURA           = 'chat:leitura'            // detail: LeituraChat (alguém leu um fio)
export const EVENTO_CHAT_ALTERADO          = 'chat:alterado'           // leu/enviou: recontar não lidas

export function avisarChatAlterado(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_CHAT_ALTERADO))
}

export interface AnexoChat {
  path:    string
  nome:    string
  tipo:    string
  tamanho: number | null
}

export interface MensagemChat {
  id:          string
  conversa_id: string
  autor_id:    string
  corpo:       string
  criada_em:   string
  responde_a:  string | null
  editada_em:  string | null
  apagada_em:  string | null
  /** {"👍": ["usuario_id", …]} */
  reacoes:     Record<string, string[]>
  anexos:      AnexoChat[]
}

export interface LeituraChat {
  conversa_id: string
  usuario_id:  string
  lido_ate:    string | null
}

export interface ConversaLista {
  id:                 string
  outro_id:           string | null
  outro_nome:         string
  outro_ativo:        boolean
  ultima_corpo:       string | null
  ultima_autor_id:    string | null
  ultima_mensagem_em: string | null
  nao_lidas:          number
}

export interface PessoaChat { id: string; nome: string }

export const POR_PAGINA = 50
export const MAX_CARACTERES = 4000
export const MAX_ANEXOS = 10
export const MAX_BYTES_ANEXO = 25 * 1024 * 1024 // o file_size_limit do bucket
const BUCKET = 'chat-anexos'
const COLUNAS = 'id, conversa_id, autor_id, corpo, criada_em, responde_a, editada_em, apagada_em, reacoes, anexos'

// A mensagem do RAISE da RPC já é frase para gente ("essa pessoa não está
// ativa no Pulsar"); o resto vira uma frase genérica.
function erroLegivel(e: { message?: string; code?: string } | null, padrao: string): Error {
  if (e?.code === '42501' || e?.code === '22023') return new Error(e.message ?? padrao)
  return new Error(padrao)
}

/** Completa o que o tempo real pode trazer faltando (linha de antes da 170000). */
export function normalizarMensagem(m: Partial<MensagemChat> & Pick<MensagemChat, 'id'>): MensagemChat {
  return {
    conversa_id: '', autor_id: '', corpo: '', criada_em: new Date(0).toISOString(),
    responde_a: null, editada_em: null, apagada_em: null,
    ...m,
    reacoes: m.reacoes && typeof m.reacoes === 'object' ? m.reacoes : {},
    anexos:  Array.isArray(m.anexos) ? m.anexos : [],
  }
}

export async function listarConversas(): Promise<ConversaLista[]> {
  const { data, error } = await getSupabaseClient().rpc('chat_conversas_lista')
  if (error) throw erroLegivel(error, 'Não foi possível carregar as conversas.')
  return (data ?? []) as ConversaLista[]
}

export async function listarPessoas(): Promise<PessoaChat[]> {
  const { data, error } = await getSupabaseClient().rpc('chat_pessoas')
  if (error) throw erroLegivel(error, 'Não foi possível carregar a equipe.')
  return (data ?? []) as PessoaChat[]
}

export async function abrirConversaDireta(outroId: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('chat_abrir_direta', { p_outro: outroId })
  if (error || !data) throw erroLegivel(error, 'Não foi possível abrir a conversa.')
  return data as string
}

/** Mensagens do fio, das mais antigas para as mais novas. `antesDe` pagina para trás; `depoisDe`, para a frente. */
export async function listarMensagens(
  conversaId: string,
  opcoes: { antesDe?: string; depoisDe?: string } = {},
): Promise<MensagemChat[]> {
  let q = getSupabaseClient()
    .from('chat_mensagens')
    .select(COLUNAS)
    .eq('conversa_id', conversaId)
  if (opcoes.antesDe)  q = q.lt('criada_em', opcoes.antesDe)
  if (opcoes.depoisDe) q = q.gt('criada_em', opcoes.depoisDe)
  const { data, error } = await q.order('criada_em', { ascending: false }).limit(POR_PAGINA)
  if (error) throw erroLegivel(error, 'Não foi possível carregar as mensagens.')
  return ((data ?? []) as MensagemChat[]).map(normalizarMensagem).reverse()
}

/** Mensagens citadas que ainda não estão carregadas (respostas a algo antigo). */
export async function buscarMensagens(ids: string[]): Promise<MensagemChat[]> {
  if (ids.length === 0) return []
  const { data, error } = await getSupabaseClient().from('chat_mensagens').select(COLUNAS).in('id', ids)
  if (error) return []
  return ((data ?? []) as MensagemChat[]).map(normalizarMensagem)
}

/** Até onde cada participante leu — o "Visto". */
export async function listarLeituras(conversaId: string): Promise<LeituraChat[]> {
  const { data, error } = await getSupabaseClient()
    .from('chat_membros')
    .select('conversa_id, usuario_id, lido_ate')
    .eq('conversa_id', conversaId)
  if (error) return []
  return (data ?? []) as LeituraChat[]
}

export async function enviarMensagem(
  conversaId: string,
  corpo: string,
  extras: { respondeA?: string | null; anexos?: AnexoChat[] } = {},
): Promise<MensagemChat> {
  const { data, error } = await getSupabaseClient().rpc('chat_enviar', {
    p_conversa:   conversaId,
    p_corpo:      corpo,
    p_responde_a: extras.respondeA ?? null,
    p_anexos:     extras.anexos ?? [],
  })
  if (error || !data) throw erroLegivel(error, 'A mensagem não foi enviada.')
  avisarChatAlterado()
  return normalizarMensagem(data as MensagemChat)
}

export async function editarMensagem(id: string, corpo: string): Promise<MensagemChat> {
  const { data, error } = await getSupabaseClient().rpc('chat_editar', { p_mensagem: id, p_corpo: corpo })
  if (error || !data) throw erroLegivel(error, 'A mensagem não foi editada.')
  return normalizarMensagem(data as MensagemChat)
}

/** Apaga a mensagem e, depois, os arquivos dela (o banco não apaga do Storage). */
export async function apagarMensagem(m: MensagemChat): Promise<MensagemChat> {
  const { data, error } = await getSupabaseClient().rpc('chat_apagar', { p_mensagem: m.id })
  if (error || !data) throw erroLegivel(error, 'A mensagem não foi apagada.')
  void removerAnexos(m.anexos.map(a => a.path))
  avisarChatAlterado()
  return normalizarMensagem(data as MensagemChat)
}

export async function reagir(id: string, emoji: string): Promise<MensagemChat> {
  const { data, error } = await getSupabaseClient().rpc('chat_reagir', { p_mensagem: id, p_emoji: emoji })
  if (error || !data) throw erroLegivel(error, 'A reação não foi registrada.')
  return normalizarMensagem(data as MensagemChat)
}

export async function marcarConversaLida(conversaId: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc('chat_marcar_lida', { p_conversa: conversaId })
  if (!error) avisarChatAlterado()
}

export async function contarNaoLidas(): Promise<number | null> {
  const { data, error } = await getSupabaseClient().rpc('chat_nao_lidas')
  return error ? null : (data as number)
}

// ── Anexos ──────────────────────────────────────────────────────────────────

// A chave no Storage aceita pouca coisa: sem acento, sem espaço. O nome de
// verdade vai em `nome`, que é o que a tela mostra.
function nomeSeguro(nome: string): string {
  const limpo = nome.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (limpo || 'arquivo').slice(-80)
}

/** Sobe o arquivo na pasta de quem envia, dentro do fio. */
export async function subirAnexo(conversaId: string, euId: string, arquivo: File): Promise<AnexoChat> {
  if (arquivo.size > MAX_BYTES_ANEXO) throw new Error(`${arquivo.name} passa de 25 MB.`)
  const path = `${conversaId}/${euId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`
  const { error } = await getSupabaseClient().storage.from(BUCKET).upload(path, arquivo, {
    contentType: arquivo.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(`${arquivo.name} não subiu. Tente de novo.`)
  return { path, nome: arquivo.name, tipo: arquivo.type, tamanho: arquivo.size }
}

export async function removerAnexos(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await getSupabaseClient().storage.from(BUCKET).remove(paths).catch(() => undefined)
}

// URL assinada por 1 h, guardada até 5 min antes de vencer: a mesma imagem
// aparece de novo a cada rolagem sem nova assinatura.
const URL_VALIDADE_S = 3600
const urls = new Map<string, { url: string; vence: number }>()

export async function urlAnexo(path: string, baixar?: string): Promise<string | null> {
  const chave = baixar ? `${path}#${baixar}` : path
  const guardada = urls.get(chave)
  if (guardada && guardada.vence > Date.now()) return guardada.url
  const { data, error } = await getSupabaseClient().storage
    .from(BUCKET)
    .createSignedUrl(path, URL_VALIDADE_S, baixar ? { download: baixar } : undefined)
  if (error || !data?.signedUrl) return null
  urls.set(chave, { url: data.signedUrl, vence: Date.now() + (URL_VALIDADE_S - 300) * 1000 })
  return data.signedUrl
}

export const ehImagem = (a: Pick<AnexoChat, 'tipo'>) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(a.tipo)

export function tamanhoLegivel(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}
