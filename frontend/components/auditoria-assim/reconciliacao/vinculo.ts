import type { CandidataVinculo } from '../types'

/**
 * Onde está cada candidata de uma guia órfã — e o que a tela pode fazer com ela.
 *
 * Escolher a sessão que uma guia cobre deixou de ser um modal separado em
 * 2026-08-24 e passou a acontecer na própria grade: as candidatas ficam
 * clicáveis onde já estão desenhadas, na semana do paciente. O ganho é não
 * perder de vista a evidência que trouxe alguém até ali — o modal antigo
 * prometia no comentário que "a semana continua atrás" e não continuava, porque
 * abri-lo desmontava o modal da semana.
 *
 * O custo é este arquivo. A janela de busca é de 7 dias RETROATIVOS a partir do
 * instante em que a ASSIM registrou a guia (`data_execucao`), e ela atravessa a
 * semana exibida — às vezes o mês. Uma guia autorizada na segunda procura
 * sessões da quinta anterior, que a grade aberta não tem onde desenhar. Sem
 * dizer isso em voz alta, a tela contaria "3 candidatas" e mostraria uma, calada.
 *
 * Então cada candidata cai em exatamente um destes lugares, e cada lugar tem um
 * gesto correspondente na barra de vínculo:
 *
 * - **na grade** — tem cartão na semana aberta. Clica-se nele;
 * - **noutra semana do mês** — a faixa de semanas leva até lá;
 * - **fora do mês carregado** — precisa trocar o mês antes da semana;
 * - **sem cartão** — cai na semana aberta e mesmo assim não foi desenhada.
 *   Não deveria acontecer, e é justamente por isso que é contada: quando
 *   acontecer, aparece escrito em vez de sumir.
 */

export type SemanaDoMes = { inicio: string; fim: string }

/**
 * O que se sabe sobre o destino de uma autorização da semana.
 *
 * Morava em `LinhaAutorizacao.tsx`, um componente que a grade aposentou em
 * 2026-08-24 e que ninguém mais importava — o tipo veio para cá, junto do resto
 * do vocabulário de vínculo, quando ganhou os dois estados de DEPOIS.
 *
 * - `sem-vinculo` — a única que autoriza ação, e ela NÃO é calculada no cliente:
 *   vem de `get_guias_orfas`, a mesma função que alimenta a fila (exclui guia já
 *   triada antes do `row_number()`, exclui guia capturada pelo próprio Pulsar e
 *   só considera `status = 'Liberado'`). Uma segunda definição de órfã aqui
 *   ofereceria vincular guia que a Conferência já considera casada;
 * - `vinculada` — alguém disse qual sessão ela cobre. Sai de
 *   `autorizacoes_vinculos`, não da ausência na fila de órfãs;
 * - `sem-sessao` — alguém disse que ela não cobre sessão nenhuma (autorização
 *   extra: 39% das órfãs medidas em produção). Mesma fonte;
 * - `pareada` — o pareamento posicional do banco já a casou com uma sessão da
 *   semana. Ela não vira cartão próprio: já está impressa no cartão da sessão;
 * - `fora-da-semana` — o que sobra, e só o que sobra. A guia não encosta em
 *   nenhuma sessão desta semana e ninguém a triou: pode estar pareada a uma
 *   sessão da semana vizinha ou ser guia do próprio Pulsar.
 *
 * Os dois estados do meio existem porque `fora-da-semana` estava respondendo
 * por eles. Uma guia recém-vinculada sai da fila de órfãs e continua sem casar
 * com sessão nenhuma pelo pareamento do banco — a sessão que ela cobre guarda a
 * guia ANTIGA, a glosada —, então ela caía no `else` e a grade a rotulava
 * "Outra semana", desmentindo a ação que o operador acabara de tomar.
 */
export type EstadoAutorizacao =
  | 'sem-vinculo'
  | 'vinculada'
  | 'sem-sessao'
  | 'pareada'
  | 'fora-da-semana'

/**
 * O dia e a hora que um `bloco_id` já carrega — sem consultar coisa nenhuma.
 *
 * `bloco_id` não é um id opaco: é
 * `concat_ws('_', paciente_id, data_atendimento, codigo_tuss, hora_inicial)`,
 * montado por `get_auditoria_assim_periodo` e repetido tal e qual em
 * `fn_blocos_assim` e em `autorizacoes_vinculos.bloco_id` (cujo comentário de
 * coluna documenta o formato). Nenhum dos quatro pedaços contém `_`.
 *
 * Serve à ponta que não tem a sessão em mãos: a guia vinculada pode cobrir uma
 * sessão de outra semana — às vezes de outro mês —, e nesse caso ela não está
 * entre as linhas carregadas. Ler o bloco é o que permite ao cartão dizer "cobre
 * Qui 30/07 14:20" em vez de mostrar um identificador cru.
 *
 * O bloco sintético de falta (`falta_…`) é traduzido antes — ver
 * `blocoRealDaFalta`: `falta_terapeuta` e `substituicao` são gravados nele.
 * Nulo quando o formato não bate.
 */
