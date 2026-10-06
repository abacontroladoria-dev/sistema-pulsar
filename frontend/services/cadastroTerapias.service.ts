import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import type { CadastroTerapia, CadastroTerapiaEdit } from "@/types/terapia"

// Ver supabase/migrations/20261006120000_cadastro_terapias.sql.

const TABLE = "cadastro_terapias"
const COLUNAS = "id, nome, tipo, cor_hex, tita_terapia_id, ativo, atualizado_em"

/** Erro com aviso próprio para a tela: a tabela ainda não existe no banco. */
export class MigrationPendenteError extends Error {
  constructor(objeto: string) {
    super(`A estrutura de ${objeto} ainda não foi criada no banco (migration pendente).`)
    this.name = "MigrationPendenteError"
  }
}

function mensagem(error: { message: string; code?: string }): string {
  // PGRST116 num update/insert com `.single()` = a RLS barrou e nenhuma linha
  // voltou. Sem esta tradução a tela mostraria "Cannot coerce the result…".
  if (error.code === "PGRST116" || /row-level security/i.test(error.message)) {
    return "Você não tem permissão para alterar o Cadastro de Terapias. Peça a permissão 'Terapias' a um administrador."
  }
  if (error.code === "23505" || /duplicate key/i.test(error.message)) {
    return "Já existe uma terapia com esse nome (acentos e maiúsculas não contam como diferença)."
  }
  if (/cor_check/.test(error.message)) return "A cor precisa estar no formato #RRGGBB."
  if (/nome_check/.test(error.message)) return "O nome precisa ter entre 2 e 120 caracteres."
  return error.message
}

export async function listarTerapias(): Promise<CadastroTerapia[]> {
  const { data, error } = await getSupabaseClient().from(TABLE).select(COLUNAS).order("nome")
  if (error) {
    if (ehMigrationPendente(error)) throw new MigrationPendenteError("terapias")
    throw new Error(mensagem(error))
  }
  return (data ?? []) as CadastroTerapia[]
}

export async function criarTerapia(input: CadastroTerapiaEdit): Promise<CadastroTerapia> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert(input)
    .select(COLUNAS)
    .single()
  if (error) throw new Error(mensagem(error))

  const terapia = data as CadastroTerapia
  await registrarAuditoria({
    tabela: "terapia",
    registroId: terapia.id,
    acao: "criar",
    alvoNome: terapia.nome,
    depois: terapia as unknown as Record<string, unknown>,
  })
  return terapia
}

export async function atualizarTerapia(
  antes: CadastroTerapia,
  input: Partial<CadastroTerapiaEdit> & { ativo?: boolean }
): Promise<CadastroTerapia> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .update(input)
    .eq("id", antes.id)
    .select(COLUNAS)
    .single()
  if (error) throw new Error(mensagem(error))

  const terapia = data as CadastroTerapia
  const acao =
    input.ativo === undefined || input.ativo === antes.ativo
      ? "editar"
      : input.ativo ? "reativar" : "inativar"
  await registrarAuditoria({
    tabela: "terapia",
    registroId: terapia.id,
    acao,
    alvoNome: terapia.nome,
    antes: antes as unknown as Record<string, unknown>,
    depois: terapia as unknown as Record<string, unknown>,
  })
  return terapia
}
