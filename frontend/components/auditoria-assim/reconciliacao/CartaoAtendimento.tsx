'use client'

import { createElement, memo, type ReactNode } from 'react'
import {
  AlertCircle, AlertOctagon, Ban, CalendarClock, CheckCircle2, KeySquare, Link2,
  type LucideIcon,
} from 'lucide-react'
import { autorizacaoCancelada, autorizacaoLiberada } from '@/hooks/useAnaliseReincidencia'
import { iconeTerapia } from '@/lib/cronograma/iconeTerapia'
import { completarMotivoGlosa, lerMotivoGlosa } from '@/lib/glosa'
import { resolverConfig } from '../SituacaoBadge'
import type { CartaoGrade, VinculoAutorizacao } from '../types'
import {
  cobertaPorAvulsa,
  SITUACOES_COBERTAS,
  SITUACOES_COM_VEREDITO,
  SITUACOES_SEM_SESSAO,
} from './cobertura'
import { dataHoraDeTimestamptz, formatarDia, formatarDiaComNome } from './datas'
import { cartaoPendente } from './grade'
import {
  distanciaCurta,
  distanciaPorExtenso,
  sessaoDoBloco,
  type PapelNaSelecao,
} from './vinculo'

/**
 * Um atendimento dentro de uma célula da grade — e, desde 2026-08-24, em DUAS
 * espécies com silhuetas diferentes.
 *
 * O problema que isto resolve: antes todo cartão tinha o mesmo tamanho, as
 * mesmas cinco linhas e a mesma borda, e a única diferença entre "está tudo
 * certo" e "isto aqui está quebrado" era o matiz de um fundo `-50`. Com seis
 * matizes em jogo, a 11px, em caixas de 150px, numa grade de ~55 células, a cor
 * parou de discriminar: a semana virava uma colcha de retalhos onde as duas
 * pendências reais se escondiam entre vinte cartões saudáveis.
 *
 * A troca é de CANAL. O que separa as duas espécies agora é a silhueta, que o
 * olho resolve antes de processar cor:
 *
 * - **compacto** (a maioria — liberada, glosa já resolvida, falta, cancelada,
 *   sessão que ainda nem venceu): duas linhas, fundo branco, sem TUSS, sem guia
 *   e sem rótulo comprido. Uma sessão que está certa não precisa ser lida;
 *   precisa ocupar o slot para a semana continuar se lendo como semana. Os
 *   números seguem no `title` e no histórico — eles só servem quando algo está
 *   errado, porque guia se digita no portal da ASSIM para contestar.
 * - **pendente** (a minoria): corpo inteiro, barra lateral de 3px, o problema
 *   escrito por extenso e o botão quando há ação.
 *
 * Em produção quase todo par (paciente, TUSS) da semana fecha
 * `agendadas == autorizadas == liberadas`, então ~85% dos cartões colapsam e os
 * dois ou três que sobram viram os únicos objetos altos da tela.
 *
 * Nenhum matiz novo entrou. O cartão sempre diz o NOME da situação, no mesmo
 * vocabulário da aba Auditoria ("Não Solicitada", "Retorno Não Confirmado",
 * "Glosa", "Cancelada"), e quem diz que a sessão está descoberta é o rose — "a
 * lacuna mais larga" do DESIGN.md: a sessão aconteceu e nada a cobre. A exceção
 * é onde a ASSIM já respondeu, que mantém o matiz do veredito — violeta para
 * "Glosa" (recusa que pede tratativa) e rose um degrau mais firme para
 * "Cancelada" (liberação desfeita, que pede autorização nova). Ver
 * `SITUACOES_COM_VEREDITO`.
 *
 * "Cancelada" e as descobertas saem todas em rose DE PROPÓSITO: dizem que nada
 * cobre aquela sessão e pedem a mesma coisa. O que as separa é o rótulo e o
 * ícone (Ban contra AlertCircle), mais o degrau da superfície — matizes
 * diferentes afirmariam que pedem respostas diferentes.
 *
 * Nada abaixo de 11px, que é o piso do DESIGN.md §3. O rótulo de estado e a
 * linha do token estavam em 10px; o token virou glifo e as linhas que sobravam
 * foram fundidas, em vez de encolhidas.
 *
 * ── O DEPOIS DA TRIAGEM (2026-08-24) ───────────────────────────────────────
 *
 * Vincular uma guia a uma sessão não deixava rastro visual nenhum. A guia saía
 * da fila de órfãs e continuava sem casar com sessão pelo pareamento do banco —
 * a sessão coberta guarda a guia ANTIGA, a glosada —, então ela caía no `else`
 * do vocabulário e a grade a rotulava **"Outra semana"**, que afirma o contrário
 * do que acabara de ser feito. Do outro lado, a sessão trocava de situação (para
 * GLOSA_RESOLVIDA, ou para LIBERADA quando não havia glosa) sem dizer o que a
 * resolveu — e o segundo caso ficava indistinguível de uma liberação normal.
 *
 * A primeira versão disto escreveu a frase no rodapé dos dois cartões ("Cobre
 * Seg 03/08 11:20" / "Coberta pela guia 15032") e foi reprovada em tela: *"o
 * operador precisa abrir o detalhamento pra descobrir quem é"*. Duas causas, e a
 * segunda é a de fundo. Prosa num contêiner de 144px trunca, e truncava pelo
 * fim — comendo justamente o número e a hora. E a espécie compacta esconde guia
 * e TUSS de propósito, o que é certo para a sessão que está tudo bem e errado
 * para a guia triada: ela não é um cartão que se pula, é um cartão que existe
 * para ser identificado.
 *
 * O que substituiu é o **selo do par** (`SeloDoPar`): o número da guia, em
 * tabular, num selo de largura fixa, no CABEÇALHO — a mesma linha da hora, que é
 * por onde a coluna do dia é varrida. Ele aparece igual nos dois cartões, então
 * o par se acha sozinho na grade sem que ninguém leia uma palavra. Sobra um
 * único fato que selo nenhum carrega — QUAL sessão —, e esse fica no rodapé da
 * guia, em rótulo/valor (`ReferenciaDaSessao`), que não trunca.
 *
 * Os dois lados do par triado vestem VIOLETA — rótulo, selo e borda —, e a
 * descartada ("é autorização extra") veste slate, que é o que acabou sem efeito.
 * Nenhum matiz novo: violeta é o que `SITUACAO_CONFIG.GLOSA_RESOLVIDA` já
 * reserva para "o que foi resolvido foi uma glosa".
 *
 * Esmeralda ficou reservada à liberação de ROTINA, e essa exclusividade é o
 * ponto. Enquanto a sessão substituída também saía verde ela se lia como uma
 * liberada comum — reportado da tela duas vezes, a segunda depois de o selo
 * violeta não ter bastado: *"não pode ser em verde pra não confundir
 * visualmente com Liberada"*. O que muda é o CANAL do rótulo e da borda, não o
 * do fundo: o compacto segue branco, então nada afirma que há trabalho ali.
 */

