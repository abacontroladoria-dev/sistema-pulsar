import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import type {
  Profissional, ProfissionalArquivos, ProfissionalEdit, ProfissionalLista, ResultadoImportacao,
} from "@/types/profissional"

// Ver supabase/migrations/20261006130000_profissionais.sql.

const TABLE = "profissionais"
const TABLE_HAB = "profissionais_terapias_habilitadas"
const VIEW_GRADE = "vw_profissionais_terapias_grade"

// Lista explícita: nada de select("*") em tabela com dado pessoal — coluna nova
// não passa a ser lida sem alguém decidir.
const TODAS = [
  "id", "tita_profissional_id", "origem", "nome", "cpf", "email", "celular",
  "tipo_registro", "uf_registro", "codigo_registro", "cbo",
  "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
  "terapia_focal_id", "ativo", "observacoes", "foto_path", "assinatura_path", "dados_tita", "sincronizado_tita_em",
  "criado_em", "atualizado_em",
]

// A lista não precisa de endereço, e-mail, observações, assinatura nem do retrato do TiTa.
const DA_LISTA = [
  "id", "tita_profissional_id", "origem", "nome", "cpf", "celular",
  "tipo_registro", "uf_registro", "codigo_registro", "cbo", "terapia_focal_id", "ativo", "foto_path",
]

// O localhost usa o banco de produção: enquanto a migration 20261006160000
// (foto_path/assinatura_path) não estiver aplicada, as telas seguem sem foto em
// vez de quebrar. Um erro de coluna no `select` derruba a instrução inteira
// (insert/update incluídos), então repetir sem as colunas é seguro.
const DAS_IMAGENS = ["foto_path", "assinatura_path"]
let semColunasImagem = false
const COLUNAS = () => TODAS.filter(c => !semColunasImagem || !DAS_IMAGENS.includes(c)).join(", ")
const COLUNAS_LISTA = () => DA_LISTA.filter(c => !semColunasImagem || !DAS_IMAGENS.includes(c)).join(", ")
const comImagensNulas = <T,>(linha: T): T => (linha ? ({ foto_path: null, assinatura_path: null, ...linha }) : linha)
const ehColunaInexistente = (e: { code?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204")

/** Roda a consulta; se faltar a coluna de imagem, liga o modo sem imagens e repete uma vez. */
async function comFallbackImagens<R extends { error: { message: string; code?: string } | null }>(
  consulta: () => PromiseLike<R>
): Promise<R> {
  const r = await consulta()
  if (!semColunasImagem && ehColunaInexistente(r.error)) {
    semColunasImagem = true
    return consulta()
  }
  return r
}

function mensagem(error: { message: string; code?: string }): string {
  if (error.code === "PGRST116" || error.code === "42501" || /row-level security|permission denied/i.test(error.message)) {
    return "Você não tem permissão para alterar o Cadastro de Profissionais. Peça a permissão 'Profissionais' a um administrador."
  }
  if (/profissionais_cpf_check/.test(error.message)) return "O CPF precisa ter 11 dígitos."
  if (/profissionais_email_check/.test(error.message)) return "O e-mail não parece válido."
  if (/profissionais_celular_check/.test(error.message)) return "O celular precisa ter DDD + número (10 a 13 dígitos)."
  if (/profissionais_cep_check/.test(error.message)) return "O CEP precisa ter 8 dígitos."
  if (/uf_registro_check|profissionais_uf_check/.test(error.message)) return "A UF precisa ter 2 letras."
  if (/profissionais_nome_check/.test(error.message)) return "O nome precisa ter ao menos 2 letras."
  if (/textos_curtos/.test(error.message)) return "Algum campo passou do tamanho máximo."
  return error.message
}

/** Lê todas as páginas de uma consulta (o PostgREST corta em 1000 linhas sem avisar). */
async function todasAsPaginas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>
): Promise<T[]> {
  const saida: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999)
    if (error) {
      if (ehMigrationPendente(error)) throw new MigrationPendenteError("profissionais")
      throw new Error(mensagem(error))
    }
    saida.push(...(data ?? []))
    if (!data || data.length < 1000) return saida
  }
}

