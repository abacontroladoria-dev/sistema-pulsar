import type { AuditoriaAssimItem, VinculoAutorizacao } from '../types'

/**
 * Quando uma sessão conta como coberta — a regra, sem estado nenhum em volta.
 *
 * Mora aqui, e não dentro de `useAnaliseReincidencia`, por duas razões. O hook
 * importa os services, que importam o cliente do Supabase, e isso torna a regra
 * impossível de exercitar num teste de nó — a única parte deste trabalho que
 * fecha ou não fecha uma conta merece teste direto. E `grade.ts` precisa dela
 * para carimbar o cartão: as duas pontas lendo o mesmo arquivo é o que impede
 * o número do topo e a marca do cartão de discordarem sobre a mesma semana.
 */

/**
 * Cota = quantas sessões daquele TUSS o paciente tem no período. Falta não conta.
 *
 * `UNIDADE_FECHADA` entrou em 2026-09-17 e é o caso mais claro dos três: num dia
 * em que a clínica não abriu não havia sessão para autorizar, então ela não
 * consome cota, não fica "sem cobertura" e não vira pendência. Antes da
 * migration 20260917110000 essas linhas nem chegavam aqui — escapavam do
 * anti-join da RPC e apareciam como RETORNO_NAO_CONFIRMADO, cobrando tratativa
 * de um feriado (336 linhas em 07/09/2026).
 */
export const SITUACOES_SEM_SESSAO = new Set(['FALTA', 'FALTA_TERAPEUTA', 'UNIDADE_FECHADA'])

/**
 * O mínimo que estas funções precisam saber de uma triagem: o seu tipo.
 *
 * Um alias e não o `VinculoAutorizacao` inteiro, porque é justamente o que
 * mantém este arquivo testável sem montar uma linha de banco inteira — os testes
 * passam `{ tipo: 'vinculo' }` e nada mais. O tipo mora em `../types` para não
 * existirem duas listas do que é um desfecho de triagem: quando
 * `falta_terapeuta` entrou (2026-09-21), a união estava escrita à mão em quatro
 * assinaturas deste arquivo e o compilador teve de apontar as quatro.
 */
type TipoDaTriagem = { tipo: VinculoAutorizacao['tipo'] }

/**
 * Os dois desfechos em que a sessão saiu coberta por uma liberação.
 *
 * Não é lista de conveniência: são exatamente os dois ramos que a migration
 * `20260821030000` põe no topo do `CASE` de `situacao` — `GLOSA_RESOLVIDA`
 * quando havia glosa e o vínculo a cobriu, `LIBERADA` quando não havia. Todo o
 * resto do vocabulário (não solicitada, glosa aberta, retorno não confirmado,
 * sincronizando, solicitação cancelada) é sessão que ninguém liberou.
 */
export const SITUACOES_COBERTAS = new Set(['LIBERADA', 'GLOSA_RESOLVIDA'])

/**
 * As situações em que a ASSIM DEU um veredito sobre a sessão.
 *
 * Elas continuam sem cobertura — ninguém as liberou —, mas o cartão diz o nome
 * do veredito em vez de "Sem cobertura", porque as duas coisas não são a mesma
 * pergunta. "Sem cobertura" é a AUSÊNCIA de resposta: não solicitada, retorno
 * não confirmado, sincronizando, solicitação cancelada. Aqui houve resposta, e
 * saber QUAL é o que decide o que fazer a seguir — glosa pede tratativa, e
 * `CANCELADA` (que é `status = 'Liberado *'`, a liberação que a ASSIM desfez)
 * pede uma autorização nova.
 *
 * `CANCELADA` entrou em 2026-08-24, reportada da tela: a sessão de 21/08 13:00
 * do Eric Gabriel Vitório Nunes aparecia como "Sem cobertura" e o operador lê
 * "Cancelada" em todo o resto do sistema. Nada muda na PENDÊNCIA — ela segue
 * contada e segue passível de vínculo com uma guia solta —, só a manchete.
 */
export const SITUACOES_COM_VEREDITO = new Set(['GLOSA', 'CANCELADA'])

