"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  History,
  Search,
  X,
} from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import {
  aplicar,
  contarKpis,
  contarKpisSenha,
  filtrosIniciais,
  TODAS_SITUACOES_PACIENTE,
  type FiltrosLaudos,
  type RecorteLaudo,
  type RecorteSenha,
} from "@/lib/laudos/filtros"
import { opcoesDeConvenio } from "@/lib/laudos/convenio"
import type {
  ItemAcompanhamentoLaudo,
  MetaAcompanhamentoLaudos,
  RespostaUploadSenhas,
} from "@/types/laudosAcompanhamento"
import { PainelFiltros } from "./FiltrosLaudos"
import { FaixaRecortes, PainelIndicadores } from "./PainelIndicadores"
import { CardLaudo } from "./CardLaudo"
import { RegistrarAvisoModal } from "./RegistrarAvisoModal"
import { ResultadoUploadSenhasModal, UploadSenhasHeader } from "./UploadSenhasHeader"

// Status Laudos e Senhas: a fila de laudos vencidos, o registro de quando a
// recepção avisou o responsável e o andamento das senhas da ASSIM (relatório
// subido pelo botão "Atualizar senhas").
//
// A lista vem de /api/acompanhamento-laudos, e não do supabase direto do
// browser, porque `orbita_laudos_relatorio` só tem GRANT para service_role.
//
// A ESTRUTURA da tela é a de /cadastros/pacientes, de propósito: mesma grade de
// cartões (2→5 colunas), mesma paginação de 75, mesma busca com debounce de
// 200ms. Os FILTROS moram num painel próprio entre o cabeçalho e os KPIs (pedido
// do usuário, 28/09/2026: o cabeçalho ficou desorganizado); o cabeçalho ficou só
// com as ações — Atualizar senhas e Histórico.
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
    buscaInicial
      ? {
          ...filtrosIniciais(),
          busca: buscaInicial,
          recorte: "todos",
          // Todas as situações e todos os convênios: o paciente do link pode
          // estar inativo, sem cadastro ou em outro convênio, e o padrão (Ativo
          // + ASSIM) o esconderia de quem veio procurá-lo.
          situacoesPaciente: new Set(TODAS_SITUACOES_PACIENTE),
          convenios: new Set<string>(),
        }
      : filtrosIniciais(),
  )
  const [pagina, setPagina] = useState(1)
  const [aberto, setAberto] = useState<ItemAcompanhamentoLaudo | null>(null)
  const [verHistorico, setVerHistorico] = useState(false)
  const [resultadoUpload, setResultadoUpload] = useState<RespostaUploadSenhas | null>(null)
  /** Muda só em "Limpar filtros" — é a chave que remonta o campo de busca. */
  const [versaoFiltros, setVersaoFiltros] = useState(0)

  /**
   * Aplica o termo já debounced. ESTÁVEL (deps vazias) de propósito: o campo de
   * busca é memoizado e só re-renderiza sozinho enquanto se digita. Ver
   * `CampoBusca`.
   */
  const aplicarBusca = useCallback((texto: string) => {
    setFiltros((f) => (f.busca === texto ? f : { ...f, busca: texto }))
    setPagina(1)
  }, [])

  /**
   * Volta a tela ao estado de abertura.
   *
   * `versaoFiltros` é a chave do `CampoBusca`: incrementá-la REMONTA o campo de
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

  /**
   * Depois do upload: mostra o resumo e relê a lista, que passa a vir com as
   * senhas do arquivo novo. Estável (`carregar` também é), para o botão do
   * cabeçalho não forçar o efeito do header a rodar de novo.
   */
  const aoConcluirUpload = useCallback(
    (resposta: RespostaUploadSenhas) => {
      setResultadoUpload(resposta)
      if (!resposta.duplicado) void carregar()
    },
    [carregar],
  )

  const rotuloSenhas = meta?.senhas
    ? [meta.senhas.importadoEm, meta.senhas.importadoPorNome].filter(Boolean).join(" · ")
    : null
  const comSenhas = meta?.senhas != null

  // O "hoje" do SERVIDOR (meta.hoje), não `new Date()` no cliente: é o mesmo
  // valor que decidiu `item.situacao` de cada laudo lá atrás. Usar uma data
  // diferente aqui abriria uma fresta — por exemplo, a página carregada bem na
  // virada da meia-noite podendo achar "vigente" um laudo que o servidor já
  // rotulou "vencido". Antes do primeiro carregamento `meta` é nulo, mas
  // `itens` também está vazio, então o valor de fallback nunca chega a ser
  // usado por um item de verdade.
  const hoje = meta?.hoje ?? ""

  // Cada painel de indicadores conta com os filtros do painel de filtros E o
  // recorte do OUTRO painel, nunca o próprio (ver `contarKpis`/`contarKpisSenha`):
  // os cards respondem ao período, ao convênio e ao cruzamento, sem que escolher
  // um card zere os vizinhos.
  const contagens = useMemo(() => contarKpis(itens, filtros, hoje), [itens, filtros, hoje])
  // O painel da senha conta pelo recorte do LAUDO, e o do laudo pelo da senha —
  // é o cruzamento que os dois painéis oferecem (ver PainelIndicadores).
  const contagensSenha = useMemo(() => contarKpisSenha(itens, filtros, hoje), [itens, filtros, hoje])

  const escolherRecorte = useCallback((recorte: RecorteLaudo) => {
    setFiltros((f) => ({ ...f, recorte }))
    setPagina(1)
  }, [])
  const escolherRecorteSenha = useCallback((recorteSenha: RecorteSenha) => {
    setFiltros((f) => ({ ...f, recorteSenha }))
    setPagina(1)
  }, [])

  const filtrados = useMemo(() => aplicar(itens, filtros, hoje), [itens, filtros, hoje])

  // Da lista inteira, não da filtrada: filtrar por convênio não pode sumir com
  // as outras opções do próprio filtro.
  const opcoesConvenio = useMemo(() => opcoesDeConvenio(itens), [itens])

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
      // Só AÇÕES no cabeçalho. Os filtros saíram para `PainelFiltros`, abaixo
      // dele — a faixa de 80px (`layout.tsx`) não comportava busca + filtros +
      // upload + Histórico sem rolar de lado.
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        <UploadSenhasHeader rotulo={rotuloSenhas} onConcluido={aoConcluirUpload} />
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
    // `aoConcluirUpload` e `setRightContent` são estáveis; `rotuloSenhas` só
    // muda quando a lista recarrega depois de um upload. Nenhum filtro entra
    // aqui: mexer num filtro não recria o cabeçalho.
  }, [aoConcluirUpload, rotuloSenhas, setRightContent])

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

      {/* As senhas falharam, os laudos não: a lista está inteira, só sem a
          coluna de senha. Dizer isso evita que "Sem relatório" em todos os
          cartões pareça que ninguém subiu o arquivo. */}
      {meta?.senhasErro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Não foi possível carregar as senhas da ASSIM ({meta.senhasErro}). Os laudos estão
            completos; só as senhas ficaram de fora.
          </span>
        </div>
      )}

      {/* O convênio da grade não veio: a lista está inteira, com o Plano do
          Órbita no lugar. Sem o aviso, um convênio antigo passaria por atual. */}
      {meta?.convenioErro && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Não foi possível ler o convênio da grade da TiTa ({meta.convenioErro}). O convênio
            mostrado é o Plano do relatório do Órbita.
          </span>
        </div>
      )}

      <PainelFiltros
        filtros={filtros}
        onChange={(f) => {
          setFiltros(f)
          setPagina(1)
        }}
        onLimpar={limparFiltros}
        comSenhas={comSenhas}
        hoje={hoje}
        busca={<CampoBusca key={versaoFiltros} onBusca={aplicarBusca} textoInicial={buscaInicial} />}
        opcoesConvenio={opcoesConvenio}
      />

      <PainelIndicadores
        contagensLaudo={contagens}
        contagensSenha={contagensSenha}
        recorte={filtros.recorte}
        recorteSenha={filtros.recorteSenha}
        onRecorte={escolherRecorte}
        onRecorteSenha={escolherRecorteSenha}
        carregando={carregando}
        comSenhas={comSenhas}
      />

      <FaixaRecortes
        recorte={filtros.recorte}
        recorteSenha={filtros.recorteSenha}
        total={filtrados.length}
        carregando={carregando}
        onRecorte={escolherRecorte}
        onRecorteSenha={escolherRecorteSenha}
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
          {!meta.convenioErro &&
            ` · convênio pela grade da TiTa em ${meta.convenioPelaGrade} de ${meta.laudos} (o resto pelo Plano do Órbita)`}
          <br />
          {meta.senhas ? (
            <>
              Senhas <span className="font-semibold">{meta.senhas.arquivoNome}</span>
              {meta.senhas.importadoEm && ` · importado em ${meta.senhas.importadoEm}`}
              {meta.senhas.importadoPorNome && ` por ${meta.senhas.importadoPorNome}`} ·{" "}
              {meta.senhas.autorizacoes} autorizações → {meta.senhas.laudosCasados} laudos
              casados
              {meta.senhas.laudosOrfaos.length > 0 &&
                ` · ${meta.senhas.laudosOrfaos.length} fora do Órbita (${meta.senhas.laudosOrfaos.join(", ")})`}
              {meta.senhas.laudosDivergentes.length > 0 &&
                ` · ${meta.senhas.laudosDivergentes.length} com favorecido divergente (${meta.senhas.laudosDivergentes.join(", ")})`}
            </>
          ) : (
            !meta.senhasErro && "Nenhum relatório de senhas importado — use “Atualizar senhas”."
          )}
        </p>
      )}

      {aberto && (
        <RegistrarAvisoModal
          item={aberto}
          hoje={hoje}
          metaSenhas={meta?.senhas ?? null}
          onFechar={() => setAberto(null)}
          onSalvo={substituir}
        />
      )}

      {resultadoUpload && (
        <ResultadoUploadSenhasModal
          resultado={resultadoUpload}
          onFechar={() => setResultadoUpload(null)}
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
 * O campo de busca do painel de filtros — dono do PRÓPRIO texto.
 *
 * O texto mora aqui, e não no estado do shell, para uma tecla re-renderizar só
 * este campo: com o texto no shell, cada letra refaria o painel, os KPIs e a
 * grade de 75 cartões antes do debounce ter qualquer chance de ajudar (foi o
 * sintoma de "digitar e a letra demorar a aparecer" quando a busca morava no
 * cabeçalho). O shell ouve só o valor debounced, por um callback estável
 * (`aplicarBusca`), e "Limpar filtros" zera o texto remontando o campo pela
 * chave (`versaoFiltros`).
 */
const CampoBusca = memo(function CampoBusca({
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
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        className={`h-10 w-full rounded-lg border border-border bg-background pl-9 ${
          texto ? "pr-9" : "pr-3"
        } text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:hidden`}
        placeholder="Buscar por nome, ID do paciente ou ID do laudo"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar laudo por nome, ID do paciente ou ID do laudo"
      />
      {texto && (
        <button
          type="button"
          onClick={() => setTexto("")}
          className={`absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
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
