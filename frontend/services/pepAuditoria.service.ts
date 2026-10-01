import { getSupabaseClient } from '@/lib/supabase/client'
import { resumoAlteracao } from '@/lib/remuneracao/pepAuditoriaFormat'

export type PepTrilhaTabela = 'registro_entrega' | 'planejamento_semestral' | 'apuracao_mensal' | 'calendario_competencia'
// 'reverter' = entrega do robô desfeita (20261002100000), gravada pelo banco.
export type PepTrilhaAcao = 'criar' | 'editar' | 'excluir' | 'reverter'

export type PepTrilhaAuditoria = {
  id: string
  tabela: PepTrilhaTabela
  registro_id: string
  acao: PepTrilhaAcao
  prestador_nome: string | null
  paciente_nome: string | null
  competencia: string | null
  antes: unknown
  depois: unknown
  motivo: string | null
  usuario_id: string | null
  usuario_nome: string | null
  criado_em: string
  /** Já formatado como DD/MM/AAAA HH:MM, horário de Brasília — preenchido por trigger no banco. */
  criado_em_brasilia: string | null
  /** Resumo em uma linha ("Status: Pendente → Entregue"), calculado no insert — pra ler direto na planilha do Supabase, sem abrir o JSON. */
  resumo: string | null
  /** Quem fez: o robô SharePoint (gravado pelo banco) ou uma pessoa (default). */
  ator?: 'robo' | 'humano'
}

// PRD Seção 11.4 — toda alteração manual fica em trilha de auditoria
// (usuário, competência, antes/depois). Chamado pelos próprios serviços de
// escrita (pep.service.ts, pepApuracao.service.ts, pepCalendario.service.ts),
// nunca direto pela tela.
export async function registrarAuditoria(input: {
  tabela: PepTrilhaTabela
  registroId: string
  acao: PepTrilhaAcao
  prestadorNome?: string | null
  pacienteNome?: string | null
  competencia?: string | null
  antes?: unknown
  depois?: unknown
  motivo?: string | null
}): Promise<void> {
  const supabase = getSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Denormalizado de propósito: se o usuário for renomeado depois, a trilha
  // continua mostrando o nome de quem realmente fez a ação naquele momento.
  const usuarioNome = user?.id
    ? (await supabase.from('usuarios').select('nome').eq('id', user.id).maybeSingle()).data?.nome ?? null
    : null
  const { error } = await supabase.from('pep_trilha_auditoria').insert({
    tabela: input.tabela,
    registro_id: input.registroId,
    acao: input.acao,
    prestador_nome: input.prestadorNome ?? null,
    paciente_nome: input.pacienteNome ?? null,
    competencia: input.competencia ?? null,
    antes: input.antes ?? null,
    depois: input.depois ?? null,
    motivo: input.motivo ?? null,
    usuario_id: user?.id ?? null,
    usuario_nome: usuarioNome,
    resumo: resumoAlteracao(input),
  })
  // Auditoria não pode derrubar a ação principal (salvar/excluir o registro
  // real) — só loga o erro. Perder uma linha de trilha é ruim; bloquear o
  // trabalho da clínica por causa dela seria pior.
  if (error) console.error('Erro registrarAuditoria:', error)
}

// prestadorNome omitido = visão geral (todos os prestadores, inclusive
// entradas sem prestador como calendario_competencia). Sempre todas as
// competências — quem quer só o mês vê pelo próprio "Competência" da linha.
export async function getTrilhaAuditoria(filtros?: {
  prestadorNome?: string
  pagina?: number
  limite?: number
}): Promise<{ data: PepTrilhaAuditoria[]; total: number; error: unknown }> {
  const supabase = getSupabaseClient()
  let query = supabase.from('pep_trilha_auditoria').select('*', { count: 'exact' }).order('criado_em', { ascending: false })
  if (filtros?.prestadorNome) query = query.eq('prestador_nome', filtros.prestadorNome)
  const limite = filtros?.limite ?? 30
  const pagina = filtros?.pagina ?? 1
  const inicio = (pagina - 1) * limite
  query = query.range(inicio, inicio + limite - 1)
  const { data, error, count } = await query
  if (error) {
    console.error('Erro getTrilhaAuditoria:', error)
    return { data: [], total: 0, error }
  }
  return { data: (data ?? []) as PepTrilhaAuditoria[], total: count ?? 0, error: null }
}