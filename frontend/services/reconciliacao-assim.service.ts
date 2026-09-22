import { getSupabaseClient } from '@/lib/supabase/client'
import type {
  CandidataVinculo,
  GuiaOrfa,
  ReclassificacaoSituacao,
  SituacaoReclassificavel,
  VinculoAutorizacao,
} from '@/components/auditoria-assim/types'

const supabase = getSupabaseClient()

/**
 * Teto de segurança da carga de triagens. Ver `listarVinculosAtivos`.
 *
 * A tabela é um livro de triagem manual: 18 guias órfãs no mês inteiro medido em
 * 2026-08-20, e nem todas são triadas. Mil linhas são anos de operação. O limite
 * existe só para que um erro de dado não vire uma resposta sem fim.
 */
const TETO_VINCULOS = 1000

/**
 * Guias da ASSIM que sobraram do match posicional da Conferência.
 *
 * "Sobraram" é literal: dentro da partição (empresa, matrícula, dep, dia, TUSS),
 * a n-ésima autorização casa com a n-ésima sessão. Uma glosa que depois foi
 * reautorizada no portal deixa a partição com uma guia a mais que sessões — e é
 * essa guia excedente que aparece aqui.
 *
 * O critério inteiro vive na RPC, de propósito: ele depende do mesmo recorte de
 * agenda que a Conferência usa (convênio, blacklist de terapias, exclusão de
 * falta), e uma segunda cópia dele no cliente divergiria na primeira mudança.
 */
export async function listarGuiasOrfas(de: string, ate: string): Promise<GuiaOrfa[]> {
  const { data, error } = await supabase.rpc('get_guias_orfas', { p_de: de, p_ate: ate })

  if (error) {
    console.error('Erro ao buscar guias órfãs:', error.message, error.details)
    throw error
  }
  return (data || []) as GuiaOrfa[]
}

/**
 * As triagens vivas da Reconciliação — o que a tela sabe sobre o DEPOIS da ação.
 *
 * Sem período, e é deliberado. A janela de vínculo é de 7 dias retroativos a
 * partir do instante em que a ASSIM registrou a guia, e ela atravessa a virada
 * do mês: uma guia de 03/08 pode cobrir uma sessão de 30/07. Recortar por
 * `vinculado_em` (quando alguém triou) ou pela data da guia deixaria de fora
 * exatamente o vínculo que cruza a borda — e o cartão da guia voltaria a mentir
 * "Outra semana" justamente no caso mais delicado. Como a tabela é um livro de
 * triagem manual (dezenas de linhas por mês), carregá-la inteira é mais barato
 * que qualquer recorte que precise estar certo nas duas pontas.
 *
 * `desfeito_em is null` porque desfazer é soft: a linha continua no banco para
 * dizer quem desfez e por quê, e uma triagem desfeita não cobre mais nada.
 *
 * Falha em silêncio não é opção aqui — quem chama gateia a primeira pintura
 * nesta carga, pelo mesmo motivo que `get_guias_orfas` passou a ser gateada:
 * pintar antes de saber faz a grade se corrigir na frente de quem está lendo.
 */
export async function listarVinculosAtivos(): Promise<VinculoAutorizacao[]> {
  const { data, error } = await supabase
    .from('autorizacoes_vinculos')
    .select('id, guia, tipo, bloco_id, guia_original, observacao, vinculado_por, vinculado_em')
    .is('desfeito_em', null)
    .order('vinculado_em', { ascending: false })
    .limit(TETO_VINCULOS)

  if (error) {
    console.error('Erro ao buscar vínculos ativos:', error.message, error.details)
    throw error
  }
  return (data || []) as VinculoAutorizacao[]
}

