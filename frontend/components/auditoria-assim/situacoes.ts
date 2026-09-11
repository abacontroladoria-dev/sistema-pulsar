/**
 * Agrupamento de situações — a regra única de "que linhas este recorte pega".
 *
 * Existe porque um recorte da tela deixou de ser 1 KPI = 1 situação:
 * SOLICITACAO_CANCELADA (a tentativa quebrou no meio — aba da ASSIM fechada na
 * identificação, envio não concluído, solicitação cancelada) é contada junto
 * com NAO_SOLICITADA, porque a ação exigida é a mesma: solicitar de novo. O
 * banco as separa para a tela poder dizer QUAL das duas é, sem separar a
 * contagem que a operação usa.
 *
 * A contagem do card e o filtro que o clique nele aplica precisam da MESMA
 * regra — se divergirem, o card mostra um número e a tabela mostra outro. Por
 * isso as duas pontas (`kpis` e `filtrados`, em useAuditoriaAssim) chamam
 * `situacaoNoRecorte` em vez de comparar strings cada uma do seu jeito.
 */

/**
 * O recorte de "Não Solicitadas": nada foi autorizado e o caminho é solicitar
 * de novo. `SOLICITACAO_CANCELADA` mora aqui, e não em Glosas, porque a ASSIM
 * não recusou nada — o processo quebrou antes de existir resposta.
 */
export const GRUPO_NAO_SOLICITADAS = ['NAO_SOLICITADA', 'SOLICITACAO_CANCELADA'] as const

/**
 * `GLOSA_RESOLVIDA` deliberadamente NÃO é agrupada com `GLOSA`.
 *
 * O agrupamento acima existe porque a ação exigida é idêntica — solicitar de
 * novo. Aqui as ações são opostas: glosa pede tratativa, glosa resolvida não
 * pede nada. Somá-las faria o card violeta ("trate isso") listar linhas que não
 * precisam de nada, e o número que a operação usa para dimensionar trabalho
 * incluiria trabalho já feito.
 *
 * "Continuar contabilizando que houve glosa" é atendido por outras duas vias, em
 * vez do agrupamento: o badge da linha diz GLOSA RESOLVIDA (a recusa continua
 * visível na tela) e o card de Glosas traz a contagem do período como dica.
 */

/**
 * A linha entra no recorte pedido?
 *
 * `NAO_SOLICITADA` como filtro significa o GRUPO — é o valor que o card
 * "Não Solicitadas" aplica, e o seletor de status usa o mesmo valor para o
 * mesmo significado. Para ver só as que quebraram no meio existe o valor
 * `SOLICITACAO_CANCELADA`, que é exato. Qualquer outro valor é comparação
 * direta, como sempre foi.
 */
export function situacaoNoRecorte(situacao: string | null, recorte: string): boolean {
  if (!recorte) return true
  if (recorte === 'NAO_SOLICITADA') {
    return GRUPO_NAO_SOLICITADAS.includes(situacao as (typeof GRUPO_NAO_SOLICITADAS)[number])
  }
  // 'GLOSA' segue sendo comparação exata: não inclui GLOSA_RESOLVIDA. Ver a nota
  // acima — as duas pedem ações opostas, e o card de Glosas dimensiona trabalho.
  return situacao === recorte
}

/**
 * A ASSIM recusou esta sessão — resolvida por vínculo posterior ou não.
 *
 * Pergunta diferente de `situacaoNoRecorte(s, 'GLOSA')`, que é "preciso tratar
 * isto?". Esta é "houve recusa?", e é a que interessa a quem exibe o MOTIVO: a
 * observação vem prefixada de "Glosa: " nos dois estados, e o motivo continua
 * existindo depois de resolvido — o histórico não se apaga.
 *
 * Existe como função porque três lugares precisavam dela (a legenda da linha e
 * dois trechos do modal de detalhamento) e cada um teria escrito o seu
 * `=== 'GLOSA' || === 'GLOSA_RESOLVIDA'`. A quarta cópia é que sempre esquece.
 */
export function ehGlosa(situacao: string | null): boolean {
  return situacao === 'GLOSA' || situacao === 'GLOSA_RESOLVIDA'
}

