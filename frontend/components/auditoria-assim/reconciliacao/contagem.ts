import type {
  AuditoriaAssimItem,
  AutorizacaoAssimSemana,
  ContagemPendencias,
  PlacarTuss,
  VinculoAutorizacao,
} from '../types'
import {
  SITUACOES_SEM_SESSAO,
  sessaoDecorrida,
  sessaoNaoSolicitada,
  sessaoSemCobertura,
  situacaoComVinculo,
  triagemCobre,
} from './cobertura'

/**
 * A aritmética da reconciliação — separada do hook porque é PURA.
 *
 * Estas funções moravam em `useAnaliseReincidencia.ts`, e ficar lá as tornava
 * intestáveis: aquele arquivo importa `services/auditoria-assim.service`, que
 * constrói um cliente Supabase no import. Qualquer teste que tocasse
 * `contarPendencias` morria montando um cliente HTTP para somar números.
 *
 * É o mesmo movimento que `guiasSubstituidas` já tinha feito para
 * `cobertura.ts`, e pela mesma razão. O hook segue reexportando tudo, então
 * nenhum consumidor precisou mudar de import.
 */

/**
 * Só `Liberado` cru consumiu cota.
 *
 * Comparação EXATA, e não por prefixo: `Liberado *` é o rótulo que a ASSIM usa
 * para autorização **cancelada** — é assim que a migration 20260528120000 a
 * traduz para a situação CANCELADA, e é por isso que `get_guias_orfas` filtra
 * `status = 'Liberado'` e não `like 'Liberado%'`. Casar por prefixo contava
 * cancelada como cota gasta e inventava excedente onde não havia.
 */
export function autorizacaoLiberada(status: string | null): boolean {
  return (status ?? '').trim() === 'Liberado'
}

/** A autorização saiu e foi desfeita. Não consumiu cota e não pede nada. */
export function autorizacaoCancelada(status: string | null): boolean {
  return (status ?? '').trim() === 'Liberado *'
}

/**
 * A recusa por REINCIDÊNCIA — o pedido duplicado.
 *
 * A ASSIM devolve `1601-REINCIDENCIA NO ATEN` (cortado em 25 caracteres, como
 * todo rótulo dela) quando já existe autorização para aquele TUSS naquele dia.
 * É a recusa do SEGUNDO pedido, e o primeiro costuma sair `Liberado`.
 *
 * Não decide mais em qual espécie de pendência a recusa cai — ver a nota em
 * `calcularLedger` (2026-08-27, Saory Araujo Oliveira). Segue existindo porque
 * o texto por extenso ("recusada por pedido duplicado") ainda é útil na gaveta
 * de detalhe, onde saber O MOTIVO da recusa continua sendo informação, mesmo
 * que a CONTAGEM não distinga mais.
 *
 * Por PREFIXO, e não comparação exata, pelo motivo que a Conferência de
 * Filipetas já documenta: o rótulo vem cortado em 25 caracteres e o de-para
 * completa o resto. `1601` é o código, e é ele que identifica o motivo.
 */
export function autorizacaoReincidencia(status: string | null): boolean {
  return (status ?? '').trim().startsWith('1601')
}