/**
 * A situação da sessão COM o vínculo aplicado — o eco local do que a RPC faz.
 *
 * `get_auditoria_assim_periodo` já resolve isto (migration 20260821030000, os
 * dois ramos no topo do `CASE`): guia vinculada cobrindo o bloco vira
 * `GLOSA_RESOLVIDA` se havia glosa e `LIBERADA` se não havia. Esta função é a
 * MESMA regra, do lado de cá, e existe por uma razão só: a tela não pode ficar
 * dizendo "Glosa · pendência" sobre uma sessão que ela própria acabou de cobrir
 * só porque a RPC ainda não concorda.
 *
 * Ela discorda da RPC em exatamente uma situação — quando aquela migration não
 * está viva no banco em que a tela está falando. E é uma discordância que erra
 * para o lado certo: o vínculo está gravado em `autorizacoes_vinculos`, o
 * cliente o leu, e negá-lo na tela seria mostrar como trabalho a fazer algo que
 * já foi feito. Com a migration aplicada isto é um no-op — os dois lados dizem
 * a mesma palavra.
 *
 * Aplicada UMA vez, em `montarGrade`, no campo `situacao` do cartão. Todo o
 * resto (a cor, o rótulo, o badge da gaveta, `cartaoPendente`) lê dali e não
 * precisa saber que houve vínculo. `origem.situacao` guarda o valor cru.
 */
export function situacaoComVinculo(
  situacao: string | null,
  vinculo: TipoDaTriagem | null | undefined
): string | null {
  if (!vinculo || vinculo.tipo !== 'vinculo') return situacao
  // Falta continua sendo falta: a sessão não aconteceu, e uma guia não a faz
  // acontecer. Não é caso de borda teórico — `vincular_autorizacao` não impede
  // vincular a um bloco que virou falta depois.
  if (SITUACOES_SEM_SESSAO.has(situacao ?? '')) return situacao
  /*
    IDEMPOTÊNCIA — e o defeito que a falta dela causava (2026-08-27).

    Esta função é o eco local de um `CASE` que a RPC já resolve, então ela recebe
    de volta a PRÓPRIA saída: com a migration viva (hoje
    `20260825010000_origem_da_guia_nas_leituras.sql`), `get_auditoria_assim`
    devolve `situacao = 'GLOSA_RESOLVIDA'` para a glosa vinculada. Sem esta
    linha, `'GLOSA_RESOLVIDA' !== 'GLOSA'` caía no `else` e a função REBAIXAVA a
    situação para `LIBERADA` — o mapa `GLOSA → GLOSA_RESOLVIDA → LIBERADA` não
    fechava em si mesmo.

    O efeito na tela (Kourtney Savino Lopes, 03–07/08): o cartão da glosa coberta
    saía com a palavra "Coberta" em vez de "Glosa Coberta", porque o rótulo
    pergunta `situacao === 'GLOSA_RESOLVIDA'` e a resposta já havia sido perdida.
    A cor e a borda violeta apareciam (elas dependem de `cobertaPorAvulsa`, que lê
    a situação crua), então o cartão ficava certo de cor e errado de palavra — e a
    distinção entre "havia uma recusa e ela foi coberta" e "ninguém tinha pedido"
    desaparecia de toda leitura que depende de `situacao`.

    O docblock acima sempre afirmou que isto é um no-op com a migration aplicada.
    Passa a ser verdade: o que já é cobertura volta como está.
  */
  if (SITUACOES_COBERTAS.has(situacao ?? '')) return situacao
  return situacao === 'GLOSA' ? 'GLOSA_RESOLVIDA' : 'LIBERADA'
}

/**
 * A sessão foi coberta por uma AVULSA, e não pelo pareamento normal do banco?
 *
 * O fato que a cor da grade precisava e não tinha. `situacaoComVinculo` põe a
 * sessão coberta por triagem em `GLOSA_RESOLVIDA` ou `LIBERADA`, e os dois são
 * esmeralda — o mesmo matiz de uma liberação que o robô tirou na hora, sem
 * ninguém precisar decidir nada. Reportado da tela: uma glosa substituída por
 * avulsa *"não pode ficar verdinha também, porque confunde com uma liberada
 * comum"*.
 *
 * O matiz continua esmeralda — a sessão ESTÁ coberta, e afirmar o contrário
 * seria pior. Quem separa é a PROCEDÊNCIA, que já existe no vocabulário:
 * `SITUACAO_CONFIG.GLOSA_RESOLVIDA` carrega `dot: bg-violet-500` justamente
 * para isso ("superfície esmeralda porque está resolvido, dot violeta porque o
 * que foi resolvido foi uma GLOSA"). O `dot` era desenhado no pill e no bloco da
 * listagem, e em lugar nenhum da grade: o cartão compacto não tem barra lateral,
 * e a sessão coberta nunca é pendente, então ela caía sempre no compacto. A marca
 * de procedência existia e não chegava à tela onde a substituição acontece.
 *
 * QUEM decide é o VÍNCULO, não a situação — e é isso que torna esta função
 * robusta ao fato medido em produção: `origem.situacao` NÃO é crua. Com a
 * migration viva, `get_auditoria_assim` já devolve GLOSA_RESOLVIDA na linha, e
 * `montarGrade` guarda essa linha inteira em `origem`. A pergunta que importa
 * ("houve triagem manual cobrindo esta sessão?") só o vínculo responde, e a
 * situação entra apenas para excluir a falta — uma guia não faz a sessão
 * acontecer (ver `situacaoComVinculo`), então ali não há cobertura a marcar.
 *
 * O parâmetro segue nomeado `situacaoCrua` porque é isso que o chamador deve
 * passar: o campo que não passou pelo eco local. Se um dia a migration sair do
 * banco, ele volta a chegar cru e a função continua respondendo o mesmo.
 */