export async function listarProfissionais(): Promise<ProfissionalLista[]> {
  const sb = getSupabaseClient()
  type Pagina = { data: ProfissionalLista[] | null; error: { message: string; code?: string } | null }
  const linhas = await todasAsPaginas<ProfissionalLista>((de, ate) =>
    comFallbackImagens(() =>
      sb.from(TABLE).select(COLUNAS_LISTA()).order("nome").order("id").range(de, ate) as unknown as PromiseLike<Pagina>
    )
  )
  return linhas.map(comImagensNulas)
}

export async function getProfissional(id: number): Promise<Profissional | null> {
  type Resposta = { data: Profissional | null; error: { message: string; code?: string } | null }
  const { data, error } = await comFallbackImagens(() =>
    getSupabaseClient().from(TABLE).select(COLUNAS()).eq("id", id).maybeSingle() as unknown as PromiseLike<Resposta>
  )
  if (error) {
    if (ehMigrationPendente(error)) throw new MigrationPendenteError("profissionais")
    throw new Error(mensagem(error))
  }
  return data ? comImagensNulas(data) : null
}

/** profissional_id (Pulsar) → ids de terapia do catálogo. */
export async function listarHabilitadas(profissionalId?: number): Promise<Map<number, number[]>> {
  const sb = getSupabaseClient()
  const linhas = await todasAsPaginas<{ profissional_id: number; terapia_id: number }>((de, ate) => {
    let q = sb.from(TABLE_HAB).select("profissional_id, terapia_id").order("profissional_id").order("terapia_id")
    if (profissionalId !== undefined) q = q.eq("profissional_id", profissionalId)
    return q.range(de, ate)
  })
  const mapa = new Map<number, number[]>()
  for (const l of linhas) {
    const arr = mapa.get(l.profissional_id) ?? []
    arr.push(l.terapia_id)
    mapa.set(l.profissional_id, arr)
  }
  return mapa
}

/** id TiTa do profissional → [{ terapia, horários }] vistos na grade (90 dias para trás em diante). */
export async function listarTerapiasDaGrade(
  titaProfissionalId?: number
): Promise<Map<number, { terapia: string; horarios: number }[]>> {
  const sb = getSupabaseClient()
  const linhas = await todasAsPaginas<{ profissional_id: number; terapia_nome: string; horarios: number }>((de, ate) => {
    let q = sb.from(VIEW_GRADE).select("profissional_id, terapia_nome, horarios").order("profissional_id").order("terapia_nome")
    if (titaProfissionalId !== undefined) q = q.eq("profissional_id", titaProfissionalId)
    return q.range(de, ate)
  })
  const mapa = new Map<number, { terapia: string; horarios: number }[]>()
  for (const l of linhas) {
    const arr = mapa.get(l.profissional_id) ?? []
    arr.push({ terapia: l.terapia_nome, horarios: Number(l.horarios) })
    mapa.set(l.profissional_id, arr)
  }
  return mapa
}

export async function importarDaTita(): Promise<ResultadoImportacao> {
  const { data, error } = await getSupabaseClient().rpc("profissionais_importar_tita")
  if (error) {
    if (ehMigrationPendente(error)) throw new MigrationPendenteError("profissionais")
    throw new Error(mensagem(error))
  }
  return data as ResultadoImportacao
}

export async function criarProfissional(input: ProfissionalEdit, terapiaIds: number[]): Promise<Profissional> {
  const sb = getSupabaseClient()
  type Resposta = { data: Profissional | null; error: { message: string; code?: string } | null }
  const { data, error } = await comFallbackImagens(() =>
    sb.from(TABLE).insert(input).select(COLUNAS()).single() as unknown as PromiseLike<Resposta>
  )
  if (error) throw new Error(mensagem(error))
  const prof = comImagensNulas(data as Profissional)

  if (terapiaIds.length) {
    const { error: e2 } = await sb
      .from(TABLE_HAB)
      .insert(terapiaIds.map(terapia_id => ({ profissional_id: prof.id, terapia_id })))
    if (e2) throw new Error(`Profissional criado, mas as terapias não foram salvas: ${mensagem(e2)}`)
  }

  await registrarAuditoria({
    tabela: "profissional",
    registroId: prof.id,
    acao: "criar",
    alvoNome: prof.nome,
    depois: { ...semRetratoTita(prof), terapias_habilitadas: terapiaIds.length },
  })
  return prof
}