/**
 * Os dois estados de guia que esta tela existe para vigiar, além da glosa.
 *
 * `ehOrfa` é injetado, e não decidido aqui, pelo motivo do cabeçalho: a
 * definição de órfã mora em `get_guias_orfas`.
 *
 * `substituidas` são as guias que uma triagem aposentou: a recusa (ou o
 * cancelamento) daquela sessão foi coberta por uma autorização externa, e o par
 * inteiro parou de pedir trabalho. Sem este conjunto, vincular uma guia baixava
 * "sem vínculo" e "faltando" e deixava "glosas" de pé — a linha continuava na
 * listagem, com uma pendência que a grade não conseguia mais apontar (a sessão
 * virou GLOSA_RESOLVIDA e sumiu dos cartões marcados). O número dizia 1 e a
 * faixa de semanas dizia "·", que é a divergência que esta tela existe para
 * caçar, virada contra ela mesma.
 *
 * A guia substituída NÃO deixa de existir: ela continua no histórico, e a sessão
 * continua dizendo GLOSA RESOLVIDA. O que ela deixa de ser é fila de trabalho.
 *
 * TODA RECUSA É GLOSA, sem separar reincidência (2026-08-27, revertido).
 *
 * Entre 08-26 e 08-27 a `1601-REINCIDENCIA` saiu de `glosas` para uma categoria
 * própria que caía em `autorizacao-a-mais` — o caso Theo Meneses (26/08) pedia
 * exatamente isso: uma recusa que era "pedido duplicado", com o primeiro pedido
 * já liberado, virava "1 glosa" numa semana sem uma única sessão descoberta.
 *
 * Só que a reversão custou o caso Saory Araujo Oliveira (27/08): uma recusa da
 * ASSIM (não importa qual código) é, para quem audita, uma GLOSA — é ela que
 * abre a gaveta e lê o motivo, não a categoria que decide entre "conversar com
 * a ASSIM" e "não pedir de novo" por trás da tela. Separar a reincidência
 * respondia uma pergunta que a operação não fazia: a pergunta era sempre "isto
 * foi recusado?", e a resposta certa é a mesma independente do código do erro.
 * O `1601` continua identificável — `autorizacaoReincidencia` segue existindo
 * para o texto da gaveta —, só não decide mais a espécie da contagem.
 */
export function calcularLedger(
  autorizacoes: AutorizacaoAssimSemana[],
  ehOrfa: (guia: string) => boolean,
  substituidas: ReadonlySet<string> = new Set()
) {
  const orfas = new Set<string>()
  let glosas = 0
  let canceladas = 0
  for (const a of autorizacoes) {
    /*
      A GUIA SUBSTITUÍDA SAI PRIMEIRO, e sai de TUDO.

      O `continue` de `substituidas.has` já morou DEPOIS do `if (ehOrfa(...))`,
      e só pulava os ramos de status — não a marca de órfã, que já tinha sido
      escrita em `orfas` na linha de cima. Uma guia que é ao mesmo tempo órfã
      (`get_guias_orfas`) e substituída (triada por um vínculo) saía com
      `glosas` intacto — zero, porque o `continue` a tirou de lá — mas
      sobrevivia em `orfas`, que `contarPendencias` soma em
      `autorizacao-a-mais`. A glosa não desaparecia: TROCAVA de espécie.
    */
    if (substituidas.has(a.guia)) continue
    if (ehOrfa(a.guia)) orfas.add(a.guia)
    if (autorizacaoCancelada(a.status)) canceladas += 1
    else if (!autorizacaoLiberada(a.status)) glosas += 1
  }
  return { orfas, glosas, canceladas }
}

/**
 * As quatro espécies de pendência.
 *
 * `autorizacao-a-mais` é a UNIÃO de dois conjuntos de guias, não a soma de dois
 * números — e é essa a diferença que esta função existe para carregar.
 *
 * Até 2026-08-26 eram cinco espécies, e "sem vínculo" (guias que sobraram do
 * pareamento) e "sobrando" (o saldo `liberadas − agendadas` por TUSS) eram
 * somadas. Mas a guia que sobra do pareamento é, quase sempre, exatamente a que
 * estoura a cota: o mesmo objeto entrava duas vezes no `total`, que é o número
 * que a operação lê para dimensionar trabalho. Contar a união desfaz isso sem
 * perder nenhum dos dois casos legítimos de divergência — a órfã que não
 * estourou cota (a sessão que ela cobriria virou falta) e a excedente que não é
 * órfã (guia já triada sai de `get_guias_orfas`, e o placar continua vendo
 * liberada a mais).
 *
 * `excedentes` vem de `excedentesDoPlacar`, que já resolve o saldo por TUSS de
 * volta para guias nomeadas. É por existir esse de-para que a união é possível:
 * sem ele, "sobrando" seria um número solto, sem identidade para deduplicar.
 *
 * `faltando` lê `naoSolicitada`, e NÃO `faltante`, pelo mesmo princípio uma
 * camada adiante: a sessão glosada está descoberta (logo entra em `faltante`),
 * mas a recusa que a descobriu já é contada aqui como `glosa`. Somar as duas
 * dava "5 glosas + 9 não solicitadas" para nove sessões — ver
 * `sessaoNaoSolicitada`, que carrega o caso.
 */
