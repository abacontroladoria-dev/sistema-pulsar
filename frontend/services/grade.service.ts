import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import type {
  AgendamentoGrade, BloqueioGrade, DisponibilidadePacienteGrade, EscopoExclusao, EventoGrade, FaixaGrade,
  FeriadoGrade, PayloadAgendamento, ProfissionalGrade, SerieGrade, SimulacaoData, TipoBloqueio,
} from "@/types/grade"

// Grade (Cronograma) — leitura e escrita da agenda própria do Pulsar.
// Ver supabase/migrations/20261008100000_grade_agenda_tabelas.sql … 100400.
//
// Leitura: tabelas grade_* (RLS por cronograma_grade) e RPCs grade_* que
// devolvem só o que a agenda precisa de profissionais, disponibilidade e
// feriados — quem agenda não tem, necessariamente, a permissão dos cadastros.
// Escrita: SÓ pelas RPCs. NADA daqui chama o TiTa.

type ErroPg = { message: string; code?: string }

/** Lançado quando as migrations da Grade ainda não foram aplicadas neste banco. */
export class GradeNaoInstaladaError extends MigrationPendenteError {
  constructor() {
    super("Grade")
    this.name = "GradeNaoInstaladaError"
  }
}

function mensagem(e: ErroPg): string {
  const m = e.message ?? ""
  if (e.code === "42501" || /permission denied|row-level security|Sem permissão/i.test(m)) {
    return "Você não tem permissão para a Grade. Peça a permissão 'Grade' (Cronograma) a um administrador."
  }
  // As RPCs levantam mensagens prontas em português (conflito, motivo, passado…).
  return m
}

function falha(e: ErroPg): never {
  if (ehMigrationPendente(e)) throw new GradeNaoInstaladaError()
  throw new Error(mensagem(e))
}

const sb = () => getSupabaseClient()

/** PostgREST corta em 1000 linhas sem erro: lê em páginas. */
async function lerTudo<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: ErroPg | null }>, pagina = 1000): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += pagina) {
    const { data, error } = await montar(de, de + pagina - 1)
    if (error) falha(error)
    const lote = (data ?? []) as T[]
    out.push(...lote)
    if (lote.length < pagina) return out
  }
}

// ── Leitura ───────────────────────────────────────────────────────────────────

export async function listarProfissionais(): Promise<ProfissionalGrade[]> {
  const { data, error } = await sb().rpc("grade_profissionais")
  if (error) falha(error)
  return (data ?? []) as ProfissionalGrade[]
}

export async function listarFaixas(de: string, ate: string, profissionais?: number[]): Promise<FaixaGrade[]> {
  const { data, error } = await sb().rpc("grade_faixas", { p_de: de, p_ate: ate, p_profissionais: profissionais?.length ? profissionais : null })
  if (error) falha(error)
  return (data ?? []) as FaixaGrade[]
}

export async function listarFeriados(de: string, ate: string): Promise<FeriadoGrade[]> {
  const { data, error } = await sb().rpc("grade_feriados", { p_de: de, p_ate: ate })
  if (error) falha(error)
  return (data ?? []) as FeriadoGrade[]
}

const COLS_AGENDAMENTO =
  "id, serie_id, data, dia_semana, hora_inicio, hora_fim, duracao_min, paciente_id, paciente_nome, profissional_id, profissional_nome, " +
  "terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, local_id, sala_nome, unidade_nome, situacao, " +
  "excluido_em, excluido_por_nome, motivo_exclusao, escopo_exclusao, origem, tita_agendamento_id, criado_em, criado_por_nome"

