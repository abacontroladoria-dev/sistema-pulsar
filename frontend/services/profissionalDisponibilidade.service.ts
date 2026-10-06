import { buscarGrade } from "@/lib/grade/fonte"
import { getSupabaseClient } from "@/lib/supabase/client"
import { ehMigrationPendente } from "@/lib/supabase/erro"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import type {
  EventoDisponibilidade, FaixaGravada, LocalDisponivel, OcupacaoLocal, OrigemVersao,
  SituacaoGradeProfissional, VersaoDisponibilidade,
} from "@/types/disponibilidadeProfissional"

// Ver supabase/migrations/20261006140000_profissionais_disponibilidade.sql.
// Leitura direto das tabelas/views (RLS por cadastros_profissionais); escrita
// SÓ pelas RPCs — as tabelas não têm grant de escrita para a aplicação.

type ErroPg = { message: string; code?: string }

function mensagem(e: ErroPg): string {
  const m = e.message ?? ""
  if (e.code === "42501" || /permission denied|row-level security|Sem permissão/i.test(m)) {
    return "Você não tem permissão para alterar a disponibilidade. Peça a permissão 'Profissionais' a um administrador."
  }
  if (/prof_disp_faixas_intervalo_check/.test(m)) return "Há intervalo fora da faixa de horário."
  if (/prof_disp_faixas_horario_check/.test(m)) return "Há faixa com o fim antes do início."
  if (/prof_disp_faixas_dia_check/.test(m)) return "Dia da semana inválido."
  if (/prof_disp_faixas_duracao_check/.test(m)) return "Duração de sessão inválida."
  if (/prof_disp_versoes_periodo_check/.test(m)) return "O fim da vigência é anterior ao início."
  // As RPCs já levantam mensagens em português (sobreposição, terapia não habilitada…).
  return m
}

function falha(e: ErroPg): never {
  if (ehMigrationPendente(e)) throw new MigrationPendenteError("disponibilidade dos profissionais")
  throw new Error(mensagem(e))
}

const COLS_VERSAO =
  "id, profissional_id, numero, vigente_de, vigente_ate, dias_ativos, origem, restaurada_de, motivo, criado_por_nome, criado_em, situacao"
const COLS_FAIXA =
  "id, versao_id, dia_semana, hora_inicio, hora_fim, duracao_min, intervalo_ativo, intervalo_inicio, intervalo_fim, local_id, local_nome, unidade_nome, ordem, profissionais_disponibilidade_faixa_terapias(terapia_id, terapia_nome)"

/** Todas as versões do profissional com as faixas (mais recente primeiro). */
export async function listarVersoes(profissionalId: number): Promise<VersaoDisponibilidade[]> {
  const sb = getSupabaseClient()
  const { data: versoes, error } = await sb
    .from("vw_profissionais_disponibilidade_versoes")
    .select(COLS_VERSAO)
    .eq("profissional_id", profissionalId)
    .order("vigente_de", { ascending: false })
  if (error) falha(error)
  const lista = (versoes ?? []) as unknown as Omit<VersaoDisponibilidade, "faixas">[]
  if (!lista.length) return []

  const { data: faixas, error: e2 } = await sb
    .from("profissionais_disponibilidade_faixas")
    .select(COLS_FAIXA)
    .in("versao_id", lista.map(v => v.id))
    .order("dia_semana")
    .order("hora_inicio")
  if (e2) falha(e2)

  type Linha = Omit<FaixaGravada, "terapias"> & {
    versao_id: string
    profissionais_disponibilidade_faixa_terapias: { terapia_id: number; terapia_nome: string }[]
  }
  const porVersao = new Map<string, FaixaGravada[]>()
  for (const f of (faixas ?? []) as unknown as Linha[]) {
    const { profissionais_disponibilidade_faixa_terapias: ts, versao_id, ...resto } = f
    porVersao.set(versao_id, [...(porVersao.get(versao_id) ?? []), { ...resto, terapias: ts ?? [] }])
  }
  return lista.map(v => ({ ...v, faixas: porVersao.get(v.id) ?? [] }))
}

export async function listarEventos(profissionalId: number): Promise<EventoDisponibilidade[]> {
  const { data, error } = await getSupabaseClient()
    .from("profissionais_disponibilidade_eventos")
    .select("id, versao_id, tipo, antes, depois, motivo, usuario_nome, criado_em, criado_em_brasilia")
    .eq("profissional_id", profissionalId)
    .order("criado_em", { ascending: false })
    .limit(200)
  if (error) falha(error)
  return (data ?? []) as EventoDisponibilidade[]
}

