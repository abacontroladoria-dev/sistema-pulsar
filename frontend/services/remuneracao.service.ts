import { getSupabaseClient } from '@/lib/supabase/client'

// Lista de profissionais distintos vindos da grade (vw_remuneracao_profissionais_roster),
// usada para popular a lista completa de cadastro mesmo para quem ainda não tem
// contrato antigo/atual cadastrado.
export async function getProfissionaisRoster(): Promise<{ data: string[] | null; error: unknown }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('vw_remuneracao_profissionais_roster')
    .select('profissional_nome')
    .order('profissional_nome')

  if (error) {
    console.error('Erro getProfissionaisRoster:', error)
    return { data: null, error }
  }
  return { data: (data ?? []).map((r: any) => r.profissional_nome as string), error: null }
}

// Quantos meses de agenda_tita olhar para trás ao datar um desligamento. Só
// precisamos saber se o último atendimento ativo cabe na janela de exibição
// (mês do desligamento + 1), então 4 meses dão folga de sobra — e o corte
// importa: sem ele a consulta cresce sem limite numa tabela de ~72k linhas.
const MESES_JANELA_DESLIGAMENTO = 4

export type UltimoAtendimentoAtivo = { nome: string; ultimaData: string }

// Último atendimento ATIVO de cada profissional, por profissional_id.
//
// Serve para datar um desligamento sem ter coluna de desligamento em lugar
// nenhum: quando o TiTa inativa alguém, o nome dele em csv_grades_profissionais
// vira "INATIVO-<nome>" (diz QUEM saiu) e os atendimentos dele passam a
// ativo=false (o último ativo diz QUANDO). O agenda_tita ainda guarda o nome
// limpo sob o mesmo profissional_id, então isto também resolve o nome de exibição
// e o match do cadastro de contrato, que é feito por nome.
//
// Consultar só os ids já marcados como desligados (2 a 6 por mês), nunca o
// roster inteiro.
export async function getUltimoAtendimentoAtivo(
  ids: number[],
): Promise<{ data: Record<number, UltimoAtendimentoAtivo>; error: unknown }> {
  if (!ids.length) return { data: {}, error: null }

  const corte = new Date()
  corte.setMonth(corte.getMonth() - MESES_JANELA_DESLIGAMENTO)

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('agenda_tita')
    .select('profissional_id, profissional_nome, data_atendimento')
    .in('profissional_id', ids)
    .eq('ativo', true)
    .gte('data_atendimento', corte.toISOString().slice(0, 10))
    .order('data_atendimento', { ascending: false })

  if (error) {
    console.error('Erro getUltimoAtendimentoAtivo:', error)
    return { data: {}, error }
  }

  // Já vem ordenado por data desc, então a primeira linha de cada id é a mais recente.
  const porId: Record<number, UltimoAtendimentoAtivo> = {}
  for (const r of (data ?? []) as Array<{ profissional_id: number; profissional_nome: string | null; data_atendimento: string }>) {
    if (porId[r.profissional_id]) continue
    porId[r.profissional_id] = {
      nome: (r.profissional_nome ?? '').trim(),
      ultimaData: r.data_atendimento,
    }
  }
  return { data: porId, error: null }
}

// Tabela única de contratos (substitui remuneracao_contratos_atuais +
// remuneracao_contratos_antigos — ver migration 20260710120000): 1 linha por
// profissional. Os itens de contrato (numero, funcao, valorPA, vigente,
// modeloFaturamento, valorTotal) vivem em remuneracao_contratos_itens desde
// 20260724160000 (colunas próprias em vez do blob jsonb "contratos", que
// fica congelado como backup) — reconstruídos aqui no mesmo shape
// `contratos: ContratoAtualItem[]` que os consumidores (hooks/telas) já esperam.
export async function getContratos() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('remuneracao_contratos')
    .select('*, remuneracao_contratos_itens(*)')
    .order('profissional_nome')
  if (error) {
    console.error('Erro getContratos:', error)
    return { data: null, error }
  }
  const shaped = (data ?? []).map((r: any) => {
    const { remuneracao_contratos_itens, ...resto } = r
    return {
      ...resto,
      contratos: (remuneracao_contratos_itens ?? [])
        .slice()
        .sort((a: any, b: any) => a.ordem - b.ordem)
        // Whitelist: campo novo no item que não entrar aqui desaparece em
        // silêncio na leitura, mesmo estando gravado.
        .map((it: any) => ({
          numero: it.numero ?? '',
          funcao: it.funcao ?? '',
          valorPA: it.valor_pa ?? 0,
          vigente: it.vigente,
          modeloFaturamento: it.modelo_faturamento === 'banco_horas' ? 'banco_horas' : 'atendimento',
          valorTotal: it.valor_total ?? 0,
          // null -> '' como numero/funcao: mantém a assinatura do rascunho igual
          // entre "veio do banco" e "digitado no modal", senão o bloco nasceria
          // marcado como não salvo sem ninguém ter mexido nele.
          observacoes: it.observacoes ?? '',
          valorPepMensal: it.valor_pep_mensal ?? null,
          especialidadesBancoHoras: it.especialidades_banco_horas ?? null,
          // undefined antes da migration 20261007150000 — vira null, igual a "sem exceção".
          valoresPorTerapia: it.valores_por_terapia ?? null,
        })),
    }
  })
  return { data: shaped, error: null }
}

