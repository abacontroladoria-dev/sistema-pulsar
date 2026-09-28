import { getSupabaseClient } from '@/lib/supabase/client'
import type { ChaveSessao, SessaoConferencia, StatusConferencia } from '@/components/conferencia-guias/folhas'

const supabase = getSupabaseClient()

const TABELA = 'conferencia_guias_assinadas'
const CONFLITO = 'paciente_id,data_atendimento,hora_inicial,codigo_tuss'

/**
 * As sessões ASSIM de um dia, com evolução e conferência já cruzadas.
 *
 * LANÇA no erro, ao contrário de `listarAuditoriaAssim`: um `return []` aqui
 * faria o dia aparecer "sem sessões" — e uma folha sem linhas é lida como folha
 * conferida. Tela vazia por erro tem de dizer que é erro.
 */
export async function listarConferenciaDia(data: string): Promise<SessaoConferencia[]> {
  const { data: result, error } = await supabase.rpc('get_conferencia_guias_dia', { p_data: data })
  if (error) throw error
  return (result ?? []) as SessaoConferencia[]
}

type FaltaRpc = {
  paciente_id: string | number
  paciente_nome: string | null
  data_atendimento: string
  hora_inicial: string
  tuss: string | null
  terapia_nome: string | null
  tipo_falta: string | null
  profissional_nome: string | null
  motivo_falta: string | null
  justificativa_falta: string | null
}

/**
 * As faltas do dia, como linhas da folha. A recepção escreve "falta" na linha
 * do papel, então a falta ocupa uma linha e a numeração da tela bate com a do
 * papel.
 *
 * A mesma função dos cartões de falta da Conferência ASSIM — e a mesma régua: a
 * falta coberta por substituição e a sessão adiantada já saem de lá (voltam
 * como sessão real em `get_conferencia_guias_dia`). Unidade fechada fica de
 * fora: a clínica não abriu, não há folha naquele dia.
 *
 * LANÇA no erro pelo mesmo motivo de `listarConferenciaDia`: sem as faltas a
 * numeração das linhas descola do papel sem nada na tela dizer isso.
 */
export async function listarFaltasDia(data: string): Promise<SessaoConferencia[]> {
  // Pela porta DEFINER da tela (20260925100000): a RPC da Auditoria roda sob a
  // RLS da fila e zera as faltas, sem erro, de quem só tem `conferencia_guias`.
  let { data: result, error } = await supabase.rpc('get_conferencia_guias_faltas_dia', { p_data: data })
  // Antes de a migration rodar a função não existe: segue pela da Auditoria.
  if (error?.code === 'PGRST202') {
    ;({ data: result, error } = await supabase.rpc('get_faltas_auditoria_assim', { p_data: data }))
  }
  if (error) throw error
  return ((result ?? []) as FaltaRpc[])
    .filter((f) => !(f.tipo_falta ?? '').toLowerCase().includes('unidade'))
    .map((f) => {
      const terapeuta = (f.tipo_falta ?? '').toLowerCase().includes('terapeuta')
      return {
        bloco_id: null,
        paciente_id: String(f.paciente_id),
        paciente_nome: f.paciente_nome,
        carteirinha: null,
        data_atendimento: f.data_atendimento,
        hora_inicial: f.hora_inicial,
        codigo_tuss: f.tuss,
        terapias: f.terapia_nome,
        profissionais: f.profissional_nome,
        quantidade_sessoes: null,
        guia: null,
        status_assim: null,
        situacao: terapeuta ? 'FALTA_TERAPEUTA' : 'FALTA',
        observacao: null,
        data_atendimento_real: null,
        grade_total: 0,
        grade_com_evolucao: 0,
        risco_evolucao: null,
        status_conferencia: null,
        conferido_por_nome: null,
        conferido_em: null,
        recepcao_avisada_em: null,
        recepcao_avisada_por_nome: null,
        observacao_conferencia: null,
        guia_vinculo: null,
        tipo_vinculo: null,
        falta: terapeuta ? 'terapeuta' : 'paciente',
        motivo_falta: f.motivo_falta,
        justificativa_falta: f.justificativa_falta,
      } satisfies SessaoConferencia
    })
}

async function usuarioLogado(): Promise<{ id: string | null; nome: string | null }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) return { id: null, nome: null }
  const { data } = await supabase.from('usuarios').select('nome').eq('id', user.id).maybeSingle()
  return { id: user.id, nome: data?.nome ?? null }
}

export type Carimbo = { nome: string | null; em: string }

/**
 * Marca (ou desmarca, com `null`) a assinatura de uma ou mais sessões.
 *
 * Upsert só com as colunas da conferência: o `ON CONFLICT DO UPDATE` do
 * PostgREST toca apenas o que vem no corpo, então o aviso à recepção e a
 * observação da mesma linha sobrevivem.
 */
export async function marcarAssinatura(
  chaves: ChaveSessao[],
  status: StatusConferencia | null
): Promise<Carimbo> {
  const { id, nome } = await usuarioLogado()
  const em = new Date().toISOString()
  const { error } = await supabase.from(TABELA).upsert(
    chaves.map((c) => ({
      ...c,
      status,
      conferido_por: status ? id : null,
      conferido_por_nome: status ? nome : null,
      conferido_em: status ? em : null,
      atualizado_em: em,
    })),
    { onConflict: CONFLITO }
  )
  if (error) throw error
  return { nome, em }
}

export async function marcarRecepcaoAvisada(chave: ChaveSessao, avisada: boolean): Promise<Carimbo> {
  const { id, nome } = await usuarioLogado()
  const em = new Date().toISOString()
  const { error } = await supabase.from(TABELA).upsert(
    {
      ...chave,
      recepcao_avisada_em: avisada ? em : null,
      recepcao_avisada_por: avisada ? id : null,
      recepcao_avisada_por_nome: avisada ? nome : null,
      atualizado_em: em,
    },
    { onConflict: CONFLITO }
  )
  if (error) throw error
  return { nome, em }
}

/**
 * Marca a filipeta da sessão como conferida — no MESMO registro da Conferência
 * de Filipetas (Auditoria ASSIM), por bloco_id, para as duas telas dizerem a
 * mesma coisa. Mesmas colunas que `marcarTokenConferido` grava.
 */
export async function marcarFilipetaConferida(blocoId: string, conferida: boolean): Promise<Carimbo> {
  const { id, nome } = await usuarioLogado()
  const em = new Date().toISOString()
  const { error } = await supabase.from('auditoria_token_conferencias').upsert(
    {
      bloco_id: blocoId,
      conferido: conferida,
      conferido_em: conferida ? em : null,
      conferido_por: conferida ? id : null,
      conferido_por_nome: conferida ? nome : null,
    },
    { onConflict: 'bloco_id' }
  )
  if (error) throw error
  return { nome, em }
}

export async function salvarObservacaoConferencia(chave: ChaveSessao, texto: string): Promise<void> {
  const { error } = await supabase.from(TABELA).upsert(
    { ...chave, observacao: texto.trim() || null, atualizado_em: new Date().toISOString() },
    { onConflict: CONFLITO }
  )
  if (error) throw error
}
