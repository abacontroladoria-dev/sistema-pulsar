import type { SupabaseClient } from '@supabase/supabase-js'
import { auditarEvolucaoComIA } from './auditorEngine'
import { carregarCriteriosVigentes, type CriteriosVigentes } from './criterios'
import { carregarPosicoesNoDia, descreverPosicao } from './posicaoSessao'

/**
 * Auditar uma evolução e gravar o veredito — num lugar só.
 *
 * A rota síncrona (Reauditar de uma evolução) e o worker da fila chamam isto.
 * Duas cópias divergiriam no primeiro ajuste: uma esqueceria a posição da
 * sessão no dia, a outra o carimbo de versão, e a mesma evolução teria
 * vereditos diferentes conforme o botão.
 */

export const COLUNAS_GRADE = `
  id,
  tita_agendamento_id,
  data,
  profissional_id,
  profissional_nome,
  paciente_id,
  paciente_nome,
  terapia_nome,
  unidade_id,
  unidade_nome,
  descricao_evolucao
`

export interface GradeParaAuditar {
  id: string
  tita_agendamento_id: number | null
  data: string
  profissional_id: number | null
  profissional_nome: string | null
  paciente_id: number | null
  paciente_nome: string | null
  terapia_nome: string | null
  unidade_id: number | null
  unidade_nome: string | null
  descricao_evolucao: string | null
}

export interface FalhaAuditoria {
  grade_id: string
  paciente_nome: string
  motivo: string
}

/** Só o que ainda pode ser auditado: ativo e com texto de evolução. */
export async function buscarGradesPorId(
  supabase: SupabaseClient,
  ids: string[]
): Promise<GradeParaAuditar[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('csv_grades_profissionais')
    .select(COLUNAS_GRADE)
    .in('id', ids)
    .eq('ativo', true)
    .not('descricao_evolucao', 'is', null)
    .neq('descricao_evolucao', '')
  if (error) throw new Error(`falha ao ler a grade: ${error.message}`)
  return (data ?? []) as GradeParaAuditar[]
}

export async function auditarEPersistir(
  supabase: SupabaseClient,
  itens: GradeParaAuditar[],
  opcoes: { concorrencia?: number; criterios?: CriteriosVigentes } = {}
): Promise<{ processados: Record<string, unknown>[]; falhas: FalhaAuditoria[]; criteriosVersao: number | null }> {
  const processados: Record<string, unknown>[] = []
  const falhas: FalhaAuditoria[] = []
  if (itens.length === 0) return { processados, falhas, criteriosVersao: opcoes.criterios?.versaoNumero ?? null }

  // Fora do laço: todas as linhas do lote ficam carimbadas com a MESMA versão.
  const { criterios, versaoId, versaoNumero } = opcoes.criterios ?? (await carregarCriteriosVigentes(supabase))
  const posicoes = await carregarPosicoesNoDia(supabase, itens)

  const auditarUm = async (item: GradeParaAuditar) => {
    try {
      const posicao = posicoes.get(item.id)
      const analise = await auditarEvolucaoComIA({
        pacienteNome: item.paciente_nome || 'Paciente',
        profissionalNome: item.profissional_nome || 'Profissional',
        terapiaNome: item.terapia_nome,
        dataSessao: item.data,
        posicaoNoDia: posicao ? descreverPosicao(posicao) : undefined,
        textoOriginal: item.descricao_evolucao || '',
        criterios
      })

      const agora = new Date().toISOString()
      const { data, error } = await supabase
        .from('auditoria_evolucoes')
        .upsert(
          {
            grade_id: item.id,
            tita_agendamento_id: item.tita_agendamento_id,
            data_sessao: item.data,
            profissional_id: item.profissional_id,
            profissional_nome: item.profissional_nome || 'Profissional',
            paciente_id: item.paciente_id,
            paciente_nome: item.paciente_nome || 'Paciente',
            terapia_nome: item.terapia_nome,
            unidade_id: item.unidade_id,
            unidade_nome: item.unidade_nome,
            texto_original: item.descricao_evolucao,
            status_risco: analise.status_risco,
            resumo_justificativa: analise.resumo_justificativa,
            apontamentos: analise.apontamentos,
            checklist_perguntas: analise.checklist_perguntas,
            inconsistencias_estruturais: analise.inconsistencias_estruturais,
            texto_revisado: analise.texto_revisado,
            modelo_ia: analise.modelo_usado,
            criterios_versao_id: versaoId,
            criterios_versao_numero: versaoNumero,
            // Deu certo agora: limpa o erro de uma tentativa anterior.
            erro_auditoria: null,
            auditado_em: agora,
            updated_at: agora
          },
          { onConflict: 'grade_id' }
        )
        .select()
        .single()

      if (error) {
        console.error('[Auditoria] Erro ao gravar auditoria:', error)
        falhas.push({ grade_id: item.id, paciente_nome: item.paciente_nome || 'Paciente', motivo: error.message })
      } else {
        processados.push(data)
      }
    } catch (itemErr) {
      const motivo = itemErr instanceof Error ? itemErr.message : 'Erro desconhecido'
      console.error(`[Auditoria] Falha ao processar item ${item.id}:`, motivo)
      falhas.push({ grade_id: item.id, paciente_nome: item.paciente_nome || 'Paciente', motivo })

      // `status_risco` é NOT NULL + CHECK: não existe veredito "erro". Então
      // só dá para registrar a falha onde JÁ existe uma auditoria anterior —
      // o veredito antigo fica preservado e a tela o marca como desatualizado.
      // Item nunca auditado não vira linha: aparece em `falhas`. O que não pode
      // acontecer é inventar um veredito para a linha.
      const { error: erroMarcacao } = await supabase
        .from('auditoria_evolucoes')
        .update({ erro_auditoria: motivo, updated_at: new Date().toISOString() })
        .eq('grade_id', item.id)
      if (erroMarcacao) {
        console.error('[Auditoria] Falha ao registrar erro_auditoria:', erroMarcacao.message)
      }
    }
  }

  const concorrencia = Math.max(1, opcoes.concorrencia ?? 1)
  let proximo = 0
  await Promise.all(
    Array.from({ length: Math.min(concorrencia, itens.length) }, async () => {
      while (proximo < itens.length) await auditarUm(itens[proximo++])
    })
  )

  return { processados, falhas, criteriosVersao: versaoNumero }
}