/**
 * Rótulo curto do que a ASSIM devolveu numa guia que não casou com sessão.
 *
 * Só para a guia que ninguém triou. Os dois desfechos da triagem têm rótulo
 * próprio e nunca chegam aqui.
 *
 * O ramo da liberada dizia "Outra semana" até 2026-09-03, e era afirmação sobre
 * um fato que nenhum código deste caminho verifica. `fora-da-semana` é o `else`
 * de `estadoDeUmaGuia` (useAnaliseReincidencia.ts) — "não está na fila de
 * órfãs, ninguém a triou, e o número dela não aparece em nenhuma sessão
 * CARREGADA". Semana nenhuma é comparada: `pareadas` é só
 * `new Set(sessoes.map(s => s.guia))`, e a coluna do cartão vem de
 * `data_execucao`, o que permitia um cartão na coluna de terça afirmar "outra
 * semana". Das três causas que `DetalheCartao` já lista por extenso (pareada a
 * uma sessão da semana vizinha, já triada, ou guia do próprio Pulsar) só a
 * primeira tem a ver com semana.
 *
 * "Não identificada" é o que a tela de fato sabe: existe, está liberada, e o
 * pareamento não a explica. A explicação por extenso continua na gaveta, onde
 * cabe — este rótulo vive num contêiner de 144px.
 */
function rotuloAutorizacao(status: string | null): string {
  if (autorizacaoCancelada(status)) return 'Cancelada'
  if (autorizacaoLiberada(status)) return 'Não identificada'
  return 'Glosa'
}

/**
 * A sessão que uma triagem aponta, lida do próprio bloco, em duas medidas.
 *
 * `curta` ("03/08 11:20") é a que cabe no cartão; `longa` ("Seg 03/08 11:20") é
 * a do `title`, onde o dia da semana cabe e ajuda.
 */
function sessaoCoberta(vinculo: VinculoAutorizacao | null): { curta: string; longa: string } | null {
  const sessao = sessaoDoBloco(vinculo?.bloco_id ?? null)
  if (!sessao) return null
  return {
    curta: `${formatarDia(sessao.dia)} ${sessao.hora}`,
    longa: `${formatarDiaComNome(sessao.dia)} ${sessao.hora}`,
  }
}

/** "por Fulano · 24/08 15:10" — a autoria da triagem, para o `title`. */
function autoriaDaTriagem(vinculo: VinculoAutorizacao | null): string {
  if (!vinculo) return ''
  const quem = vinculo.vinculado_por ? ` por ${vinculo.vinculado_por}` : ''
  const quando = vinculo.vinculado_em ? ` em ${dataHoraDeTimestamptz(vinculo.vinculado_em)}` : ''
  return `${quem}${quando}`
}

/**
 * O ícone da especialidade, resolvido pelo nome da terapia.
 *
 * Componente próprio, e `createElement` em vez de `<Icone />`: a tabela devolve
 * um componente escolhido em tempo de render, e montá-lo como elemento JSX de
 * uma variável local é o que a regra `react-hooks/static-components` proíbe —
 * com razão no caso geral, ainda que aqui a referência venha de um mapa fixo.
 */
function IconeDaTerapia({ terapia }: { terapia: string }) {
  return createElement(iconeTerapia(terapia), {
    size: 11,
    className: 'mt-px shrink-0 text-slate-400',
    'aria-hidden': true,
  })
}

/**
 * O cabeçalho comum às duas espécies: a hora à esquerda, o estado à direita.
 *
 * A hora fica na mesma altura em todo cartão para que a coluna do dia possa ser
 * varrida de cima a baixo sem reler cada caixa — é o que sobrou do antigo
 * `Miolo`, e é a única parte dele que as duas espécies compartilham.
 */
function Cabecalho({
  hora,
  tinta,
  Icone,
  teveToken,
  token,
  selo,
}: {
  hora: string
  tinta: string
  Icone: LucideIcon
  teveToken: boolean | null
  token: string | null
  /** O selo do par, quando há triagem. Toma o lugar do ícone — ver `SeloDoPar`. */
  selo?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-1.5">
      <span className="text-[13px] leading-tight font-semibold tabular-nums text-slate-900">
        {hora}
      </span>
      <span className="flex min-w-0 shrink items-center gap-1">
        {/* Glifo, e não linha própria: o token é dado de conferência de filipeta,
            um eixo diferente do estado da autorização, e gastava a quinta linha
            do cartão a 10px para dizer o que um ícone com `title` já diz. */}
        {/* Âmbar, e não slate: a filipeta é o terceiro eixo do vocabulário
            (DESIGN.md), onde âmbar já significa "a conferir" — e em slate-400 o
            glifo de 11px sumia dentro do cartão. `-600` e não `-700` porque o
            que se pediu foi laranja visível, e o degrau -700 lê como ferrugem;
            como glifo ele responde ao piso de 3:1 de elemento não-textual, não
            ao de 4,5:1 de texto. */}
        {teveToken && (
          <KeySquare
            size={12}
            className="shrink-0 text-amber-600"
            aria-label={`filipeta ${token ?? ''}`}
          />
        )}
        {/* O selo SUBSTITUI o ícone de estado em vez de conviver com ele: ele já
            carrega glifo próprio, e o estado continua escrito por extenso na
            linha de baixo. Dois glifos mais um número numa faixa de 144px é
            onde o cabeçalho deixa de ser varrível. */}
        {selo ?? <Icone size={13} strokeWidth={2.25} className={`shrink-0 ${tinta}`} aria-hidden />}
      </span>
    </div>
  )
}

/**
 * O selo do par: o mesmo número, no mesmo lugar, nos dois cartões.
 *
 * O problema que ele resolve foi reportado da tela: *"o operador precisa abrir o
 * detalhamento pra descobrir quem é"*. A causa era estrutural — o cartão triado
 * é da espécie COMPACTA, e a espécie compacta esconde guia e TUSS de propósito
 * ("uma sessão que está certa não precisa ser lida"). Só que uma guia vinculada
 * não é um cartão que se pula: ele existe justamente para ser identificado, e
 * dizia "Vinculada" sem dizer *qual*.
 *
 * A primeira tentativa foi escrever a frase no rodapé ("Coberta pela guia
 * 15032"). Prosa num contêiner de 144px trunca — e truncava exatamente no
 * número, que é a única parte que importa. A troca é de FORMA: sai a frase,
 * entra um selo de largura fixa com o número em tabular.
 *
 * Ele fica no cabeçalho, na mesma linha da hora, porque é ali que a coluna do
 * dia é varrida de cima a baixo — e é isso que faz o par se achar sozinho: dois
 * cartões distantes na grade carregando `15032` idêntico, na mesma altura, se
 * lêem como um objeto só sem que ninguém precise ler uma palavra.
 *
 * O número é o da GUIA nos dois cartões, e não "o outro lado" de cada um: o selo
 * é o nome do par, não um ponteiro. A guia é quem dá nome porque é ela que foi
 * autorizada — é o número que se digita no portal da ASSIM.
 */
