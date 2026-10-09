import { getSupabaseClient } from "@/lib/supabase/client"

// Foto de perfil do paciente. Bucket PRIVADO (LGPD) — ver
// supabase/migrations/20260826100400_storage_pacientes_fotos.sql.
//
// Consequência de ser privado: `getPublicUrl` NÃO funciona (devolve uma URL que
// responde 400, falhando em silêncio). Toda exibição passa por URL assinada, que
// expira — por isso o banco guarda o PATH do objeto, nunca a URL.

export const BUCKET_FOTOS = "pacientes-fotos"

export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024
export const MIMES_ACEITOS = ["image/jpeg", "image/png", "image/webp"]

const TTL_SEGUNDOS = 900 // 15 minutos
/** Renova antes de expirar de fato, para uma aba aberta há muito tempo não quebrar. */
const MARGEM_RENOVACAO_MS = 5 * 60 * 1000

const cacheUrls = new Map<string, { url: string; expiraEm: number }>()

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

/** Mesma validação que o bucket faz, mas antes de gastar o upload. */
export function validarArquivoFoto(file: File): string | null {
  if (!MIMES_ACEITOS.includes(file.type)) {
    return "Formato não aceito. Use JPEG, PNG ou WebP."
  }
  if (file.size > TAMANHO_MAXIMO_BYTES) {
    return "A imagem passa de 5 MB. Escolha um arquivo menor."
  }
  return null
}

/**
 * Envia a foto e devolve o PATH do objeto.
 *
 * O path segue `{id_paciente}/{arquivo}` — a policy de INSERT exige que o
 * primeiro segmento seja numérico. O nome do arquivo nunca é o nome do paciente:
 * nome de arquivo vaza dado pessoal em log de CDN e em URL.
 *
 * Cada troca grava um objeto NOVO (timestamp no nome) em vez de sobrescrever o
 * mesmo path — sobrescrever faria o cache do navegador continuar servindo a
 * foto antiga.
 */
export async function uploadFotoPaciente(
  idPaciente: number,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const problema = validarArquivoFoto(file)
  if (problema) return { path: null, error: problema }

  const supabase = getSupabaseClient()
  const extensao = EXTENSAO_POR_MIME[file.type] ?? "jpg"
  const path = `${idPaciente}/foto-${Date.now()}.${extensao}`

  const { error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(path, file, { upsert: false, contentType: file.type })

  if (error) {
    console.error("Erro ao enviar foto do paciente:", error)
    return { path: null, error: error.message }
  }

  return { path, error: null }
}

// Pedidos em voo, por path: quem pede a mesma foto enquanto o lote ainda não
// voltou espera o lote, em vez de abrir uma requisição própria.
const emVoo = new Map<string, Promise<string | null>>()

function urlValidaEmCache(path: string): string | null {
  const cacheada = cacheUrls.get(path)
  if (cacheada && cacheada.expiraEm - Date.now() > MARGEM_RENOVACAO_MS) return cacheada.url
  return null
}

/**
 * Assina várias fotos numa requisição só (uma página da listagem). Chamado
 * antes de os avatares montarem: cada `getFotoUrlAssinada` dali em diante cai
 * no cache ou no pedido em voo, e a página faz 1 ida ao Storage em vez de 75.
 */
export function precarregarFotosAssinadas(paths: string[]): void {
  const faltam = [...new Set(paths)].filter((p) => !urlValidaEmCache(p) && !emVoo.has(p))
  if (faltam.length === 0) return

  const lote = getSupabaseClient()
    .storage.from(BUCKET_FOTOS)
    .createSignedUrls(faltam, TTL_SEGUNDOS)
    .then(({ data, error }) => {
      if (error) console.error("Erro ao gerar URLs das fotos:", error)
      const expiraEm = Date.now() + TTL_SEGUNDOS * 1000
      const porPath = new Map<string, string>()
      for (const item of data ?? []) {
        if (item.path && item.signedUrl && !item.error) {
          porPath.set(item.path, item.signedUrl)
          cacheUrls.set(item.path, { url: item.signedUrl, expiraEm })
        }
      }
      return porPath
    })
    .finally(() => {
      for (const p of faltam) emVoo.delete(p)
    })

  for (const p of faltam) emVoo.set(p, lote.then((m) => m.get(p) ?? null))
}

/** URL assinada, com cache em memória enquanto ainda houver margem de validade. */
export async function getFotoUrlAssinada(path: string): Promise<string | null> {
  const cacheada = urlValidaEmCache(path)
  if (cacheada) return cacheada
  const pendente = emVoo.get(path)
  if (pendente) return pendente

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .createSignedUrl(path, TTL_SEGUNDOS)

  if (error || !data?.signedUrl) {
    // Objeto apagado por fora, path órfão: não é erro de tela. Quem chama cai
    // no fallback de iniciais.
    console.error("Erro ao gerar URL da foto:", error)
    cacheUrls.delete(path)
    return null
  }

  cacheUrls.set(path, {
    url: data.signedUrl,
    expiraEm: Date.now() + TTL_SEGUNDOS * 1000,
  })
  return data.signedUrl
}

/**
 * Remove o objeto. Usada para apagar a foto ANTIGA depois que a nova já entrou —
 * falhar aqui deixa um órfão no bucket, mas não pode derrubar a troca de foto,
 * que já deu certo.
 */
export async function removerFotoPaciente(path: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.storage.from(BUCKET_FOTOS).remove([path])

  cacheUrls.delete(path)

  if (error) {
    console.error("Erro ao remover foto do paciente:", error)
    return false
  }

  return true
}