// Nome ATUAL do cadastro, pelas ligações de id (decisão de 16/10/2026: a sessão
// guarda quem/o quê; nome se lê do cadastro na hora). As colunas *_nome da
// própria sessão são só a cópia do momento em que foi criada: valem apenas se o
// cadastro não puder ser lido (RLS de quem consulta).
const COLS_CADASTRO_ATUAL =
  ", cad_paciente:pacientes!grade_agendamentos_paciente_id_fkey(nome)" +
  ", cad_profissional:profissionais!grade_agendamentos_profissional_id_fkey(nome)" +
  ", cad_terapia:cadastro_terapias!grade_agendamentos_terapia_id_fkey(nome)" +
  ", cad_exibicao:cadastro_terapias!grade_agendamentos_terapia_exibicao_id_fkey(nome)"

type ComCadastro = AgendamentoGrade & {
  cad_paciente?: { nome: string } | null
  cad_profissional?: { nome: string } | null
  cad_terapia?: { nome: string } | null
  cad_exibicao?: { nome: string } | null
}

function comNomesDoCadastro(r: ComCadastro): AgendamentoGrade {
  const { cad_paciente, cad_profissional, cad_terapia, cad_exibicao, ...a } = r
  return {
    ...a,
    paciente_nome: cad_paciente?.nome ?? a.paciente_nome,
    profissional_nome: cad_profissional?.nome ?? a.profissional_nome,
    terapia_nome: cad_terapia?.nome ?? a.terapia_nome,
    terapia_exibicao_nome: cad_exibicao?.nome ?? a.terapia_exibicao_nome,
  }
}

/** Sessões agendadas no período (excluídas ficam de fora: estão no Registro). */
export async function listarAgendamentos(args: {
  de: string
  ate: string
  profissionais?: number[]
  pacienteId?: number
}): Promise<AgendamentoGrade[]> {
  const linhas = await lerTudo<ComCadastro>((i, f) => {
    let q = sb().from("grade_agendamentos").select(COLS_AGENDAMENTO + COLS_CADASTRO_ATUAL)
      .eq("situacao", "agendado").gte("data", args.de).lte("data", args.ate)
    if (args.profissionais?.length) q = q.in("profissional_id", args.profissionais)
    if (args.pacienteId != null) q = q.eq("paciente_id", args.pacienteId)
    return q.order("data").order("hora_inicio").order("id").range(i, f)
  })
  return linhas.map(comNomesDoCadastro)
}

export async function buscarAgendamento(id: string): Promise<AgendamentoGrade | null> {
  const { data, error } = await sb().from("grade_agendamentos").select(COLS_AGENDAMENTO + COLS_CADASTRO_ATUAL).eq("id", id).maybeSingle()
  if (error) falha(error)
  return data ? comNomesDoCadastro(data as unknown as ComCadastro) : null
}

/** Quantas sessões "desta em diante" apagaria (prévia do botão). */
export async function contarDestaEmDiante(serieId: string, data: string): Promise<{ quantidade: number; ultima: string | null }> {
  const { data: linhas, error, count } = await sb().from("grade_agendamentos")
    .select("data", { count: "exact" })
    .eq("serie_id", serieId).eq("situacao", "agendado").gte("data", data)
    .order("data", { ascending: false }).limit(1)
  if (error) falha(error)
  return { quantidade: count ?? 0, ultima: (linhas?.[0] as { data: string } | undefined)?.data ?? null }
}

const COLS_SERIE =
  "id, paciente_id, profissional_id, terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome, dia_semana, " +
  "hora_inicio, hora_fim, sala_nome, unidade_nome, frequencia, intervalo_semanas, data_inicio, data_fim, total_sessoes, " +
  "situacao, encerrada_a_partir, encerrada_por_nome, motivo_encerramento, origem, observacao, criado_em, criado_por_nome"

export async function buscarSerie(id: string): Promise<SerieGrade | null> {
  const { data, error } = await sb().from("grade_series").select(COLS_SERIE).eq("id", id).maybeSingle()
  if (error) falha(error)
  return (data as SerieGrade | null) ?? null
}

