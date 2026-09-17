/**
 * A regra única de "qual card esta linha alimenta".
 *
 * Existe porque a contagem passou a ter DUAS pontas que precisam concordar: a
 * tela diária, que percorre as linhas do dia uma a uma, e a visão gerencial,
 * que percorre um resumo pré-agregado em que cada linha já vale N sessões. Se
 * cada uma somasse do seu jeito, "37 glosas" no modal e "37 glosas" no card
 * seriam dois números com duas definições — exatamente o risco que
 * `situacoes.ts` foi escrito para evitar, um nível acima.
 *
 * Por isso o acumulador recebe `peso`: a tela diária passa 1 por linha, o modal
 * passa a contagem daquele grupo. A aritmética é a mesma; só a unidade muda.
 *
 * O que NÃO mora aqui, de propósito: o recorte por paciente e por bloco de
 * horário. Esses filtram quais linhas chegam ao acumulador, e são da tela.
 */

import type { KpisAuditoriaAssim } from './types'
import { situacaoNoRecorte } from './situacoes'

/**
 * As situações que não são estágio de autorização — a sessão não aconteceu.
 * Ficam fora de `total` e de todos os cards do ciclo, como o DESIGN.md determina
 * ao mantê-las fora da rampa de prioridades.
 *
 * `UNIDADE_FECHADA` (a clínica não abriu) entrou em 2026-09-17. Ela é falta para
 * efeito de CONTAGEM — não houve sessão, não há autorização a cobrar — mas não é
 * falta de ninguém, e por isso tem card próprio em vez de somar em `faltas`:
 * misturá-la ali inflaria o número de assiduidade com feriado. É a mesma
 * separação que `contar_faltas_do_paciente` já faz no banco (20260908100200).
 */
export const SITUACOES_DE_FALTA = ['FALTA', 'FALTA_TERAPEUTA', 'UNIDADE_FECHADA'] as const

export function ehFalta(situacao: string | null): boolean {
  return (
    situacao === 'FALTA' ||
    situacao === 'FALTA_TERAPEUTA' ||
    situacao === 'UNIDADE_FECHADA'
  )
}

/** O que uma linha precisa expor para ser contada. Nada além disto. */
export type LinhaContavel = {
  situacao: string | null
  teve_token: boolean | null
}

export function kpisVazios(): KpisAuditoriaAssim {
  return {
    total: 0,
    liberadas: 0,
    faltas: 0,
    faltas_terapeuta: 0,
    unidade_fechada: 0,
    nao_solicitadas: 0,
    sincronizando: 0,
    retorno_nao_confirmado: 0,
    canceladas: 0,
    glosas: 0,
    glosas_resolvidas: 0,
    tokens: 0,
  }
}

/**
 * Soma uma linha (ou um grupo de `peso` linhas iguais) ao acumulador.
 *
 * As sutilezas que esta função guarda, e que reescrever à mão erraria:
 *
 * - **O token é descontado de `liberadas`, não somado.** Os dois cards vivem
 *   lado a lado e somar nos dois contaria a mesma sessão duas vezes no Total.
 * - **`retorno_nao_confirmado` engloba `AGUARDANDO_RETORNO`**, que é o mesmo
 *   estado com outro nome vindo de um ramo mais antigo da RPC.
 * - **`nao_solicitadas` é o GRUPO** (via `situacaoNoRecorte`), então inclui
 *   `SOLICITACAO_CANCELADA`: a ação exigida é a mesma, solicitar de novo.
 * - **`glosas` é comparação exata** — `GLOSA_RESOLVIDA` fica de fora, porque
 *   aquele card dimensiona trabalho a fazer e uma glosa já coberta por vínculo
 *   não pede nada.
 * - **`total` exclui faltas**, que são contadas em campos próprios.
 */
export function acumularKpis(
  acc: KpisAuditoriaAssim,
  linha: LinhaContavel,
  peso = 1
): void {
  const { situacao } = linha

  if (ehFalta(situacao)) {
    // Comparação EXATA nos três, sem `else` de sobra: enquanto eram duas
    // espécies o `else` era seguro, mas com a terceira ele passou a despejar
    // UNIDADE_FECHADA em `faltas_terapeuta` — feriado contado como lacuna de
    // escala. Um `else` que significa "o outro" não sobrevive a um terceiro.
    if (situacao === 'FALTA') acc.faltas += peso
    else if (situacao === 'FALTA_TERAPEUTA') acc.faltas_terapeuta += peso
    else acc.unidade_fechada += peso
    return
  }

  acc.total += peso

  // Contado sobre QUALQUER situação que não seja falta, não só sobre LIBERADA.
  // É o comportamento histórico da tela e está preservado deliberadamente: na
  // prática só sessão liberada carrega token, mas mudar o alcance aqui mudaria
  // números em produção sem ninguém ter pedido.
  if (linha.teve_token === true) {
    acc.tokens += peso
    acc.liberadas -= peso
  }

  if (situacao === 'LIBERADA') acc.liberadas += peso
  if (situacaoNoRecorte(situacao, 'NAO_SOLICITADA')) acc.nao_solicitadas += peso
  if (situacao === 'SINCRONIZANDO') acc.sincronizando += peso
  if (situacao === 'RETORNO_NAO_CONFIRMADO' || situacao === 'AGUARDANDO_RETORNO') {
    acc.retorno_nao_confirmado += peso
  }
  if (situacao === 'CANCELADA') acc.canceladas += peso
  if (situacao === 'GLOSA') acc.glosas += peso
  if (situacao === 'GLOSA_RESOLVIDA') acc.glosas_resolvidas += peso
}

/** Conveniência para quem tem as linhas cruas: um peso por linha. */
export function contarKpis(linhas: readonly LinhaContavel[]): KpisAuditoriaAssim {
  const acc = kpisVazios()
  for (const linha of linhas) acumularKpis(acc, linha)
  return acc
}
