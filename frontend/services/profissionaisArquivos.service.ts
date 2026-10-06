import { getSupabaseClient } from "@/lib/supabase/client"
import { BUCKET_FOTOS, removerFotoPaciente, validarArquivoFoto } from "@/services/pacientesFoto.service"

// Foto de perfil e foto da assinatura/carimbo do profissional. Mesmo bucket
// PRIVADO das fotos de paciente, na pasta `profissionais/{id}/` — ver
// supabase/migrations/20261006160000_profissionais_foto_assinatura.sql.
//
// A exibição usa getFotoUrlAssinada (pacientesFoto.service), que serve para
// qualquer path do bucket; o banco guarda o PATH, nunca a URL.

export type TipoArquivoProfissional = "foto" | "assinatura"

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export { validarArquivoFoto as validarArquivoProfissional }

/**
 * Envia a imagem e devolve o PATH. Cada troca grava um objeto NOVO (horário no
 * nome) — sobrescrever faria o navegador seguir mostrando a imagem velha. O nome
 * nunca leva o nome do profissional (vazaria em log de CDN e em URL).
 */
export async function enviarArquivoProfissional(
  idProfissional: number,
  tipo: TipoArquivoProfissional,
  file: File
): Promise<string> {
  const problema = validarArquivoFoto(file)
  if (problema) throw new Error(problema)

  const path = `profissionais/${idProfissional}/${tipo}-${Date.now()}.${EXTENSAO_POR_MIME[file.type] ?? "jpg"}`
  const { error } = await getSupabaseClient()
    .storage.from(BUCKET_FOTOS)
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) {
    throw new Error(
      /row-level security|unauthorized|403/i.test(error.message)
        ? "Sem permissão para enviar imagens do profissional (ou a migration 20261006160000 ainda não foi aplicada)."
        : "Não foi possível enviar a imagem."
    )
  }
  return path
}

/** Remove o objeto. Falhar só deixa um órfão no bucket; nunca derruba a troca. */
export function removerArquivoProfissional(path: string): Promise<boolean> {
  return removerFotoPaciente(path)
}