/**
 * Existe papel para a recepção conferir nesta sessão?
 *
 * Três casos deixam papel: filipeta, erro de reconhecimento facial e dispositivo
 * indisponível — mas só quando a autorização SAIU. As fontes não têm a mesma
 * autoridade sobre isso:
 *
 * - `teve_token` vem de `autorizacoes_assim`, o relatório da ASSIM. Existir
 *   token ali já é prova de que a autorização saiu, então não precisa de gate.
 * - `biofacial` vem do MESMO relatório, e também é resposta da ASSIM: o `8-`
 *   (dispositivo indisponível) é a CAUSA de a filipeta existir — sem
 *   dispositivo, a ASSIM cai no #checkBday e emite o papel (20260903000000).
 *   Por ser resposta e não intenção, também não leva gate.
 * - `forma_autorizacao` guarda o que a RECEPÇÃO escolheu no modal do robô
 *   (`OPCOES_VALIDACAO` em robo-autorizador/rpa.js) — intenção registrada ANTES
 *   de a ASSIM responder. Diz "tentei validar por reconhecimento facial e deu
 *   erro", não "a ASSIM liberou e saiu papel".
 *
 * Sob RECUSA as duas leituras divergem: houve a tentativa, não houve a
 * liberação, e portanto não existe filipeta. Pedir conferência de um papel
 * inexistente não tem resposta possível — o operador não pode marcar
 * "conferida" nem deixar pendente, e a linha fica presa. Caso real: BERNARDO
 * FREIRES PESSOA OTERIO, 31/08/2026 13:40, glosa 1013 (CADASTRO DO BENEFICIARIO
 * COM PROBLEMAS), `teve_token: false`, forma 'Erro no Reconhecimento Facial'.
 *
 * O teste é RECUSA EXPLÍCITA, não ausência de liberação, e a diferença entre as
 * duas não é sutil: `status_assim` nulo significa que a ASSIM não respondeu
 * (RETORNO_NAO_CONFIRMADO), e ali o registro da recepção é a única evidência
 * que existe — o papel provavelmente está lá. Medido em 2026-09-02: um gate por
 * `status_assim IN ('Liberado','Liberado *')` derrubaria 19 linhas legítimas de
 * julho/2026; este derruba exatamente a do Bernardo, 1 em 167.
 *
 * Por que `status_assim` e não `situacao`: `situacao` é a leitura OPERACIONAL do
 * Pulsar (inclui RETORNO_NAO_CONFIRMADO, faltas, cancelamentos), enquanto a
 * pergunta aqui é estritamente "a ASSIM recusou?". Um bloco pode estar
 * GLOSA_RESOLVIDA — recusa no histórico, guia vinculada autorizando hoje — e o
 * papel existe: é o caso que 20260828180000 corrigiu justamente para INCLUIR.
 * `status_assim` responde pela guia que vale, e por isso é a coluna certa.
 *
 * Espelha o WHERE de `get_tokens_mensal` (migration 20260902110000), que
 * decide o mesmo para o modal de Conferência de Filipetas, com a mesma forma
 * (`<> ALL (ARRAY[...])`) que o CASE de `situacao` usa na RPC diária. As duas
 * pontas precisam concordar: o botão da linha e a lista do modal falam do
 * mesmo papel.
 */
const LIBERACOES = ['Liberado', 'Liberado *']

/**
 * O `biofacial` do extrato chega TRUNCADO em 25 chars ('8-DISPOSITIVO
 * INDISPONIVEL' tem 26) e o vocabulário não é fechado: o único pedaço estável é
 * o número antes do primeiro '-'. Mesma forma do
 * `split_part(btrim(...), '-', 1) = '8'` que get_tokens_mensal usa na Semente 4
 * e no WHERE final — as duas pontas decidem sobre o MESMO papel e não podem
 * divergir.
 *
 * Compara o campo INTEIRO antes do '-', não `startsWith('8')`: um código futuro
 * como '80-' casaria por `startsWith` e não é dispositivo indisponível.
 */
export function dispositivoIndisponivel(biofacial: string | null | undefined): boolean {
  return (biofacial ?? '').trim().split('-')[0] === '8'
}

export function temPapelParaConferir(item: {
  teve_token?: boolean | null
  forma_autorizacao?: string | null
  status_assim?: string | null
  biofacial?: string | null
}): boolean {
  if (item.teve_token) return true
  // Sem dispositivo, a ASSIM emite a filipeta: o papel é consequência do `8-`, e
  // o token é consequência do papel — por isso este ramo NÃO olha `teve_token` e
  // não passa pelo gate de recusa. `biofacial` é campo do RELATÓRIO (resposta),
  // não do modal da recepção (intenção); só `forma_autorizacao` opina sobre fato
  // que a ASSIM ainda não confirmou, e por isso só ele carrega o gate.
  //
  // Caso real: ADRIAN ARAUJO NERY, 01/09/2026 10:00, guia 5665, biofacial
  // '8-DISPOSITIVO INDISPONIVEL', token vazio, status Liberado — papel existia,
  // a Conferência de Filipetas já o cobrava e esta linha não o oferecia.
  if (dispositivoIndisponivel(item.biofacial)) return true
  if (!/reconhecimento\s+facial/i.test(item.forma_autorizacao ?? '')) return false
  // Nulo = sem resposta = desconhecido, e desconhecido mantém o botão.
  return item.status_assim == null || LIBERACOES.includes(item.status_assim)
}
