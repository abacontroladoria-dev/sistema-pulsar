'use client'

import type { CandidataVinculo, CartaoGrade, LinhaGrade } from '../types'
import CartaoAtendimento from './CartaoAtendimento'
import { formatarDia } from './datas'
import { candidataElegivel, type PapelNaSelecao } from './vinculo'

/** O modo de vínculo, visto de dentro da grade. Ausente = grade normal. */
export type SelecaoNaGrade = {
  /** `bloco_id` → candidata, só as que esta semana desenha. */
  porBloco: Map<string, CandidataVinculo>
  /** A guia sendo vinculada, para marcá-la sem torná-la clicável. */
  guiaEmFoco: string
  onEscolher: (candidata: CandidataVinculo) => void
}

const DIA_CURTO = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

function rotuloColuna(iso: string): { nome: string; data: string } {
  const [ano, mes, dia] = iso.split('-').map(Number)
  const d = new Date(ano, (mes ?? 1) - 1, dia ?? 1)
  return { nome: DIA_CURTO[d.getDay()] ?? '', data: formatarDia(iso) }
}

/**
 * A semana do paciente como agenda: horários nas linhas, dias úteis nas colunas.
 *
 * É o elemento principal do modal, e por isso é o único que rola. A coluna do
 * horário fica grudada na esquerda porque, com rolagem lateral, uma célula sem a
 * escala ao lado deixa de dizer a que hora aquele atendimento pertence — e a
 * hora é justamente o eixo.
 *
 * Largura mínima de 11rem por dia é medida, não estética: abaixo disso o nome da
 * terapia quebra em três linhas e o cartão deixa de ser lido de relance, que é a
 * única razão de ele existir. Dois atendimentos da mesma faixa EMPILHAM, em
 * qualquer largura: cada cartão ocupa a coluna inteira e ganha o outro embaixo.
 * Até 2026-08-24 eles se dividiam quando a coluna era larga, e meia coluna é
 * exatamente onde o nome da terapia volta a quebrar — a tela grande piorava a
 * leitura do caso mais denso.
 *
 * Célula vazia fica VAZIA. Numa agenda o vazio é a maioria das células, e
 * escrever "sem sessão" em cada uma faz o ruído crescer com o tamanho da tela; o
 * dia inteiro sem nada, esse sim, é dito uma vez no cabeçalho da coluna.
 *
 * A altura da célula é do CONTEÚDO desde 2026-08-24. Com o cartão saudável
 * colapsado em duas linhas, um `min-h` fixo devolveria em espaço vazio toda a
 * altura que o colapso economizou — e é justamente a diferença de altura entre
 * as duas espécies que faz a pendência ser achada por silhueta.
 */