/**
 * Sessões que a guia selecionada poderia estar cobrindo.
 *
 * Janela retroativa: a autorização externa vem DEPOIS da sessão. O default de 7
 * dias saiu da medição de 2026-08-20 — distância máxima observada +3,16 dias
 * (p99 +3,15d) sobre as 18 órfãs reais do período. 3 dias perderia o lote de
 * reautorização em bloco; 5 e 7 dão resultado idêntico.
 *
 * Pode demorar alguns segundos: a RPC chama get_auditoria_assim_periodo uma
 * fatia de dia por vez, porque em janela de 7 dias ela estoura o
 * statement_timeout. É o preço de a `situacao` daqui ser exatamente a mesma que
 * a Conferência mostra, em vez de uma segunda implementação do mesmo CASE.
 */
export async function listarCandidatasVinculo(
  guia: string,
  janelaDias = 7
): Promise<CandidataVinculo[]> {
  const { data, error } = await supabase.rpc('get_candidatas_vinculo', {
    p_guia: guia,
    p_janela_dias: janelaDias,
  })

  if (error) {
    console.error('Erro ao buscar candidatas:', error.message, error.details)
    throw error
  }
  return (data || []) as CandidataVinculo[]
}

/**
 * Grava o vínculo guia -> sessão.
 *
 * Nenhuma validação aqui: beneficiário, TUSS, janela e unicidade são checados
 * dentro da RPC. O vínculo muda o que o faturamento considera coberto, então a
 * regra tem de estar onde o cliente não alcança.
 *
 * `filaId` é rastreabilidade da solicitação original, não cobertura — vem nulo
 * quando a sessão nunca foi solicitada pelo Pulsar.
 */
export async function vincularAutorizacao(params: {
  guia: string
  blocoId: string
  filaId?: string | null
  observacao?: string | null
  janelaDias?: number
}): Promise<string> {
  const { data, error } = await supabase.rpc('vincular_autorizacao', {
    p_guia: params.guia,
    p_bloco_id: params.blocoId,
    p_fila_id: params.filaId ?? null,
    p_observacao: params.observacao ?? null,
    p_janela_dias: params.janelaDias ?? 7,
  })

  if (error) throw error
  return data as string
}

/**
 * Registra que a guia autorizou um horário em que o TERAPEUTA faltou.
 *
 * VÍNCULO PURO, e a palavra importa: nenhuma sessão é criada, a falta continua
 * falta, e assiduidade, cota, glosa e KPIs não mudam. O que muda é só isto — a
 * guia sai da fila de órfãs e o slot da falta passa a dizer de onde veio a
 * autorização. Sem esta ação a guia voltaria à fila todo dia sem ter para onde
 * ir, ou seria descartada como "autorização extra", que apaga o que se sabe.
 *
 * A chave é o `filaId` da falta, e não um bloco: o bloco da falta é sintético
 * (`falta_…`), não existe em `fn_blocos_assim`, e é a RPC que o monta — aceitá-lo
 * do cliente deixaria o formato divergir do que a grade usa como chave.
 *
 * RPC própria e não um ramo de `vincular_autorizacao`: daquelas 8 guardas, 6
 * dependem do bloco real e da Conferência. O que sobraria não é a mesma função.
 */
export async function vincularAutorizacaoFalta(params: {
  guia: string
  filaId: string
  observacao?: string | null
  janelaDias?: number
}): Promise<string> {
  const { data, error } = await supabase.rpc('vincular_autorizacao_falta', {
    p_guia: params.guia,
    p_fila_id: params.filaId,
    p_observacao: params.observacao ?? null,
    p_janela_dias: params.janelaDias ?? 7,
  })

  if (error) throw error
  return data as string
}