export function contarPendencias(
  placar: PlacarTuss[],
  ledger: {
    orfas: ReadonlySet<string>
    glosas: number
    canceladas: number
  },
  excedentes: ReadonlySet<string>
): ContagemPendencias {
  let faltando = 0
  for (const p of placar) faltando += p.naoSolicitada

  const aMais = new Set(ledger.orfas)
  for (const guia of excedentes) aMais.add(guia)

  const contagem: ContagemPendencias = {
    glosa: ledger.glosas,
    cancelamento: ledger.canceladas,
    'autorizacao-a-mais': aMais.size,
    faltando,
    total: 0,
  }
  /*
    O CANCELAMENTO NÃO ENTRA NO TOTAL (2026-08-27, reportado da tela).

    `total` é o número que a operação lê para dimensionar trabalho — é ele que a
    linha imprime como "8 Pendências" e é por ele que a listagem ordena e filtra.
    O cancelamento não é trabalho: `autorizacaoCancelada` já registra o que ele é
    ("a autorização saiu e foi desfeita — não consumiu cota e não pede nada"), e a
    própria ajuda da espécie diz isso ao usuário. Somá-lo inflava a fila com
    linhas em que não havia nada a fazer.

    Ele continua CONTADO e continua VISÍVEL na linha, com a pílula slate e a
    hachura de "encerrado" (ver `.rachurado`): o fato existe, a auditoria precisa
    dele, e esconder o número faria a listagem discordar da grade — onde a guia
    cancelada segue desenhada. O que ele deixa de ser é uma unidade de fila.

    Se ele fosse a ÚNICA espécie do paciente, a linha sairia da listagem (o filtro
    é `total > 0`), e é o desfecho certo: um mês em que só houve cancelamento não
    tem pendência nenhuma. Ver a nota em `ListaPendencias`, onde a mesma decisão
    aparece do lado da tela.
  */
  contagem.total = contagem.glosa + contagem['autorizacao-a-mais'] + faltando
  return contagem
}

/**
 * guia → TUSS da sessão que ela COBRE, para as triagens que cobrem.
 *
 * O vínculo aceita guia de TUSS diferente do da sessão (20260925130000). O caso
 * que exigiu: Miguel Rodrigues De Queiroz, 24/09 — a Coordenação de Caso das
 * 14:20 (22070384) foi glosada por reincidência e a refação saiu como Terapia
 * Ocupacional (22070427). Contada no TUSS dela, a guia sobrava como "autorização
 * a mais" em TO e faltava uma liberação em Psicologia, mesmo depois do vínculo.
 * A cota é da SESSÃO: a guia conta onde cobre.
 *
 * O TUSS sai do `bloco_id`, que é montado pelo banco:
 * `paciente_data_TUSS_hora` na sessão e `falta_paciente_data_hora_TUSS` no bloco
 * sintético da falta (substituição).
 */
export function tussDasGuiasVinculadas(
  vinculosPorBloco: ReadonlyMap<string, VinculoAutorizacao>
): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const v of vinculosPorBloco.values()) {
    if (!triagemCobre(v) || !v.bloco_id) continue
    const partes = v.bloco_id.split('_')
    const tuss = partes[0] === 'falta' ? partes[partes.length - 1] : partes[2]
    if (tuss) mapa.set(v.guia, tuss)
  }
  return mapa
}

