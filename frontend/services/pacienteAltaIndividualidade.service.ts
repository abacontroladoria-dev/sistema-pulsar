"use client"

import { getSupabaseClient } from "@/lib/supabase/client"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import type { AltaIndividualidade, AltaIndividualidadeForm, PacienteAlta, PacienteAltaForm } from "@/types/laudos"

// Tabelas cadastros_pacientes_altas (1:N) e
// cadastros_pacientes_altas_individualidades (0-ou-1 por paciente).
// Ver supabase/migrations/20260826140000, 140100 e o rename em 140400.
//
// São tabelas DIFERENTES, com sequências de id próprias — e por isso entidades
// de auditoria diferentes (`alta` e `alta_individualidade`). Gravar as duas sob
// o mesmo rótulo, como se fazia até 20260826140300, misturava a trilha da alta
// nº 3 com a da individualidade nº 3.

const TB_ALTAS = "cadastros_pacientes_altas"
const TB_INDIVIDUALIDADES = "cadastros_pacientes_altas_individualidades"

// ─── READ ─────────────────────────────────────────────────────────────────────

/** Busca os dados de individualidades de um paciente (0 ou 1 registro). */
export async function getAltaIndividualidade(
  pacienteId: number
): Promise<{ data: AltaIndividualidade | null; error: string | null }> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from(TB_INDIVIDUALIDADES)
    .select("*")
    .eq("id_paciente_pulsar", pacienteId)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as AltaIndividualidade | null, error: null }
}

/** Busca todas as altas de um paciente. */
export async function getAltasDoPaciente(
  pacienteId: number
): Promise<{ data: PacienteAlta[]; error: string | null }> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from(TB_ALTAS)
    .select("*")
    // Alta "excluída" continua no banco (soft-delete, 20260827100000) e
    // CONTINUA na lista — só marcada. A tela é quem decide como mostrar
    // (badge "Excluída"), não a query.
    .eq("id_paciente_pulsar", pacienteId)
    .order("data_alta", { ascending: false })

  if (error) return { data: [], error: error.message }
  return { data: data as PacienteAlta[], error: null }
}

export interface AltaAtiva {
  idAlta: number
  especialidade: string
}

/**
 * Altas ATIVAS (não excluídas) de vários pacientes de uma vez — para a
 * Ocupação de Paciente deixar de ofertar a especialidade sem uma consulta por
 * paciente. Mesmo papel de getSuspensoesVigentesPorPacientes. Erro (inclusive
 * falta de permissão) devolve mapa vazio: a tela segue, sem o bloqueio.
 */
export async function getAltasAtivasPorPacientes(
  pacienteIds: number[]
): Promise<Map<number, AltaAtiva[]>> {
  const mapa = new Map<number, AltaAtiva[]>()
  if (pacienteIds.length === 0) return mapa

  const { data, error } = await getSupabaseClient()
    .from(TB_ALTAS)
    .select("id_alta, id_paciente_pulsar, especialidade_alta")
    .in("id_paciente_pulsar", pacienteIds)
    .eq("ativo", true)

  if (error) {
    console.error("Erro ao buscar altas ativas em lote:", error)
    return mapa
  }

  for (const linha of (data ?? []) as { id_alta: number; id_paciente_pulsar: number; especialidade_alta: string | null }[]) {
    if (!linha.especialidade_alta) continue
    const item: AltaAtiva = { idAlta: linha.id_alta, especialidade: linha.especialidade_alta }
    const lista = mapa.get(linha.id_paciente_pulsar)
    if (lista) lista.push(item)
    else mapa.set(linha.id_paciente_pulsar, [item])
  }
  return mapa
}

// ─── UPSERT INDIVIDUALIDADE ───────────────────────────────────────────────────

