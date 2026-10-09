import { getSupabaseClient } from "@/lib/supabase/client"
import { getUsuarioAtual } from "@/lib/supabase/usuarioAtual"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"
import { mensagemDeErroBanco } from "@/lib/cadastros/erroBanco"
import type { Paciente, PacienteEdit, PacienteFichaMedica } from "@/types/paciente"
import type {
  PacienteImportacaoLog,
  ResultadoImportacaoPacientes,
} from "@/types/pacienteImportacao"

/**
 * Resultado de escrita com a MENSAGEM do banco preservada.
 *
 * A versão anterior devolvia só `boolean` e enterrava o erro num console.error,
 * então uma recusa de RLS ou de CHECK chegava na tela como "não foi possível
 * salvar", sem dizer o quê. Diagnosticar isso exigia abrir o DevTools.
 */
export type Resultado = { ok: boolean; error: string | null; id?: number | null }

const mensagemDeErro = mensagemDeErroBanco

// Cadastro canônico de paciente. Substitui services/reboot/pacientes.service.ts:
// a tabela `reboot_pacientes` foi promovida a `public.pacientes` em
// 20260817190000_pacientes_canonica.sql (uma identidade de paciente, não duas).

const TABLE = "pacientes"
// Ficha médica mora em tabela própria por SEGURANÇA, não organização:
// pacientes_select é aberta a todo autenticado e dado de saúde não pode herdar
// isso. Ver 20260826100300.
const TABLE_FICHA = "pacientes_ficha_medica"

// Colunas explícitas em vez de `select("*")`: sob privilégio por COLUNA o
// PostgREST devolve 403 para `*`, e esse já foi um problema real neste projeto
// (ver reference_grants_coluna_postgrest). Listar também deixa óbvio, na
// revisão, quando uma coluna nova deixa de ser lida.
const COLUNAS = [
  "id_paciente",
  "tita_paciente_id",
  "nome",
  "nome_normalizado",
  "matricula",
  "tem_nome_civil",
  "nome_civil",
  "cpf",
  "data_nascimento",
  "sexo",
  "cor_raca",
  "estado_civil",
  "rg",
  "rg_orgao_emissor",
  "rg_uf",
  "rg_data_emissao",
  "email",
  "telefone_residencial",
  "falecido",
  "foto_path",
  "ficticio",
  "ativo",
  "observacoes",
  "origem_cadastro",
  "sincronizado_em",
  "lgpd_consentimento_em",
  "cep",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "responsavel_nome",
  "responsavel_cpf",
  "responsavel_email",
  "responsavel_telefone",
  "responsavel_parentesco",
  "responsavel_financeiro",
  "responsavel_financeiro_id",
  "convenio_id",
  "convenio_nome",
  "numero_carteirinha",
  "criado_em",
  "atualizado_em",
  "nome_usuario_responsavel",
].join(",")

export type ListarPacientesOpts = {
  /** Inclui os fictícios (Horário Administrativo e afins). Padrão: false. */
  incluirFicticios?: boolean
  /** Inclui os inativos. Padrão: true — a tela de cadastro precisa vê-los. */
  incluirInativos?: boolean
}

export async function getPacientes(
  opts: ListarPacientesOpts = {}
): Promise<{ data: Paciente[]; error: string | null }> {
  const { incluirFicticios = false, incluirInativos = true } = opts
  const supabase = getSupabaseClient()

  let query = supabase.from(TABLE).select(COLUNAS).order("nome")
  if (!incluirFicticios) query = query.eq("ficticio", false)
  if (!incluirInativos) query = query.eq("ativo", true)

  const { data, error } = await query

  if (error) {
    console.error("Erro ao buscar pacientes:", error)
    return { data: [], error: error.message }
  }

  // Cast por `unknown`: com a lista de colunas montada em runtime o supabase-js
  // não consegue inferir a forma da linha e devolve GenericStringError[]. O
  // client do projeto é `createBrowserClient<any>`, então a garantia de tipo
  // aqui é o próprio `COLUNAS` acima.
  return { data: (data ?? []) as unknown as Paciente[], error: null }
}

/**
 * Busca por `tita_paciente_id` — a chave estável. Use isto ao cruzar com
 * `agenda_tita`, nunca o nome.
 */
export async function getPacientePorTitaId(
  titaPacienteId: number
): Promise<{ data: Paciente | null; error: string | null }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUNAS)
    .eq("tita_paciente_id", titaPacienteId)
    .maybeSingle()

  if (error) {
    console.error("Erro ao buscar paciente por tita_paciente_id:", error)
    return { data: null, error: error.message }
  }

  return { data: (data ?? null) as Paciente | null, error: null }
}