export async function listarBloqueios(de: string, ate: string, profissionais?: number[]): Promise<BloqueioGrade[]> {
  return lerTudo<BloqueioGrade>((i, f) => {
    let q = sb().from("grade_bloqueios")
      .select("id, profissional_id, data_inicio, data_fim, hora_inicio, hora_fim, dias_semana, tipo, motivo, situacao, origem, criado_por_nome, criado_em")
      .eq("situacao", "ativo").lte("data_inicio", ate).or(`data_fim.is.null,data_fim.gte.${de}`)
    if (profissionais?.length) q = q.in("profissional_id", profissionais)
    return q.order("data_inicio").order("id").range(i, f)
  })
}

const COLS_EVENTO =
  "id, acao, agendamento_id, serie_id, bloqueio_id, importacao_id, lote_id, profissional_id, paciente_id, quantidade, motivo, resumo, feito_por_nome, feito_em, feito_em_brasilia"

/** Histórico de uma sessão: eventos dela e da série. */
export async function listarEventosDaSessao(agendamentoId: string, serieId: string | null): Promise<EventoGrade[]> {
  let q = sb().from("grade_eventos").select(COLS_EVENTO)
  q = serieId ? q.or(`agendamento_id.eq.${agendamentoId},serie_id.eq.${serieId}`) : q.eq("agendamento_id", agendamentoId)
  const { data, error } = await q.order("feito_em", { ascending: false }).limit(100)
  if (error) falha(error)
  return (data ?? []) as EventoGrade[]
}

/** Registro de alterações da página (filtros opcionais). */
export async function listarEventos(f: {
  de?: string | null
  ate?: string | null
  acoes?: string[]
  profissionalId?: number | null
  pacienteId?: number | null
  limite?: number
}): Promise<EventoGrade[]> {
  let q = sb().from("grade_eventos").select(COLS_EVENTO)
  // Datas do filtro são de Brasília; o carimbo é timestamptz.
  if (f.de) q = q.gte("feito_em", `${f.de}T00:00:00-03:00`)
  if (f.ate) q = q.lte("feito_em", `${f.ate}T23:59:59-03:00`)
  if (f.acoes?.length) q = q.in("acao", f.acoes)
  if (f.profissionalId != null) q = q.eq("profissional_id", f.profissionalId)
  if (f.pacienteId != null) q = q.eq("paciente_id", f.pacienteId)
  const { data, error } = await q.order("feito_em", { ascending: false }).limit(f.limite ?? 300)
  if (error) falha(error)
  return (data ?? []) as EventoGrade[]
}

export type PacienteGrade = {
  id_paciente: number
  nome: string
  convenio_nome: string | null
  ativo: boolean
  tita_paciente_id: number | null
}

/** Pacientes reais (sem fictício), ativos primeiro. */
export async function listarPacientes(): Promise<PacienteGrade[]> {
  return lerTudo<PacienteGrade>((i, f) =>
    sb().from("pacientes")
      .select("id_paciente, nome, convenio_nome, ativo, tita_paciente_id")
      .eq("ficticio", false).eq("falecido", false)
      .order("nome").order("id_paciente").range(i, f))
}

export async function disponibilidadePaciente(pacienteId: number): Promise<DisponibilidadePacienteGrade | null> {
  const { data, error } = await sb().rpc("grade_disponibilidade_paciente", { p_paciente_id: pacienteId })
  if (error) falha(error)
  return (data as DisponibilidadePacienteGrade | null) ?? null
}

// ── Agendar / excluir ─────────────────────────────────────────────────────────

export async function simular(p: PayloadAgendamento): Promise<SimulacaoData[]> {
  const { data, error } = await sb().rpc("grade_simular_agendamento", { p })
  if (error) falha(error)
  return (data ?? []) as SimulacaoData[]
}

export type ResultadoCriacao = {
  serie_id: string
  criadas: number
  puladas: { data: string; motivo: string }[]
  primeira: string
  ultima: string
}

export async function criar(p: PayloadAgendamento): Promise<ResultadoCriacao> {
  const { data, error } = await sb().rpc("grade_criar_agendamento", { p })
  if (error) falha(error)
  if (!data) throw new Error("O agendamento não foi gravado. Tente de novo.")
  return data as ResultadoCriacao
}