function SeloDoPar({
  guia,
  tom,
  Icone,
  titulo,
}: {
  guia: string
  tom: string
  Icone: LucideIcon
  titulo: string
}) {
  return (
    <span
      title={titulo}
      className={`inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold ${tom}`}
    >
      {/* Para quem lê por leitor de tela, o selo sozinho seria um número solto
          no meio do cartão. A frase inteira vai aqui e o visível fica oculto do
          leitor — o `title` não é anunciado de forma confiável num span. */}
      <span className="sr-only">{titulo}</span>
      <Icone size={10} className="shrink-0" aria-hidden />
      <span aria-hidden className="truncate font-mono tabular-nums">
        {guia}
      </span>
    </span>
  )
}

/**
 * A tarja que o modo de vínculo acrescenta ao pé do cartão.
 *
 * Ela carrega a DISTÂNCIA — as horas entre a sessão e o instante em que a ASSIM
 * registrou a guia. É o critério da reconciliação, e no modal que este modo
 * aposentou ele era o dado mais escondido da tela: 11px cinza, encostado no
 * número da guia, no canto direito de uma linha de lista.
 *
 * Steel, e só steel, no cartão escolhível: "esta é a que você pode clicar" é
 * seleção, não estado clínico — o matiz semântico do cartão continua sendo do
 * cartão. A candidata já coberta veste slate e some do primeiro plano sem sair
 * da tela, porque é justamente ela que revela a guia extra.
 */
function Tarja({
  papel,
  distancia,
  ehFalta,
}: {
  papel: PapelNaSelecao
  distancia: number | null
  /**
   * O alvo é uma FALTA, e não uma sessão. Diz "Esta falta", porque "Esta sessão"
   * prometeria um atendimento que não houve — a falta continua falta, e o que se
   * registra ali é de onde veio a autorização, não uma cobertura.
   *
   * Um flag e não um quinto `PapelNaSelecao`: papel é o estado do cartão DENTRO
   * da escolha, não a espécie do cartão. As duas perguntas são independentes.
   */
  ehFalta?: boolean
}) {
  if (papel === 'inerte') return null

  const conteudo: Record<'foco' | 'alvo' | 'coberta', { Icone: LucideIcon; texto: string }> = {
    foco: { Icone: Link2, texto: 'Esta guia' },
    alvo: { Icone: Link2, texto: ehFalta ? 'Esta falta' : 'Esta sessão' },
    coberta: { Icone: CheckCircle2, texto: ehFalta ? 'já autorizada' : 'já coberta' },
  }
  const { Icone, texto } = conteudo[papel]
  const alvo = papel === 'alvo'

  return (
    <p
      className={`mt-1.5 flex items-center justify-between gap-1.5 border-t pt-1 text-[11px] leading-tight font-semibold ${
        alvo ? 'border-brand text-brand-fg' : 'border-slate-200 text-slate-500'
      }`}
    >
      <span className="truncate tabular-nums">{distanciaCurta(distancia) ?? ''}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Icone size={11} aria-hidden />
        {texto}
      </span>
    </p>
  )
}

/**
 * O rodapé da guia vinculada: a sessão que ela cobre, em rótulo e valor.
 *
 * O selo do cabeçalho nomeia o par; falta o fato que nenhum selo carrega — QUAL
 * sessão. Ele só existe deste lado, e a assimetria é a economia do desenho: a
 * sessão não precisa de rodapé porque o selo já diz a guia, e um "coberta pela
 * guia 15032" embaixo de um selo escrito `15032` seria o mesmo dado duas vezes
 * num cartão que tem duas linhas.
 *
 * Rótulo à esquerda e valor à direita, como todo o resto do cartão (hora/glifos,
 * terapia/estado). A frase corrida que estava aqui truncava a 144px, e truncava
 * pelo fim — comendo a hora, que é a parte que identifica. Com os dois lados
 * curtos e `justify-between`, nada é cortado.
 *
 * Sem o nome do dia: "Seg 03/08 11:20" não cabe, e a data já é inequívoca. Onde
 * há largura para o dia por extenso é no `title` e na gaveta.
 *
 * "Autorização Substituta" (ajuste em tela, era "cobre"): a guia e a borda do
 * cartão voltaram a esmeralda, e este rodapé passou a ser onde a procedência —
 * "isto substituiu outra coisa" — fica escrita por extenso, já que a cor não a
 * carrega mais aqui. Esmeralda, acompanhando o resto do cartão.
 *
 * O rótulo agora é quem QUEBRA, e o valor é quem fica `shrink-0`. Antes o
 * inverso: "cobre" era uma palavra só e cabia sozinha, sobrando a faixa toda
 * para a data. Com três palavras ("Autorização Substituta") e os dois lados
 * `shrink-0`, os 144px não tinham como acomodar as duas — medido em tela: a
 * data, que é o único fato novo desta linha, saía cortada em "0". Invertendo
 * quem cede, ela nunca mais é cortada; o rótulo é redundante com o cabeçalho
 * do cartão (a borda e a hora já dizem "isto está coberto por avulsa"), então
 * é ele quem pode gastar uma segunda linha.
 */
function ReferenciaDaSessao({ valor, titulo }: { valor: string; titulo: string }) {
  return (
    <p
      title={titulo}
      className="mt-1.5 flex items-start justify-between gap-2 border-t border-emerald-200 pt-1 text-[11px] leading-tight"
    >
      <span className="min-w-0 text-slate-500">Autorização Substituta</span>
      <span className="shrink-0 pt-px font-semibold tabular-nums text-emerald-700">{valor}</span>
    </p>
  )
}

/**
 * A espécie compacta: duas linhas e nada mais.
 *
 * A segunda linha diz as duas coisas de uma vez — a TERAPIA à esquerda e o
 * RÓTULO do estado à direita, embaixo do ícone que ele repete. O rótulo escrito
 * é o que a regra do vocabulário exige (cor nunca é o único sinal): um ✓ verde
 * sozinho pede que a pessoa saiba de cor que verde é "Liberada", e é justamente
 * a leitura de relance que o cartão compacto existe para servir.
 *
 * Antes só uma das duas aparecia, conforme o estado fosse ou não a notícia. Sai
 * mais barato mostrar as duas: a terapia trunca, o rótulo é curto e não encolhe.
 */
