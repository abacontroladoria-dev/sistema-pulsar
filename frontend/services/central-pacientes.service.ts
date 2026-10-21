import { getSupabaseClient }
from '@/lib/supabase/client'
import { buscarVinculosDosBlocos } from '@/services/auditoria-assim.service'
import { montarBlocoId } from '@/lib/central/blocoId'
import type { VinculoCobertura } from '@/components/auditoria-assim/types'

const supabase =
  getSupabaseClient()

export async function listarCentralPacientes(
  data: string
): Promise<Record<string, any>[]> {

  const { data: response, error } =
    await supabase
      .rpc('listar_central_pacientes', { p_data: data })
      .order('horario', { ascending: true })

  if (error) {

	console.error(
	  'ERRO CENTRAL:',
	  JSON.stringify(error, null, 2)
	)

    return []
  }

  return response || []
}

/**
 * Qual guia externa cobriu cada sessão glosada do dia — o depois da Reconciliação.
 *
 * A Central sabe que a ASSIM recusou (`status_operacional = 'glosa'`), mas não
 * sabia que alguém já tinha resolvido a recusa vinculando uma guia autorizada
 * por fora do Pulsar. Sem isto a mesma sessão fica vermelha aqui e "Glosa
 * Resolvida" na aba Auditoria — duas telas do mesmo sistema discordando sobre o
 * mesmo fato, e a errada é a que o coordenador olha o dia inteiro.
 *
 * A chave é o `bloco_id`, e não `autorizacoes_vinculos.fila_id`: aquele campo é
 * rastreabilidade da solicitação original (pode vir nulo, e um ON DELETE SET
 * NULL o zera), enquanto o bloco é a referência de COBERTURA — a que
 * `vincular_autorizacao` valida e a que a Conferência consome. Ler por outra
 * chave seria uma segunda regra, livre para divergir da primeira.
 *
 * O TUSS vem da PRÓPRIA fila (`fila_autorizacoes.tuss`), que é a coluna contra
 * a qual a RPC confere o bloco na hora de gravar o vínculo
 * (20260821000000:641-654). Re-derivar TUSS de nome de terapia no cliente seria
 * a terceira cópia de um mapa que já custou uma divergência silenciosa — ver
 * `tuss_da_sessao`.
 *
 * Devolve o mapa chaveado pelo `id` da linha da Central (que na Parte 1 da view
 * é o `fila_autorizacoes.id`). Sem glosa no dia — o caso comum — não toca a rede.
 */
export async function buscarCoberturaDasGlosas(
  linhas: Record<string, any>[]
): Promise<Map<string, VinculoCobertura>> {

  const porLinha = new Map<string, VinculoCobertura>()

  const idsGlosa = (linhas || [])
    .filter((l) => l?.status_operacional === 'glosa' && l?.id)
    .map((l) => String(l.id))

  if (idsGlosa.length === 0) return porLinha

  // Colunas explícitas, nunca `select('*')`: sob privilégio por coluna o
  // asterisco devolve 403 em vez de devolver o que se pode ler.
  const { data: filas, error } = await supabase
    .from('fila_autorizacoes')
    .select('id, paciente_id, data_atendimento, horario, tuss')
    .in('id', idsGlosa)

  if (error) {
    console.error(
      'Erro ao buscar o TUSS das glosas:',
      error.message,
      error.details
    )
    return porLinha
  }

  const linhaPorBloco = new Map<string, string>()

  for (const fila of filas ?? []) {
    const blocoId = montarBlocoId({
      paciente_id: fila.paciente_id,
      data_atendimento: fila.data_atendimento,
      codigo_tuss: fila.tuss,
      horario: fila.horario,
    })
    if (blocoId) linhaPorBloco.set(blocoId, String(fila.id))
  }

  if (linhaPorBloco.size === 0) return porLinha

  const vinculos = await buscarVinculosDosBlocos(Array.from(linhaPorBloco.keys()))

  for (const [blocoId, vinculo] of vinculos) {
    const idLinha = linhaPorBloco.get(blocoId)
    if (idLinha) porLinha.set(idLinha, vinculo)
  }

  return porLinha
}

export type ResultadoCorrecaoFalta = {
  id: string
  status: string
  tipo_falta: string
  numero_autorizacao: string | null
  // A guia continua emitida na ASSIM e, com a linha em falta, aparece como
  // órfã na Reconciliação — quem corrigiu precisa saber que falta essa triagem.
  guia_ficou_orfa: boolean
}

/**
 * Troca um lançamento já resolvido (presença ou guia capturada) por falta.
 * Toda a regra mora na RPC `corrigir_lancamento_falta`
 * (20261021130000): papel, status aceito, vínculo que impede. O erro dela já
 * vem em frase para a tela.
 */
export async function corrigirLancamentoFalta(params: {
  filaId: string
  tipoFalta: 'paciente' | 'terapeuta'
  justificativa: string
  codigo?: number | null
}): Promise<ResultadoCorrecaoFalta> {
  const { data, error } = await supabase.rpc('corrigir_lancamento_falta', {
    p_fila_id: params.filaId,
    p_tipo_falta: params.tipoFalta,
    p_justificativa: params.justificativa,
    p_codigo: params.tipoFalta === 'paciente' ? params.codigo ?? null : null,
  })

  if (error) throw new Error(error.message)

  const linha = Array.isArray(data) ? data[0] : data
  if (!linha) throw new Error('A correção não devolveu a sessão. Recarregue a tela.')
  return linha as ResultadoCorrecaoFalta
}
