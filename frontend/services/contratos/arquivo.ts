import "server-only"

// O bucket dos PDFs de contrato do paciente. Único lugar que conhece o nome do
// bucket e a convenção de caminho (molde:
// modules/atendimento/repositories/anexo-storage.repository.ts).
//
// PRIVADO e SÓ SERVICE ROLE (20261008160000): o navegador não lista, não baixa
// e não grava. Quem chama confere a permissão ANTES (services/contratos/acesso).
//
// Caminho: {paciente_id}/{contrato_id}/{original|assinado}-{timestamp}.pdf
// O NOME DO PACIENTE NUNCA ENTRA: o caminho aparece em log de storage e na URL
// assinada. O nome original do arquivo fica em pacientes_contratos, sob RLS.
// A RPC contratos_registrar_arquivo reconfere o prefixo {paciente}/{contrato}/.

export const BUCKET_CONTRATOS = "contratos-pacientes"

/** 5 minutos: a URL só precisa sobreviver ao clique que abre o PDF. */
export const VALIDADE_URL_S = 300

export const TAMANHO_MAXIMO = 10 * 1024 * 1024

export function montarCaminho(pacienteId: number, contratoId: number, qual: "original" | "assinado"): string {
  return `${pacienteId}/${contratoId}/${qual}-${Date.now()}.pdf`
}

/** Os primeiros bytes de um PDF são "%PDF-". O MIME do navegador não prova nada. */
export function pareceUmPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}
