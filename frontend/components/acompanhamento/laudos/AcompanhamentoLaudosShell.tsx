"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, ChevronLeft, ChevronRight, History, Search, X } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { campo, foco } from "@/components/cadastros/pacientes/ui/campos"
import { aplicar, contarKpis, filtrosIniciais, type FiltrosLaudos } from "@/lib/laudos/filtros"
import type {
  ItemAcompanhamentoLaudo,
  MetaAcompanhamentoLaudos,
} from "@/types/laudosAcompanhamento"
import { BarraFiltros, KpisLaudos } from "./FiltrosLaudos"
import { CardLaudo } from "./CardLaudo"
import { RegistrarAvisoModal } from "./RegistrarAvisoModal"

// Acompanhamento de Laudos: a fila de laudos vencidos e o registro de quando a
// recepção avisou o responsável.
//
// A lista vem de /api/acompanhamento-laudos, e não do supabase direto do
// browser, porque `orbita_laudos_relatorio` só tem GRANT para service_role.
//
// A ESTRUTURA da tela é a de /cadastros/pacientes, de propósito: mesma grade de
// cartões (2→5 colunas), mesma paginação de 75, mesma busca no header com
// debounce de 200ms, mesmo botão de Histórico ao lado. Quem usa uma sabe usar a
// outra sem aprender nada novo.
//
// FILTRO NO CLIENTE, sobre a lista inteira. São 343 itens (medido) num payload
// que já vem pronto do servidor: filtrar aqui é instantâneo, e mandar cada
// mudança de filtro para o servidor faria a tela reler as 1.849 linhas do
// relatório a cada clique de KPI. A paginação é aplicada DEPOIS do filtro — por
// isso buscar um nome o encontra esteja ele na página 1 ou na 5.

const POR_PAGINA = 75

interface Props {
  /** Termo já pronto (ex: o "ID Favorecido" de um paciente) vindo de um link
   * direto de outra tela — ver cronograma/ocupacao-paciente. Abre a tela já
   * buscando por ele, num recorte que não esconde laudos vigentes. */
  buscaInicial?: string
}

