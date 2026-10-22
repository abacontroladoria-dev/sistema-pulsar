import { getSupabaseClient } from "@/lib/supabase/client"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import type { Convenio, ConvenioEdit, PlanoSaude, PlanoSaudeEdit, PlanoSaudeComConvenio } from "@/types/convenio"

const TABLE_CONVENIOS = "convenios"
const TABLE_PLANOS = "planos_saude"

export async function listarConvenios(): Promise<Convenio[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE_CONVENIOS).select("*").order("nome")
  if (error) throw new Error(error.message)
  return (data ?? []) as Convenio[]
}

export async function criarConvenio(input: ConvenioEdit): Promise<Convenio> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE_CONVENIOS).insert(input).select("*").single()
  if (error) throw new Error(error.message)

  const convenio = data as Convenio
  await registrarAuditoria({
    tabela: "convenio",
    registroId: convenio.id,
    acao: "criar",
    convenioNome: convenio.nome,
    alvoNome: convenio.nome,
    depois: convenio as unknown as Record<string, unknown>,
  })
  return convenio
}

export async function atualizarConvenio(id: number, input: Partial<ConvenioEdit>): Promise<Convenio> {
  const sb = getSupabaseClient()
  // O "antes" tem que ser lido antes da escrita, senão a trilha compara o
  // registro com ele mesmo.
  const { data: antes } = await sb.from(TABLE_CONVENIOS).select("*").eq("id", id).maybeSingle()

  const { data, error } = await sb.from(TABLE_CONVENIOS).update(input).eq("id", id).select("*").single()
  if (error) throw new Error(error.message)

  const convenio = data as Convenio
  await registrarAuditoria({
    tabela: "convenio",
    registroId: id,
    acao: "editar",
    convenioNome: convenio.nome,
    alvoNome: convenio.nome,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: convenio as unknown as Record<string, unknown>,
  })
  return convenio
}

/** Soft-delete (ativo = false) — o projeto não faz exclusão física de cadastro. */
export async function inativarConvenio(id: number): Promise<void> {
  await definirAtivoConvenio(id, false)
}

export async function reativarConvenio(id: number): Promise<void> {
  await definirAtivoConvenio(id, true)
}

async function definirAtivoConvenio(id: number, ativo: boolean): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(TABLE_CONVENIOS).select("*").eq("id", id).maybeSingle()

  const { data, error } = await sb
    .from(TABLE_CONVENIOS)
    .update({ ativo })
    .eq("id", id)
    .select("*")
    .maybeSingle()
  if (error) throw new Error(error.message)

  const convenioNome = (antes as Convenio | null)?.nome ?? null

  await registrarAuditoria({
    tabela: "convenio",
    registroId: id,
    acao: ativo ? "reativar" : "inativar",
    convenioNome,
    alvoNome: convenioNome,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: (data ?? null) as Record<string, unknown> | null,
  })

  // Inativar o convênio inativa os planos dele junto: `getPlanosSaudeAtivos`
  // já esconde plano de convênio inativo do select da Ficha Médica, mas a
  // coluna `ativo` do plano continuava true — e a tela de Convênios mostrava
  // "Inativo" no convênio com os planos dentro ainda marcados como ativos.
  //
  // O caminho inverso NÃO é simétrico de propósito: reativar o convênio não
  // ressuscita os planos. Um plano pode ter sido desativado por decisão
  // própria (produto descontinuado) antes do convênio inteiro sair, e reativar
  // em massa desfaria essa decisão sem ninguém pedir. Reativação é plano a
  // plano, pela tela.
  if (ativo) return

  const { data: planosAtivos, error: erroBusca } = await sb
    .from(TABLE_PLANOS)
    .select("*")
    .eq("convenio_id", id)
    .eq("ativo", true)
  if (erroBusca) throw new Error(erroBusca.message)

  for (const plano of (planosAtivos ?? []) as PlanoSaude[]) {
    const { data: depois, error: erroUpdate } = await sb
      .from(TABLE_PLANOS)
      .update({ ativo: false })
      .eq("id", plano.id)
      .select("*")
      .maybeSingle()
    if (erroUpdate) throw new Error(erroUpdate.message)

    // Uma linha por plano, e não uma só resumindo: a trilha é consultada por
    // entidade (`tabela = 'plano_saude'`), então sem isto o plano sumiria da
    // tela sem registro de quando nem por quê.
    await registrarAuditoria({
      tabela: "plano_saude",
      registroId: plano.id,
      acao: "inativar",
      convenioNome,
      alvoNome: plano.nome,
      antes: plano as unknown as Record<string, unknown>,
      depois: (depois ?? null) as Record<string, unknown> | null,
      motivo: `Convênio "${convenioNome ?? id}" foi inativado.`,
    })
  }
}