/**
 * Registra que o slot de falta na verdade teve SUBSTITUTO — a sessão aconteceu.
 *
 * A irmã de `vincularAutorizacaoFalta`, e a diferença entre as duas é a única
 * coisa que importa aqui: lá a sessão NÃO aconteceu (a falta continua falta e
 * nada é coberto), aqui ela ACONTECEU, com outro profissional, e esta guia a
 * cobre. Para todo efeito de cobertura isto é um vínculo — a sessão sai de
 * "autorização a mais" e deixa de pedir trabalho.
 *
 * Nenhum dado do banco distingue os dois casos: os dois chegam como uma falta
 * de terapeuta na fila. Quem sabe é quem triou, e por isso a tela PERGUNTA. O
 * caso que a exigiu (João Lucas, 21/09): a substituição foi informada depois de
 * a recepção lançar a falta, e triar como `falta_terapeuta` deixava a pendência
 * "1 Autorização a mais" de pé mesmo depois do vínculo.
 *
 * NÃO reverte a falta em `fila_autorizacoes` (decidido em 2026-09-22): o
 * lançamento da recepção continua lá, e é a auditoria que passa a discordar
 * dele. Desfazer o registro operacional é outro gesto, com outra dona.
 */
export async function vincularAutorizacaoSubstituicao(params: {
  guia: string
  filaId: string
  observacao?: string | null
  janelaDias?: number
}): Promise<string> {
  const { data, error } = await supabase.rpc('vincular_autorizacao_substituicao', {
    p_guia: params.guia,
    p_fila_id: params.filaId,
    p_observacao: params.observacao ?? null,
    p_janela_dias: params.janelaDias ?? 7,
  })

  if (error) throw error
  return data as string
}

/**
 * Marca a guia como autorização extra, sem sessão correspondente.
 *
 * Não é enfeite: 7 das 18 órfãs medidas na Etapa 0 têm como candidata mais
 * próxima uma sessão JÁ liberada. Vinculá-las afirmaria uma cobertura que não
 * existe; sem esta ação elas voltariam à fila de trabalho todo dia, para sempre.
 */
export async function marcarGuiaSemSessao(
  guia: string,
  observacao?: string | null
): Promise<string> {
  const { data, error } = await supabase.rpc('marcar_guia_sem_sessao', {
    p_guia: guia,
    p_observacao: observacao ?? null,
  })

  if (error) throw error
  return data as string
}

/** Desfaz por soft delete: guarda quem desfez e por quê, e a guia volta à fila. */
export async function desvincularAutorizacao(
  vinculoId: string,
  motivo?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('desvincular_autorizacao', {
    p_vinculo_id: vinculoId,
    p_motivo: motivo ?? null,
  })

  if (error) throw error
}

/**
 * Sobrepõe a situação derivada de uma sessão — a glosa que na verdade foi falta.
 *
 * Nenhuma validação aqui, pelo mesmo motivo de `vincularAutorizacao`: permissão,
 * conjunto de destinos permitidos, tamanho da justificativa e a checagem contra
 * a situação vigente vivem todos dentro da RPC. Isto muda o que o faturamento
 * considera pendente (é a `situacao` que `fn_alertas_avaliar_assim` lê), então a
 * regra tem de estar onde o cliente não alcança.
 *
 * O que a tela ganha por chamar a RPC em vez de escrever na tabela: a mensagem
 * de erro do Postgres já vem pronta para ser lida por quem está na tela — "Sessão
 * X está coberta por uma guia vinculada", "Justificativa muito curta" —, e não
 * precisa ser reconstruída aqui a partir de um código.
 */