function Compacto({
  hora,
  terapia,
  rotulo,
  tinta,
  Icone,
  teveToken,
  token,
  titulo,
  onAbrir,
  desabilitado,
  inerte,
  selo,
  tarja,
  contorno,
  rachurado,
}: {
  hora: string
  terapia: string | null
  rotulo: string
  tinta: string
  Icone: LucideIcon
  teveToken: boolean | null
  token: string | null
  titulo: string
  /** Todo cartão abre o detalhe — ver a nota do componente. */
  onAbrir: () => void
  desabilitado?: boolean
  /** Modo de vínculo: este cartão não é candidato nem é a guia em foco. */
  inerte?: boolean
  /** O selo do par, no cabeçalho, no lugar do ícone de estado. */
  selo?: ReactNode
  tarja?: ReactNode
  /**
   * A cor da borda, quando o compacto precisa de uma silhueta própria.
   *
   * Os DOIS lados do par triado a usam — a sessão coberta por avulsa e a guia
   * que a cobriu —, e é ela a única marca que a caixa inteira carrega. O
   * compacto é branco de fundo por princípio ("uma sessão que está certa não
   * precisa ser lida"), e era isso que deixava a procedência sem lugar: sobravam
   * o rótulo e o selo, os dois pequenos, num cartão de 144px numa grade de ~55
   * células. A borda veste o MESMO matiz do rótulo e o fundo segue branco, então
   * nada afirma que há trabalho pendente. Ausente, a borda é a slate de sempre.
   *
   * Não é barra lateral (`Espinha`) DE PROPÓSITO, embora tenha sido a primeira
   * tentativa nos dois lados. A barra é o dispositivo da espécie PENDENTE, e em
   * `SITUACAO_CONFIG` a barra violeta já significa "isto é uma glosa, trate" —
   * reusá-la para "procedência: veio de avulsa" dava dois significados ao mesmo
   * matiz na mesma tela, que é o que o vocabulário proíbe. A borda não tem esse
   * problema: ela é o contorno da caixa, não um acento dentro dela. Medido em
   * tela, a barra ainda comia 2px do nome da terapia.
   *
   * Quando há contorno o `hover` não repinta a borda: trocá-la por slate ao
   * passar o mouse apagaria justamente a marca sob o cursor.
   */
  contorno?: string
  /**
   * A hachura de "encerrado" — ver `.rachurado`/`.rachurado-forte` em globals.css.
   *
   * Responde a pergunta que a cor não responde: o item saiu da fila. Os cinco
   * matizes semânticos já estão todos ocupados, e "encerrado" não é um sexto
   * estado — é uma qualificação sobre o estado que já está escrito. Textura é o
   * canal livre, e a listra nasce de `currentColor`, então ela sai no matiz do
   * próprio cartão em vez de introduzir cor nova.
   *
   * `true` usa a opacidade base; `'forte'` é para o slate do cancelamento, onde a
   * mesma opacidade mede mais fraca por partir de menos contraste — ver a nota em
   * `.rachurado-forte`.
   */
  rachurado?: boolean | 'forte'
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      disabled={desabilitado}
      title={titulo}
      className={`relative w-full min-w-0 rounded-lg border bg-white py-1.5 pr-2 pl-2 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none ${
        contorno ?? 'border-slate-200'
      } ${rachurado === 'forte' ? 'rachurado-forte' : rachurado ? 'rachurado' : ''} ${
        inerte ? 'opacity-60' : ''
      } ${
        desabilitado ? '' : contorno ? 'hover:bg-slate-50' : 'hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <Cabecalho
        hora={hora}
        tinta={tinta}
        Icone={Icone}
        teveToken={teveToken}
        token={token}
        selo={selo}
      />
      <p className="mt-0.5 flex items-start justify-between gap-1.5 text-[11px] leading-tight">
        {terapia && (
          <span className="flex min-w-0 items-start gap-1 text-slate-600">
            <IconeDaTerapia terapia={terapia} />
            <span className="truncate">{terapia}</span>
          </span>
        )}
        {/* O rótulo pode QUEBRAR em vez de empurrar a terapia, e `min-w-min` é o
            piso que permite isso sem cortar palavra: o mínimo de um texto é a
            palavra mais longa dele. Medido em tela: com "Glosa Coberta" e
            `shrink-0`, numa faixa de 144px sobrava "Fon…" onde o cartão vizinho
            mostrava "Fonoaudio…" — o cartão distinguido saía menos legível que o
            comum, que é o contrário do que a distinção existe para fazer.

            Quebrar só ajuda quando a palavra mais longa do rótulo é CURTA. Em
            "Glosa Coberta" ela é "Coberta" e a terapia recupera a linha inteira;
            em "Autorização extra" ela é "Autorização", que já é a largura toda —
            ali a quebra gastava uma segunda linha e a terapia continuava em
            "Fonoa…". Por isso o piso é medido, não aplicado a todos: `nowrap`
            acima de 10 caracteres na palavra mais longa. Os rótulos de uma
            palavra ("Liberada", "Cancelada", "Vinculada") nunca quebraram —
            para eles o mínimo já é a largura inteira. */}
        <span
          className={`min-w-min text-right font-semibold ${
            palavraMaisLonga(rotulo) > 10 ? 'whitespace-nowrap' : ''
          } ${tinta}`}
        >
          {rotulo}
        </span>
      </p>
      {tarja}
    </button>
  )
}

/**
 * O corpo da espécie pendente: o que está errado, em quê, e com qual número.
 *
 * A ordem é a da pergunta que se faz: quando (cabeçalho), em que terapia, o que
 * há de errado, e só então os identificadores — que existem para ser digitados
 * no portal da ASSIM, não para serem lidos de relance.
 */
function CorpoPendente({
  terapia,
  frase,
  tinta,
  codigo,
  guia,
  motivo,
}: {
  terapia: string | null
  frase: string
  tinta: string
  codigo: string | null
  guia: string | null
  motivo: string | null
}) {
  return (
    <>
      {/* Terapia à esquerda, estado à direita — a MESMA disposição do cartão
          compacto. O estado morava numa linha própria abaixo, e isso fazia o
          rótulo pular de altura conforme o cartão: no compacto ele estava no
          canto direito da segunda linha, no pendente duas linhas mais abaixo e
          à esquerda. Varrer uma coluna com o mesmo dado em dois lugares obriga
          a reler cada cartão. Agora o estado está sempre no mesmo canto, e é a
          terapia que trunca — ela sobrevive inteira no `title`. */}
      <p className="mt-0.5 flex items-start justify-between gap-1.5 text-[11px] leading-tight">
        {terapia && (
          <span className="flex min-w-0 items-start gap-1 font-medium text-slate-700">
            <IconeDaTerapia terapia={terapia} />
            <span className="truncate">{terapia}</span>
          </span>
        )}
        {/* A cor nunca é o único sinal: o problema vem escrito, no matiz dele. */}
        <span className={`shrink-0 text-right font-semibold ${tinta}`}>{frase}</span>
      </p>
      {/* Código e guia na MESMA linha: são os dois identificadores do mesmo
          atendimento, e a grade por horário não tem altura para dar a cada um. */}
      <p className="mt-1 font-mono text-[11px] leading-tight tabular-nums text-slate-600">
        {codigo ?? '—'}
        {guia && <span className="text-slate-400"> · </span>}
        {guia}
      </p>
      {motivo && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-slate-500">{motivo}</p>
      )}
    </>
  )
}

/**
 * O tamanho da palavra mais longa de um rótulo — o que decide se ele pode quebrar.
 *
 * Ver a nota no rótulo de `Compacto`. Quebrar um rótulo de duas palavras devolve
 * largura à terapia só quando a palavra mais longa é curta; quando ela já ocupa
 * a faixa inteira ("Autorização"), a quebra gasta uma linha e não devolve nada.
 */
function palavraMaisLonga(texto: string): number {
  return texto.split(/\s+/).reduce((maior, p) => Math.max(maior, p.length), 0)
}

/** A barra lateral de 3px — o mesmo dispositivo que `SituacaoBloco` já usa. */
function Espinha({ dot }: { dot: string }) {
  return <span aria-hidden className={`absolute inset-y-0 left-0 w-0.75 rounded-l-lg ${dot}`} />
}

/**
 * Todo cartão é um botão, e todo botão abre a MESMA coisa: o detalhe.
 *
 * Até 2026-08-24 só a guia órfã era clicável — ela levava direto à escolha da
 * sessão — e os outros vinte cartões da semana não faziam nada. Uma grade em que
 * um cartão em vinte responde ao clique ensina a não clicar em nenhum, e ainda
 * escondia num gesto exclusivo os dados que a pessoa precisava conferir (motivo
 * da recusa por extenso, quem solicitou, se a filipeta foi conferida).
 *
 * Agora o gesto é um só e as ações moram na gaveta, onde há espaço para dizer o
 * que cada uma faz. Ver `DetalheCartao`.
 */
const CartaoAtendimento = memo(function CartaoAtendimento({
  cartao,
  codigosGlosa,
  onAbrir,
  papel,
  atenuar,
  distanciaSelecao,
  ehFaltaNaSelecao,
}: {
  cartao: CartaoGrade
  codigosGlosa: Map<string, string>
  onAbrir: (cartao: CartaoGrade) => void
  /**
   * O papel deste cartão no modo de vínculo. Ausente = modo normal.
   *
   * Primitivos, e não um objeto `selecao`, porque este componente é `memo`: um
   * objeto recriado a cada render derrubaria a comparação rasa das ~55 células
   * mesmo fora do modo de vínculo, que é quando a grade rola.
   */
  papel?: PapelNaSelecao
  /**
   * Há alvo escolhível na semana desenhada. Só então o recuo do `inerte` é
   * aplicado — ver a nota em `GradeSemana`. Fora do modo de vínculo é ignorado.
   */
  atenuar?: boolean
  distanciaSelecao?: number | null
  /**
   * O alvo da escolha é uma falta de terapeuta. Muda só o vocabulário da tarja e
   * do `title` — a cor, a silhueta e o estado do cartão continuam sendo os da
   * falta, que é exatamente o ponto: vincular não a transforma em sessão.
   */
  ehFaltaNaSelecao?: boolean
}) {
  // Duas coisas diferentes, e por isso duas variáveis. No modo de vínculo o
  // ÚNICO cartão que aceita clique é o alvo — abrir a gaveta de detalhe no meio
  // de uma escolha trocaria a pergunta debaixo da mão de quem está decidindo.
  // Mas só o cartão fora da janela ESMAECE: a candidata já coberta precisa
  // continuar legível, porque é ela que revela que a guia é extra.
  const desabilitado = papel !== undefined && papel !== 'alvo'
  // Não clicável e recuado são coisas DIFERENTES, e separá-las é o que conserta
  // a semana apagada: enquanto as candidatas carregam — ou quando a guia não tem
  // candidata nenhuma — nada é alvo, e aí ninguém recua. O clique continua
  // bloqueado nos dois casos, porque abrir a gaveta no meio de uma escolha
  // trocaria a pergunta debaixo da mão de quem decide.
  const inerte = papel === 'inerte' && atenuar === true
  // Uma tarja de cada vez, e a da seleção vence: enquanto se escolhe a sessão de
  // uma guia, o rodapé do cartão responde à pergunta do MODO ("esta é a que você
  // pode clicar"), não ao histórico dele.
  const tarjaSelecao = papel ? (
    <Tarja papel={papel} distancia={distanciaSelecao ?? null} ehFalta={ehFaltaNaSelecao} />
  ) : null
  // No modo de vínculo o `title` responde à pergunta do modo, não à do cartão.
  const tituloSelecao =
    papel === 'alvo'
      ? (distanciaPorExtenso(distanciaSelecao ?? null) ??
        (ehFaltaNaSelecao
          ? 'registrar que esta guia foi a autorização desta falta'
          : 'vincular a guia a esta sessão'))
      : papel === 'coberta'
        ? ehFaltaNaSelecao
          ? 'esta falta já tem uma autorização registrada'
          : 'esta sessão já está coberta — não pode receber a guia'
        : papel === 'foco'
          ? 'a guia que está sendo vinculada'
          : papel === 'inerte'
            ? 'fora da janela de busca desta guia'
            : null

  if (cartao.tipo === 'sessao') {
    const config = resolverConfig(cartao.situacao ?? '—')
    const pendente = cartaoPendente(cartao)

    /*
      Qual guia cobriu esta sessão — na primeira linha, sem gastar altura.

      A `situacao` diz QUE está coberta e nunca diz POR QUÊ: a sessão continua
      guardando no campo `guia` a autorização ANTIGA, a glosada, porque o vínculo
      não a reescreve. E no ramo LIBERADA (sessão que nunca foi solicitada e que
      alguém acabou de cobrir por fora) ela fica indistinguível de uma liberação
      normal do robô — a ação do operador some da grade no instante em que surte
      efeito.

      O selo responde as duas coisas de uma vez e é o mesmo que o cartão da guia
      carrega: é assim que os dois se acham na grade. Ver `SeloDoPar`.
    */
    /*
      Coberta por AVULSA, e não pelo pareamento normal — a distinção que a cor
      não fazia.

      `situacaoComVinculo` deixa esta sessão em GLOSA_RESOLVIDA ou LIBERADA, e as
      duas são esmeralda: na grade ela ficava idêntica a uma sessão que o robô
      liberou na hora. Reportado da tela — "não pode ficar verdinha também,
      porque confunde com uma liberada comum".

      A resposta NÃO é trocar o matiz do estado: a sessão está coberta, e
      esmeralda é o que diz isso — pintá-la de outra cor afirmaria que ainda há
      trabalho. É acrescentar a PROCEDÊNCIA, no violeta que
      `SITUACAO_CONFIG.GLOSA_RESOLVIDA` já reserva para ela ("dot violeta porque
      o que foi resolvido foi uma GLOSA"). Essa marca existia no vocabulário e
      não era desenhada em lugar nenhum desta grade: o `dot` só aparece no pill e
      no bloco da listagem, e a sessão coberta nunca é pendente, então ela caía
      sempre no compacto — que não tem barra lateral.

      Quem a carrega aqui é o SELO, não uma barra. A barra violeta já significa
      "isto é uma glosa, trate" na espécie pendente, e dar-lhe um segundo
      significado no mesmo modal é o que o vocabulário proíbe; o selo, ao
      contrário, só existe em par triado — não há como confundi-lo com estado.

      Quem decide é o VÍNCULO, e a situação entra só para excluir a falta — ver
      `cobertaPorAvulsa`. `origem.situacao` não é crua na prática: com a migration
      viva a RPC já devolve GLOSA_RESOLVIDA na linha que `montarGrade` guarda em
      `origem`.
    */
    const porAvulsa = cobertaPorAvulsa(cartao.origem.situacao, cartao.vinculo)

    // Violeta sempre que houver selo, sem ramo de esmeralda: selo só existe onde
    // houve triagem, e o único vínculo que `porAvulsa` recusa é o de uma FALTA —
    // sessão que não aconteceu, cuja cobertura não é substituição de nada. Ali o
    // slate diz o que é: um vínculo que não surtiu efeito.
    const selo = cartao.vinculo ? (
      <SeloDoPar
        guia={cartao.vinculo.guia}
        Icone={Link2}
        tom={porAvulsa ? 'bg-violet-100 text-violet-800' : 'bg-slate-200 text-slate-700'}
        titulo={`Coberta pela guia ${cartao.vinculo.guia}${autoriaDaTriagem(cartao.vinculo)}`}
      />
    ) : undefined

    const titulo = [
      cartao.hora,
      cartao.terapia,
      cartao.legenda,
      config.label,
      cartao.vinculo ? `coberta pela guia ${cartao.vinculo.guia}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    if (!pendente) {
      /*
        A sessão que AINDA NÃO ACONTECEU não veste o vocabulário da auditoria.

        "Não Solicitada" é rótulo de auditoria e nasce vermelho, porque depois do
        atendimento não ter pedido autorização é a lacuna mais larga que existe.
        Antes do atendimento é o estado normal — a autorização se tira na hora —,
        e a tela pintava de rose a agenda inteira de quinta e sexta, dizendo que
        havia erro onde não havia nada ainda.

        Então enquanto não decorre, e enquanto ninguém liberou, o cartão diz o
        que de fato é: "Agendada", em slate. Nenhum matiz novo — slate já é
        "nenhum status registrado" no DESIGN.md — e nenhuma situação nova em
        SITUACAO_CONFIG: é só esta tela escolhendo não gritar cedo demais.
      */
      const aguardando =
        !cartao.decorrida &&
        !SITUACOES_SEM_SESSAO.has(cartao.situacao ?? '') &&
        !SITUACOES_COM_VEREDITO.has(cartao.situacao ?? '') &&
        !SITUACOES_COBERTAS.has(cartao.situacao ?? '')

      /*
        A sessão que uma AVULSA cobriu não diz "Liberada" — e não diz em verde.

        Duas coisas foram reprovadas em tela, uma depois da outra. Primeiro o
        rótulo: `situacaoComVinculo` manda para LIBERADA toda sessão coberta por
        triagem que não vinha de glosa (a NAO_SOLICITADA e a CANCELADA que
        alguém acabou de cobrir), e ali o cartão saía com a palavra exata de uma
        liberação de rotina. Depois o MATIZ: mesmo escrito "Glosa Resolvida", o
        rótulo continuava em `config.strong`, que é esmeralda, e o selo violeta
        no cabeçalho não bastava — *"não pode ser em verde pra não confundir
        visualmente com Liberada"*.

        A troca é do CANAL do rótulo, não do estado. A palavra e a BORDA do
        cartão passam a violeta — o matiz que `SITUACAO_CONFIG.GLOSA_RESOLVIDA`
        já reserva para "o que foi resolvido foi uma glosa" —, e a borda existe
        porque o compacto tem fundo branco: sem ela a procedência ficava só em
        dois glifos pequenos, que a 144px numa grade de ~55 células não separam
        nada. O fundo segue branco como todo compacto, então nada afirma que há
        trabalho pendente aqui.

        Os dois ramos dizem "Glosa Coberta" e "Coberta": o que muda é se havia
        recusa para cobrir. "Coberta" é a palavra que a gaveta já usa na pílula
        — nenhum vocabulário novo.
      */
      const rotuloCoberta = porAvulsa
        ? cartao.situacao === 'GLOSA_RESOLVIDA'
          ? 'Glosa Coberta'
          : 'Coberta'
        : config.label

      return (
        <Compacto
          hora={cartao.hora}
          terapia={cartao.terapia}
          rotulo={aguardando ? 'Agendada' : rotuloCoberta}
          tinta={
            aguardando ? 'text-slate-500' : porAvulsa ? 'text-violet-700' : config.strong
          }
          Icone={aguardando ? CalendarClock : config.icon}
          teveToken={cartao.teve_token}
          token={cartao.token}
          titulo={tituloSelecao ?? (aguardando ? `${titulo} · ainda não aconteceu` : titulo)}
          onAbrir={() => onAbrir(cartao)}
          desabilitado={desabilitado}
          inerte={inerte}
          selo={selo}
          tarja={tarjaSelecao}
          // A borda no MESMO violeta do rótulo. É o que dá ao cartão coberto por
          // avulsa uma silhueta própria na grade, em vez de deixar a procedência
          // dependendo de dois glifos de 11px.
          contorno={porAvulsa && !aguardando ? 'border-violet-300' : undefined}
          // E a hachura, que diz a coisa que a cor não diz: este item foi
          // ENCERRADO. A glosa existiu, alguém a cobriu, e não há mais nada a
          // fazer aqui — ver `.rachurado-forte` em globals.css. Ela risca sem
          // pintar, então o violeta segue sendo procedência e a textura passa a
          // ser "fechado", que é o canal que estava livre. FORTE, na mesma
          // intensidade do cancelamento (ajuste em tela) — as duas marcam
          // "encerrado", e a base ficava sutil demais para ler de relance numa
          // grade de ~55 células.
          rachurado={porAvulsa && !aguardando ? 'forte' : false}
        />
      )
    }

    /*
      A manchete é o NOME DA SITUAÇÃO — o mesmo nome da aba Auditoria. A COR é
      que diz se a sessão está descoberta.

      Até 2026-08-25 a manchete era a palavra "Sem cobertura" para tudo que não
      tivesse veredito da ASSIM, e isso custava o nome: a sessão que a
      Conferência chama de "Não Solicitada" aparecia aqui como "Sem cobertura",
      e quem vai e volta entre as duas abas lia dois vocabulários para um fato
      só. Reportado da tela — a reconciliação existe para resolver o que a
      Conferência aponta, então falar a língua dela não é preferência.

      A troca é SÓ da palavra. Rose continua vestindo toda sessão descoberta,
      seja qual for a situação por baixo — é "a lacuna mais larga" do DESIGN.md
      e é exatamente isso, a sessão aconteceu e nada a cobre. Assim a coluna do
      dia segue sendo varrida pela cor (SE está descoberta) e a palavra passa a
      responder a segunda pergunta (POR QUE: não solicitada, solicitação
      cancelada, retorno não confirmado, sincronizando), em vez de as duas
      disputarem o mesmo espaço dizendo o mesmo. O fato que a palavra deixou de
      carregar continua no `title` e na pílula "Sem cobertura" da gaveta.

      As situações de `SITUACOES_COM_VEREDITO` seguem com o matiz próprio, e não
      com rose: houve resposta da ASSIM, e QUAL foi a resposta decide o próximo
      passo — "Glosa" pede tratativa, "Cancelada" pede autorização nova.
    */
    const descoberta =
      cartao.semCobertura && !SITUACOES_COM_VEREDITO.has(cartao.situacao ?? '')
    const frase = config.label
    const tinta = descoberta ? 'text-rose-700' : config.strong
    const superficie = descoberta ? 'border-rose-200 bg-rose-50' : config.surface
    const dot = descoberta ? 'bg-rose-500' : config.dot
    const Icone = descoberta ? AlertCircle : config.icon
    const motivo =
      completarMotivoGlosa(lerMotivoGlosa(cartao.motivoBruto), codigosGlosa)?.descricao ?? null

    return (
      <button
        type="button"
        onClick={() => onAbrir(cartao)}
        disabled={desabilitado}
        title={tituloSelecao ?? `${titulo}${cartao.semCobertura ? ' · sem cobertura' : ''}`}
        className={`relative w-full min-w-0 rounded-lg border py-2 pr-2 pl-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none ${superficie} ${
          inerte ? 'opacity-60' : ''
        } ${
          desabilitado ? '' : 'hover:brightness-97'
        }`}
      >
        <Espinha dot={dot} />
        <Cabecalho
          hora={cartao.hora}
          tinta={tinta}
          Icone={Icone}
          teveToken={cartao.teve_token}
          token={cartao.token}
          selo={selo}
        />
        <CorpoPendente
          terapia={cartao.terapia}
          frase={frase}
          tinta={tinta}
          codigo={cartao.codigo_tuss}
          guia={cartao.guia}
          motivo={motivo}
        />
        {tarjaSelecao}
      </button>
    )
  }

  const cancelada = autorizacaoCancelada(cartao.status)
  const liberada = autorizacaoLiberada(cartao.status)
  const semVinculo = cartao.estado === 'sem-vinculo'
  // Os dois desfechos da triagem. Antes deles a guia recém-decidida caía em
  // `fora-da-semana` e a grade a rotulava "Outra semana" — a única afirmação que
  // a tela conseguia fazer sobre ela era a mais errada possível.
  const vinculada = cartao.estado === 'vinculada'
  const semSessao = cartao.estado === 'sem-sessao'
  // Estourar a cota é pendência mesmo quando a guia não está na fila de órfãs:
  // é o excedente que provoca a glosa 1601, e ele existia só como `+1` num chip
  // do placar — um número que a grade não tinha como apontar.
  const pendente = cartaoPendente(cartao)
  const coberta = sessaoCoberta(cartao.vinculo)

  // Mesmo parser que a Conferência e a Central usam: numa recusa o `status`
  // vem "1601-REINCIDENCIA NO ATEN" (cortado em 25 caracteres) e o de-para
  // completa o que a ASSIM truncou.
  const motivo =
    liberada || cancelada
      ? null
      : (cartao.descricao_erro ??
        completarMotivoGlosa(lerMotivoGlosa(cartao.status), codigosGlosa)?.descricao ??
        null)

  // A guia RECUSADA (nem liberada, nem cancelada, nem triada) é a que sobrava
  // no `else` até 2026-08-27, e caía em esmeralda por eliminação — reportado da
  // tela: a 405760 (Theo Meneses, 1601-REINCIDENCIA) aparecia "verde como se
  // fosse liberada". Ela nunca cobriu sessão nenhuma; é a MESMA glosa que o
  // outro lado do par mostra em violeta (lilás) — mesmo vocabulário, mesmo
  // matiz.
  //
  // Checada ANTES de `pendente` na cor, embora `pendente` (`cartaoPendente`,
  // grade.ts) TAMBÉM seja `true` para ela agora: a guia recusada precisa da
  // silhueta expandida (não pode ficar sem destaque, é uma glosa esquecida),
  // mas o MOTIVO da pendência não é o mesmo da que espera triagem. Âmbar
  // continua reservado a "esperando alguém decidir o vínculo"
  // (`semVinculo`/excedente); a recusa já tem veredito — é violeta, igual a
  // toda glosa nesta tela. Sem checar antes, `pendente` capturava a recusada e
  // ela saía laranja — reportado da tela.
  const recusada = !semSessao && !cancelada && !liberada && !vinculada

  // A guia VINCULADA veste ESMERALDA: ela cobriu uma sessão, e esmeralda é o
  // que esta tela usa para "está coberto". A procedência ("é a avulsa que
  // substituiu, não o pareamento normal") continua marcada — pela hachura
  // FORTE do lado da sessão e pelo rótulo "Autorização Substituta" no rodapé —,
  // então a cor volta a responder só a pergunta que sempre respondeu aqui: este
  // item está coberto?
  //
  // A DESCARTADA veste slate, que nesta tela é o que acabou sem efeito: ela não
  // cobre sessão nenhuma, e é isso que o operador afirmou sobre ela. "Outra
  // semana" (liberada, mas sem casar com nada aqui) também é slate — ela pode
  // estar cobrindo uma sessão de fora da janela, então afirmar "descoberto" ou
  // "coberto" aqui seria adivinhar. Cota divergente (`semVinculo`/excedente,
  // sem ser recusa) é âmbar pelo mesmo motivo que a chip do placar é âmbar
  // (DESIGN.md, o terceiro eixo): "esperando alguém olhar".
  const tom = recusada
    ? 'border-violet-200 bg-violet-50'
    : vinculada
      ? 'border-emerald-200 bg-emerald-50'
      : pendente
        ? 'border-amber-300 bg-amber-50'
        : 'border-slate-200 bg-slate-50'
  const tinta = recusada
    ? 'text-violet-700'
    : vinculada
      ? 'text-emerald-700'
      : pendente
        ? 'text-amber-700'
        : 'text-slate-600'
  const dot = recusada ? 'bg-violet-500' : vinculada ? 'bg-emerald-500' : pendente ? 'bg-amber-500' : 'bg-slate-400'
  // AlertOctagon na recusada, checado ANTES de `pendente` pela mesma razão da
  // cor: `pendente` também é `true` aqui, e o glifo de vínculo (`Link2`) não
  // pode representar uma glosa. Link2 tanto na órfã quanto na vinculada de
  // propósito: é o mesmo eixo — o do vínculo — em dois momentos, e quem separa
  // os dois é o matiz mais o rótulo, que vem escrito. Ban na descartada porque
  // é o ícone do botão que a produziu ("Nenhuma — é autorização extra").
  const Icone = recusada
    ? AlertOctagon
    : vinculada
      ? Link2
      : pendente
        ? Link2
        : semSessao || cancelada
          ? Ban
          : CheckCircle2

  const rotulo = semVinculo
    ? 'Sem vínculo'
    : vinculada
      ? 'Vinculada'
      : semSessao
        ? 'Autorização extra'
        : rotuloAutorizacao(cartao.status)
  // Excedente que não está na fila SUBSTITUI o rótulo em vez de qualificá-lo:
  // "Não identificada · além do agendado" diria as duas coisas ao contrário —
  // "não identificada" afirma que o pareamento não explica a guia, e "além do
  // agendado" já é uma explicação (ela passou da cota do dia). Os rótulos que
  // afirmam algo VERIFICADO sobre a guia — a órfã e as duas triadas — convivem
  // com o excedente: sabe-se o que ela é E que passou da cota.
  const frase = !cartao.excedente
    ? rotulo
    : semVinculo || vinculada || semSessao
      ? `${rotulo} · além do agendado`
      : 'Liberada além do agendado'
  const tituloBase = `Guia ${cartao.guia}, autorizada às ${cartao.hora}`

  /*
    O que faltava neste cartão era o próprio NÚMERO dele.

    A espécie compacta esconde guia e TUSS de propósito — "uma sessão que está
    certa não precisa ser lida" —, e a guia triada herdou esse silêncio sem
    merecê-lo: ela não é um cartão que se pula, é um cartão que existe para ser
    identificado, e dizia "Vinculada" sem dizer qual. Era isso que obrigava a
    abrir a gaveta.

    O selo repõe o número no cabeçalho, e é o MESMO que a sessão coberta carrega
    — é o que faz os dois se acharem na grade sem ler nada (ver `SeloDoPar`). O
    rodapé fica com o único fato que o selo não carrega: qual sessão. Ele sai do
    próprio `bloco_id`, e não de uma busca, porque a sessão coberta pode estar
    noutra semana — a janela é de 7 dias retroativos e atravessa a virada do
    mês —, e aí ela não está entre as linhas desenhadas aqui.
  */
  const selo =
    vinculada || semSessao ? (
      <SeloDoPar
        guia={cartao.guia}
        Icone={vinculada ? Link2 : Ban}
        // Esmeralda na vinculada (ajuste em tela) — acompanha a borda e a hora
        // do próprio cartão, que voltaram a esmeralda. O par com a sessão do
        // outro lado (que segue violeta) não se acha mais pela cor do selo — o
        // número da guia é idêntico nos dois, e é ele quem faz o par se achar.
        // Ver `SeloDoPar`.
        tom={vinculada ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}
        titulo={
          vinculada
            ? `${tituloBase} — cobre a sessão de ${coberta?.longa ?? 'outra semana'}${autoriaDaTriagem(cartao.vinculo)}`
            : `${tituloBase} — triada como autorização extra${autoriaDaTriagem(cartao.vinculo)}`
        }
      />
    ) : undefined

  const tarja =
    tarjaSelecao ??
    (vinculada && coberta ? (
      <ReferenciaDaSessao
        valor={coberta.curta}
        titulo={`Cobre a sessão de ${coberta.longa}${autoriaDaTriagem(cartao.vinculo)}`}
      />
    ) : null)

  if (!pendente) {
    // Guia recusada que não está na fila e não estourou cota: a recusa continua
    // sendo o assunto, então ela vai no rótulo — mas sem gastar altura de
    // pendência, porque não há o que fazer a respeito nesta tela.
    return (
      <Compacto
        hora={cartao.hora}
        terapia={cartao.terapia}
        rotulo={rotulo}
        tinta={tinta}
        Icone={Icone}
        teveToken={cartao.teve_token}
        token={cartao.token}
        titulo={
          tituloSelecao ??
          [
            tituloBase,
            cartao.terapia,
            // A guia triada fala do PAR, não do próprio estado: repetir aqui o
            // rótulo que já está escrito ao lado gastaria o `title` dizendo o
            // que o olho acabou de ler.
            vinculada && coberta
              ? `cobre a sessão de ${coberta.longa}${autoriaDaTriagem(cartao.vinculo)}`
              : semSessao
                ? `sem sessão correspondente${autoriaDaTriagem(cartao.vinculo)}`
                : (motivo ?? rotulo),
          ]
            .filter(Boolean)
            .join(' · ')
        }
        onAbrir={() => onAbrir(cartao)}
        desabilitado={desabilitado}
        inerte={inerte}
        selo={selo}
        tarja={tarja}
        // Esmeralda, acompanhando a borda e a hora (ajuste em tela): esta guia
        // está coberta — cobriu uma sessão —, e esmeralda é o que a tela usa
        // para isso. Só a borda, e não a barra lateral: a barra é o dispositivo
        // da espécie PENDENTE (`Espinha`), e repeti-la aqui empresta peso de
        // pendência a uma guia que já cumpriu o papel dela.
        contorno={vinculada ? 'border-emerald-300' : undefined}
        // A VINCULADA não hachura (ajuste em tela): ela é o lado que COBRIU —
        // continua fazendo o trabalho de apontar a sessão, e o par se acha na
        // grade pelo selo e pela borda violeta idênticos. Hachurados os dois
        // desfechos que ENCERRARAM sem virar cobertura de nada: a guia triada
        // como autorização extra, e a que a ASSIM desfez ("Liberado *"). A
        // cancelada usa a hachura FORTE (ajuste em tela) — é a mesma marca que o
        // cancelamento leva na listagem, onde ele também saiu do total pelo
        // mesmo motivo (ver `contarPendencias`).
        rachurado={cancelada ? 'forte' : semSessao}
      />
    )
  }

  const miolo = (
    <>
      <Espinha dot={dot} />
      {/* Sem selo na espécie expandida: `CorpoPendente` já imprime a guia numa
          linha própria, e repetir o número no cabeçalho seria dizê-lo duas vezes
          no mesmo cartão. */}
      <Cabecalho
        hora={cartao.hora}
        tinta={tinta}
        Icone={Icone}
        teveToken={cartao.teve_token}
        token={cartao.token}
      />
      <CorpoPendente
        terapia={cartao.terapia}
        frase={frase}
        tinta={tinta}
        codigo={cartao.codigo_tuss}
        guia={cartao.guia}
        motivo={motivo}
      />
      {tarja}
    </>
  )

  return (
    <button
      type="button"
      onClick={() => onAbrir(cartao)}
      disabled={desabilitado}
      title={
        tituloSelecao ??
        `${tituloBase} — ${
          semVinculo ? 'ver o que ela pode cobrir' : 'liberação além das sessões agendadas do TUSS'
        }`
      }
      className={`relative w-full min-w-0 rounded-lg border py-2 pr-2 pl-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:outline-none ${tom} ${
        inerte ? 'opacity-60' : ''
      } ${
        desabilitado ? '' : 'hover:brightness-97'
      }`}
    >
      {miolo}
    </button>
  )
})

export default CartaoAtendimento