export async function atualizarProfissional(
  antes: Profissional,
  input: Partial<ProfissionalEdit & ProfissionalArquivos>
): Promise<Profissional> {
  type Resposta = { data: Profissional | null; error: { message: string; code?: string } | null }
  const { data, error } = await comFallbackImagens(() =>
    getSupabaseClient()
      .from(TABLE)
      .update(input)
      .eq("id", antes.id)
      .select(COLUNAS())
      .single() as unknown as PromiseLike<Resposta>
  )
  if (error) {
    if (ehColunaInexistente(error) && ("foto_path" in input || "assinatura_path" in input)) {
      throw new Error("A foto ainda não pode ser gravada: falta aplicar a migration 20261006160000_profissionais_foto_assinatura.sql.")
    }
    throw new Error(mensagem(error))
  }
  const prof = comImagensNulas(data as Profissional)

  const acao =
    input.ativo === undefined || input.ativo === antes.ativo ? "editar" : input.ativo ? "reativar" : "inativar"
  await registrarAuditoria({
    tabela: "profissional",
    registroId: prof.id,
    acao,
    alvoNome: prof.nome,
    antes: semRetratoTita(antes),
    depois: semRetratoTita(prof),
  })
  return prof
}

/**
 * Grava a lista de terapias habilitadas por diferença (insere as novas, apaga as
 * retiradas). `nomes` resolve id → nome para a trilha ficar legível.
 */
export async function salvarHabilitadas(
  prof: Pick<Profissional, "id" | "nome">,
  antes: number[],
  depois: number[],
  nomes: Map<number, string>
): Promise<void> {
  const sb = getSupabaseClient()
  const setAntes = new Set(antes)
  const setDepois = new Set(depois)
  const novas = depois.filter(id => !setAntes.has(id))
  const retiradas = antes.filter(id => !setDepois.has(id))
  if (!novas.length && !retiradas.length) return

  if (novas.length) {
    const { error } = await sb
      .from(TABLE_HAB)
      .insert(novas.map(terapia_id => ({ profissional_id: prof.id, terapia_id })))
    if (error) throw new Error(mensagem(error))
  }
  if (retiradas.length) {
    // `.select()` devolve o que foi apagado: DELETE barrado pela RLS não dá
    // erro, só apaga zero linhas — sem conferir, a tela diria "salvo".
    const { data, error } = await sb
      .from(TABLE_HAB)
      .delete()
      .eq("profissional_id", prof.id)
      .in("terapia_id", retiradas)
      .select("terapia_id")
    if (error) throw new Error(mensagem(error))
    if ((data ?? []).length !== retiradas.length) {
      throw new Error("Nem todas as terapias foram retiradas — confira sua permissão e tente de novo.")
    }
  }

  const rotulo = (ids: number[]) => ids.map(id => nomes.get(id) ?? `#${id}`).sort((a, b) => a.localeCompare(b, "pt-BR")).join(", ")
  await registrarAuditoria({
    tabela: "profissional",
    registroId: prof.id,
    acao: "editar",
    alvoNome: prof.nome,
    antes: { terapias_habilitadas: rotulo(antes) },
    depois: { terapias_habilitadas: rotulo(depois) },
  })
}

/** A trilha guarda o cadastro, não o retrato do TiTa (que muda a cada importação). */
function semRetratoTita(p: Profissional): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { dados_tita, sincronizado_tita_em, ...resto } = p
  return resto as unknown as Record<string, unknown>
}
