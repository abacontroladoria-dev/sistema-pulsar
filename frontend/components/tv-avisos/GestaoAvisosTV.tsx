"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Monitor,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { CarrosselAvisos } from "@/components/tv/CarrosselAvisos"
import {
  criarAviso,
  definirAtivo,
  descartarArquivoAviso,
  listarAvisos,
  publicarAvisos,
  removerAviso,
  restaurarAviso,
  salvarOrdem,
  validarArquivoAviso,
  type AvisoTVRegistro,
  type ErroAviso,
} from "@/services/tvAvisos.service"

// Gestão do carrossel da TV da recepção.
//
// ─── Enviar não é publicar ──────────────────────────────────────────────────
//
// O upload sobe o objeto na hora (estado pendente criaria órfão a cada
// desistência, mesmo raciocínio do FotoPacienteUpload), mas a linha nasce como
// RASCUNHO — `ativo = false`. Antes, escolher o arquivo bastava para o cartaz
// entrar na parede da recepção em até 5 min, sem ninguém confirmar: um arquivo
// errado no seletor virava erro visível para todas as famílias na sala de espera.
// Agora quem publica confere na prévia e clica em "Publicar na TV".
//
// Ligar/desligar e reordenar continuam IMEDIATOS, de propósito: são ações sobre
// o que já foi conferido uma vez, e tirar do ar um cartaz errado não pode custar
// dois cliques nem depender de lembrar de um segundo botão.
//
// ─── A tela não espera o banco ──────────────────────────────────────────────
//
// Ligar/desligar, reordenar e remover aplicam na hora e reconciliam depois. O
// motivo é medido, não estético: reordenar era a pior operação da tela — cada
// clique de seta custava uma escrita, um recarregamento da lista inteira e um
// congelamento de TODOS os botões, então mover um cartaz da posição 5 para a 1
// eram quatro esperas em sequência com a página travada no meio.
//
// Três regras sustentam isso e nenhuma é opcional:
//
//   1. O que está em voo é POR LINHA (`emVoo`, um Set de ids), nunca um booleano
//      da página. Uma escrita numa linha não tem por que desabilitar as outras.
//   2. Toda ação guarda o estado anterior e faz ROLLBACK se a escrita falhar. É
//      o que substitui o antigo `recarregar()` pós-escrita.
//   3. A reconciliação com o banco continua existindo — ver abaixo.
//
// ⚠️ RLS bloqueando WRITE não gera erro visível: a gravação "funciona" e não
// grava. Esta tela nasceu relendo o banco depois de CADA escrita justamente por
// isso. O otimismo não pode revogar essa proteção, então ela mudou de lugar em
// vez de sumir: `recarregar()` ainda roda depois de toda escrita, só que sem
// bloquear a tela e sem a pessoa esperar por ele. Se a policy recusou calada, a
// lista volta ao que o banco tem — a diferença é que agora isso é uma correção
// visível depois do fato, não uma espera antes dele.

/** Janela para desfazer uma remoção antes de o arquivo ir embora do bucket. */
const DESFAZER_MS = 8000

/**
 * Quanto tempo o "Confirmar exclusão" fica armado antes de voltar ao normal.
 *
 * Curto de propósito: a confirmação existe para pegar o clique mal-mirado, e um
 * botão que continua armado por muito tempo vira a própria armadilha que ele
 * deveria evitar — o segundo clique distraído no mesmo lugar acha o estado
 * perigoso esperando.
 */
const CONFIRMAR_EXCLUSAO_MS = 4000

/**
 * Espera antes de gravar a ordem.
 *
 * 600ms é mais que o intervalo entre dois cliques de seta seguidos e menos que
 * o tempo de conferir onde o cartaz parou. Ver `agendarSalvarOrdem`.
 */
const SALVAR_ORDEM_DEBOUNCE_MS = 600

/**
 * Quanto a TV demora para pegar uma mudança.
 *
 * Casa com `POLL_AVISOS_VERSAO_MS` em app/tv/page.tsx. Está escrito na tela de
 * propósito: a TV se atualiza sozinha há muito tempo, mas ninguém que publica
 * sabia disso — e em 2026-09-10 alguém reiniciou a máquina inteira da recepção
 * por achar que "não tinha funcionado". O número não é decoração; é o que evita
 * o reboot.
 */
const LATENCIA_TV = "até 30 segundos"

type Removido = {
  aviso: AvisoTVRegistro
  /** Índice de onde ele saiu, para o desfazer devolver no lugar certo. */
  indice: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * Rótulo de quem está fora do ar, na voz de quem opera a TV.
 *
 * RASCUNHO nunca esteve no ar; APOSENTADO esteve e foi tirado. No banco os dois
 * são `ativo = false`; quem os separa é `publicado_em`, carimbado pelo trigger
 * na primeira ida ao ar (20260910190000_tv_avisos_publicado_em.sql).
 *
 * Isto já foi um Set em memória, e a distinção evaporava no F5 — todo cartaz de
 * julho voltava a se declarar "Nunca publicada". O rótulo existia quando o risco
 * era baixo (a pessoa tinha acabado de mexer) e sumia quando era alto (semanas
 * depois, sem ninguém lembrar do que já foi parede).
 */
type Situacao = "no-ar" | "rascunho" | "aposentado"

/**
 * Botão de excluir em lote — vizinho do publicar, mas deliberadamente distante.
 *
 * ─── Por que dois cliques ────────────────────────────────────────────────────
 *
 * As duas ações agem sobre a MESMA seleção e carregam o mesmo número no rótulo
 * ("Excluir 3" / "Publicar 3 na TV"). Só o peso visual separava uma da outra, e
 * peso visual não corrige mira: num trackpad, 40px de erro horizontal trocava
 * "pôr na parede da recepção" por "destruir 3 uploads".
 *
 * O segundo clique não é cerimônia — é o que dá ao erro de mira uma tela de
 * saída. A confirmação expira sozinha em 4s para não virar uma armadilha
 * esperando o próximo clique distraído no mesmo lugar.
 *
 * Continua contorno e nunca preenchido: publicar é a ação que a pessoa veio
 * fazer, excluir é a saída secundária.
 */
function BotaoExcluirSelecionados({
  quantidade,
  onExcluir,
}: {
  quantidade: number
  onExcluir: () => void
}) {
  // Guarda a QUANTIDADE que estava armada, não um booleano: assim a confirmação
  // se invalida sozinha quando a seleção muda, sem efeito nenhum para sincronizar
  // — um "Confirmar exclusão" pendente sobre 3 imagens não pode continuar armado
  // depois que a pessoa marcou a quarta.
  const [armadoPara, setArmadoPara] = useState<number | null>(null)
  const confirmando = armadoPara === quantidade

  useEffect(() => {
    if (armadoPara === null) return
    const t = setTimeout(() => setArmadoPara(null), CONFIRMAR_EXCLUSAO_MS)
    return () => clearTimeout(t)
  }, [armadoPara])

  if (quantidade === 0) return null

  return (
    <button
      type="button"
      onClick={() => {
        if (confirmando) {
          setArmadoPara(null)
          onExcluir()
        } else {
          setArmadoPara(quantidade)
        }
      }}
      className={`shrink-0 inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 ${
        confirmando
          ? "border-rose-400 bg-rose-50 text-rose-800"
          : "border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300"
      }`}
    >
      <Trash2 className="w-4 h-4" />
      {confirmando
        ? "Confirmar exclusão"
        : quantidade === 1
          ? "Excluir 1"
          : `Excluir ${quantidade}`}
    </button>
  )
}

/**
 * O botão de publicar — no cabeçalho do grupo e na barra flutuante.
 *
 * Um componente só, de propósito: os dois têm de dizer a mesma coisa e agir
 * igual. Duas cópias do mesmo JSX é como uma delas envelhece com um texto que a
 * outra já corrigiu.
 *
 * Desabilitado com zero marcadas, e dizendo por quê no rótulo: um botão que
 * some quando não há seleção esconderia justamente a pista de que existe algo a
 * fazer ali; um que continua clicável não teria o que publicar.
 */
function BotaoPublicar({
  quantidade,
  publicando,
  onPublicar,
}: {
  quantidade: number
  publicando: boolean
  onPublicar: () => void
}) {
  const vazio = quantidade === 0

  return (
    /* Clinical Steel, não âmbar.

       O âmbar daqui honrava "Âmbar sólido não é botão" usando tint + anel, mas
       errava um degrau acima: a Decoration-Free Semantics Rule reserva âmbar
       para "esperando alguém olhar" e manda a AÇÃO PRIMÁRIA usar o aço da marca.
       Um matiz que carrega estado não decora botão — e nesta mesma tela o âmbar
       já significa outra coisa (o anel da prévia, o fundo da linha em rascunho).
       Gastá-lo também no botão apagava a diferença entre "isto está pendente" e
       "clique aqui".

       O botão de enviar imagens ao lado já usava `bg-brand-fg`; agora as duas
       ações primárias da tela falam a mesma língua. */
    <button
      type="button"
      onClick={onPublicar}
      disabled={publicando || vazio}
      title={vazio ? "Marque as imagens que quer publicar" : undefined}
      className="shrink-0 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-fg px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      {publicando ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Monitor className="w-4 h-4" />
      )}
      {vazio
        ? "Publicar na TV"
        : quantidade === 1
          ? "Publicar 1 na TV"
          : `Publicar ${quantidade} na TV`}
    </button>
  )
}

