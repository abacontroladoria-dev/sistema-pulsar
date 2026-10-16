import { getSupabaseClient } from "@/lib/supabase/client"
import type { SupabaseClient } from "@supabase/supabase-js"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import type {
  AlvoImportacaoTita, ImportacaoTita, ItemImportacaoTita, ItemPreviaDisponibilidade,
} from "@/types/titaImportacao"

// Ver supabase/migrations/20261015190000_tita_importacoes_disponibilidade.sql.
// Log legível por quem tem cadastros_profissionais; escrita só pelas RPCs.

const MIGRATION = "20261015190000_tita_importacoes_disponibilidade.sql"

/** Cliente do banco: o do navegador por padrão; a rotina das 04:00 passa o da service_role. */
type Cliente = SupabaseClient
const cli = (c?: Cliente) => (c ?? getSupabaseClient()) as Cliente

type ErroPg = { message: string; code?: string }

function falha(e: ErroPg): never {
  if (ehMigrationPendente(e)) throw new Error(`Falta aplicar a migration ${MIGRATION}. Nada foi gravado.`)
  if (e.code === "42501" || /permission denied|Sem permissão/i.test(e.message)) {
    throw new Error("Você não tem permissão para isso. Peça a permissão 'Profissionais' a um administrador.")
  }
  throw new Error(e.message)
}

const COLS_IMPORTACAO =
  "id, alvo, situacao, origem, parametros, vistos_na_tita, novos, alterados, iguais, pendencias, sem_grade, aplicados, erros, extras, erro_mensagem, usuario_nome, iniciado_em, finalizado_em"

/**
 * Execuções concluídas (a mais recente primeiro). Sem a migration aplicada
 * devolve lista vazia: o localhost usa o banco de produção e a tela não pode
 * quebrar antes do deploy.
 */
export async function listarImportacoes(alvo: AlvoImportacaoTita, limite = 10, cliente?: Cliente): Promise<ImportacaoTita[]> {
  const { data, error } = await cli(cliente)
    .from("tita_importacoes")
    .select(COLS_IMPORTACAO)
    .eq("alvo", alvo)
    .in("situacao", ["sucesso", "parcial", "erro"])
    .order("iniciado_em", { ascending: false })
    .limit(limite)
  if (error) {
    if (ehMigrationPendente(error)) return []
    falha(error)
  }
  return (data ?? []) as ImportacaoTita[]
}

export async function lerImportacao(id: string, cliente?: Cliente): Promise<ImportacaoTita> {
  const { data, error } = await cli(cliente).from("tita_importacoes").select(COLS_IMPORTACAO).eq("id", id).single()
  if (error) falha(error)
  return data as ImportacaoTita
}

/** Itens de uma execução (todas as páginas). */
export async function listarItensImportacao(importacaoId: string, cliente?: Cliente): Promise<ItemImportacaoTita[]> {
  const sb = cli(cliente)
  const out: ItemImportacaoTita[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb
      .from("tita_importacoes_itens")
      .select("id, importacao_id, tipo, entidade_id, tita_id, nome, resumo, mudancas, etiquetas, aplicado_em, erro")
      .eq("importacao_id", importacaoId)
      .order("nome")
      .order("id")
      .range(de, de + 999)
    if (error) falha(error)
    out.push(...((data ?? []) as ItemImportacaoTita[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

/** Grava a prévia (nada muda na disponibilidade). Devolve o id da importação. */
export async function gravarPreviaDisponibilidade(args: {
  vigenteDe: string
  janela: { de: string; ate: string }
  vistos: number
  itens: ItemPreviaDisponibilidade[]
}, cliente?: Cliente): Promise<string> {
  const { data, error } = await cli(cliente).rpc("tita_importacao_disponibilidade_previa", {
    p_vigente_de: args.vigenteDe,
    p_semana_de: args.janela.de,
    p_semana_ate: args.janela.ate,
    p_vistos: args.vistos,
    // O nome é só da tela: a RPC usa o do cadastro.
    p_itens: args.itens.map(i => ({ ...i, nome: undefined })),
  })
  if (error) falha(error)
  if (!data) throw new Error("A prévia não foi gravada. Tente de novo.")
  return data as string
}

export async function aplicarLoteDisponibilidade(importacaoId: string, profissionais: number[], cliente?: Cliente): Promise<{ aplicados: number; erros: number }> {
  const { data, error } = await cli(cliente).rpc("tita_importacao_disponibilidade_aplicar", {
    p_importacao_id: importacaoId,
    p_profissionais: profissionais,
  })
  if (error) falha(error)
  return data as { aplicados: number; erros: number }
}

export async function concluirImportacaoDisponibilidade(importacaoId: string, cliente?: Cliente): Promise<{ situacao: string; aplicados: number; erros: number }> {
  const { data, error } = await cli(cliente).rpc("tita_importacao_concluir", { p_importacao_id: importacaoId })
  if (error) falha(error)
  return data as { situacao: string; aplicados: number; erros: number }
}