export async function upsertContrato(record: any): Promise<{ ok: boolean; error: string | null }> {
  const supabase = getSupabaseClient()
  const { contratos, ...parent } = record

  const { data: parentRow, error: parentError } = await supabase
    .from('remuneracao_contratos')
    .upsert(parent, { onConflict: 'profissional_nome' })
    .select('id')
    .single()
  if (parentError) {
    console.error('Erro ao salvar contrato:', parentError)
    return { ok: false, error: parentError.message }
  }

  // Coluna de exceções por terapia (migration 20261007150000). Confere ANTES do
  // delete abaixo: se ela ainda não existe no banco, o insert voltaria PGRST204
  // depois de já ter apagado os itens, e o profissional ficaria sem contrato.
  // Só é preciso quando algum item traz exceção — sem exceção a chave nem vai.
  const temExcecao = (contratos ?? []).some((it: { valoresPorTerapia?: unknown[] | null }) => !!it.valoresPorTerapia?.length)
  if (temExcecao) {
    const { error: colunaError } = await supabase
      .from('remuneracao_contratos_itens')
      .select('valores_por_terapia')
      .limit(1)
    if (colunaError) {
      console.error('Coluna valores_por_terapia indisponível:', colunaError)
      return {
        ok: false,
        error: 'Valor por terapia ainda não está disponível no banco (falta aplicar a migration 20261007150000). Nada foi alterado.',
      }
    }
  }

  // Substitui os itens do profissional pelo conjunto atual (mais simples que
  // diff — o volume por profissional é pequeno e a tela sempre manda a lista
  // completa dos contratos daquele profissional).
  const { error: deleteError } = await supabase
    .from('remuneracao_contratos_itens')
    .delete()
    .eq('contrato_id', parentRow.id)
  if (deleteError) {
    console.error('Erro ao limpar itens de contrato:', deleteError)
    return { ok: false, error: deleteError.message }
  }

  const itens = (contratos ?? []).map((it: any, idx: number) => ({
    contrato_id: parentRow.id,
    ordem: idx,
    numero: it.numero || null,
    funcao: it.funcao || null,
    valor_pa: it.valorPA ?? null,
    vigente: it.vigente ?? true,
    modelo_faturamento: it.modeloFaturamento === 'banco_horas' ? 'banco_horas' : 'atendimento',
    valor_total: it.valorTotal ?? null,
    // A observação é POR CONTRATO desde a migration 20260803120000. Requer que a
    // coluna exista: sem ela o insert volta PGRST204 e, como o delete acima já
    // rodou, o profissional fica sem contrato nenhum.
    observacoes: it.observacoes || null,
    valor_pep_mensal: it.valorPepMensal ?? null,
    especialidades_banco_horas: it.especialidadesBancoHoras?.length ? it.especialidadesBancoHoras : null,
    // Chave só quando há exceção: sem a migration aplicada, mandar a coluna
    // (mesmo null) derrubaria o insert de TODO contrato, não só deste.
    ...(it.valoresPorTerapia?.length ? { valores_por_terapia: it.valoresPorTerapia } : {}),
  }))
  if (itens.length) {
    const { error: itensError } = await supabase.from('remuneracao_contratos_itens').insert(itens)
    if (itensError) {
      console.error('Erro ao salvar itens de contrato:', itensError)
      return { ok: false, error: itensError.message }
    }
  }

  return { ok: true, error: null }
}
