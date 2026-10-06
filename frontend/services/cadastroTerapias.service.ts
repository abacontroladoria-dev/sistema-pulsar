import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import type { CadastroTerapia, CadastroTerapiaEdit } from "@/types/terapia"

// Ver supabase/migrations/20261006120000_cadastro_terapias.sql.

const TABLE = "cadastro_terapias"
const COLUNAS = "id, nome, tipo, cor_hex, tita_terapia_id, icone, ativo, atualizado_em"
const COLUNAS_SEM_ICONE = "id, nome, tipo, cor_hex, tita_terapia_id, ativo, atualizado_em"

// O localhost usa o banco de produção: enquanto a migration 20261006150000
// (coluna `icone`) não estiver aplicada, a tela segue sem ícone em vez de quebrar.
let semColunaIcone = false
const colunas = () => (semColunaIcone ? COLUNAS_SEM_ICONE : COLUNAS)
const semIcone = <T extends { icone?: string | null }>(input: T) => {
  if (!semColunaIcone) return input
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { icone, ...resto } = input
  return resto
}
const comIconeNulo = (linhas: unknown[]) => linhas.map(l => ({ icone: null, ...(l as object) }))

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
  type Resposta = { data: unknown[] | null; error: { message: string; code?: string } | null }
  const ler = () => getSupabaseClient().from(TABLE).select(colunas()).order("nome") as unknown as PromiseLike<Resposta>
  let { data, error } = await ler()
  if (error && !semColunaIcone && (error.code === "42703" || error.code === "PGRST204")) {
    semColunaIcone = true
    ;({ data, error } = await ler())
  }
  if (error) {
    if (ehMigrationPendente(error)) throw new MigrationPendenteError("terapias")
    throw new Error(mensagem(error))
  }
  return comIconeNulo(data ?? []) as CadastroTerapia[]
}

export async function criarTerapia(input: CadastroTerapiaEdit): Promise<CadastroTerapia> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert(semIcone(input))
    .select(colunas())
    .single()
  if (error) throw new Error(mensagem(error))

  const terapia = comIconeNulo([data])[0] as unknown as CadastroTerapia
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
    .update(semIcone(input))
    .eq("id", antes.id)
    .select(colunas())
    .single()
  if (error) throw new Error(mensagem(error))

  const terapia = comIconeNulo([data])[0] as unknown as CadastroTerapia
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