/** Situação da grade de todos (lista de profissionais). Sem linha = sem grade. */
export async function listarSituacaoGrades(): Promise<Map<number, SituacaoGradeProfissional>> {
  const { data, error } = await getSupabaseClient()
    .from("vw_profissionais_grade_situacao")
    .select("profissional_id, situacao, versao_vigente_id, vigente_desde, vigente_ate, proxima_de, encerrada_em, total_versoes")
  if (error) falha(error)
  return new Map(((data ?? []) as SituacaoGradeProfissional[]).map(s => [s.profissional_id, s]))
}

export async function listarLocais(): Promise<LocalDisponivel[]> {
  const { data, error } = await getSupabaseClient().rpc("profissionais_locais")
  if (error) falha(error)
  return (data ?? []) as LocalDisponivel[]
}

/** Faixas de versões vigentes/agendadas de OUTROS profissionais — base dos avisos de local. */
export async function listarOcupacoesDeOutros(profissionalId: number): Promise<OcupacaoLocal[]> {
  const sb = getSupabaseClient()
  const { data: versoes, error } = await sb
    .from("vw_profissionais_disponibilidade_versoes")
    .select("id, profissional_id, vigente_de, vigente_ate, dias_ativos")
    .neq("profissional_id", profissionalId)
    .in("situacao", ["vigente", "agendada"])
  if (error) falha(error)
  const vs = (versoes ?? []) as { id: string; profissional_id: number; vigente_de: string; vigente_ate: string | null; dias_ativos: number[] }[]
  if (!vs.length) return []
  const porId = new Map(vs.map(v => [v.id, v]))
  const out: OcupacaoLocal[] = []
  // Em lotes: `in` com centenas de uuids estoura o tamanho da URL.
  for (let i = 0; i < vs.length; i += 80) {
    const { data, error: e2 } = await sb
      .from("profissionais_disponibilidade_faixas")
      .select("versao_id, local_id, dia_semana, hora_inicio, hora_fim")
      .in("versao_id", vs.slice(i, i + 80).map(v => v.id))
    if (e2) falha(e2)
    for (const f of (data ?? []) as { versao_id: string; local_id: string; dia_semana: number; hora_inicio: string; hora_fim: string }[]) {
      const v = porId.get(f.versao_id)!
      if (!v.dias_ativos.includes(f.dia_semana)) continue
      out.push({ local_id: f.local_id, dia_semana: f.dia_semana, hora_inicio: f.hora_inicio, hora_fim: f.hora_fim,
        profissional_id: v.profissional_id, vigente_de: v.vigente_de, vigente_ate: v.vigente_ate })
    }
  }
  return out
}

export async function criarVersao(args: {
  profissionalId: number
  vigenteDe: string
  vigenteAte: string | null
  dias: number[]
  faixas: unknown[]
  motivo: string | null
  origem: OrigemVersao
  restauradaDe?: string | null
}): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("profissional_disponibilidade_criar_versao", {
    p_profissional_id: args.profissionalId,
    p_vigente_de: args.vigenteDe,
    p_vigente_ate: args.vigenteAte,
    p_dias: args.dias,
    p_faixas: args.faixas,
    p_motivo: args.motivo,
    p_origem: args.origem,
    p_encerrar_anterior: true,
    p_restaurada_de: args.restauradaDe ?? null,
  })
  if (error) falha(error)
  // Sem id de volta = nada foi gravado (defesa contra falha silenciosa).
  if (!data) throw new Error("A versão não foi gravada. Tente de novo.")
  return data as string
}

export async function alterarVigencia(versaoId: string, vigenteDe: string, vigenteAte: string | null, motivo: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc("profissional_disponibilidade_alterar_vigencia", {
    p_versao_id: versaoId,
    p_vigente_de: vigenteDe,
    p_vigente_ate: vigenteAte,
    p_motivo: motivo,
  })
  if (error) falha(error)
}

/**
 * Horários (Livre + Agendado) do profissional na grade TiTa numa semana — base
 * do "Preencher a partir da grade TiTa". Livre e Agendado contam igual: os dois
 * são horário em que o profissional está disponível para a clínica.
 */
export async function lerSemanaTita(titaProfissionalId: number, de: string, ate: string) {
  return buscarGrade<{ data: string; hora_inicial: string; hora_final: string; terapia_nome: string | null; sala_nome: string | null; status_agendamento: string | null }>({
    fonte: "base",
    unidade: 280,
    de,
    ate,
    campos: "data, hora_inicial, hora_final, terapia_nome, sala_nome, status_agendamento",
    refinar: q => q.eq("profissional_id", titaProfissionalId),
    ordem: [{ coluna: "data" }, { coluna: "hora_inicial" }, { coluna: "id" }],
  })
}