export function cobertaPorAvulsa(
  situacaoCrua: string | null,
  vinculo: TipoDaTriagem | null | undefined
): boolean {
  if (!vinculo || vinculo.tipo !== 'vinculo') return false
  return !SITUACOES_SEM_SESSAO.has(situacaoCrua ?? '')
}

/** O instante de uma sessão: "2026-08-24T08:00". Nulo quando falta a hora. */
function instanteSessao(s: AuditoriaAssimItem): string | null {
  if (!s.data_atendimento) return null
  const hora = s.hora_inicial?.slice(0, 5)
  return hora ? `${s.data_atendimento}T${hora}` : null
}

/**
 * A sessão já aconteceu e já passou dos 30 minutos de tolerância?
 *
 * Sem hora, o critério cai para o corte por DIA, mas estrito: nunca conta o
 * próprio dia, porque não há como saber se os 30 minutos já passaram.
 */
export function sessaoDecorrida(s: AuditoriaAssimItem, cutoff: string): boolean {
  const instante = instanteSessao(s)
  if (instante !== null) return instante <= cutoff
  return (s.data_atendimento ?? '') < cutoff.slice(0, 10)
}

/**
 * Esta sessão específica já ocorreu e ninguém a liberou.
 *
 * É o fato que faltava para a tela responder "QUAL sessão está com problema".
 * Até 2026-08-24 a única forma de "faltando" era o agregado por TUSS
 * (`decorridas − liberadas`), que diz QUANTAS e não diz quais — e um número que
 * ninguém consegue apontar não serve para quem precisa conferir a sessão.
 *
 * A regra usa a `situacao` que a própria RPC já resolveu, então ela não
 * reimplementa o pareamento: `get_auditoria_assim` decide o que é coberto (ver
 * `SITUACOES_COBERTAS`) e aqui só se lê o veredito.
 *
 * Falta não entra: sessão que não aconteceu não podia ser coberta, e cobrar
 * autorização dela é justamente um dos jeitos de estourar a cota.
 */
export function sessaoSemCobertura(
  s: AuditoriaAssimItem,
  cutoff: string,
  /**
   * As triagens vivas, por bloco. Sem elas a conta fica refém de a RPC já ter
   * aplicado o vínculo — e uma sessão coberta na frente do operador continuaria
   * contando como "faltando" no cabeçalho e como cartão marcado na faixa de
   * semanas. Ver `situacaoComVinculo`.
   */
  vinculosPorBloco: ReadonlyMap<string, TipoDaTriagem> = new Map()
): boolean {
  if (SITUACOES_SEM_SESSAO.has(s.situacao ?? '')) return false
  if (!sessaoDecorrida(s, cutoff)) return false
  const situacao = situacaoComVinculo(s.situacao, vinculosPorBloco.get(s.bloco_id ?? ''))
  return !SITUACOES_COBERTAS.has(situacao ?? '')
}