export async function listarPlanosSaude(convenioId?: number): Promise<PlanoSaude[]> {
  const sb = getSupabaseClient()
  let query = sb.from(TABLE_PLANOS).select("*").order("nome")
  if (convenioId !== undefined) query = query.eq("convenio_id", convenioId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as PlanoSaude[]
}

export async function criarPlanoSaude(input: PlanoSaudeEdit): Promise<PlanoSaude> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE_PLANOS).insert(input).select("*").single()
  if (error) throw new Error(error.message)

  const plano = data as PlanoSaude
  await registrarAuditoria({
    tabela: "plano_saude",
    registroId: plano.id,
    acao: "criar",
    alvoNome: plano.nome,
    depois: plano as unknown as Record<string, unknown>,
  })
  return plano
}

export async function atualizarPlanoSaude(id: number, input: Partial<PlanoSaudeEdit>): Promise<PlanoSaude> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(TABLE_PLANOS).select("*").eq("id", id).maybeSingle()

  const { data, error } = await sb.from(TABLE_PLANOS).update(input).eq("id", id).select("*").single()
  if (error) throw new Error(error.message)

  const plano = data as PlanoSaude
  await registrarAuditoria({
    tabela: "plano_saude",
    registroId: id,
    acao: "editar",
    alvoNome: plano.nome,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: plano as unknown as Record<string, unknown>,
  })
  return plano
}

export async function inativarPlanoSaude(id: number): Promise<void> {
  await definirAtivoPlano(id, false)
}

export async function reativarPlanoSaude(id: number): Promise<void> {
  await definirAtivoPlano(id, true)
}

async function definirAtivoPlano(id: number, ativo: boolean): Promise<void> {
  const sb = getSupabaseClient()
  const { data: antes } = await sb.from(TABLE_PLANOS).select("*").eq("id", id).maybeSingle()

  const { data, error } = await sb
    .from(TABLE_PLANOS)
    .update({ ativo })
    .eq("id", id)
    .select("*")
    .maybeSingle()
  if (error) throw new Error(error.message)

  await registrarAuditoria({
    tabela: "plano_saude",
    registroId: id,
    acao: ativo ? "reativar" : "inativar",
    alvoNome: (antes as PlanoSaude | null)?.nome ?? null,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: (data ?? null) as Record<string, unknown> | null,
  })
}

// ─── Consumo externo (Cadastro de Pacientes / Ficha Médica) ────────────────

/**
 * Planos pelos ids, ATIVOS OU NÃO — para o histórico dar nome a um plano que já
 * foi desativado depois de usado.
 */
export async function getPlanosSaudePorIds(
  ids: number[]
): Promise<{ id: number; nome: string; convenio_nome: string }[]> {
  if (ids.length === 0) return []
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABLE_PLANOS).select("id, nome, convenios(nome)").in("id", ids)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: any) => ({ id: row.id, nome: row.nome, convenio_nome: row.convenios?.nome ?? "" }))
}

// Fonte de verdade para o select "Plano de saúde" — nunca texto livre. A RLS
// de convenios_select/planos_saude_select já libera SELECT para quem tem
// `cadastros_pacientes`, mesmo sem `cadastros_convenios`.
export async function getPlanosSaudeAtivos(): Promise<PlanoSaudeComConvenio[]> {
  const sb = getSupabaseClient()
  const { data, error } = await sb
    .from(TABLE_PLANOS)
    .select("*, convenios!inner(nome, ativo)")
    .eq("ativo", true)
    .eq("convenios.ativo", true)
    .order("nome")
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    convenio_id: row.convenio_id,
    nome: row.nome,
    ativo: row.ativo,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    id_usuario: row.id_usuario,
    nome_usuario_responsavel: row.nome_usuario_responsavel,
    convenio_nome: row.convenios.nome,
  }))
}