/**
 * O placar de um conjunto de sessões contra um conjunto de autorizações.
 *
 * Pura de propósito: a listagem chama isto uma vez por paciente do período e o
 * modal chama de novo para o paciente aberto (e para a semana aberta). Duas
 * implementações fariam a linha da tabela e o card do modal discordarem sobre
 * o mesmo paciente — que é exatamente o tipo de divergência que esta tela
 * existe para caçar.
 *
 * MUDOU DE ARQUIVO EM 2026-09-22, pelo motivo do cabeçalho deste — o mesmo que
 * já moveu `guiasSubstituidas` e `contarPendencias` antes dela. Morava em
 * `useAnaliseReincidencia.ts`, que importa os services e com eles o cliente do
 * Supabase: um teste que a tocasse morria com "Your project's URL and API key
 * are required" antes de somar um número. Foi o que aconteceu ao tentar travar
 * o caso João Lucas (ver `placarSubstituicao.test.ts`), e a função sem teste era
 * exatamente onde o defeito estava. O hook segue reexportando.
 *
 * `cutoff` é o instante (inclusivo) até o qual uma sessão já aconteceu E já
 * passou dos 30 minutos de tolerância. Ela separa `agendadas` de
 * `decorridas`, e a diferença não é cosmética: contar como "autorização
 * faltando" uma sessão que ainda vai acontecer — ou que aconteceu há 5
 * minutos — transformaria a tela em ruído. Só sessão realmente decorrida
 * pode estar sem cobertura.
 *
 * `faltante` conta SESSÕES, uma a uma, por `sessaoSemCobertura` — não é mais
 * `decorridas − liberadas`. A troca (2026-08-24) tem um motivo e um efeito:
 *
 * - motivo: a subtração diz quantas faltam e não diz QUAIS, então a grade não
 *   tinha como marcar a sessão problemática. Contando por sessão, cada unidade
 *   do número é um cartão que a tela consegue apontar.
 * - efeito: os dois números divergem num caso, e é o caso que importa. Três
 *   sessões decorridas, três liberações, mas uma delas órfã e uma sessão em
 *   glosa: a subtração fechava `0` e escondia tudo; a contagem por sessão diz
 *   `1`, e do lado das guias a órfã aparece como "sem vínculo". Que é
 *   exatamente o par que esta tela existe para reconciliar.
 */
export function calcularPlacar(
  sessoes: AuditoriaAssimItem[],
  autorizacoes: AutorizacaoAssimSemana[],
  cutoff: string,
  /** As triagens vivas, por bloco — ver `sessaoSemCobertura`. */
  vinculosPorBloco: ReadonlyMap<string, VinculoAutorizacao> = new Map()
): PlacarTuss[] {
  const porTuss = new Map<string, PlacarTuss & { terapiasVistas: Set<string> }>()

  const entrada = (codigo: string | null) => {
    const chave = codigo ?? '—'
    let atual = porTuss.get(chave)
    if (!atual) {
      atual = {
        codigo_tuss: chave,
        terapias: '',
        agendadas: 0,
        decorridas: 0,
        autorizadas: 0,
        liberadas: 0,
        canceladas: 0,
        excedente: 0,
        faltante: 0,
        naoSolicitada: 0,
        terapiasVistas: new Set<string>(),
      }
      porTuss.set(chave, atual)
    }
    return atual
  }

  for (const s of sessoes) {
    const item = entrada(s.codigo_tuss)
    if (s.terapias) item.terapiasVistas.add(s.terapias)
    /*
      Sessão com falta não aconteceu, então não é cota — e autorizar em cima
      dela é justamente um dos jeitos de estourar a cota.

      A SUBSTITUIÇÃO É A EXCEÇÃO, e ela é o motivo de este teste ler a situação
      JÁ COM O VÍNCULO APLICADO (2026-09-22). Quando a triagem afirma que houve
      substituto, `situacaoComVinculo` promove a falta a LIBERADA: a sessão
      aconteceu, consome cota, e conta como agendada como qualquer outra.

      Ler a situação crua aqui era a segunda fonte do defeito relatado (João
      Lucas, 21/09). A guia vinculada saía da fila de órfãs, mas a falta seguia
      pulada por este `continue` — então `agendadas` não a contava, o
      `excedente = liberadas − agendadas` acusava 1, e `excedentesDoPlacar`
      renomeava a guia recém-triada de volta como "Autorização a mais". A
      pendência não sobrevivia por engano de contagem: sobrevivia porque metade
      do sistema já sabia do vínculo e esta metade não.
    */
    const situacaoEfetiva = situacaoComVinculo(
      s.situacao,
      s.bloco_id ? vinculosPorBloco.get(s.bloco_id) : undefined
    )
    if (SITUACOES_SEM_SESSAO.has(situacaoEfetiva ?? '')) continue
    item.agendadas += 1
    if (sessaoDecorrida(s, cutoff)) item.decorridas += 1
    if (sessaoSemCobertura(s, cutoff, vinculosPorBloco)) item.faltante += 1
    if (sessaoNaoSolicitada(s, cutoff, vinculosPorBloco)) item.naoSolicitada += 1
  }

  const tussCoberto = tussDasGuiasVinculadas(vinculosPorBloco)
  for (const a of autorizacoes) {
    const item = entrada(tussCoberto.get(a.guia) ?? a.codigo_tuss)
    item.autorizadas += 1
    if (autorizacaoLiberada(a.status)) item.liberadas += 1
    else if (autorizacaoCancelada(a.status)) item.canceladas += 1
  }

  return [...porTuss.values()]
    .map(({ terapiasVistas, ...item }) => ({
      ...item,
      terapias: [...terapiasVistas].join(' | '),
      excedente: item.liberadas - item.agendadas,
    }))
    .sort((a, b) => b.excedente - a.excedente || a.codigo_tuss.localeCompare(b.codigo_tuss))
}