export default function GradeSemana({
  linhas,
  dias,
  hoje,
  codigosGlosa,
  chaveAberta,
  onAbrirDetalhe,
  selecao,
}: {
  linhas: LinhaGrade[]
  dias: string[]
  /** Data local de hoje, para destacar a coluna do dia. */
  hoje: string
  codigosGlosa: Map<string, string>
  /**
   * O cartão que está aberto na gaveta. Anel de steel, nunca matiz semântico:
   * "você está aqui" e "isto é uma glosa" não podem ser a mesma cor.
   */
  chaveAberta: string | null
  onAbrirDetalhe: (cartao: CartaoGrade) => void
  /**
   * Modo de vínculo: a grade vira o seletor de "esta guia cobre qual sessão?".
   *
   * Substituiu um modal próprio em 2026-08-24. Ele desmontava o modal da semana
   * para abrir, então a evidência que trouxe a pessoa até ali — a agenda do
   * paciente, com a guia órfã no dia em que foi autorizada — desaparecia
   * justamente no momento de decidir. Aqui a escolha acontece em cima dela.
   */
  selecao?: SelecaoNaGrade
}) {
  const diasVazios = new Set(
    dias.filter((dia) => linhas.every((linha) => (linha.celulas[dia] ?? []).length === 0))
  )

  /**
   * Há alguma sessão escolhível desenhada nesta semana?
   *
   * Atenuar é um recurso RELATIVO: ele só significa alguma coisa quando existe
   * um destaque contra o qual recuar. Sem essa guarda o modo de vínculo apagava
   * a semana INTEIRA, e em dois momentos que não são raros — enquanto as
   * candidatas carregam (a RPC vai dia a dia e leva segundos, então `candidatas`
   * fica `[]`) e quando a guia não tem candidata nenhuma, que são 39% das órfãs
   * medidas em produção.
   *
   * O efeito era o oposto do pretendido: a grade abria com tudo a 35% de
   * opacidade, inclusive a glosa que o operador foi ali justamente ler para
   * decidir. "Recua para o fundo, sem sumir" virou sumir.
   */
  const haAlvo =
    !!selecao &&
    linhas.some((linha) =>
      dias.some((dia) =>
        (linha.celulas[dia] ?? []).some((cartao) => {
          const candidata = selecao.porBloco.get(cartao.chave)
          return !!candidata && candidataElegivel(candidata)
        })
      )
    )

  return (
    // Sem `overflow-x-auto` PRÓPRIO, e isto é deliberado: quem rola nos dois
    // eixos é o corpo do modal. Um `overflow-x` aqui criaria um scroller
    // intermediário, e `sticky top-0` no cabeçalho dos dias passaria a resolver
    // contra ELE — que nunca rola na vertical, porque não tem altura limitada.
    // O efeito medido era o cabeçalho subir junto com o conteúdo e sumir, e com
    // ele o nome do dia de cada coluna. O `relative` que impedia a largura
    // mínima de escapar mudou de endereço junto, para o corpo do modal.
    <div>
      {/*
        As larguras mínimas das colunas somam ~59,5rem. Abaixo disso a grade
        transborda e o contêiner rola de lado, em vez de espremer os cartões até
        a ilegibilidade; acima, o `1fr` distribui a sobra pelos cinco dias.

        Sem roles de tabela: com `display: contents` nas linhas, `role="row"` é
        descartado por parte dos navegadores e a tabela chega ao leitor de tela
        pela metade — pior que não prometer tabela nenhuma. O resumo da semana
        logo acima é anunciado por `aria-live`, e cada cartão carrega o estado
        escrito.
      */}
      <div className="grid w-full grid-cols-[4.5rem_repeat(5,minmax(11rem,1fr))]">
        {/* Cabeçalho. Grudado no topo além de na esquerda: a escala é curta
            desde que o cartão saudável colapsou, mas uma semana cheia ainda
            rola, e uma célula sem o nome do dia acima deixa de dizer QUANDO
            aquele atendimento foi — que é metade do que a grade promete. */}
        <div className="sticky top-0 left-0 z-30 border-b border-slate-200 bg-white px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">
          Horário
        </div>
        {dias.map((dia) => {
          const { nome, data } = rotuloColuna(dia)
          const ehHoje = dia === hoje
          return (
            <div
              key={dia}
              className={`sticky top-0 z-20 border-b border-l border-slate-200 px-3 py-2.5 text-[11px] font-semibold tracking-wide ${
                ehHoje ? 'bg-brand-surface text-brand-fg' : 'bg-white text-slate-500'
              }`}
            >
              {nome} <span className="tabular-nums">{data}</span>
              {ehHoje && <span className="ml-1 font-medium normal-case">· hoje</span>}
              {/* Dito uma vez, no alto da coluna: repetir isso em cada faixa
                  encheria o dia mais vazio de texto. */}
              {diasVazios.has(dia) && (
                <span className="mt-0.5 block font-normal text-slate-400 normal-case">
                  Nenhum atendimento
                </span>
              )}
            </div>
          )
        })}

        {/* A escala de horários */}
        {linhas.map((linha) => {
          const semHora = linha.hora === '—'
          return (
            <div key={linha.hora} className="contents">
              <div className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-3 text-right">
                {semHora ? (
                  <span className="text-[10px] leading-tight font-semibold text-slate-400">
                    sem horário
                  </span>
                ) : (
                  <span className="text-[12px] leading-none font-semibold tabular-nums text-slate-500">
                    {linha.hora}
                  </span>
                )}
              </div>

              {dias.map((dia) => {
                const cartoes = linha.celulas[dia] ?? []
                return (
                  <div
                    key={dia}
                    className={`border-b border-l border-slate-100 p-2 ${
                      dia === hoje ? 'bg-brand-surface/40' : ''
                    }`}
                  >
                    {cartoes.length > 0 && (
                      // Empilhados, SEMPRE — nunca lado a lado, mesmo com a
                      // coluna larga o bastante para dois. Dois cartões na
                      // mesma faixa são duas coisas do MESMO horário, e lado a
                      // lado eles são lidos como colunas: o olho pergunta "qual
                      // é o de quando?" e não há resposta, porque a resposta é
                      // "os dois". Um embaixo do outro herda a leitura da
                      // própria grade — de cima para baixo é o tempo, e dentro
                      // da célula não há tempo a passar, só uma lista.
                      <div className="flex flex-col items-stretch gap-1.5">
                        {cartoes.map((cartao) => {
                          const candidata = selecao?.porBloco.get(cartao.chave)
                          const papel: PapelNaSelecao | undefined = !selecao
                            ? undefined
                            : candidata
                              ? candidataElegivel(candidata)
                                ? 'alvo'
                                : 'coberta'
                              : cartao.tipo === 'autorizacao' &&
                                  cartao.guia === selecao.guiaEmFoco
                                ? 'foco'
                                : 'inerte'

                          // Anel CHEIO no que se pode clicar, TRACEJADO na guia
                          // em foco. Os dois são steel — os dois são "em jogo" —
                          // e o traço é o que separa "clique aqui" de "é isto
                          // que estamos vinculando", sem gastar um segundo
                          // matiz num vocabulário que já tem seis.
                          const anel =
                            papel === 'alvo' || cartao.chave === chaveAberta
                              ? 'ring-2 ring-brand ring-offset-1'
                              : papel === 'foco'
                                ? 'outline-2 outline-dashed outline-brand outline-offset-2'
                                : ''

                          return (
                            <div
                              key={cartao.chave}
                              data-chave={cartao.chave}
                              // Sem `grow`/`basis`: no eixo vertical os dois
                              // passam a falar de ALTURA, e `basis-34` daria
                              // 8,5rem de cartão vazio a cada um.
                              className={`min-w-0 rounded-lg ${anel}`}
                            >
                              <CartaoAtendimento
                                cartao={cartao}
                                codigosGlosa={codigosGlosa}
                                onAbrir={
                                  papel === 'alvo' && candidata
                                    ? () => selecao?.onEscolher(candidata)
                                    : onAbrirDetalhe
                                }
                                papel={papel}
                                atenuar={haAlvo}
                                distanciaSelecao={candidata?.distancia_horas ?? null}
                                // Pela SITUAÇÃO da candidata, e não pelo prefixo
                                // `falta_` do bloco: a situação é o dado, o
                                // prefixo é serialização.
                                ehFaltaNaSelecao={candidata?.situacao === 'FALTA_TERAPEUTA'}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
