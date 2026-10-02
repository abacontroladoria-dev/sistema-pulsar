import { getSupabaseClient } from '@/lib/supabase/client'
import { ehMigrationPendente } from '@/lib/supabase/erro'
import { semanasEsperadas } from '@/lib/remuneracao/semanasCompetencia'
import { somarMeses, type ConferenciaMes, type DadosSituacao, type EvidenciaDoMes } from '@/lib/remuneracao/situacaoEntregasPep'
import { getFeriados } from '@/services/feriados.service'
import { getCatalogoItens } from '@/services/pep.service'
import { getCalendarioCompetencia } from '@/services/pepCalendario.service'

// Os dados de que o status do analista (Faltam entregas / Entregas completas /
// Conferido / Liberado) precisa, de TODOS os analistas do mês, em poucas
// consultas. O PostgREST corta cada resposta em 1000 linhas sem avisar, então
// tudo que pode passar disso é lido por páginas.

const PAGINA = 1000

async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw error
    const linhas = (data ?? []) as T[]
    todas.push(...linhas)
    if (linhas.length < PAGINA) return todas
  }
}

/** null = não foi possível ler (a tela mostra "Sem dados" em vez de inventar um status). */
export async function carregarDadosSituacao(competencia: string): Promise<DadosSituacao | null> {
  const sb = getSupabaseClient()
  try {
    const [{ data: catalogo, error: erroCatalogo }, { data: calendario }, { data: feriados }] = await Promise.all([
      getCatalogoItens(), getCalendarioCompetencia(competencia), getFeriados(),
    ])
    if (erroCatalogo || !catalogo) return null

    const inicioCiclo = somarMeses(competencia, -5)
    const [registros, planos, entregasSemestrais, sugestoes, conferencias] = await Promise.all([
      lerTudo<DadosSituacao['registros'][number]>((de, ate) => sb.from('pep_registros_entrega')
        .select('prestador_nome, paciente_nome, item_id, status, quantidade_entregue, updated_at')
        .eq('competencia', competencia).order('id').range(de, ate)),
      lerTudo<DadosSituacao['planos'][number]>((de, ate) => sb.from('pep_planejamento_semestral')
        .select('paciente_nome, item_id, competencia_planejada')
        .eq('ativo', true).lte('competencia_planejada', competencia).order('id').range(de, ate)),
      // Uma entrega semestral vale dos 5 meses antes do mês planejado até hoje;
      // 11 meses para trás cobrem qualquer plano vencido agora.
      lerTudo<DadosSituacao['entregasSemestrais'][number]>((de, ate) => sb.from('pep_registros_entrega')
        .select('paciente_nome, item_id, competencia')
        .eq('status', 'entregue').is('quantidade_entregue', null)
        .gte('competencia', somarMeses(inicioCiclo, -6)).lte('competencia', competencia).order('id').range(de, ate)),
      listarSugestoes(competencia),
      listarConferencias(competencia),
    ])
    return {
      catalogo, registros, planos, entregasSemestrais, sugestoes, conferencias,
      semanasEsperadas: calendario?.semanas_supervisao_estudo ?? semanasEsperadas(competencia, feriados ?? []),
    }
  } catch (e) {
    console.warn('Situação das entregas indisponível:', e)
    return null
  }
}

async function listarSugestoes(competencia: string): Promise<DadosSituacao['sugestoes']> {
  try {
    return await lerTudo<DadosSituacao['sugestoes'][number]>((de, ate) => getSupabaseClient().from('sp_pep_itens')
      .select('prestador_nome, padrao, robo_obs')
      .eq('status', 'sugerido').eq('competencia', competencia).order('sp_id').range(de, ate))
  } catch {
    // Robô não aplicado neste ambiente (ou sem permissão): sem sugestões, a conta segue.
    return []
  }
}

/** Evidências do mês que estão na pasta do SharePoint (sem as apagadas). [] se o robô não está neste ambiente. */
export async function listarEvidenciasDoMes(competencia: string): Promise<EvidenciaDoMes[]> {
  try {
    return await lerTudo<EvidenciaDoMes>((de, ate) => getSupabaseClient().from('sp_pep_itens')
      .select('prestador_nome, paciente_nome, sigla, padrao')
      .eq('tipo', 'evidencia').eq('competencia', competencia).is('removido_em', null)
      .not('prestador_nome', 'is', null).order('sp_id').range(de, ate))
  } catch {
    return []
  }
}

/** [] com a migration 20261003110000 pendente: ninguém conferido ainda. */
export async function listarConferencias(competencia: string): Promise<ConferenciaMes[]> {
  const { data, error } = await getSupabaseClient()
    .from('pep_conferencia_mensal')
    .select('prestador_nome, conferido_em, conferido_por_nome')
    .eq('competencia', competencia)
  if (error) {
    if (!ehMigrationPendente(error)) console.warn('Conferência indisponível:', error)
    return []
  }
  return (data ?? []) as ConferenciaMes[]
}

/** Marca (ou desmarca) a conferência das entregas do analista no mês. */
export async function conferirMes(prestadorNome: string, competencia: string, conferir: boolean): Promise<void> {
  const { error } = await getSupabaseClient().rpc('pep_conferir_mes', {
    p_prestador: prestadorNome, p_competencia: competencia, p_conferir: conferir,
  })
  if (error) {
    if (ehMigrationPendente(error)) throw new Error('A conferência ainda não está disponível neste ambiente (falta aplicar a migration 20261003110000).')
    throw error
  }
}