/**
 * As guias que estouraram a cota — nomeadas, não contadas.
 *
 * `excedente` é um número por TUSS ("6 liberadas para 5 sessões"), e um número
 * não se destaca num cartão. Esta função escolhe QUAIS guias vestem esse número.
 *
 * O critério é a guia que NÃO casou com sessão nenhuma — `pareadas` traz as que
 * a RPC já encaixou. Isso não é heurística: é a leitura direta do fato que o
 * excedente mede. Sobrou liberação porque alguma delas não tem sessão embaixo,
 * e é essa que a grade precisa apontar.
 *
 * Era posicional até 2026-08-27 — "as ÚLTIMAS `excedente` liberações por
 * `data_execucao`" —, e a justificativa registrada era que o banco pareia
 * posicionalmente. Ele não pareia: medido em produção, cada sessão carrega a
 * guia autorizada NAQUELE DIA (Theo Meneses, TUSS 22070400, as sete sessões de
 * agosto). Com isso a regra antiga errava o alvo em 2 dos 3 excedentes do mês, e
 * errava para o pior lado — marcava uma guia que TEM sessão e deixava a órfã
 * sem marca. No caso do Theo acusava a 405507 (26/08, pareada com a sessão das
 * 08:00) enquanto a 51500 (05/08, sem sessão nenhuma) passava batida; no do Davi
 * Yuri, acusava a 368385 (24/08) em vez da 13846 (03/08).
 *
 * A ordem por `data_execucao` sobrevive como DESEMPATE, para o caso de sobrarem
 * mais guias sem par do que o excedente comporta: aí as mais recentes são as que
 * passaram do agendado. E se nada ficou sem par (o excedente veio de sessão
 * cancelada, não de guia solta), o desempate responde sozinho — sem ele a grade
 * ficaria com um número no topo e nenhum cartão marcado, que é justamente a
 * divergência que esta tela existe para caçar.
 *
 * Só liberação entra: recusada não gastou cota, e cancelada foi desfeita.
 */
export function excedentesDoPlacar(
  placar: PlacarTuss[],
  autorizacoes: AutorizacaoAssimSemana[],
  /** As guias que a RPC já casou com uma sessão. Vazio = cai no desempate. */
  pareadas: ReadonlySet<string> = new Set()
): Set<string> {
  const marcadas = new Set<string>()
  for (const p of placar) {
    if (p.excedente <= 0) continue
    const doTuss = autorizacoes
      .filter((a) => (a.codigo_tuss ?? '—') === p.codigo_tuss && autorizacaoLiberada(a.status))
      .sort((a, b) => (a.data_execucao ?? '').localeCompare(b.data_execucao ?? ''))

    // Primeiro as que não casaram com sessão — as mais recentes entre elas, se
    // forem mais do que o excedente. Depois, se ainda faltar marca, completa
    // pelo fim da fila: o excedente é um fato do placar e precisa de dono.
    //
    // O orçamento é contado NESTE TUSS (`deste`), e não em `marcadas`: aquele
    // acumula o mês inteiro, e compará-lo com `p.excedente` faria o segundo TUSS
    // nascer "já cheio" e não marcar nada.
    const deste = new Set<string>()
    const semPar = doTuss.filter((a) => !pareadas.has(a.guia))
    for (const a of semPar.slice(-p.excedente)) deste.add(a.guia)
    for (const a of doTuss.slice(-p.excedente)) {
      if (deste.size >= p.excedente) break
      deste.add(a.guia)
    }
    for (const guia of deste) marcadas.add(guia)
  }
  return marcadas
}