/**
 * Resolve vários `tita_paciente_id` de uma vez para `id_paciente` (a PK do
 * Pulsar). Para cruzar uma grade inteira (centenas de linhas) com dado do
 * Pulsar sem fazer uma chamada por paciente — mesmo motivo/uso de
 * `getPacientePorTitaId`, só que em lote.
 */
export async function getPacientesPorTitaIds(
  titaIds: number[]
): Promise<Map<number, number>> {
  const mapa = new Map<number, number>()
  if (titaIds.length === 0) return mapa

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select("id_paciente, tita_paciente_id")
    .in("tita_paciente_id", titaIds)

  if (error) {
    console.error("Erro ao resolver pacientes por tita_paciente_id:", error)
    return mapa
  }

  for (const linha of (data ?? []) as { id_paciente: number; tita_paciente_id: number | null }[]) {
    if (linha.tita_paciente_id != null) mapa.set(linha.tita_paciente_id, linha.id_paciente)
  }
  return mapa
}

/** Busca pela PK. É o que a tela de detalhe usa. */
export async function getPacientePorId(
  idPaciente: number
): Promise<{ data: Paciente | null; error: string | null }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUNAS)
    .eq("id_paciente", idPaciente)
    .maybeSingle()

  if (error) {
    console.error("Erro ao buscar paciente por id:", error)
    return { data: null, error: error.message }
  }

  return { data: (data ?? null) as Paciente | null, error: null }
}

/**
 * Grava só o `foto_path`. Fica fora do `upsertPaciente` de propósito: o upload
 * é imediato e não participa do "Salvar tudo" do formulário — o arquivo já foi
 * para o Storage, e deixá-lo pendente criaria órfão se o usuário cancelasse.
 */
export async function atualizarFotoPaciente(
  idPaciente: number,
  fotoPath: string | null
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from(TABLE)
    .update({ foto_path: fotoPath })
    .eq("id_paciente", idPaciente)

  if (error) {
    console.error("Erro ao atualizar foto do paciente:", error)
    return false
  }

  return true
}

const COLUNAS_FICHA = [
  "paciente_id",
  "tipo_sanguineo",
  "restricoes_alimentares",
  "alergias",
  "doencas",
  "plano_saude_id",
  "numero_carteirinha",
].join(",")

/**
 * Ficha médica do paciente. Devolve `null` quando ainda não existe linha — a
 * ficha é criada no primeiro salvamento, não junto com o paciente, para não
 * gerar linha vazia em todo paciente sincronizado do TiTa.
 */
export async function getFichaMedica(
  idPaciente: number
): Promise<{ data: PacienteFichaMedica | null; error: string | null }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE_FICHA)
    .select(COLUNAS_FICHA)
    .eq("paciente_id", idPaciente)
    .maybeSingle()

  if (error) {
    console.error("Erro ao buscar ficha médica:", error)
    return { data: null, error: error.message }
  }

  return { data: (data ?? null) as PacienteFichaMedica | null, error: null }
}

export async function upsertFichaMedica(
  row: PacienteFichaMedica,
  pacienteNome?: string
): Promise<Resultado> {
  const supabase = getSupabaseClient()
  const usuario = await getUsuarioAtual()

  const { data: antes } = await supabase
    .from(TABLE_FICHA)
    .select(COLUNAS_FICHA)
    .eq("paciente_id", row.paciente_id)
    .maybeSingle()

  const { data: depois, error } = await supabase
    .from(TABLE_FICHA)
    .upsert(
      { ...row, id_usuario: usuario.id, nome_usuario_responsavel: usuario.nome },
      { onConflict: "paciente_id" }
    )
    .select(COLUNAS_FICHA)
    .maybeSingle()

  if (error) {
    console.error("Erro ao salvar ficha médica:", error)
    return { ok: false, error: mensagemDeErro(error) }
  }

  await registrarAuditoria({
    tabela: "ficha_medica",
    registroId: row.paciente_id,
    acao: antes ? "editar" : "criar",
    pacienteId: row.paciente_id,
    pacienteNome: pacienteNome ?? null,
    alvoNome: pacienteNome ?? null,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: (depois ?? null) as Record<string, unknown> | null,
  })

  return { ok: true, error: null }
}