export function AcompanhamentoLaudosShell({ buscaInicial = "" }: Props) {
  const [itens, setItens] = useState<ItemAcompanhamentoLaudo[]>([])
  const [meta, setMeta] = useState<MetaAcompanhamentoLaudos | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // "vencidos_sem_aviso" (o padrão de filtrosIniciais) esconderia um laudo
  // vigente que chegou aqui por link direto — "todos" garante que o que veio
  // de fora sempre aparece, não só a fila de trabalho do dia.
  const [filtros, setFiltros] = useState<FiltrosLaudos>(() =>
    buscaInicial ? { ...filtrosIniciais(), busca: buscaInicial, recorte: "todos" } : filtrosIniciais(),
  )
  const [pagina, setPagina] = useState(1)
  const [aberto, setAberto] = useState<ItemAcompanhamentoLaudo | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  /** Muda só em "Limpar filtros" — é a chave que remonta o campo de busca. */
  const [versaoFiltros, setVersaoFiltros] = useState(0)

  /**
   * Aplica o termo já debounced. ESTÁVEL (deps vazias) de propósito: é o que
   * mantém o `setRightContent` abaixo fora do caminho do teclado. Ver
   * `BuscaHeader`.
   */
  const aplicarBusca = useCallback((texto: string) => {
    setFiltros((f) => (f.busca === texto ? f : { ...f, busca: texto }))
    setPagina(1)
  }, [])

  /**
   * Volta a tela ao estado de abertura.
   *
   * `versaoFiltros` é a chave do `BuscaHeader`: incrementá-la REMONTA o campo de
   * busca, o que zera o texto que vive dentro dele. Sem isso, "Limpar filtros"
   * apagaria `filtros.busca` e o campo continuaria mostrando o termo digitado —
   * a tela mostrando a lista inteira com uma busca escrita no header. Remontar
   * em vez de erguer o texto para cá preserva o ganho de digitação: uma tecla
   * continua re-renderizando só o campo.
   */
  const limparFiltros = useCallback(() => {
    setFiltros(filtrosIniciais())
    setPagina(1)
    setVersaoFiltros((v) => v + 1)
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      // Barra no fim: `trailingSlash: true` no next.config faz a URL sem barra
      // responder 308 e só então chegar à rota. O fetch segue o redirecionamento
      // sozinho, então funcionava — só custava uma ida e volta a mais em toda
      // carga. Mesma forma de /api/laudos/ e /api/tv/chamadas/.
      const resposta = await fetch("/api/acompanhamento-laudos/", { cache: "no-store" })
      const corpo = await resposta.json()
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.error ?? `HTTP ${resposta.status}`)
      }
      setItens(corpo.itens as ItemAcompanhamentoLaudo[])
      setMeta(corpo.meta as MetaAcompanhamentoLaudos)
    } catch (e) {
      console.error("[acompanhamento-laudos] falha ao carregar", e)
      setErro(e instanceof Error ? e.message : "erro desconhecido")
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // O "hoje" do SERVIDOR (meta.hoje), não `new Date()` no cliente: é o mesmo
  // valor que decidiu `item.situacao` de cada laudo lá atrás. Usar uma data
  // diferente aqui abriria uma fresta — por exemplo, a página carregada bem na
  // virada da meia-noite podendo achar "vigente" um laudo que o servidor já
  // rotulou "vencido". Antes do primeiro carregamento `meta` é nulo, mas
  // `itens` também está vazio, então o valor de fallback nunca chega a ser
  // usado por um item de verdade.
  const hoje = meta?.hoje ?? ""

  // `contarKpis` recebe `filtros` inteiro — mas só LÊ dele busca, situação do
  // paciente e as janelas de data, nunca `filtros.recorte` (ver o comentário
  // da função). É por isso que os cards respondem a "Avisado em 03/08 até —"
  // (pedido do usuário, 28/08/2026: "eu tenho 4 Vence em breve, mas nenhum
  // dentro desse período — o painel precisa responder a isso") sem que
  // selecionar um recorte zere os outros cards.
  const contagens = useMemo(() => contarKpis(itens, filtros, hoje), [itens, filtros, hoje])

  const filtrados = useMemo(() => aplicar(itens, filtros, hoje), [itens, filtros, hoje])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  // Um filtro que encurta a lista pode deixar a página atual fora do intervalo;
  // sem isto a tela ficaria vazia sem explicação.
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const daPagina = useMemo(
    () => filtrados.slice(inicio, inicio + POR_PAGINA),
    [filtrados, inicio],
  )

  function irPara(destino: number) {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  /**
   * Substitui um item no lugar depois do save, em vez de recarregar a lista.
   *
   * Recarregar significaria reler as 1.849 linhas do relatório e remontar a
   * grade — e, pior, o cartão que a recepção acabou de tratar poderia sair do
   * recorte "vencidos sem aviso" e a tela pular. Aqui o número do KPI atualiza
   * (o item mudou), o cartão mostra a data nova, e a lista só se reorganiza no
   * próximo carregamento.
   */
  const substituir = useCallback((atualizado: ItemAcompanhamentoLaudo) => {
    setItens((atuais) =>
      atuais.map((i) => (i.idLaudo === atualizado.idLaudo ? atualizado : i)),
    )
  }, [])

  const { setRightContent } = useHeader()

  useEffect(() => {
    setRightContent(
      // `overflow-x-auto` é a rede de segurança: em janelas mais estreitas que
      // busca + filtros + Histórico juntos, o próprio bloco rola de lado em vez
      // de a barra do sistema (fixa em 80px, `layout.tsx`) cortar o que não
      // coube. `min-w-0` é o que deixa esse `overflow-x-auto` valer: sem ele, um
      // item flex por padrão recusa encolher abaixo do seu conteúdo, e o scroll
      // nunca chegaria a ativar. `flex-nowrap`: quebrar linha aqui estouraria
      // essa mesma altura fixa.
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
        <BuscaHeader key={versaoFiltros} onBusca={aplicarBusca} textoInicial={buscaInicial} />
        <BarraFiltros
          filtros={filtros}
          onChange={(f) => {
            setFiltros(f)
            setPagina(1)
          }}
          onLimpar={limparFiltros}
        />
        <button
          type="button"
          onClick={() => setVerHistorico(true)}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted ${foco}`}
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Histórico
        </button>
      </div>,
    )
    return () => setRightContent(null)
    // `aplicarBusca`, `setRightContent` e `limparFiltros` são estáveis. `filtros`
    // NÃO é — muda a cada clique num filtro, e por isso ESTÁ na lista: sem ele,
    // a `BarraFiltros` movida para cá (pedido do usuário, 28/08/2026) ficaria
    // presa no valor de quando o efeito rodou pela última vez, mostrando uma
    // data antiga depois de escolher uma nova. Isso não reabre o problema da
    // digitação instantânea: `filtros` só muda em ações discretas de clique
    // (data, ordenar, situação, KPI), nunca por tecla — quem segura o texto
    // livre é `BuscaHeader`, com seu próprio estado e debounce.
  }, [aplicarBusca, filtros, limparFiltros, setRightContent, versaoFiltros])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
      {erro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Não foi possível carregar os laudos. {erro}
            {" — o robô do Órbita pode não ter rodado hoje."}
          </span>
        </div>
      )}

      <KpisLaudos
        contagens={contagens}
        recorte={filtros.recorte}
        carregando={carregando}
        onRecorte={(recorte) => {
          setFiltros((f) => ({ ...f, recorte }))
          setPagina(1)
        }}
      />

      {carregando ? (
        <GradeEsqueleto />
      ) : filtrados.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          {itens.length === 0
            ? "Nenhum laudo no relatório do Órbita."
            : "Nenhum laudo neste recorte."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {daPagina.map((item) => (
            <CardLaudo key={item.idLaudo} item={item} onAbrir={() => setAberto(item)} />
          ))}
        </ul>
      )}

      {!carregando && filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Mostrando {inicio + 1}–{Math.min(inicio + POR_PAGINA, filtrados.length)} de{" "}
            {filtrados.length} {filtrados.length === 1 ? "laudo" : "laudos"}
            {filtrados.length !== itens.length && ` (filtrado de ${itens.length})`}
          </p>

          {totalPaginas > 1 && (
            <nav className="flex items-center gap-2" aria-label="Paginação de laudos">
              <button
                type="button"
                onClick={() => irPara(paginaAtual - 1)}
                disabled={paginaAtual <= 1}
                className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent ${foco}`}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                Página {paginaAtual} de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => irPara(paginaAtual + 1)}
                disabled={paginaAtual >= totalPaginas}
                className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent ${foco}`}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      )}

      {/* A procedência do que está na tela. Não é decoração: se o robô não rodou
          hoje, a fila é a de ontem — e vigente/vencido é calculado com a data de
          HOJE sobre um relatório velho. Sem esta linha, isso é invisível. */}
      {meta && (
        <p className="text-xs text-muted-foreground">
          Relatório <span className="font-semibold">{meta.arquivoNome}</span> ·{" "}
          {meta.linhasLidas} linhas → {meta.laudos} laudos · vigência calculada em{" "}
          {meta.hoje.split("-").reverse().join("/")}
          {meta.descartadas > 0 && ` · ${meta.descartadas} linha(s) sem ID Laudo, descartada(s)`}
          {meta.comSituacaoDivergente > 0 &&
            ` · ${meta.comSituacaoDivergente} com situação divergente do Órbita`}
        </p>
      )}

      {aberto && (
        <RegistrarAvisoModal
          item={aberto}
          hoje={hoje}
          onFechar={() => setAberto(null)}
          onSalvo={substituir}
        />
      )}

      {verHistorico && (
        <HistoricoCadastrosModal
          titulo="Histórico do acompanhamento de laudos"
          subtitulo="Todos os registros de aviso ao responsável — quem, quando e o que mudou, mais recentes primeiro."
          entidades={["laudo_acompanhamento"]}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </div>
  )
}

/**
 * O campo de busca do header — dono do PRÓPRIO texto.
 *
 * POR QUE ELE EXISTE COMO COMPONENTE, e não como um `<input>` inline no
 * `setRightContent`: naquele desenho o texto morava no estado do shell, então
 * CADA TECLA
 *
 *   1. atualizava o estado do shell,
 *   2. re-executava o efeito de `setRightContent` (que dependia do texto),
 *   3. recriava a árvore inteira do header e a empurrava para o
 *      HeaderContext,
 *   4. re-renderizava o layout do dashboard — que contém este próprio input.
 *
 * O debounce de 200ms não ajudava nada nisso: ele só atrasa o REFILTRO, e o
 * caminho caro acontecia antes dele, no passo 3. O sintoma era exatamente o
 * relatado: digitar e a letra demorar a aparecer.
 *
 * Com o texto aqui dentro, uma tecla re-renderiza só este componente. O shell
 * ouve apenas o valor debounced, por um callback estável (`aplicarBusca`), e o
 * efeito do header roda uma única vez, na montagem.
 *
 * (O mesmo padrão vale para /cadastros/pacientes, que tem a estrutura antiga —
 * fora do escopo desta tela, não mexido aqui.)
 */
const BuscaHeader = memo(function BuscaHeader({
  onBusca,
  textoInicial = "",
}: {
  onBusca: (texto: string) => void
  textoInicial?: string
}) {
  const [texto, setTexto] = useState(textoInicial)

  useEffect(() => {
    const t = setTimeout(() => onBusca(texto), 200)
    return () => clearTimeout(t)
  }, [texto, onBusca])

  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="text"
        // `min-w-[160px]`, não `w-80` fixo: agora divide o cabeçalho com a
        // barra de filtros inteira (pedido do usuário, 28/08/2026) — `flex-1`
        // deixa este campo ser o primeiro a ceder espaço quando o resto não
        // couber, até um piso ainda digitável, em vez de tirar espaço fixo dos
        // filtros ao lado.
        className={`${campo} pl-9 ${texto ? "pr-9" : ""} min-w-[160px]`}
        placeholder="Buscar nome ou ID"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar laudo"
      />
      {texto && (
        <button
          type="button"
          onClick={() => setTexto("")}
          className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
          aria-label="Limpar busca"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

// Imita a FORMA do cartão (dois ids, avatar redondo, nome, três linhas de dado e
// a linha do aviso), não um bloco genérico — assim o layout não salta quando os
// dados chegam.
function GradeEsqueleto() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-4 flex flex-col items-center">
            <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
            <div className="mt-4 h-3 w-28 animate-pulse rounded bg-muted" />
          </div>
          <hr className="my-4 border-border" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-3 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
