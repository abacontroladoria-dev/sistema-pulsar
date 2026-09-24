import { getSupabaseClient } from "@/lib/supabase/client"
import { getUsuarioAtual } from "@/lib/supabase/usuarioAtual"
import { registrarAuditoria } from "@/services/cadastrosAuditoria.service"

// Lançamento manual de pagamentos/NF recebidos, por paciente e competência —
// fonte do "Efetivado" real usado em Previsão/Histórico de Receitas.
// Ver supabase/migrations/20260923140000_create_previsao_receitas_faturamento.sql.
//
// ⚠️ RLS BLOQUEANDO WRITE NÃO GERA ERRO. Um insert/update negado por policy
// volta como sucesso com zero linhas afetadas — mesmo risco já documentado em
// laudosAcompanhamento.service.ts e visto antes em Ocupação de Salas. Daí o
// `.select().maybeSingle()` e a checagem do retorno abaixo.

const TABELA = "previsao_receitas_faturamento"

const COLUNAS =
  "id, paciente_id, competencia, numero_nf, data_pagamento, valor_pago," +
  " criado_por_nome, atualizado_por_nome, atualizado_em_brasilia"

export interface RegistroFaturamento {
  id: number
  paciente_id: number
  competencia: string
  numero_nf: string | null
  data_pagamento: string | null
  valor_pago: number
  criado_por_nome: string | null
  atualizado_por_nome: string | null
  atualizado_em_brasilia: string | null
}

export interface FiltroFaturamento {
  competencia?: string
  pacienteId?: number
}

/** Lançamentos manuais, filtrados por competência e/ou paciente. */
export async function listarFaturamento(
  filtro: FiltroFaturamento = {},
): Promise<{ data: RegistroFaturamento[]; error: string | null }> {
  const sb = getSupabaseClient()
  let query = sb.from(TABELA).select(COLUNAS).order("competencia", { ascending: false }).order("id", { ascending: false })

  if (filtro.competencia) query = query.eq("competencia", filtro.competencia)
  if (filtro.pacienteId) query = query.eq("paciente_id", filtro.pacienteId)

  const { data, error } = await query

  if (error) {
    console.error("[previsaoReceitasFaturamento] falha ao listar:", error)
    return { data: [], error: error.message }
  }
  return { data: (data as unknown as RegistroFaturamento[]) ?? [], error: null }
}

export interface EdicaoFaturamento {
  id?: number
  pacienteId: number
  pacienteNome: string
  competencia: string
  numeroNf: string | null
  dataPagamento: string | null
  valorPago: number
}

/**
 * Grava um lançamento novo (sem `id`) ou atualiza um existente (`id`
 * presente) e registra a alteração na trilha.
 *
 * Sem upsert por chave de negócio: um paciente+mês pode ter várias linhas
 * (várias NFs), então "salvar" só é update quando a tela está editando uma
 * linha específica pelo seu `id` (PK bigserial).
 */
export async function salvarFaturamento(
  edicao: EdicaoFaturamento,
): Promise<{ data: RegistroFaturamento | null; error: string | null }> {
  const sb = getSupabaseClient()
  const usuario = await getUsuarioAtual()

  // O estado ANTERIOR, lido antes de escrever: é o `antes` da trilha, igual
  // ao padrão de laudosAcompanhamento.service.ts.
  let anterior: RegistroFaturamento | null = null
  if (edicao.id) {
    const { data: existente, error: erroLeitura } = await sb
      .from(TABELA)
      .select(COLUNAS)
      .eq("id", edicao.id)
      .maybeSingle()
    if (erroLeitura) {
      console.error("[previsaoReceitasFaturamento] falha ao ler registro anterior:", erroLeitura)
      return { data: null, error: erroLeitura.message }
    }
    anterior = (existente as unknown as RegistroFaturamento) ?? null
  }

  const payload = {
    paciente_id: edicao.pacienteId,
    competencia: edicao.competencia,
    numero_nf: edicao.numeroNf?.trim() || null,
    data_pagamento: edicao.dataPagamento || null,
    valor_pago: edicao.valorPago,
    atualizado_por_id: usuario.id,
    atualizado_por_nome: usuario.nome,
  }

  const query = edicao.id
    ? sb.from(TABELA).update(payload).eq("id", edicao.id)
    : sb.from(TABELA).insert({ ...payload, criado_por_id: usuario.id, criado_por_nome: usuario.nome })

  const { data, error } = await query.select(COLUNAS).maybeSingle()

  if (error) {
    console.error("[previsaoReceitasFaturamento] falha ao gravar:", error)
    return { data: null, error: error.message }
  }

  // Ver o aviso no cabeçalho: policy negando write volta sem erro e sem linha.
  if (!data) {
    const msg =
      "A gravação não retornou o registro — provavelmente falta de permissão (RLS). Nada foi salvo."
    console.error(`[previsaoReceitasFaturamento] ${msg}`, { id: edicao.id })
    return { data: null, error: msg }
  }

  const gravado = data as unknown as RegistroFaturamento

  await registrarAuditoria({
    tabela: "previsao_receitas_faturamento",
    registroId: gravado.id,
    acao: edicao.id ? "editar" : "criar",
    pacienteId: edicao.pacienteId,
    pacienteNome: edicao.pacienteNome,
    alvoNome: `${edicao.pacienteNome} — ${edicao.competencia}`,
    antes: anterior ? paraTrilha(anterior) : null,
    depois: paraTrilha(gravado),
  })

  return { data: gravado, error: null }
}

/**
 * Exclui um lançamento e registra a exclusão na trilha.
 *
 * Corrigir um valor errado digitado não precisa disso (edita a linha), mas um
 * lançamento criado por engano (paciente/mês trocado) precisa poder sumir da
 * lista — pedido explícito do usuário (2026-09-23).
 */
export async function excluirFaturamento(
  registro: Pick<RegistroFaturamento, "id" | "paciente_id" | "competencia">,
  pacienteNome: string,
): Promise<{ error: string | null }> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.from(TABELA).delete().eq("id", registro.id).select("id").maybeSingle()

  if (error) {
    console.error("[previsaoReceitasFaturamento] falha ao excluir:", error)
    return { error: error.message }
  }
  // Ver o aviso no cabeçalho: policy negando write volta sem erro e sem linha.
  if (!data) {
    const msg = "A exclusão não retornou o registro — provavelmente falta de permissão (RLS). Nada foi excluído."
    console.error(`[previsaoReceitasFaturamento] ${msg}`, { id: registro.id })
    return { error: msg }
  }

  await registrarAuditoria({
    tabela: "previsao_receitas_faturamento",
    registroId: registro.id,
    acao: "excluir",
    pacienteId: registro.paciente_id,
    pacienteNome,
    alvoNome: `${pacienteNome} — ${registro.competencia}`,
    antes: { paciente_id: registro.paciente_id, competencia: registro.competencia },
    depois: null,
  })

  return { error: null }
}

function paraTrilha(r: RegistroFaturamento): Record<string, unknown> {
  return {
    paciente_id: r.paciente_id,
    competencia: r.competencia,
    numero_nf: r.numero_nf,
    data_pagamento: r.data_pagamento,
    valor_pago: r.valor_pago,
  }
}