export async function reclassificarSituacao(params: {
  blocoId: string
  situacaoNova: SituacaoReclassificavel
  justificativa: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('reclassificar_situacao', {
    p_bloco_id: params.blocoId,
    p_situacao_nova: params.situacaoNova,
    p_justificativa: params.justificativa,
  })

  if (error) throw error
  return data as string
}

/**
 * Registra que a sessão agendada para um dia foi atendida em outro.
 *
 * Não é uma reclassificação: reclassificar diz o que a sessão FOI (falta,
 * cancelada); isto diz QUANDO ela aconteceu. Por isso escreve em
 * fila_autorizacoes e não em auditoria_situacao_overrides — e por isso a sessão
 * deixa de contar como falta em todo o sistema, não só na Conferência.
 *
 * Depois disto o bloco volta a existir na Conferência e a guia órfã pode ser
 * vinculada a ele: a janela de `vincular_autorizacao` passa a comparar contra a
 * data real (20260916120300).
 */
export async function marcarSessaoAdiantada(params: {
  filaId: string
  dataReal: string
  justificativa: string
}): Promise<{ marcada: boolean; motivo?: string }> {
  const { data, error } = await supabase.rpc('marcar_sessao_adiantada', {
    p_fila_id: params.filaId,
    p_data_real: params.dataReal,
    p_justificativa: params.justificativa,
  })

  if (error) throw error
  return data as { marcada: boolean; motivo?: string }
}

/** A volta: a linha torna a ser falta. Recusa se a guia já foi vinculada. */
export async function desfazerSessaoAdiantada(
  filaId: string,
  motivo?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('desfazer_sessao_adiantada', {
    p_fila_id: filaId,
    p_motivo: motivo ?? null,
  })

  if (error) throw error
}

/** Desfaz por soft delete: a sessão volta a valer a situação derivada pela RPC. */
export async function desfazerReclassificacao(
  overrideId: string,
  motivo?: string | null
): Promise<void> {
  const { error } = await supabase.rpc('desfazer_reclassificacao', {
    p_override_id: overrideId,
    p_motivo: motivo ?? null,
  })

  if (error) throw error
}

/**
 * O histórico COMPLETO de reclassificações de uma sessão, desfeitas inclusive.
 *
 * A ativa a tela já recebe pela carga de `listarReclassificacoesAtivas`; o que só
 * existe aqui é a SEQUÊNCIA — quem reclassificou, quem desfez, e por quê. Por
 * isso é buscado sob demanda, ao abrir o log de um bloco, e não junto com a
 * semana: é a leitura rara.
 */
export async function listarReclassificacoesBloco(
  blocoId: string
): Promise<ReclassificacaoSituacao[]> {
  const { data, error } = await supabase.rpc('get_reclassificacoes_bloco', {
    p_bloco_id: blocoId,
  })

  if (error) {
    console.error('Erro ao buscar histórico de reclassificações:', error.message, error.details)
    throw error
  }
  return (data || []) as ReclassificacaoSituacao[]
}

/**
 * As reclassificações vivas — o que a grade precisa para desenhar o DEPOIS.
 *
 * Sem período, pelo mesmo motivo de `listarVinculosAtivos`: é um livro de
 * decisões manuais (ordem de dezenas de linhas), e carregá-lo inteiro é mais
 * barato que qualquer recorte que precise estar certo nas bordas. Aqui há um
 * motivo adicional — a chave é o `bloco_id`, que embute a data da sessão, então
 * recortar por `reclassificado_em` (quando alguém decidiu) deixaria de fora
 * exatamente a correção feita hoje sobre uma sessão do mês passado, que é o caso
 * mais comum: ninguém reclassifica uma sessão no mesmo dia em que ela acontece.
 *
 * A `situacao` da RPC JÁ reflete a reclassificação — a grade não depende desta
 * carga para mostrar o estado certo. O que ela acrescenta é a AUTORIA: quem
 * decidiu, quando, e com que justificativa. Sem isso o cartão mudaria de cor sem
 * dizer quem o mudou, que é o oposto do que esta feature promete.
 */
export async function listarReclassificacoesAtivas(): Promise<ReclassificacaoSituacao[]> {
  const { data, error } = await supabase
    .from('auditoria_situacao_overrides')
    .select(
      'id, bloco_id, situacao_anterior, situacao_nova, justificativa, reclassificado_por, reclassificado_em, desfeito_por, desfeito_em, desfeito_motivo'
    )
    .is('desfeito_em', null)
    .order('reclassificado_em', { ascending: false })
    .limit(TETO_VINCULOS)

  if (error) {
    console.error('Erro ao buscar reclassificações ativas:', error.message, error.details)
    throw error
  }
  return (data || []) as ReclassificacaoSituacao[]
}