/** Salva (cria ou atualiza) as individualidades de um paciente. */
export async function salvarAltaIndividualidade(
  pacienteId: number,
  pacienteNome: string,
  form: AltaIndividualidadeForm,
  registroAnterior: AltaIndividualidade | null
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const payload = {
    id_paciente_pulsar: pacienteId,
    comp_agressivo: form.comp_agressivo,
    paciente_verbal: form.paciente_verbal,
    ambiente_natural: form.ambiente_natural,
    nivel_suporte: form.nivel_suporte,
    origem_judicial: form.origem_judicial,
  }

  const { data: salvo, error } = await supabase
    .from(TB_INDIVIDUALIDADES)
    .upsert(payload, { onConflict: "id_paciente_pulsar" })
    .select("id_individualidade")
    .single()

  if (error) return { error: error.message }

  const registroId = (salvo as { id_individualidade: number }).id_individualidade

  const acao = registroAnterior ? "editar" : "criar"
  const antes = registroAnterior
    ? {
        comp_agressivo: registroAnterior.comp_agressivo,
        paciente_verbal: registroAnterior.paciente_verbal,
        ambiente_natural: registroAnterior.ambiente_natural,
        nivel_suporte: registroAnterior.nivel_suporte,
        origem_judicial: registroAnterior.origem_judicial,
      }
    : null

  void registrarAuditoria({
    tabela: "alta_individualidade",
    registroId,
    acao,
    pacienteId,
    pacienteNome,
    antes,
    depois: payload,
  })

  return { error: null }
}

// ─── CRUD ALTAS ───────────────────────────────────────────────────────────────

export async function criarAlta(
  pacienteId: number,
  pacienteNome: string,
  form: PacienteAltaForm
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const payload = {
    id_paciente_pulsar: pacienteId,
    data_alta: form.data_alta,
    especialidade_alta: form.especialidade_alta,
    arquivo_alta_path: form.arquivo_alta_path,
  }

  const { data, error } = await supabase
    .from(TB_ALTAS)
    .insert([payload])
    .select("id_alta")
    .single()

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta",
    registroId: data.id_alta,
    acao: "criar",
    pacienteId,
    pacienteNome,
    antes: null,
    depois: payload,
  })

  return { error: null }
}

/**
 * "Exclui" a alta marcando ativo = false. A linha NUNCA é apagada.
 *
 * Alta é registro clínico: decisão do usuário em 2026-08-27 de que nada de
 * laudo/alta sai do banco. O privilégio de DELETE está revogado no próprio
 * banco (20260827100000) — isto aqui é a interface para essa regra, não a
 * única barreira.
 */
export async function excluirAlta(
  pacienteId: number,
  pacienteNome: string,
  alta: PacienteAlta
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from(TB_ALTAS)
    .update({ ativo: false })
    .eq("id_alta", alta.id_alta)

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta",
    registroId: alta.id_alta,
    acao: "excluir",
    pacienteId,
    pacienteNome,
    antes: { ...alta },
    depois: null,
  })

  return { error: null }
}

/**
 * Reverte a exclusão marcando ativo = true de novo. Não valida se já existe
 * outra alta ativa na mesma especialidade — a mesma folga que já existe hoje
 * entre altas ativas (o combobox de "nova alta" filtra pelo front, o banco
 * não impede duas linhas ativas na mesma especialidade).
 */
export async function reativarAlta(
  pacienteId: number,
  pacienteNome: string,
  alta: PacienteAlta
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient()

  const { error } = await supabase
    .from(TB_ALTAS)
    .update({ ativo: true })
    .eq("id_alta", alta.id_alta)

  if (error) return { error: error.message }

  void registrarAuditoria({
    tabela: "alta",
    registroId: alta.id_alta,
    acao: "reativar",
    pacienteId,
    pacienteNome,
    antes: { ...alta },
    depois: { ...alta, ativo: true },
  })

  return { error: null }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────

/** Faz upload do anexo da alta e retorna o path no Storage. */
export async function uploadArquivoAlta(
  pacienteId: number,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const supabase = getSupabaseClient()
  const ext = file.name.split(".").pop() ?? "pdf"
  const path = `altas/${pacienteId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from("laudos-pacientes")
    .upload(path, file, { upsert: false })

  if (error) return { path: null, error: error.message }
  return { path, error: null }
}

/** Gera URL assinada temporária para anexo da alta. */
export async function getUrlAssinadaAlta(path: string): Promise<string | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage
    .from("laudos-pacientes")
    .createSignedUrl(path, 900) // 15 minutos de validade

  if (error || !data?.signedUrl) {
    console.error("Erro ao gerar URL da alta:", error)
    return null
  }
  return data.signedUrl
}