/**
 * Esta sessão está descoberta E ninguém respondeu por ela — a espécie "Não
 * solicitada" da listagem, sem a parte que outra espécie já conta.
 *
 * `sessaoSemCobertura` responde "alguém cobriu?", e a recusa não cobre nada:
 * a sessão glosada responde "não" e é, corretamente, um cartão marcado na
 * grade. Mas a listagem conta espécies, e ali a MESMA recusa já entra como
 * `glosa` pelo lado da autorização — então somar as duas contava o mesmo fato
 * duas vezes.
 *
 * O caso que revelou isto (Yure Bernardo, agosto/2026): cinco recusas em 03/08
 * e quatro sessões nunca solicitadas em 07/08 saíam como "5 glosas + 9 não
 * solicitadas", total 14, quando o trabalho real é 9. As cinco apareciam nas
 * duas espécies. A grade nunca errou — `cartaoPendente` é `semCobertura ||
 * GLOSA` sobre UM cartão, e um `||` não duplica; quem somava era a aritmética.
 *
 * `SITUACOES_COM_VEREDITO` é exatamente o conjunto certo para descontar, e não
 * uma lista nova: ele já existe para separar "a ASSIM respondeu" de "não há
 * resposta", que é a mesma fronteira. GLOSA sai porque vira `glosa`; CANCELADA
 * sai porque a autorização desfeita já entra como `cancelamento`.
 *
 * A sessão descontada NÃO deixa de pedir trabalho — ela continua marcada na
 * grade e continua contada, pela espécie que a nomeia melhor. O que ela deixa
 * de ser é uma segunda unidade no `total`.
 */
export function sessaoNaoSolicitada(
  s: AuditoriaAssimItem,
  cutoff: string,
  vinculosPorBloco: ReadonlyMap<string, TipoDaTriagem> = new Map()
): boolean {
  if (!sessaoSemCobertura(s, cutoff, vinculosPorBloco)) return false
  const situacao = situacaoComVinculo(s.situacao, vinculosPorBloco.get(s.bloco_id ?? ''))
  return !SITUACOES_COM_VEREDITO.has(situacao ?? '')
}

/**
 * As guias que uma triagem aposentou — a outra metade de "sair da contagem".
 *
 * Vincular uma guia externa a uma sessão glosada resolve DUAS pendências de uma
 * vez, e até 2026-08-24 a tela só baixava uma e meia: a guia saía de "sem
 * vínculo" (deixa a fila de órfãs) e a sessão saía de "faltando" (vira
 * GLOSA_RESOLVIDA), mas a GLOSA original continuava contada. Ela é uma linha de
 * `autorizacoes_assim` com status de recusa, e nada nela muda quando o vínculo é
 * gravado. O efeito era uma listagem que ficava dizendo "1 glosa" para um
 * paciente cuja grade não tinha mais um único cartão marcado — o número e os
 * cartões discordando sobre a mesma semana, que é o defeito que esta tela
 * inteira existe para caçar, virado contra ela mesma.
 *
 * A ponte é a SESSÃO, e não o campo `guia_original` do vínculo: aquele é copiado
 * de `fila_autorizacoes` no momento da gravação e vem nulo quando a sessão nunca
 * foi solicitada pelo Pulsar. A sessão coberta continua guardando no campo
 * `guia` a autorização antiga — o vínculo não a reescreve —, então é dela que se
 * lê, com certeza, qual guia deixou de pedir tratativa.
 *
 * O que sai é a FILA DE TRABALHO, não o histórico: a sessão segue dizendo GLOSA
 * RESOLVIDA e o motivo da recusa segue por extenso na gaveta. Vale também para a
 * `CANCELADA` que um vínculo cobriu (aí a sessão vira LIBERADA), pelo mesmo
 * motivo — a liberação desfeita foi substituída por uma que valeu.
 *
 * SÓ `tipo === 'vinculo'` aposenta guia (2026-08-27). `sem_sessao` é o outro
 * desfecho da triagem — "esta guia é autorização extra, não cobre sessão
 * nenhuma" — e sempre tem `bloco_id: null` (a constraint da tabela exige). Sem
 * este filtro, `vinculosPorBloco.has(s.bloco_id ?? '')` bateria também num
 * `sem_sessao` cujo mapa foi indexado com a chave `''`, contra qualquer sessão
 * cujo `bloco_id` também for nulo — as linhas de falta sintetizadas no serviço
 * — aposentando a guia glosada de uma falta por uma triagem que não a cobre.
 */
export function guiasSubstituidas(
  sessoes: AuditoriaAssimItem[],
  vinculosPorBloco: ReadonlyMap<string, VinculoAutorizacao>
): Set<string> {
  const substituidas = new Set<string>()
  if (vinculosPorBloco.size === 0) return substituidas
  for (const s of sessoes) {
    const vinculo = s.bloco_id ? vinculosPorBloco.get(s.bloco_id) : undefined
    if (s.guia && vinculo?.tipo === 'vinculo') substituidas.add(s.guia)
  }
  return substituidas
}