export function sessaoDoBloco(blocoId: string | null): { dia: string; hora: string } | null {
  if (!blocoId) return null
  const partes = (blocoRealDaFalta(blocoId) ?? blocoId).split('_')
  if (partes.length !== 4) return null
  const [, dia, , hora] = partes
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}/.test(hora)) return null
  return { dia, hora: hora.slice(0, 5) }
}

/**
 * A guia carregada foi emitida DEPOIS da triagem que leva o número dela?
 *
 * Então é outra guia. O número da ASSIM recicla, e `autorizacoes_assim` tem
 * `UNIQUE (guia)`: a emissão nova sobrescreve a antiga, e a triagem feita sobre
 * a antiga passava a vestir a nova — de outro paciente. Medido em 28/09: 4 dos
 * 27 vínculos ativos, todos de agosto, com o número reemitido em setembro. Uma
 * guia de ABA emitida em 01/09 saía "Vinculada · Autorização Substituta 03/08
 * 11:20", apontando para a Psicopedagogia de outra criança.
 *
 * Ninguém vincula uma guia que ainda não existe, então a ordem no tempo é
 * prova suficiente. `data_execucao` vem sem fuso e é hora de Brasília;
 * `vinculado_em` é timestamptz. Sem um dos dois não há como afirmar: `false`.
 */
export function guiaPosteriorAoVinculo(
  dataExecucao: string | null,
  vinculadoEm: string | null
): boolean {
  if (!dataExecucao || !vinculadoEm) return false
  const temFuso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dataExecucao)
  const emissao = Date.parse(temFuso ? dataExecucao : `${dataExecucao}-03:00`)
  const triagem = Date.parse(vinculadoEm)
  if (Number.isNaN(emissao) || Number.isNaN(triagem)) return false
  return emissao > triagem
}

/**
 * O bloco sintético de falta traduzido para o `bloco_id` da sessão real.
 *
 * A falta tem chave própria, `falta_<paciente>_<dia>_<hora>_<tuss>` (ordem
 * diferente da sessão), e é nela que `falta_terapeuta` e `substituicao` são
 * gravados. Mas a substituição devolve o slot à Conferência como sessão real,
 * com o `bloco_id` normal `<paciente>_<dia>_<tuss>_<hora>` — e aí o vínculo,
 * indexado só pela chave da falta, não achava o cartão: a sessão substituída
 * saía "Liberada" comum, com o nome da titular que faltou (21/09, guia 321907).
 *
 * Nulo quando o id não é de falta.
 */
export function blocoRealDaFalta(blocoId: string): string | null {
  const partes = blocoId.split('_')
  if (partes.length !== 5 || partes[0] !== 'falta') return null
  const [, paciente, dia, hora, tuss] = partes
  return `${paciente}_${dia}_${tuss}_${hora}`
}

/**
 * O papel de um cartão enquanto a grade está escolhendo a sessão de uma guia.
 *
 * - `foco` — a própria guia sendo vinculada. Não é alvo de clique: é o sujeito
 *   da pergunta, e fica marcada para não se perder de vista;
 * - `alvo` — candidata elegível. É o único cartão clicável do modo;
 * - `coberta` — candidata que a RPC devolveu marcada como não-elegível (já
 *   liberada ou já vinculada). Continua VISÍVEL de propósito: é o que faz
 *   perceber que a guia é extra;
 * - `inerte` — todo o resto da semana. Recua para o fundo, sem sumir.
 */
export type PapelNaSelecao = 'foco' | 'alvo' | 'coberta' | 'inerte'

/**
 * Escolhível de verdade.
 *
 * A RPC já devolve `elegivel` (não coberta e não vinculada), e `ja_vinculado`
 * é redundante com ele hoje. Os dois são exigidos aqui mesmo assim: são
 * booleanos anuláveis vindos de fora, e um `null` em qualquer um dos dois não
 * pode virar "pode clicar".
 */
export function candidataElegivel(c: CandidataVinculo): boolean {
  return c.elegivel === true && c.ja_vinculado !== true
}

