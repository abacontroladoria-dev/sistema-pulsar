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

/** Sessões agendadas no período (excluídas ficam de fora: estão no Registro). */
export async function listarAgendamentos(args: {
  de: string
  ate: string
  profissionais?: number[]
  pacienteId?: number
}): Promise<AgendamentoGrade[]> {
  return lerTudo<AgendamentoGrade>((i, f) => {
    let q = sb().from("grade_agendamentos").select(COLS_AGENDAMENTO)
      .eq("situacao", "agendado").gte("data", args.de).lte("data", args.ate)
    if (args.profissionais?.length) q = q.in("profissional_id", args.profissionais)
    if (args.pacienteId != null) q = q.eq("paciente_id", args.pacienteId)
    return q.order("data").order("hora_inicio").order("id").range(i, f)
  })
}

export async function buscarAgendamento(id: string): Promise<AgendamentoGrade | null> {
  const { data, error } = await sb().from("grade_agendamentos").select(COLS_AGENDAMENTO).eq("id", id).maybeSingle()
  if (error) falha(error)
  return (data as AgendamentoGrade | null) ?? null
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
  dias_uteis: number
  dias_sincronizados: number
  contadores: {
    lidas: number; novos: number; series_novas: number; vinculos: number; existentes: number; ignorados: number
    bloqueios_novos: number; bloqueios_existentes: number; pendencias: number; sumidos: number
  }
  profissionais: number[]
  pendencias: { motivo: "paciente_sem_cadastro" | "profissional_sem_cadastro" | "terapia_sem_catalogo"; tita_id: number | null; nome: string | null; sessoes: number }[]
  novos: { data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  ignorados: { data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  sumidos: { id: string; data: string; hora: string; paciente: string; profissional: string; terapia: string }[]
  sem_disponibilidade: { id: number; nome: string; sessoes: number }[]
}

export type AplicadoImportacao = {
  vinculos: number; series_novas: number; sessoes_novas: number; bloqueios: number
  sumidos_excluidos: number; series_encerradas: number; lotes?: number; excluir_sumidos?: boolean
}

export async function previaImportacao(de: string, ate: string): Promise<PreviaImportacao> {
  const { data, error } = await sb().rpc("grade_importar_tita_previa", { p_de: de, p_ate: ate })
  if (error) falha(error)
  return data as PreviaImportacao
}

export async function aplicarLote(importacaoId: string, excluirSumidos: boolean, profissionais: number[]): Promise<AplicadoImportacao> {
  const { data, error } = await sb().rpc("grade_importar_tita_aplicar", {
    p_importacao_id: importacaoId, p_excluir_sumidos: excluirSumidos, p_profissionais: profissionais,
  })
  if (error) falha(error)
  return (data as { aplicado: AplicadoImportacao }).aplicado
}

export async function concluirImportacao(importacaoId: string): Promise<AplicadoImportacao> {
  const { data, error } = await sb().rpc("grade_importar_tita_concluir", { p_importacao_id: importacaoId })
  if (error) falha(error)
  return data as AplicadoImportacao
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