export async function upsertPaciente(row: PacienteEdit): Promise<Resultado> {
  const supabase = getSupabaseClient()
  const usuario = await getUsuarioAtual()

  const criando = row.id_paciente === undefined

  // O "antes" tem que ser lido ANTES da escrita, senão a trilha compara o
  // registro com ele mesmo.
  const antes = criando ? null : (await getPacientePorId(row.id_paciente!)).data

  // `origem_cadastro` só é definida na CRIAÇÃO. Num paciente que veio do TiTa
  // ela permanece 'tita', para o resync continuar podendo refrescar identidade
  // (nome/cpf/nascimento) — o backfill preserva o que foi digitado aqui via
  // COALESCE, então editar cadastro não briga com o sync.
  const payload: Record<string, unknown> = {
    ...row,
    id_usuario: usuario.id,
    nome_usuario_responsavel: usuario.nome,
  }
  if (criando) payload.origem_cadastro = "pulsar"

  // Insert e update em vez de upsert: `id_paciente` é `GENERATED ALWAYS AS
  // IDENTITY` (20260817190000_pacientes_canonica.sql), e o Postgres recusa
  // qualquer valor explícito nessa coluna dentro de um INSERT — mesmo quando é
  // um upsert que na prática vai fazer UPDATE, o `ON CONFLICT` não livra o
  // INSERT inicial dessa checagem. Editar um paciente quebrava com
  // "cannot insert a non-DEFAULT value into column \"id_paciente\"".
  delete payload.id_paciente
  const query = criando
    ? supabase.from(TABLE).insert(payload)
    : supabase.from(TABLE).update(payload).eq("id_paciente", row.id_paciente!)

  const { data: depois, error } = await query.select(COLUNAS).maybeSingle()

  if (error) {
    console.error("Erro ao salvar paciente:", error)
    return { ok: false, error: mensagemDeErro(error) }
  }

  const salvo = depois as Paciente | null

  await registrarAuditoria({
    tabela: "paciente",
    registroId: salvo?.id_paciente ?? row.id_paciente ?? "",
    acao: criando ? "criar" : "editar",
    pacienteId: salvo?.id_paciente ?? row.id_paciente ?? null,
    pacienteNome: salvo?.nome ?? row.nome,
    alvoNome: salvo?.nome ?? row.nome,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: (salvo ?? null) as Record<string, unknown> | null,
  })

  return { ok: true, error: null, id: salvo?.id_paciente ?? null }
}

/**
 * Inativa ou reativa o cadastro, com motivo — ação explícita, separada da
 * edição de campos. `ativo` é o que a clínica trata como "cadastro em uso";
 * `falecido` é outra coisa e não é tocado aqui.
 */
export async function definirAtivoPaciente(
  idPaciente: number,
  ativo: boolean,
  motivo?: string
): Promise<Resultado> {
  const supabase = getSupabaseClient()
  const usuario = await getUsuarioAtual()

  const antes = (await getPacientePorId(idPaciente)).data

  const { data: depois, error } = await supabase
    .from(TABLE)
    .update({
      ativo,
      id_usuario: usuario.id,
      nome_usuario_responsavel: usuario.nome,
    })
    .eq("id_paciente", idPaciente)
    .select(COLUNAS)
    .maybeSingle()

  if (error) {
    console.error("Erro ao alterar situação do paciente:", error)
    return { ok: false, error: mensagemDeErro(error) }
  }

  await registrarAuditoria({
    tabela: "paciente",
    registroId: idPaciente,
    acao: ativo ? "reativar" : "inativar",
    pacienteId: idPaciente,
    pacienteNome: antes?.nome ?? null,
    alvoNome: antes?.nome ?? null,
    antes: (antes ?? null) as Record<string, unknown> | null,
    depois: (depois ?? null) as Record<string, unknown> | null,
    motivo: motivo?.trim() || null,
  })

  return { ok: true, error: null }
}

/**
 * Dispara manualmente a importação de pacientes do TiTa via RPC.
 */
export async function importarPacientesDaTita(): Promise<ResultadoImportacaoPacientes> {
  const { data, error } = await getSupabaseClient().rpc("pacientes_importar_tita", { p_origem: "manual" })
  if (error) {
    throw new Error(mensagemDeErro(error))
  }
  return data as ResultadoImportacaoPacientes
}

/**
 * Obtém a última execução registrada no log de importações.
 */
export async function getUltimaImportacaoPacientes(): Promise<PacienteImportacaoLog | null> {
  const { data, error } = await getSupabaseClient()
    .from("pacientes_importacoes_log")
    .select("*")
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Erro ao obter última importação de pacientes:", error)
    return null
  }
  return (data as PacienteImportacaoLog) ?? null
}

/**
 * Lista as últimas execuções da importação de pacientes para o histórico do "Ver mais".
 */
export async function getHistoricoImportacoesPacientes(
  limite = 10
): Promise<PacienteImportacaoLog[]> {
  const { data, error } = await getSupabaseClient()
    .from("pacientes_importacoes_log")
    .select("*")
    .order("iniciado_em", { ascending: false })
    .limit(limite)

  if (error) {
    console.error("Erro ao obter histórico de importações de pacientes:", error)
    return []
  }
  return (data ?? []) as PacienteImportacaoLog[]
}