export type MapaCandidatas = {
  /**
   * `bloco_id` → candidata, só as que a grade exibida de fato desenha.
   *
   * Inclui as NÃO elegíveis de propósito: uma sessão já liberada continua
   * visível e marcada como tal, porque é o que faz o operador perceber que a
   * guia é extra — 39% das órfãs medidas em produção não cobrem sessão nenhuma.
   */
  naGrade: Map<string, CandidataVinculo>
  /**
   * Semana (segunda ISO) → quantas candidatas elegíveis ela guarda.
   *
   * TODAS as semanas do mês, a aberta inclusive. É o que a faixa do cabeçalho
   * imprime enquanto o modo está ligado: no modo normal ela conta pendências em
   * âmbar, aqui conta candidatas em steel, e nos dois casos responde à mesma
   * pergunta — para que lado navegar.
   */
  porSemana: Map<string, number>
  /** Elegíveis fora do mês carregado: exigem trocar de mês antes da semana. */
  foraDoMes: CandidataVinculo[]
  /** Elegíveis que caem na semana aberta e mesmo assim não têm cartão. */
  semCartao: CandidataVinculo[]
  /** Total de elegíveis, esteja cada uma onde estiver. */
  totalElegiveis: number
}

/** A semana do mês que contém `dia`, ou nula quando ele está fora do carregado. */
function semanaDe(semanas: SemanaDoMes[], dia: string): SemanaDoMes | null {
  // Comparação textual: datas ISO ordenam como strings, e é o que esta tela
  // inteira usa para não passar `date` por `new Date()` e ganhar 3h de fuso.
  return semanas.find((s) => dia >= s.inicio && dia <= s.fim) ?? null
}

export function mapearCandidatas(
  candidatas: CandidataVinculo[],
  semanas: SemanaDoMes[],
  semanaAtual: string,
  chavesNaGrade: ReadonlySet<string>
): MapaCandidatas {
  const naGrade = new Map<string, CandidataVinculo>()
  const porSemana = new Map<string, number>()
  const foraDoMes: CandidataVinculo[] = []
  const semCartao: CandidataVinculo[] = []
  let totalElegiveis = 0

  for (const c of candidatas) {
    const desenhada = chavesNaGrade.has(c.bloco_id)
    if (desenhada) naGrade.set(c.bloco_id, c)

    if (!candidataElegivel(c)) continue
    totalElegiveis += 1

    // Sem data não há como situá-la em semana nenhuma. Vai para a lista que a
    // barra imprime por extenso — some da tela é o único desfecho proibido.
    const dia = c.data_atendimento
    if (!dia) {
      semCartao.push(c)
      continue
    }

    const semana = semanaDe(semanas, dia)
    if (!semana) {
      foraDoMes.push(c)
      continue
    }
    porSemana.set(semana.inicio, (porSemana.get(semana.inicio) ?? 0) + 1)
    // Cai na semana aberta e mesmo assim não foi desenhada. Não deveria
    // acontecer; é contado para aparecer escrito quando acontecer.
    if (semana.inicio === semanaAtual && !desenhada) semCartao.push(c)
  }

  return { naGrade, porSemana, foraDoMes, semCartao, totalElegiveis }
}

/** "3,2" — vírgula, porque a tela é em português e `toFixed` devolve ponto. */
function comVirgula(valor: number): string {
  return valor.toFixed(1).replace('.', ',')
}

/**
 * A distância entre a sessão e o instante em que a ASSIM registrou a guia.
 *
 * É O critério da reconciliação: casar guia com sessão aqui é casar por tempo,
 * e era o dado mais escondido do modal antigo — 11px cinza, no canto direito,
 * depois do número da guia.
 *
 * O SINAL vem da RPC como `data_execucao - (data_atendimento + hora_inicial)`,
 * então **negativo = a guia saiu ANTES da sessão** (autorização adiantada) e
 * positivo = depois (o caso normal, e o caso da glosa reautorizada no portal,
 * que é o que este módulo existe para caçar). O modal antigo invertia a leitura
 * do lado negativo: escrevia "3,2 h antes da autorização", que afirma o oposto.
 *
 * A frase é sempre sobre a GUIA porque o cartão em que ela aparece é a sessão —
 * o referente já está na tela.
 */
export function distanciaCurta(horas: number | null): string | null {
  if (horas == null) return null
  const abs = Math.abs(horas)
  const medida = abs < 24 ? `${comVirgula(abs)} h` : `${comVirgula(abs / 24)} d`
  return horas < 0 ? `${medida} antes` : `${medida} depois`
}

/** A mesma distância com o referente escrito, para `title` e leitor de tela. */
export function distanciaPorExtenso(horas: number | null): string | null {
  const curta = distanciaCurta(horas)
  if (!curta) return null
  return `guia autorizada ${curta} desta sessão`
}