/**
 * Um grupo da lista ("No ar" ou "Fora do ar").
 *
 * Existe porque os dois grupos são a MESMA linha com regras diferentes de
 * cabeçalho e de setas, e duplicar 60 linhas de JSX para variar dois detalhes é
 * como as duas metades começam a divergir.
 *
 * As setas só aparecem quando `onMover` é passado: fora do ar não há ordem para
 * defender — um cartaz parado não tem posição no carrossel, e oferecer setas ali
 * seria prometer um efeito que não existe.
 */
function GrupoAvisos({
  titulo,
  descricao,
  avisos,
  vazio,
  emVoo,
  onMover,
  onAlternar,
  onExcluir,
  mostrarPosicao = false,
  situacaoDe,
  selecionados,
  onAlternarSelecao,
  onSelecionarTodos,
  acao,
}: {
  titulo: string
  descricao: string
  avisos: AvisoTVRegistro[]
  vazio?: string
  emVoo: Set<string>
  onMover?: (indice: number, direcao: -1 | 1) => void
  onAlternar: (aviso: AvisoTVRegistro) => void
  onExcluir: (aviso: AvisoTVRegistro) => void
  mostrarPosicao?: boolean
  situacaoDe?: (a: AvisoTVRegistro) => Situacao
  /** Quando presente, cada linha ganha caixa de seleção. */
  selecionados?: Set<string>
  onAlternarSelecao?: (id: string) => void
  onSelecionarTodos?: (ids: string[], marcar: boolean) => void
  /** Botão à direita do cabeçalho — o "Publicar" mora aqui. */
  acao?: React.ReactNode
}) {
  const selecionavel = !!selecionados && !!onAlternarSelecao

  // O atalho age só sobre quem NUNCA foi ao ar.
  //
  // Marcar tudo de uma vez era o acidente antigo com dois cliques em vez de um:
  // com 30 aposentados e 2 novidades na lista, "Selecionar todas" armava as 32 e
  // o botão oferecia "Publicar 32 na TV" — a mesma parede de julho de volta.
  //
  // Republicar um aposentado continua possível, e é uma escolha legítima: clica
  // a caixa dele. O que deixa de existir é o gesto que faz isso por engano com
  // dezenas de cartazes ao mesmo tempo.
  const idsAtalho = avisos
    .filter((a) => (situacaoDe ? situacaoDe(a) !== "aposentado" : true))
    .map((a) => a.id)
  const marcados = selecionados
    ? idsAtalho.filter((id) => selecionados.has(id)).length
    : 0
  const todosMarcados = marcados > 0 && marcados === idsAtalho.length

  return (
    <section className="border-b border-slate-200 last:border-b-0">
      {/* O botão vive NO cabeçalho do grupo, na mesma linha do título: a ação
          fica encostada no conjunto sobre o qual ela age, e não numa barra
          separada que precisa repetir por escrito a quais imagens se refere. */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 bg-slate-50/60 border-b border-slate-200">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-slate-700">{titulo}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{descricao}</p>
        </div>
        {acao}
      </div>

      {/* "Selecionar todas" só aparece a partir de duas linhas do atalho: com
          uma só, a caixa da própria linha já faz o trabalho e o atalho seria
          ruído. */}
      {selecionavel && onSelecionarTodos && idsAtalho.length > 1 && (
        <div className="px-5 py-2 border-b border-slate-100">
          <label className="inline-flex min-h-11 items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={todosMarcados}
              // Estado indeterminado quando só parte está marcada: sem isto a
              // caixa mostraria "desmarcado" com 3 de 5 selecionadas, mentindo
              // sobre o que o botão vai publicar.
              ref={(el) => {
                if (el) el.indeterminate = marcados > 0 && !todosMarcados
              }}
              onChange={() => onSelecionarTodos(idsAtalho, !todosMarcados)}
              className="w-4 h-4 rounded border-slate-300 text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
            />
            {/* O rótulo diz o ESCOPO, não só a ação: "todas" numa lista que tem
                aposentado escondido prometeria mais do que a caixa entrega. */}
            {todosMarcados
              ? "Desmarcar as novas"
              : avisos.length > idsAtalho.length
                ? `Selecionar as ${idsAtalho.length} novas`
                : "Selecionar todas"}
          </label>
        </div>
      )}

      {avisos.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-500">{vazio}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {avisos.map((aviso, i) => {
            const salvando = emVoo.has(aviso.id)
            const situacao = situacaoDe?.(aviso)
            const marcado = selecionados?.has(aviso.id) ?? false
            return (
              <li
                key={aviso.id}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                  salvando ? "opacity-60" : ""
                } ${marcado ? "bg-amber-50/60" : ""}`}
              >
                {/* A caixa de seleção é o primeiro elemento da linha: é a
                    decisão que vem antes de qualquer outra neste grupo, e quem
                    varre a lista de cima a baixo marcando precisa de todas
                    alinhadas na mesma coluna.

                    Envolvida num <label> de 44×44 (o mínimo da DESIGN.md) que
                    cobre a caixa e o rótulo invisível. A margem negativa desfaz
                    o excedente no layout, então o alvo cresce sem que a linha
                    engorde: o dedo ganha os 44px, o olho continua vendo 16. */}
                {selecionavel && onAlternarSelecao && (
                  <label className="shrink-0 grid place-items-center w-11 h-11 -my-2 -ml-3 cursor-pointer">
                    <span className="sr-only">
                      Selecionar {aviso.titulo || "aviso"} para publicar
                    </span>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => onAlternarSelecao(aviso.id)}
                      disabled={salvando}
                      className="w-4 h-4 rounded border-slate-300 text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                    />
                  </label>
                )}

                {/* Setas: mais confiáveis que arrastar num notebook com
                    trackpad, e acessíveis por teclado sem nenhum trabalho.
                    Desabilitadas nas pontas em vez de escondidas — botão que
                    some muda o layout da linha a cada movimento.

                    36px cada, com folga entre elas: antes eram 24px coladas uma
                    na outra, que é a geometria clássica de clicar na seta
                    errada.

                    Os 44px da DESIGN.md valem para a ÁREA CLICÁVEL, não para o
                    desenho. As setas passam a 44 de altura real, empilhadas sem
                    gap: coladas, cada uma tem alvo cheio e a fronteira entre
                    elas é uma linha só — não há faixa morta nem sobreposição
                    onde o clique cai na irmã errada. O ícone continua com 16px,
                    então a lista não engorda visualmente.

                    Alargar o alvo por fora (um `::after` de 44 sobre um botão de
                    36) NÃO serve aqui: com 4px de gap os centros ficariam a 40px
                    e os dois alvos se sobreporiam em 4px — exatamente o erro de
                    mira que este bloco existe para evitar.

                    (Antes havia aqui um argumento de que a regra "nasceu para o
                    PWA de celular e esta tela é de desktop". A DESIGN.md não
                    abre essa exceção — diz que toda tela do sistema é instalação
                    PWA. Refutar um documento vinculante num comentário de código
                    é deixar a divergência para alguém reabrir depois.) */}
                {onMover && (
                  <div className="shrink-0 flex flex-col">
                    <button
                      type="button"
                      onClick={() => onMover(i, -1)}
                      disabled={i === 0}
                      aria-label={`Mover ${aviso.titulo || "aviso"} para cima`}
                      className="grid place-items-center w-11 h-11 rounded-t-lg text-slate-500 transition-colors hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMover(i, 1)}
                      disabled={i === avisos.length - 1}
                      aria-label={`Mover ${aviso.titulo || "aviso"} para baixo`}
                      className="grid place-items-center w-11 h-11 rounded-b-lg text-slate-500 transition-colors hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* 96×64 é 3:2, a mesma proporção do painel da TV: a miniatura
                    mostra de relance se a arte vai preencher ou sobrar fundo.

                    `alt` com o título, não vazio: o título É o nome do arquivo,
                    então para quem usa leitor de tela esta é a única pista de
                    QUAL cartaz é a linha. Decorativa seria certo se o nome
                    estivesse ao lado carregando o sentido — mas numa tela que é
                    inteiramente sobre imagens, deixar a imagem muda é deixar a
                    pessoa sem referência nenhuma. */}
                <img
                  src={aviso.url}
                  alt={aviso.titulo ? `Miniatura: ${aviso.titulo}` : "Miniatura do aviso"}
                  className={`shrink-0 w-24 h-16 rounded-md border border-slate-200 object-contain bg-slate-50 transition-[opacity,filter] duration-200 ${
                    aviso.ativo ? "" : "opacity-50 grayscale"
                  }`}
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium truncate ${aviso.ativo ? "text-slate-900" : "text-slate-600"}`}
                  >
                    {aviso.titulo || "Sem título"}
                  </p>
                  {/* Dentro do grupo "No ar", o índice da lista JÁ É a posição
                      no carrossel — que é o ponto inteiro de ter separado os
                      grupos. Antes isto era um `findIndex` sobre outra lista,
                      justamente porque as duas ordens não batiam. */}
                  {/* "Já esteve no ar" agora sobrevive ao F5: sai de
                      `publicado_em`, não de memória de sessão. */}
                  <p className="text-xs text-slate-500 mt-0.5">
                    {mostrarPosicao
                      ? `Posição ${i + 1} na TV`
                      : situacao === "aposentado"
                        ? "Já esteve no ar"
                        : "Nunca publicada"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onAlternar(aviso)}
                  disabled={salvando}
                  className="shrink-0 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
                >
                  {aviso.ativo ? (
                    <>
                      <EyeOff className="w-3.5 h-3.5" />
                      Tirar do ar
                    </>
                  ) : (
                    <>
                      <Eye className="w-3.5 h-3.5" />
                      Colocar no ar
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onExcluir(aviso)}
                  disabled={salvando}
                  aria-label={`Remover ${aviso.titulo || "aviso"}`}
                  // slate-500, não slate-400: um controle que só tem ícone
                  // não pode ficar abaixo de 4.5:1 (slate-400 em branco mede
                  // 3.0:1), porque não há rótulo ao lado para socorrer quem
                  // não distingue o desenho.
                  //
                  // O detector acusa "slate-500 sobre bg-rose-50" aqui e é
                  // falso positivo: os dois nunca coexistem. O `hover:` que
                  // pinta o fundo rosa é o mesmo que troca o texto para
                  // rose-700 (~7,5:1 sobre rose-50). Deixar o ícone rosa em
                  // repouso para calar o aviso seria pior — rosa parado em
                  // toda linha lê como estado de erro, e a Status Lock Rule
                  // reserva rosa para "indisponível", não para cor ociosa de
                  // controle.
                  className="shrink-0 grid place-items-center w-11 h-11 rounded-lg text-slate-500 transition-colors hover:text-rose-700 hover:bg-rose-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function GestaoAvisosTV() {
  const [avisos, setAvisos] = useState<AvisoTVRegistro[]>([])
  const [carregando, setCarregando] = useState(true)
  // Falha de leitura fica NA TELA, não só num toast que some em 4s: o caso mais
  // provável aqui é a migration não aplicada, e quem abrir a página depois do
  // toast sumir veria uma lista vazia — indistinguível de "nenhum aviso ainda".
  const [falha, setFalha] = useState<ErroAviso | null>(null)
  // Quantos arquivos faltam neste envio. Número, e não booleano: com seleção
  // múltipla o "1 de 4" é a única forma de a pessoa saber que ainda há coisa
  // subindo, e não que a tela travou.
  const [restantes, setRestantes] = useState(0)
  const [totalEnvio, setTotalEnvio] = useState(0)
  const [publicando, setPublicando] = useState(false)
  // Ids com escrita em voo. Set, não booleano: ver a regra 1 no topo. Desabilita
  // só a linha que está sendo salva.
  const [emVoo, setEmVoo] = useState<Set<string>>(new Set())
  // Só para o realce da área de soltar. Contador, não booleano: `dragleave`
  // dispara ao passar por cima de cada filho, e um booleano faria a moldura
  // piscar enquanto o arquivo atravessa a lista.
  const [arrastandoSobre, setArrastandoSobre] = useState(0)
  // Prévia mostrando também os rascunhos ("como ficaria se eu publicasse").
  // "Pedido" porque é a intenção da pessoa; o valor efetivo (`verPendentes`,
  // abaixo) ainda depende de haver rascunho.
  const [verPendentesPedido, setVerPendentesPedido] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Timer do debounce da ordem + contador de sequência das gravações.
  // Ver `agendarSalvarOrdem`.
  const salvarOrdemRef = useRef<{
    timer: ReturnType<typeof setTimeout> | undefined
    sequencia: number
  }>({ timer: undefined, sequencia: 0 })
  // A barra de publicação ancorada. O observador abaixo usa isto para saber
  // quando ela saiu da tela — e só então mostra a versão flutuante.
  const barraAncoradaRef = useRef<HTMLDivElement | null>(null)
  const [barraAncoradaVisivel, setBarraAncoradaVisivel] = useState(true)
  // Ids marcados para publicar. Nasce VAZIO e continua vazio depois de cada
  // publicação: o botão só age sobre escolha explícita.
  //
  // É o que torna o acidente impossível por construção, em vez de por regra —
  // antes o "Publicar" varria tudo que estivesse fora do ar, e um cartaz
  // aposentado em julho voltava à parede junto com os novos. Agora não existe
  // "tudo": existe o que a pessoa marcou.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  // Em ref, não em estado: nada na tela depende disto para renderizar (o toast
  // do desfazer é quem carrega a interação), e mantê-lo fora do estado evita que
  // o timer pendente vire dependência de efeito.
  const removidosRef = useRef<Map<string, Removido>>(new Map())
  const enviando = restantes > 0

  const marcarEmVoo = useCallback((id: string, ativo: boolean) => {
    setEmVoo((atual) => {
      const proximo = new Set(atual)
      if (ativo) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }, [])

  /** Marca ou desmarca uma imagem para publicação. */
  const alternarSelecao = useCallback((id: string) => {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }, [])

  /** Marca ou desmarca todas as imagens de uma vez. */
  const selecionarTodos = useCallback((ids: string[], marcar: boolean) => {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      for (const id of ids) {
        if (marcar) proximo.add(id)
        else proximo.delete(id)
      }
      return proximo
    })
  }, [])

  /**
   * Descarta da seleção quem já não pode ser publicado nem excluído em lote.
   *
   * Marcar é uma afirmação sobre uma linha que está fora do ar. Quando a linha
   * sobe para o ar, ou some porque outra aba a removeu, a marca perde referente:
   * a caixa que a representava não é mais desenhada, e a contagem dos botões
   * ("Publicar 3") cai sozinha sem que ninguém tenha desmarcado nada.
   *
   * A contagem já filtrava por `foraDoAr` e nunca chegou a publicar o que não
   * devia — o defeito era de leitura, não de escrita: a pessoa via "3
   * selecionadas" virar "2" depois de um clique sem relação com a seleção.
   */
  const podarSelecao = useCallback((lista: AvisoTVRegistro[]) => {
    setSelecionados((atual) => {
      if (atual.size === 0) return atual
      const elegiveis = new Set(
        lista.filter((a) => !a.ativo).map((a) => a.id)
      )
      const proximo = new Set(
        [...atual].filter((id) => elegiveis.has(id))
      )
      // Mesma referência quando nada mudou: `selecionados` alimenta o efeito do
      // observador da barra, e um Set novo a cada releitura o reiniciaria à toa.
      return proximo.size === atual.size ? atual : proximo
    })
  }, [])

  const recarregar = useCallback(async () => {
    const { avisos: lista, error } = await listarAvisos()
    // A mensagem do service já vem traduzida (tabela ausente, permissão
    // faltando). Um "não foi possível carregar" genérico aqui mandaria quem lê
    // procurar o problema no lugar errado.
    setFalha(error)
    if (error) toast.error(error.mensagem)
    setAvisos(lista)
    setCarregando(false)
  }, [])

  /**
   * Relê o banco sem bloquear a tela — a rede de segurança contra RLS calada.
   *
   * Um `recarregar()` cru aqui reacenderia `carregando` no meio da operação e
   * faria a lista sumir e voltar; esta versão só corrige o que estiver
   * divergente. Erro é engolido: a ação otimista já reportou o resultado dela, e
   * um segundo toast sobre a releitura não teria ação associada.
   */
  const reconciliar = useCallback(async () => {
    const { avisos: lista, error } = await listarAvisos()
    if (error) return
    setAvisos(lista)
    // A lista que volta é a autoridade sobre o que ainda dá para marcar. Uma
    // linha removida noutra aba não pode deixar a marca dela para trás.
    podarSelecao(lista)
  }, [podarSelecao])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial via API, sem valor derivável no primeiro render
    recarregar()
  }, [recarregar])

  // Uma remoção pendente com a aba fechando deixa o arquivo no bucket para
  // sempre. Descartar no desmonte fecha a janela de desfazer do jeito honesto:
  // quem saiu da tela não vai clicar em desfazer.
  useEffect(() => {
    const pendentes = removidosRef.current
    const ordem = salvarOrdemRef.current
    return () => {
      for (const { timer, aviso } of pendentes.values()) {
        clearTimeout(timer)
        descartarArquivoAviso(aviso.caminho)
      }
      pendentes.clear()
      // Só cancela o timer; NÃO tenta gravar aqui. Um `salvarOrdem` disparado
      // durante o desmonte não teria como reportar erro nem como ser desfeito,
      // e o debounce é de 600ms — sair da tela nessa janela significa que a
      // pessoa mal viu o cartaz se mexer. Perder essa ordem é melhor que gravar
      // pelas costas dela.
      clearTimeout(ordem.timer)
    }
  }, [])

  /**
   * Mostra a barra flutuante só quando a ancorada saiu de vista.
   *
   * O padrão é o de aplicativo moderno: a ação mora COLADA no que ela afeta
   * (logo acima da lista) e só vira barra flutuante quando a rolagem a tirou da
   * tela. Uma faixa fixa permanente no topo custaria uma tira de tela para
   * sempre e, de tanto estar lá, deixaria de ser vista — que é exatamente o que
   * aconteceu com a barra na posição antiga.
   *
   * Depende de `avisos` — a fonte de que sai `foraDoAr` — e não de
   * `foraDoAr.length` diretamente: aquela constante é declarada mais abaixo,
   * junto do resto da divisão em grupos, e usá-la aqui cairia na zona morta
   * temporal. O efeito precisa reassinar sempre que a barra ancorada monta ou
   * desmonta; sem isso o observador ficaria preso ao nó antigo depois de
   * publicar.
   */
  useEffect(() => {
    const alvo = barraAncoradaRef.current
    // Sem barra ancorada não há nada a acompanhar — e nem precisa zerar o
    // estado aqui: as duas barras dependem do grupo "fora do ar" existir, então
    // sem a ancorada a flutuante também não é renderizada, qualquer que seja o
    // valor guardado.
    if (!alvo) return

    const observador = new IntersectionObserver(
      ([entrada]) => setBarraAncoradaVisivel(entrada.isIntersecting),
      // Margem negativa no topo: a barra conta como "fora de vista" um pouco
      // antes de sumir de fato, então a flutuante entra sem piscar no limiar.
      { rootMargin: "-8px 0px 0px 0px", threshold: 0 }
    )
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [avisos])

  /**
   * Envia um lote (do seletor ou do arrastar-e-soltar).
   *
   * Em SÉRIE, não em Promise.all: `criarAviso` lê o maior `ordem` para se pôr no
   * fim da fila, e em paralelo os quatro leriam o mesmo valor e empatariam. O
   * empate não quebra nada (a ordenação desempata por `criado_em`), mas a fila
   * sairia numa ordem que não é a que a pessoa escolheu no seletor.
   *
   * Um arquivo inválido no meio não aborta o resto: quem arrasta a pasta inteira
   * com um PDF dentro quer as imagens publicadas e um aviso sobre o PDF, não
   * quatro envios cancelados.
   */
  async function enviarLote(files: File[]) {
    if (files.length === 0) return

    const validos: File[] = []
    const recusados: string[] = []
    for (const file of files) {
      const problema = validarArquivoAviso(file)
      if (problema) recusados.push(`${file.name}: ${problema}`)
      else validos.push(file)
    }

    // Um a um, com o nome do arquivo: "Formato não aceito" sozinho não diz qual
    // dos quatro arquivos foi recusado.
    for (const aviso of recusados) toast.error(aviso)
    if (validos.length === 0) return

    setTotalEnvio(validos.length)
    setRestantes(validos.length)

    let enviados = 0
    const falhas: string[] = []

    for (const file of validos) {
      // O nome do arquivo vira o título, só para o marketing se localizar na
      // lista — no bucket o objeto é um uuid, e o título nunca vai para a TV.
      const titulo = file.name.replace(/\.[^.]+$/, "")
      const { error } = await criarAviso(file, titulo)
      if (error) falhas.push(`${file.name}: ${error}`)
      else enviados++
      setRestantes((n) => n - 1)
    }

    setTotalEnvio(0)
    for (const falha of falhas) toast.error(falha)

    if (enviados > 0) {
      // A prévia já abre incluindo o que acabou de subir. Pedir para "conferir
      // antes de publicar" e deixar a conferência atrás de um link que a pessoa
      // ainda precisa descobrir é pedir para ela publicar sem olhar.
      setVerPendentesPedido(true)
      // "Confira e publique", não "enviado": o passo que falta é justamente o
      // que a pessoa poderia achar que já aconteceu.
      toast.success(
        enviados === 1
          ? "Imagem enviada. Confira a prévia e publique."
          : `${enviados} imagens enviadas. Confira a prévia e publique.`
      )
    }

    await recarregar()
  }

  function soltar(e: React.DragEvent) {
    e.preventDefault()
    setArrastandoSobre(0)
    if (enviando) return
    // `type.startsWith("image/")` filtra a pasta arrastada e o atalho: o que não
    // é imagem some sem virar quatro toasts de erro. O que É imagem mas tem
    // formato errado (bmp, gif) segue para validarArquivoAviso, que explica.
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    )
    if (files.length === 0) {
      toast.error("Solte arquivos de imagem (JPG, PNG ou WebP).")
      return
    }
    enviarLote(files)
  }

  /**
   * Põe no ar exatamente as imagens MARCADAS.
   *
   * Antes este botão publicava tudo que estivesse fora do ar, e era aí que
   * morava o acidente: um cartaz aposentado em julho subia de carona com os dois
   * que a pessoa acabara de enviar. A seleção resolve isso na raiz — não há
   * mais um "tudo" implícito para o botão varrer, só o que foi marcado.
   *
   * Ganha desfazer pelo mesmo motivo que a remoção ganhou, só que a aposta aqui
   * é melhor: a TV só busca a lista nova a cada 30s, então um desfazer dentro
   * dos 8s quase sempre chega ANTES de o cartaz aparecer na parede. É uma
   * garantia melhor do que um diálogo de confirmação, que interrompe todo mundo
   * para proteger o caso raro e ainda assim deixa passar o clique automático.
   */
  async function publicar() {
    // Filtra pela lista real: um id marcado cuja linha sumiu (removida noutra
    // aba, e a reconciliação trouxe a lista sem ela) não pode ir para o update.
    const marcados = foraDoAr.filter((a) => selecionados.has(a.id))
    const ids = marcados.map((a) => a.id)
    if (ids.length === 0) return

    // Quem nunca esteve no ar estreia agora. Só esses voltam a `null` se alguém
    // desfizer — para um cartaz que já era aposentado, a data de estreia
    // permanece verdadeira mesmo depois do desfazer.
    const estreantes = marcados
      .filter((a) => a.publicadoEm === null)
      .map((a) => a.id)

    const anterior = avisos
    // Publicar é a ação mais visível da tela e some com a barra inteira.
    // Aplicar na hora é o que faz o clique parecer resolvido; o rollback abaixo
    // é o que torna isso seguro.
    //
    // `publicadoEm` entra junto com `ativo` porque é o trigger do banco que o
    // carimba, e a releitura só chega depois. Sem ele, publicar e tirar do ar em
    // seguida devolveria o cartaz ao grupo dos rascunhos — a tela insistiria em
    // republicar justamente o que a pessoa acabou de recusar. `?? agora` guarda
    // a estreia: republicar não reescreve a data original, igual ao trigger.
    const agora = new Date().toISOString()
    setAvisos((atuais) =>
      atuais.map((a) =>
        ids.includes(a.id)
          ? { ...a, ativo: true, publicadoEm: a.publicadoEm ?? agora }
          : a
      )
    )
    setPublicando(true)

    const { error } = await publicarAvisos(ids)
    setPublicando(false)

    if (error) {
      setAvisos(anterior)
      toast.error(error)
      reconciliar()
      return
    }

    // A seleção morre com a publicação. Deixá-la marcada apontaria para linhas
    // que já subiram para o grupo de cima, e o próximo clique no botão não teria
    // o que fazer.
    selecionarTodos(ids, false)

    // Ícone de monitor no toast: o desfazer de publicação e o de exclusão têm o
    // mesmo texto ("Desfazer"), a mesma duração e o mesmo botão branco, e podem
    // estar na tela ao mesmo tempo fazendo coisas opostas. O ícone é o que
    // separa "tirar da parede" de "trazer o arquivo de volta".
    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <Monitor className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {ids.length === 1
              ? `No ar. A TV atualiza em ${LATENCIA_TV}.`
              : `${ids.length} no ar. A TV atualiza em ${LATENCIA_TV}.`}
          </span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              desfazerPublicacao(ids, estreantes)
            }}
            className="shrink-0 rounded-md bg-white/20 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Desfazer
          </button>
        </span>
      ),
      { duration: DESFAZER_MS }
    )

    reconciliar()
  }

  /**
   * Tira do ar o que o "Publicar" acabou de subir.
   *
   * Devolve os ids ao estado de ANTES do clique, e para quem estreou naquele
   * clique isso inclui voltar a ser rascunho — quem desfaz está dizendo "não era
   * para ter publicado". Tratá-los como aposentados os esconderia da fila de
   * publicação e a pessoa não teria como tentar de novo.
   *
   * `estreantes` distingue os dois casos: quem já tinha `publicadoEm` antes
   * deste clique é um cartaz que voltou ao ar e saiu de novo, e a data de
   * estreia dele continua verdadeira. Só quem estreou aqui volta a `null`.
   *
   * A seleção é devolvida junto. Desfazer é "volte ao instante anterior", e
   * naquele instante as imagens estavam marcadas; sem isto, quem desfaz para
   * corrigir uma escolha teria de remarcar tudo à mão antes de tentar de novo.
   */
  async function desfazerPublicacao(ids: string[], estreantes: string[]) {
    const anterior = avisos
    const estreou = new Set(estreantes)

    setAvisos((atuais) =>
      atuais.map((a) =>
        ids.includes(a.id)
          ? {
              ...a,
              ativo: false,
              publicadoEm: estreou.has(a.id) ? null : a.publicadoEm,
            }
          : a
      )
    )
    selecionarTodos(ids, true)

    const resultados = await Promise.all(
      ids.map((id) =>
        definirAtivo(id, false, estreou.has(id) ? { limparEstreia: true } : {})
      )
    )
    const falhou = resultados.find((r) => r.error)

    if (falhou?.error) {
      setAvisos(anterior)
      selecionarTodos(ids, false)
      toast.error(falhou.error)
    } else {
      toast.success(
        ids.length === 1 ? "Publicação desfeita." : "Publicações desfeitas."
      )
    }

    reconciliar()
  }

  async function alternar(aviso: AvisoTVRegistro) {
    const desejado = !aviso.ativo
    const anterior = avisos
    const agora = new Date().toISOString()

    setAvisos((atuais) =>
      atuais.map((a) =>
        a.id === aviso.id
          ? {
              ...a,
              ativo: desejado,
              // Subir ao ar carimba a estreia (o trigger faz o mesmo no banco);
              // descer não apaga nada — é justamente o "esteve no ar um dia" que
              // faz dele um aposentado em vez de um rascunho.
              publicadoEm: desejado ? (a.publicadoEm ?? agora) : a.publicadoEm,
            }
          : a
      )
    )
    // Subir ao ar tira a linha do grupo que tem caixa de seleção. Sem desmarcar,
    // a contagem dos botões cairia sozinha e a pessoa veria "3 selecionadas"
    // virar "2" depois de um clique que não tinha nada a ver com a seleção.
    if (desejado) selecionarTodos([aviso.id], false)
    marcarEmVoo(aviso.id, true)

    const { error } = await definirAtivo(aviso.id, desejado)

    if (error) {
      setAvisos(anterior)
      toast.error(error)
    } else {
      toast.success(
        desejado
          ? `No ar. A TV atualiza em ${LATENCIA_TV}.`
          : `Fora do ar. A TV atualiza em ${LATENCIA_TV}.`
      )
    }

    marcarEmVoo(aviso.id, false)
    reconciliar()
  }

  /**
   * Troca um cartaz de lugar DENTRO do grupo "No ar".
   *
   * Recebe o índice dentro de `noAr`, não dentro de `avisos`. É isso que faz a
   * seta e o rótulo "Posição N na TV" finalmente concordarem: mover para cima
   * agora sempre significa "uma posição antes no carrossel", porque não há mais
   * linha fora do ar no meio do caminho para atrapalhar a conta.
   *
   * A lista gravada continua sendo a INTEIRA (`salvarOrdem` reescreve tudo) —
   * os que estão fora do ar mantêm seus lugares relativos e só não participam
   * da troca.
   */
  function moverNoAr(indiceNoGrupo: number, direcao: -1 | 1) {
    const destino = indiceNoGrupo + direcao
    if (destino < 0 || destino >= noAr.length) return

    const a = noAr[indiceNoGrupo]
    const b = noAr[destino]

    // Sem `emVoo` aqui, de propósito: reordenar é a ação que mais se repete em
    // sequência (mover um cartaz três posições são três cliques seguidos na
    // MESMA seta), e desabilitar o botão entre eles obrigaria a pessoa a
    // esperar o servidor a cada clique — que é exatamente o problema que este
    // otimismo existe para resolver.
    setAvisos((atuais) => {
      const nova = [...atuais]
      const i = nova.findIndex((x) => x.id === a.id)
      const j = nova.findIndex((x) => x.id === b.id)
      if (i < 0 || j < 0) return atuais
      ;[nova[i], nova[j]] = [nova[j], nova[i]]
      agendarSalvarOrdem(nova)
      return nova
    })
  }

  /**
   * Grava a ordem depois que os cliques pararem.
   *
   * Antes, cada clique de seta disparava um `salvarOrdem` que por sua vez
   * dispara N UPDATEs em paralelo. Mover um cartaz da posição 15 para a 1 eram
   * 14 cliques × 15 linhas = 210 escritas correndo entre si, SEM ordem garantida
   * entre os lotes: dois `Promise.all` intercalados podiam deixar a tabela num
   * estado que não correspondia a nenhum dos dois cliques, e a `reconciliar`
   * seguinte puxava a lista para esse estado embaixo do cursor da pessoa.
   *
   * Com o debounce, uma rajada de cliques vira UMA gravação. O `sequenciaRef`
   * cobre o resto: se duas gravações ainda assim se cruzarem, só a resposta da
   * mais recente pode mexer na tela.
   */
  function agendarSalvarOrdem(lista: AvisoTVRegistro[]) {
    clearTimeout(salvarOrdemRef.current.timer)
    salvarOrdemRef.current.timer = setTimeout(async () => {
      const sequencia = ++salvarOrdemRef.current.sequencia
      const { error } = await salvarOrdem(lista.map((x) => x.id))

      // Resposta velha chegando depois de um clique mais novo: ignora. Sem esta
      // guarda, um erro antigo faria rollback por cima de uma ordem que a pessoa
      // já corrigiu.
      if (sequencia !== salvarOrdemRef.current.sequencia) return

      if (error) {
        toast.error(error)
        reconciliar()
      }
    }, SALVAR_ORDEM_DEBOUNCE_MS)
  }

  /**
   * Remove com janela de desfazer, sem diálogo de confirmação.
   *
   * A tela usava `confirm()` — um diálogo do sistema operacional, fora do design
   * da página, que interrompe antes de a pessoa ver o resultado e ainda assim
   * não protege de nada: quem clica em "Remover" por engano clica em "OK" por
   * engano logo depois, porque o diálogo aparece antes do erro ficar visível.
   *
   * Desfazer protege melhor porque age DEPOIS: o cartaz some da lista, a pessoa
   * vê que sumiu o errado, e desfaz. O arquivo continua no bucket durante a
   * janela justamente para que voltar seja possível (ver `removerAviso`).
   */
  async function excluir(aviso: AvisoTVRegistro) {
    const indice = avisos.findIndex((a) => a.id === aviso.id)
    const anterior = avisos

    setAvisos((atuais) => atuais.filter((a) => a.id !== aviso.id))
    marcarEmVoo(aviso.id, true)

    const { error } = await removerAviso(aviso.id)
    marcarEmVoo(aviso.id, false)

    if (error) {
      setAvisos(anterior)
      toast.error(error)
      reconciliar()
      return
    }

    // Passada a janela sem ninguém desfazer, o arquivo vai embora de vez.
    const timer = setTimeout(() => {
      removidosRef.current.delete(aviso.id)
      descartarArquivoAviso(aviso.caminho)
    }, DESFAZER_MS)

    removidosRef.current.set(aviso.id, { aviso, indice, timer })

    const nome = aviso.titulo || "Aviso"
    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{nome} removido</span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              desfazerRemocao(aviso.id)
            }}
            className="shrink-0 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Desfazer
          </button>
        </span>
      ),
      { duration: DESFAZER_MS }
    )
  }

  /**
   * Remove de uma vez tudo que está marcado.
   *
   * Reaproveita o mesmo mecanismo do excluir de uma linha: cada aviso entra em
   * `removidosRef` com seu próprio índice e seu próprio timer, e o arquivo só
   * some do bucket quando a janela fecha. O desfazer devolve TODOS juntos.
   *
   * A proteção principal continua sendo o desfazer, não o "tem certeza?": quem
   * marcou cinco imagens já fez uma escolha explícita item por item, e o que
   * salva de verdade é ver a lista sem elas e poder voltar atrás.
   *
   * O segundo clique do botão (ver `BotaoExcluirSelecionados`) não protege da
   * decisão, protege da MIRA — ele existe porque este botão divide a barra com o
   * de publicar, sobre a mesma seleção e com o mesmo número no rótulo.
   */
  async function excluirSelecionados() {
    const alvos = foraDoAr.filter((a) => selecionados.has(a.id))
    if (alvos.length === 0) return

    // Índice de cada um ANTES de remover: o desfazer devolve cada aviso ao
    // lugar de onde saiu, e depois da remoção esses índices não existem mais.
    const comIndice = alvos.map((aviso) => ({
      aviso,
      indice: avisos.findIndex((a) => a.id === aviso.id),
    }))
    const ids = alvos.map((a) => a.id)

    setAvisos((atuais) => atuais.filter((a) => !selecionados.has(a.id)))
    selecionarTodos(ids, false)
    for (const id of ids) marcarEmVoo(id, true)

    const resultados = await Promise.all(ids.map((id) => removerAviso(id)))
    for (const id of ids) marcarEmVoo(id, false)

    // ─── Falha parcial ───────────────────────────────────────────────────────
    //
    // Antes, UM erro entre N devolvia a lista inteira (`setAvisos(anterior)`) —
    // inclusive as que o banco de fato apagou. Quem excluía 40 e via 39 saírem
    // presenciava as 40 voltarem e sumirem de novo um instante depois, quando a
    // reconciliação corrigia. Um pisca-pisca de 40 linhas com um toast de erro
    // que não explicava nada disso.
    //
    // Agora cada linha responde por si: quem falhou volta, quem saiu fica fora.
    // A tela passa a mostrar o que o banco tem antes mesmo da reconciliação.
    const idsComErro = new Set(
      ids.filter((_, i) => resultados[i].error)
    )
    const sobreviventes = comIndice.filter((c) => !idsComErro.has(c.aviso.id))

    if (idsComErro.size > 0) {
      const falhou = resultados.find((r) => r.error)!
      // Devolve só as que não saíram, cada uma no índice de origem. De trás para
      // frente porque os índices são os da lista original.
      setAvisos((atuais) => {
        const nova = [...atuais]
        for (const { aviso, indice } of [...comIndice]
          .filter((c) => idsComErro.has(c.aviso.id))
          .reverse()) {
          nova.splice(Math.min(indice, nova.length), 0, aviso)
        }
        return nova
      })
      toast.error(
        idsComErro.size === ids.length
          ? falhou.error!
          : `${idsComErro.size} de ${ids.length} não puderam ser excluídas. ${falhou.error}`
      )
      reconciliar()
      if (sobreviventes.length === 0) return
    }

    // Um timer por aviso, como no caminho individual: assim o desfazer de um
    // lote e o de uma linha solta convivem sem um cancelar o outro.
    for (const { aviso, indice } of sobreviventes) {
      const timer = setTimeout(() => {
        removidosRef.current.delete(aviso.id)
        descartarArquivoAviso(aviso.caminho)
      }, DESFAZER_MS)
      removidosRef.current.set(aviso.id, { aviso, indice, timer })
    }

    const idsDesfazer = sobreviventes.map((c) => c.aviso.id)

    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {sobreviventes.length === 1
              ? `${sobreviventes[0].aviso.titulo || "Aviso"} removido`
              : `${sobreviventes.length} imagens removidas`}
          </span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              desfazerRemocaoEmLote(idsDesfazer)
            }}
            className="shrink-0 rounded-md bg-white/20 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Desfazer
          </button>
        </span>
      ),
      { duration: DESFAZER_MS }
    )
  }

  async function desfazerRemocao(id: string) {
    const pendente = removidosRef.current.get(id)
    if (!pendente) return

    clearTimeout(pendente.timer)
    removidosRef.current.delete(id)

    const { aviso, indice } = pendente

    // Volta para o lugar de onde saiu, não para o fim da lista: desfazer que
    // devolve o item noutra posição obriga a pessoa a reordenar para consertar
    // o desfazer.
    setAvisos((atuais) => {
      const nova = [...atuais]
      nova.splice(Math.min(indice, nova.length), 0, aviso)
      return nova
    })

    const { error } = await restaurarAviso({
      caminho: aviso.caminho,
      titulo: aviso.titulo,
      ordem: aviso.ordem,
      ativo: aviso.ativo,
      publicadoEm: aviso.publicadoEm,
    })

    if (error) {
      toast.error(error)
      setAvisos((atuais) => atuais.filter((a) => a.id !== aviso.id))
    }

    reconciliar()
  }

  /**
   * Desfaz um lote inteiro numa atualização só.
   *
   * Chamar `desfazerRemocao` N vezes parecia bastar — cada uma faz seu `splice`
   * no índice de origem, de trás para frente. Mas as N chamadas disparam N
   * `setAvisos` que o React agrupa: cada updater recebe `atuais` num estágio
   * diferente da reinserção, e o `Math.min(indice, nova.length)` então grampeia
   * uns no fim da lista. Num lote grande a ordem restaurada não era a original,
   * apesar de o comentário de lá prometer que sim.
   *
   * Uma leitura de estado, todos os índices aplicados sobre ela, um write.
   */
  async function desfazerRemocaoEmLote(ids: string[]) {
    const pendentes = ids
      .map((id) => removidosRef.current.get(id))
      .filter((p): p is Removido => !!p)
    if (pendentes.length === 0) return

    for (const p of pendentes) {
      clearTimeout(p.timer)
      removidosRef.current.delete(p.aviso.id)
    }

    // Do maior índice para o menor: assim cada `splice` acontece antes de os
    // anteriores empurrarem as posições seguintes.
    const ordenados = [...pendentes].sort((a, b) => b.indice - a.indice)

    setAvisos((atuais) => {
      const nova = [...atuais]
      for (const { aviso, indice } of ordenados) {
        nova.splice(Math.min(indice, nova.length), 0, aviso)
      }
      return nova
    })

    const resultados = await Promise.all(
      pendentes.map((p) =>
        restaurarAviso({
          caminho: p.aviso.caminho,
          titulo: p.aviso.titulo,
          ordem: p.aviso.ordem,
          ativo: p.aviso.ativo,
          publicadoEm: p.aviso.publicadoEm,
        })
      )
    )

    const falhou = resultados.find((r) => r.error)
    if (falhou?.error) {
      // Tira da tela só as que não voltaram ao banco.
      const perdidos = new Set(
        pendentes.filter((_, i) => resultados[i].error).map((p) => p.aviso.id)
      )
      setAvisos((atuais) => atuais.filter((a) => !perdidos.has(a.id)))
      toast.error(falhou.error)
    }

    reconciliar()
  }

  // ─── Os três grupos ────────────────────────────────────────────────────────
  //
  // Antes havia dois (`ativos` e `rascunhos`) e o comentário aqui defendia a
  // fusão: rascunho e aposentado são os dois `ativo = false`, "os dois querem
  // exatamente a mesma ação", então não valeria um estado a mais.
  //
  // Esse raciocínio era verdadeiro enquanto a ação era POR LINHA. O botão
  // "Publicar na TV", que age em LOTE, o invalidou sem que ninguém percebesse:
  // quem sobe 2 cartazes novos e tem 3 aposentados de julho na lista lê "5
  // imagens fora do ar" e, com um clique, devolve os 3 velhos à parede da
  // recepção. Um lote não pode ter o mesmo escopo de um clique individual.
  //
  // A separação por seleção resolveu o botão, mas não o gesto: o "Selecionar
  // todas" passou a armar os mesmos aposentados de uma vez, e a prévia — que é
  // o argumento de segurança da tela — nunca mostrava o aposentado marcado.
  // Ver `idsAtalho` em GrupoAvisos e `entrantes` logo abaixo.
  //
  // A separação agora vem do banco (`publicado_em`), não de memória de sessão:
  // a pergunta "isto já foi parede?" sobrevive ao F5, que é quando ela importa.
  const situacaoDe = (a: AvisoTVRegistro): Situacao =>
    a.ativo ? "no-ar" : a.publicadoEm ? "aposentado" : "rascunho"

  const noAr = avisos.filter((a) => situacaoDe(a) === "no-ar")
  const rascunhos = avisos.filter((a) => situacaoDe(a) === "rascunho")
  const aposentados = avisos.filter((a) => situacaoDe(a) === "aposentado")
  const foraDoAr = [...rascunhos, ...aposentados]

  // Quantas estão marcadas AGORA. Serve aos DOIS botões — publicar e excluir
  // agem sobre a mesma seleção.
  const marcados = foraDoAr.filter((a) => selecionados.has(a.id))
  const qtdSelecionada = marcados.length

  // ─── O que a prévia mostra ─────────────────────────────────────────────────
  //
  // A prévia É o argumento de segurança desta tela: o texto manda conferir nela
  // antes de publicar. Então ela tem de mostrar exatamente o que o botão vai
  // fazer — nem mais, nem menos.
  //
  // Antes ela mostrava "no ar + rascunhos", fixo, e o botão publicava a SELEÇÃO
  // (que pode conter aposentado). Um cartaz aposentado marcado ia para a parede
  // da recepção sem ter aparecido na prévia uma única vez, e o comentário que
  // ficava aqui afirmava o contrário — dizia que o botão não tinha mais essa
  // consequência. Tinha.
  //
  // Com algo marcado, a prévia é o futuro literal: o que já está no ar mais o
  // que sobe se a pessoa clicar. Sem nada marcado, ela volta a ser o presente
  // (só o que está no ar), com o botão de espiar os rascunhos.
  const verPendentes = verPendentesPedido && rascunhos.length > 0
  const entrantes = qtdSelecionada > 0 ? marcados : verPendentes ? rascunhos : []
  const naPrevia = [...noAr, ...entrantes]

  // Esqueleto com a forma da lista, não um spinner centralizado: a página já
  // sabe que vai ser uma lista de linhas com miniatura à esquerda, e mostrar
  // essa forma faz o conteúdo chegar no lugar onde os olhos já estão. Um
  // spinner no meio do nada move tudo quando o conteúdo entra.
  if (carregando) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,420px)] gap-6 items-start">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="px-5 py-4 border-b border-slate-200">
            <div className="h-4 w-40 rounded bg-slate-200 animate-pulse" />
            <div className="mt-2 h-3 w-64 rounded bg-slate-100 animate-pulse" />
          </div>
          <ul className="divide-y divide-slate-100">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-3">
                <div className="w-24 h-16 rounded-md bg-slate-100 animate-pulse" />
                <div className="flex-1">
                  <div className="h-3.5 w-44 rounded bg-slate-200 animate-pulse" />
                  <div className="mt-2 h-3 w-24 rounded bg-slate-100 animate-pulse" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="h-4 w-28 rounded bg-slate-200 animate-pulse" />
          <div className="mt-4 aspect-[1337/860] w-full rounded-lg bg-slate-100 animate-pulse" />
        </div>
        <span className="sr-only" role="status">
          Carregando avisos
        </span>
      </div>
    )
  }

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,420px)] gap-6 items-start"
      // O alvo do arrastar é a tela toda, não um retângulo pequeno: quem vem do
      // explorador com quatro arquivos mira a página, e uma zona estreita
      // transforma soltar numa tarefa de pontaria. O realce mostra o alvo real.
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setArrastandoSobre((n) => n + 1)
      }}
      onDragOver={(e) => {
        // Sem isto o navegador ABRE a imagem solta, trocando a página da pessoa
        // pelo arquivo — e o envio nunca acontece.
        if (e.dataTransfer.types.includes("Files")) e.preventDefault()
      }}
      onDragLeave={() => setArrastandoSobre((n) => Math.max(0, n - 1))}
      onDrop={soltar}
    >
      {/* ─── lista ─────────────────────────────────────────────────────── */}
      <div
        className={`rounded-xl border bg-white transition-colors ${
          arrastandoSobre > 0
            ? "border-slate-900 ring-2 ring-slate-900/10"
            : "border-slate-200"
        }`}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Imagens do carrossel
            </h2>
            {/* A frase inteira é descritiva e não muda; só a CONTAGEM muda por
                ação otimista. `aria-live` na frase toda faria o leitor de tela
                repetir "…exibidas nesta ordem a cada 12 segundos" a cada
                clique, por cima do toast. A região viva é só o número. */}
            <p className="text-xs text-slate-500 mt-0.5">
              <span aria-live="polite" aria-atomic="true">
                {noAr.length === 0
                  ? "Nenhuma imagem no ar"
                  : `${noAr.length} ${noAr.length === 1 ? "imagem no ar" : "imagens no ar"}`}
              </span>
              {noAr.length === 0
                ? " — a TV mostra a tela padrão de espera."
                : ", exibidas nesta ordem a cada 12 segundos."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-brand-fg px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {enviando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ImagePlus className="w-4 h-4" />
            )}
            {enviando && totalEnvio > 1
              ? `Enviando ${totalEnvio - restantes + 1} de ${totalEnvio}…`
              : enviando
                ? "Enviando…"
                : "Adicionar imagens"}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              // Zerar o input permite reenviar o MESMO arquivo depois de um
              // erro — sem isto o `change` não dispara na segunda tentativa.
              e.target.value = ""
              enviarLote(files)
            }}
          />
        </div>

        {falha ? (
          <div className="px-5 py-16 text-center">
            <TriangleAlert className="w-8 h-8 mx-auto text-amber-600" />
            <p className="mt-3 text-sm font-medium text-slate-700 max-w-md mx-auto">
              {falha.mensagem}
            </p>
            {/* O detalhe técnico fica, mas em segundo plano: quem opera lê a
                linha de cima e liga para a tecnologia; quem atende a ligação
                precisa desta linha para resolver sem investigar do zero. */}
            {falha.detalhe && (
              <p className="mt-2 text-[11px] text-slate-500 max-w-md mx-auto">
                {falha.detalhe}
              </p>
            )}
          </div>
        ) : avisos.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Monitor className="w-8 h-8 mx-auto text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Nenhuma imagem enviada ainda
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Arraste imagens para esta página ou use o botão acima. Enquanto não
              houver imagem no ar, a TV da recepção continua exibindo a tela
              padrão &ldquo;Atendimento em andamento&rdquo;.
            </p>
          </div>
        ) : (
          /* ─── Dois grupos, não uma lista só ──────────────────────────────
             Isto resolve dois problemas de uma vez.

             (1) O acidente: rascunho e aposentado eram indistinguíveis, e o
                 botão de lote publicava os dois.
             (2) A posição mentirosa: a lista mostrava TODOS os avisos, mas o
                 rótulo dizia "Posição N na TV" contando só os ativos. Com um
                 rascunho no meio, apertar ↑ movia a linha e não mudava o
                 número — a seta e o rótulo discordavam.

             Separados, o índice DENTRO do grupo "No ar" é a posição na TV.
             Não há mais dois ordenamentos para conciliar. */
          <div>
            <GrupoAvisos
              titulo="No ar"
              descricao={
                noAr.length === 1
                  ? "1 imagem girando na recepção agora."
                  : `${noAr.length} imagens girando na recepção, nesta ordem.`
              }
              avisos={noAr}
              vazio="Nenhuma imagem no ar — a TV mostra a tela padrão de espera."
              emVoo={emVoo}
              onMover={moverNoAr}
              onAlternar={alternar}
              onExcluir={excluir}
              mostrarPosicao
            />

            {foraDoAr.length > 0 && (
              <GrupoAvisos
                titulo="Fora do ar"
                descricao={
                  qtdSelecionada > 0
                    ? // A latência aparece no instante em que a pessoa está
                      // prestes a publicar — e não só no toast, que chega tarde
                      // demais para quem nunca publicou. Foi essa dúvida que
                      // levou alguém a reiniciar a máquina da recepção.
                      `${qtdSelecionada} de ${foraDoAr.length} selecionada${qtdSelecionada === 1 ? "" : "s"}. Publicando, a TV atualiza em ${LATENCIA_TV}.`
                    : "Não aparecem na TV. Selecione para publicar ou excluir."
                }
                avisos={foraDoAr}
                emVoo={emVoo}
                onAlternar={alternar}
                onExcluir={excluir}
                situacaoDe={situacaoDe}
                selecionados={selecionados}
                onAlternarSelecao={alternarSelecao}
                onSelecionarTodos={selecionarTodos}
                acao={
                  /* Divisória entre as duas ações, e não só espaço: elas agem
                     sobre a mesma seleção e mostram o mesmo número, então o que
                     as separa precisa ser visível. A ordem também importa —
                     destrutiva à esquerda, primária à direita, encostada na
                     borda onde o polegar e o olho terminam. */
                  <div ref={barraAncoradaRef} className="shrink-0 flex items-center gap-3">
                    <BotaoExcluirSelecionados
                      quantidade={qtdSelecionada}
                      onExcluir={excluirSelecionados}
                    />
                    {qtdSelecionada > 0 && (
                      <span
                        aria-hidden="true"
                        className="h-6 w-px bg-slate-200"
                      />
                    )}
                    <BotaoPublicar
                      quantidade={qtdSelecionada}
                      publicando={publicando}
                      onPublicar={publicar}
                    />
                  </div>
                }
              />
            )}
          </div>
        )}

      </div>

      {/* ─── prévia ────────────────────────────────────────────────────── */}
      {/* Mesmo componente que a TV usa, não uma reprodução: prévia que só
          aproxima o comportamento é prévia que mente, e quem publica o cartaz
          não teria como saber. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 xl:sticky xl:top-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {qtdSelecionada > 0
              ? "Prévia com as selecionadas"
              : verPendentes
                ? "Prévia com os não publicados"
                : "Prévia da TV"}
          </h2>
          {/* Sem este botão, o rascunho não seria conferível em lugar nenhum: a
              prévia mostra o que está NO AR, e o cartaz recém-enviado por
              definição não está. Pedir para "conferir antes de publicar" e não
              dar onde conferir empurraria a pessoa a publicar às cegas — que é
              exatamente o que este fluxo existe para evitar.

              Some quando há seleção: aí a prévia já segue as marcas, e um botão
              que alterna algo que não está no comando confunde. */}
          {qtdSelecionada === 0 && rascunhos.length > 0 && (
            <button
              type="button"
              onClick={() => setVerPendentesPedido((v) => !v)}
              className="shrink-0 rounded text-xs font-medium text-slate-500 transition-colors hover:text-slate-900 underline decoration-slate-300 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
            >
              {verPendentes ? "Ver só o que está no ar" : "Incluir não publicados"}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">
          {qtdSelecionada > 0
            ? `Como a TV fica se você publicar ${qtdSelecionada === 1 ? "a imagem marcada" : `as ${qtdSelecionada} imagens marcadas`}.`
            : verPendentes
              ? "Como ficaria depois de publicar. Ainda não é o que a recepção vê."
              : "Como aparece na recepção enquanto ninguém está sendo chamado."}
        </p>

        {/* 1337/860 é a área ÚTIL do painel esquerdo numa TV 1080p — não 16:9,
            que é a proporção da TV inteira. O painel perde o header (90px), o
            footer (70px), a coluna de "Últimas chamadas" e os espaçamentos, e
            sobra quase 3:2. Usar aspect-video aqui faria a prévia mentir sobre
            onde a arte encosta. */}
        <div
          className={`aspect-[1337/860] w-full rounded-lg bg-slate-100 border overflow-hidden transition-colors ${
            entrantes.length > 0
              ? "border-amber-300 ring-2 ring-amber-100"
              : "border-slate-200"
          }`}
        >
          {naPrevia.length > 0 ? (
            <CarrosselAvisos avisos={naPrevia} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-center px-6">
              <p className="text-base font-bold text-slate-700 leading-tight">
                Atendimento
                <br />
                em andamento
              </p>
              <p className="mt-2 text-[11px] text-slate-500 max-w-[24ch]">
                Tela padrão exibida quando não há nenhum aviso ativo.
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          Quando um paciente é chamado, o carrossel sai da tela e o nome ocupa o
          painel inteiro. Os avisos voltam assim que a chamada termina.
        </p>

        {/* Especificação da arte, embaixo da prévia.
            Aqui ela fica ao lado do que descreve: a frase "aparece inteira,
            nunca cortada" está a centímetros da prévia que mostra exatamente
            isso acontecendo. Enquanto morava no card da esquerda era um bloco
            de texto no meio do caminho de quem só queria publicar.

            O texto encolheu para o que não dá para adivinhar nem deduzir da
            tela. Saiu: a explicação de arrastar-e-soltar (a página inteira
            realça ao arrastar, e o botão está visível), o "nada vai à TV antes
            de você publicar" (o grupo "Fora do ar" já diz isso) e o aviso de que
            a TV se atualiza sozinha (que agora aparece no cabeçalho do grupo
            assim que há imagem marcada, e de novo no toast). Instrução repetida
            em três lugares é instrução que ninguém lê em nenhum. */}
        <div className="mt-5 pt-4 border-t border-slate-200">
          <p className="text-xs font-semibold text-slate-700">
            Como preparar a imagem
          </p>

          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
            <div>
              <dt className="text-[11px] text-slate-600">Proporção</dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                3:2 (horizontal)
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-600">Dimensões</dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                1800 × 1200 px
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-600">Formato</dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5">
                JPG, PNG ou WebP
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-600">Tamanho máximo</dt>
              <dd className="text-xs font-medium text-slate-800 mt-0.5 tabular-nums">
                10 MB
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            A imagem aparece{" "}
            <strong className="font-medium text-slate-600">inteira</strong>, nunca
            cortada — fora de 3:2, sobra fundo. Evite texto pequeno: a TV é lida a
            4 metros.
          </p>
        </div>
      </div>

      {/* ─── barra flutuante ───────────────────────────────────────────────
          O mesmo botão, seguindo a pessoa quando o cabeçalho do grupo saiu de
          vista. Só aparece havendo SELEÇÃO: sem imagem marcada não há ação
          pendente, e uma barra permanente no rodapé viraria moldura.

          Marcar as imagens exige rolar a lista, e numa lista longa o botão fica
          para trás — é exatamente o caso que esta barra existe para cobrir.

          `pointer-events-none` no envelope e `auto` na barra: sem isso a faixa
          transparente que atravessa a tela roubaria cliques da lista embaixo. */}
      {qtdSelecionada > 0 && !barraAncoradaVisivel && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
          {/* Superfície branca, não âmbar: o âmbar aqui competia com o anel
              âmbar da prévia (que marca "isto ainda não está no ar") e, agora
              que o botão primário é o aço da marca, uma faixa âmbar atrás dele
              só sujaria a leitura. A elevação já basta para destacar a barra. */}
          <div className="pointer-events-auto flex items-center justify-between gap-4 w-full max-w-3xl rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-lg shadow-slate-900/10 motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in motion-safe:duration-200">
            <p className="text-xs text-slate-600 min-w-0">
              <strong className="font-semibold text-slate-900">
                {qtdSelecionada === 1
                  ? "1 imagem selecionada"
                  : `${qtdSelecionada} imagens selecionadas`}
              </strong>{" "}
              — publicando, a TV atualiza em {LATENCIA_TV}.
            </p>
            <div className="shrink-0 flex items-center gap-3">
              <BotaoExcluirSelecionados
                quantidade={qtdSelecionada}
                onExcluir={excluirSelecionados}
              />
              <span aria-hidden="true" className="h-6 w-px bg-slate-200" />
              <BotaoPublicar
                quantidade={qtdSelecionada}
                publicando={publicando}
                onPublicar={publicar}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
