"use client"

import { getSupabaseClient } from "@/lib/supabase/client"
import { getUsuarioAtual } from "@/lib/supabase/usuarioAtual"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import type { PacienteAltaClinica, PacienteAltaClinicaForm } from "@/types/laudos"

// Tabela cadastros_pacientes_alta_clinica (histórico; a linha mais recente
// com ativo=true é o estado "vigente"). Ver supabase/migrations/20260921200000.
//
// Espelha pacienteSuspensaoTemporaria.service.ts: mesmo padrão de soft delete,
// mesmo formato de trilha de auditoria, "criado por" gravado na própria linha.
// Diferença: aqui não há "criar mais uma" livremente — a tela só oferece
// registrar quando não existe alta clínica vigente, e excluir/reativar a
// vigente (ver getAltaClinicaVigente).

const TB_ALTA_CLINICA = "cadastros_pacientes_alta_clinica"

// ─── READ ─────────────────────────────────────────────────────────────────────

/** Busca o histórico completo de alta clínica de um paciente. */
export async function getAltasClinicasDoPaciente(
  pacienteId: number
): Promise<{ data: PacienteAltaClinica[]; error: string | null }> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from(TB_ALTA_CLINICA)
    .select("*")
    .eq("id_paciente_pulsar", pacienteId)
    .order("criado_em", { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: data as PacienteAltaClinica[], error: null }
}

/** A alta clínica vigente do paciente, se houver: a mais recente com ativo=true. */
export function altaClinicaVigente(altas: PacienteAltaClinica[]): PacienteAltaClinica | null {
  return altas.find((a) => a.ativo) ?? null
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function criarAltaClinica(
  pacienteId: number,
  pacienteNome: string,
  form: PacienteAltaClinicaForm
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()
  const usuario = await getUsuarioAtual()

  const payload = {
    id_paciente_pulsar: pacienteId,
    data_alta_clinica: form.data_alta_clinica,
    arquivo_alta_clinica_path: form.arquivo_alta_clinica_path,
    criado_por_usuario_id: usuario.id,
    criado_por_usuario_nome: usuario.nome,
  }

  const { data, error } = await supabase
    .from(TB_ALTA_CLINICA)
    .insert([payload])
    .select("id_alta_clinica")
    .single()

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta_clinica",
    registroId: data.id_alta_clinica,
    acao: "criar",
    pacienteId,
    pacienteNome,
    antes: null,
    depois: payload,
  })

  return { error: null }
}

/**
 * "Exclui" (reverte) a alta clínica marcando ativo = false. A linha NUNCA é
 * apagada — mesma regra de alta/suspensão (registro clínico), DELETE
 * revogado no banco (20260921200100).
 */
export async function excluirAltaClinica(
  pacienteId: number,
  pacienteNome: string,
  altaClinica: PacienteAltaClinica
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from(TB_ALTA_CLINICA)
    .update({ ativo: false })
    .eq("id_alta_clinica", altaClinica.id_alta_clinica)

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta_clinica",
    registroId: altaClinica.id_alta_clinica,
    acao: "excluir",
    pacienteId,
    pacienteNome,
    antes: { ...altaClinica },
    depois: null,
  })

  return { error: null }
}

/** Reverte a exclusão marcando ativo = true de novo. */
export async function reativarAltaClinica(
  pacienteId: number,
  pacienteNome: string,
  altaClinica: PacienteAltaClinica
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from(TB_ALTA_CLINICA)
    .update({ ativo: true })
    .eq("id_alta_clinica", altaClinica.id_alta_clinica)

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta_clinica",
    registroId: altaClinica.id_alta_clinica,
    acao: "reativar",
    pacienteId,
    pacienteNome,
    antes: { ...altaClinica },
    depois: { ...altaClinica, ativo: true },
  })

  return { error: null }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────

// Mesmo bucket privado de alta/suspensão (laudos-pacientes): acesso só por
// URL assinada de curta duração, nunca por URL pública. Prefixo próprio
// (altas-clinicas/) só para não misturar com os outros dois na listagem do
// bucket — a policy de storage.objects já cobre qualquer prefixo sob a
// permissão `cadastros_pacientes` (ver 20260921200000).
const BUCKET_LAUDOS = "laudos-pacientes"

/** Faz upload do anexo da alta clínica e retorna o path no Storage. */
export async function uploadArquivoAltaClinica(
  pacienteId: number,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const supabase = getSupabaseClient()
  const ext = file.name.split(".").pop() ?? "pdf"
  const path = `altas-clinicas/${pacienteId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET_LAUDOS)
    .upload(path, file, { upsert: false })

  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

/** Gera URL assinada temporária para anexo da alta clínica. */
export async function getUrlAssinadaAltaClinica(path: string): Promise<string | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage
    .from(BUCKET_LAUDOS)
    .createSignedUrl(path, 900) // 15 minutos de validade

  if (error || !data?.signedUrl) {
    console.error("Erro ao gerar URL da alta clínica:", error)
    return null
  }
  return data.signedUrl
}