export async function excluir(id: string, escopo: Extract<EscopoExclusao, "somente_esta" | "desta_em_diante">, motivo: string) {
  const { data, error } = await sb().rpc("grade_excluir_agendamento", { p_agendamento_id: id, p_escopo: escopo, p_motivo: motivo })
  if (error) falha(error)
  return data as { excluidas: number; de: string; ate: string; escopo: string }
}

export async function criarBloqueio(b: {
  profissional_id: number
  data_inicio: string
  data_fim: string | null
  hora_inicio: string | null
  hora_fim: string | null
  dias_semana: number[] | null
  tipo: TipoBloqueio
  motivo: string
}) {
  const { data, error } = await sb().rpc("grade_criar_bloqueio", { p: b })
  if (error) falha(error)
  return data as { id: string; sessoes_no_periodo: number }
}

export async function excluirBloqueio(id: string, motivo: string) {
  const { data, error } = await sb().rpc("grade_excluir_bloqueio", { p_bloqueio_id: id, p_motivo: motivo })
  if (error) falha(error)
  return data as { modo: "excluido" | "encerrado" }
}

// ── Importar do TiTa (só leitura da cópia sincronizada) ───────────────────────

export type PreviaImportacao = {
  importacao_id: string
  janela_inicio: string
  janela_fim: string
  frescor: string | null
  /** Dia da janela (de hoje em diante) conferido há MAIS tempo. Ausente antes da migration 20261016100000. */
  frescor_pior?: string | null
  /** Cópia com mais de 30 h: aplicar é recusado. */
  copia_velha?: boolean
  dias_uteis: number
  dias_sincronizados: number
  contadores: {
    lidas: number; novos: number; series_novas: number; vinculos: number; existentes: number
    bloqueios_novos: number; bloqueios_existentes: number; pendencias: number; sumidos: number
    /** Só no banco antigo (antes de "o TiTa manda"). */
    ignorados?: number
    restaurados?: number; alterados?: number; desfaz_pulsar?: number; ja_no_pulsar?: number; bloqueios_sumidos?: number
  }
  profissionais: number[]
  pendencias: PendenciaImportacao[]
  novos: { data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  ignorados?: { data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  restaurados?: { data: string; hora: string; paciente: string; profissional: string; terapia: string; desfaz_pulsar: boolean }[]
  alterados?: { data: string; hora: string; paciente: string; profissional: string; terapia: string; sala: string | null; de: string }[]
  sumidos: { id: string; data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  sem_disponibilidade: { id: number; nome: string; sessoes: number }[]
}

export type PendenciaImportacao = {
  motivo: "paciente_sem_cadastro" | "profissional_sem_cadastro" | "terapia_sem_catalogo"
  tita_id: number | null
  nome: string | null
  sessoes: number
}

export type AplicadoImportacao = {
  vinculos: number; series_novas: number; sessoes_novas: number; bloqueios: number
  sumidos_excluidos: number; series_encerradas: number; lotes?: number; excluir_sumidos?: boolean
  restauradas?: number; alteradas?: number; bloqueios_excluidos?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteGrade = any

export async function previaImportacao(de: string, ate: string, cliente?: ClienteGrade): Promise<PreviaImportacao> {
  const { data, error } = await (cliente ?? sb()).rpc("grade_importar_tita_previa", { p_de: de, p_ate: ate })
  if (error) falha(error)
  return data as PreviaImportacao
}

export async function aplicarLote(importacaoId: string, excluirSumidos: boolean, profissionais: number[], cliente?: ClienteGrade): Promise<AplicadoImportacao> {
  const { data, error } = await (cliente ?? sb()).rpc("grade_importar_tita_aplicar", {
    p_importacao_id: importacaoId, p_excluir_sumidos: excluirSumidos, p_profissionais: profissionais,
  })
  if (error) falha(error)
  return (data as { aplicado: AplicadoImportacao }).aplicado
}

export async function concluirImportacao(importacaoId: string, cliente?: ClienteGrade): Promise<AplicadoImportacao> {
  const { data, error } = await (cliente ?? sb()).rpc("grade_importar_tita_concluir", { p_importacao_id: importacaoId })
  if (error) falha(error)
  return data as AplicadoImportacao
}

const LOTE_IMPORTACAO = 15
const ZERADO: AplicadoImportacao = { vinculos: 0, series_novas: 0, sessoes_novas: 0, bloqueios: 0, sumidos_excluidos: 0, series_encerradas: 0 }

/**
 * Aplica a prévia inteira em lotes de profissionais (com o TiTa mandando, o que
 * sumiu dele sempre sai) e fecha a importação. Lote que falha interrompe; o que
 * já foi aplicado fica, e reimportar não duplica.
 */
export async function aplicarImportacaoCompleta(
  previa: PreviaImportacao,
  onProgresso?: (feitos: number, total: number) => void,
  /** Só vale no banco antigo; depois da migration 20261016100000 o que sumiu sempre sai. */
  excluirSumidos = true,
  /** A rotina das 04:00 passa o cliente da service_role. */
  cliente?: ClienteGrade,
): Promise<AplicadoImportacao> {
  const lotes: number[][] = []
  for (let i = 0; i < previa.profissionais.length; i += LOTE_IMPORTACAO) lotes.push(previa.profissionais.slice(i, i + LOTE_IMPORTACAO))
  onProgresso?.(0, lotes.length)
  for (let i = 0; i < lotes.length; i++) {
    await aplicarLote(previa.importacao_id, excluirSumidos, lotes[i], cliente)
    onProgresso?.(i + 1, lotes.length)
  }
  try {
    // Sem nada a aplicar também fecha: fica no histórico como "conferido".
    return { ...ZERADO, ...(await concluirImportacao(previa.importacao_id, cliente)) }
  } catch (e) {
    // Banco antes da migration 20261016100000 não fecha importação vazia.
    if (!lotes.length) return ZERADO
    throw e
  }
}

/** Uma importação da Grade, para o relatório "Sincronização do TiTa". */
export type ImportacaoGrade = {
  id: string
  janela_inicio: string
  janela_fim: string
  situacao: "previa" | "aplicando" | "aplicada" | "descartada"
  contadores: PreviaImportacao["contadores"]
  aplicado: AplicadoImportacao
  frescor: string | null
  frescor_pior: string | null
  pendencias: PendenciaImportacao[]
  criado_por_nome: string | null
  criado_em: string
  aplicada_em: string | null
  aplicada_por_nome: string | null
}

export type ItemImportacaoGrade = {
  id: number
  tipo: "novo" | "restaurado" | "alterado" | "sumido" | "bloqueio" | "bloqueio_sumido" | "serie_encerrada"
  profissional_id: number | null
  profissional_nome: string | null
  paciente_nome: string | null
  data: string | null
  hora: string | null
  terapia: string | null
  sala: string | null
  de: string | null
}

const COLS_IMPORTACAO_GRADE =
  "id, janela_inicio, janela_fim, situacao, contadores, aplicado, frescor, frescor_pior, pendencias, criado_por_nome, criado_em, aplicada_em, aplicada_por_nome"
// O localhost usa o banco de produção: sem a migration 20261016100000 as duas colunas não existem.
const COLS_IMPORTACAO_GRADE_ANTIGAS = COLS_IMPORTACAO_GRADE.replace("frescor_pior, pendencias, ", "")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerImportacoesGrade(filtrar: (q: any) => PromiseLike<{ data: unknown[] | null; error: ErroPg | null }>): Promise<ImportacaoGrade[]> {
  let r = await filtrar(sb().from("grade_importacoes").select(COLS_IMPORTACAO_GRADE))
  if (r.error && (r.error.code === "42703" || r.error.code === "PGRST204")) {
    r = await filtrar(sb().from("grade_importacoes").select(COLS_IMPORTACAO_GRADE_ANTIGAS))
  }
  if (r.error) falha(r.error)
  return ((r.data ?? []) as Partial<ImportacaoGrade>[]).map(i => ({ frescor_pior: null, pendencias: [], ...i }) as ImportacaoGrade)
}

/** Importações aplicadas, a mais recente primeiro. */
export async function listarImportacoesGrade(limite = 10): Promise<ImportacaoGrade[]> {
  return lerImportacoesGrade(q => q.eq("situacao", "aplicada").order("aplicada_em", { ascending: false }).limit(limite))
}

export async function lerImportacaoGrade(id: string): Promise<ImportacaoGrade> {
  const [imp] = await lerImportacoesGrade(q => q.eq("id", id).limit(1))
  if (!imp) throw new Error("Importação não encontrada.")
  return imp
}

/** O que a importação fez, sessão a sessão (vazio antes da migration 20261016100000). */
export async function listarItensImportacaoGrade(importacaoId: string): Promise<ItemImportacaoGrade[]> {
  const out: ItemImportacaoGrade[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb()
      .from("grade_importacoes_itens")
      .select("id, tipo, profissional_id, profissional_nome, paciente_nome, data, hora, terapia, sala, de")
      .eq("importacao_id", importacaoId)
      .order("profissional_nome")
      .order("data")
      .order("id")
      .range(de, de + 999)
    if (error) {
      if (ehMigrationPendente(error)) return []
      falha(error)
    }
    out.push(...((data ?? []) as ItemImportacaoGrade[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

/**
 * Pede ao sync uma cópia nova da grade do TiTa para a janela. O sync confere um
 * dia por vez (cerca de 1 minuto por dia útil) e segue sozinho; a tela acompanha
 * pelo frescor (grade_sync_dia). Nada é escrito no TiTa.
 */
export async function atualizarCopiaTita(de: string, ate: string): Promise<void> {
  const r = await fetch("/api/grade/atualizar-copia-tita", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ de, ate }),
  })
  const corpo = (await r.json().catch(() => ({}))) as { ok?: boolean; mensagem?: string }
  if (!r.ok || !corpo.ok) throw new Error(corpo.mensagem ?? "Não foi possível pedir a cópia nova do TiTa.")
}

export type ImportacaoResumo = { id: string; aplicada_em: string | null; aplicada_por_nome: string | null; janela_inicio: string; janela_fim: string; aplicado: AplicadoImportacao }

export async function ultimaImportacao(): Promise<ImportacaoResumo | null> {
  const { data, error } = await sb().from("grade_importacoes")
    .select("id, aplicada_em, aplicada_por_nome, janela_inicio, janela_fim, aplicado")
    .eq("situacao", "aplicada").order("aplicada_em", { ascending: false }).limit(1).maybeSingle()
  if (error) falha(error)
  return (data as ImportacaoResumo | null) ?? null
}

// ── Inativação do profissional (Cadastro de Profissionais) ───────────────────

export async function sessoesAPartir(profissionalId: number, data: string): Promise<{ sessoes: number; pacientes: number }> {
  const { data: r, error } = await sb().rpc("profissional_sessoes_a_partir", { p_profissional_id: profissionalId, p_data: data })
  if (error) falha(error)
  return r as { sessoes: number; pacientes: number }
}

export async function inativarProfissional(args: { profissionalId: number; dataSaida: string; agendamentos: "manter" | "excluir"; motivo: string | null }) {
  const { data, error } = await sb().rpc("profissional_inativar", {
    p_profissional_id: args.profissionalId, p_data_saida: args.dataSaida, p_agendamentos: args.agendamentos, p_motivo: args.motivo,
  })
  if (error) falha(error)
  return data as { sessoes: number; pacientes: number; series_encerradas: number; agendamentos: string; data_saida: string }
}
