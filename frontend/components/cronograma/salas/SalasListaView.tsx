"use client"

// SalasListaView — a visão geral: indicadores, filtros e o acervo de salas em
// um dos três modos (cards, lista compacta, mapa de calor).
//
// A hierarquia é deliberada: os KPIs são compactos e ficam ACIMA, os cards
// dominam o espaço. Na tela antiga os quatro StatCards tinham números 2xl e
// competiam com a grade; aqui eles informam o recorte e saem da frente.
//
// "Lista compacta" é o SalasGridView de sempre, inteiro — a tabela densa
// continua sendo a melhor ferramenta para comparar muitas salas de uma vez, e
// quem já trabalhava assim não perde nada.

import { useMemo } from "react"
import { AlertTriangle, DoorOpen, Loader2, RefreshCw } from "lucide-react"
import { SegmentedTabs } from "@/components/cronograma/ui/SegmentedTabs"
import { SalasFiltros } from "./SalasFiltros"
import { FiltrosChips } from "./FiltrosChips"
import { SalasCardsGrid } from "./SalasCardsGrid"
import { SalasGridView } from "./SalasGridView"
import { SalasHeatmapView } from "./SalasHeatmapView"
import { chipsDeFiltro, removerChipDeFiltro, SALAS_FILTROS_VAZIO, type GrupoDiasSalas, type SalasFiltrosState } from "@/lib/cronograma/salasView"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import type { AlocacaoAtual } from "@/hooks/useOcupacaoSalas"
import type { ProfissionalOpcao } from "@/services/salas.service"
import type { Sala, SalaComOcupacao, SalaTerapiaExclusiva } from "@/lib/cronograma/salasTypes"

// "regularizacoes" entra aqui porque, do ponto de vista de quem usa, é mais
// uma forma de ver o mesmo assunto — e não uma ação de cadastro, que era onde
// o botão vivia. Ela ignora os filtros de sala de propósito (usa alocações e
// linhas direto), então a página a renderiza fora desta view; o seletor só
// precisa saber que ela existe para marcá-la como ativa.
export type ModoLista = "cards" | "lista" | "mapa" | "regularizacoes"

/**
 * O seletor de vistas. Exportado à parte porque ele é renderizado no CABEÇALHO
 * da página, não aqui dentro: junto dos filtros ele estourava a largura e
 * quebrava a barra de controles em duas linhas.
 */
export function SalasSeletorDeVista({ modo, onModo }: { modo: ModoLista; onModo: (m: ModoLista) => void }) {
  return (
    <SegmentedTabs
      value={modo}
      onChange={onModo}
      ariaLabel="Modo de visualização"
      tabs={[
        { value: "cards", label: "Cards" },
        { value: "lista", label: "Lista compacta" },
        { value: "mapa", label: "Mapa de calor" },
        { value: "regularizacoes", label: "Regularizações" },
      ]}
    />
  )
}

interface SalasListaViewProps {
  modo: ModoLista
  // O seletor vive no cabeçalho da página (SalasSeletorDeVista), então a troca
  // de vista não passa mais por aqui — só o modo escolhido.
  /** Salas do padrão Seg-Sex (as demais vêm em `gruposEspeciais`). */
  filtradasPadrao: SalaComOcupacao[]
  gruposEspeciais: GrupoDiasSalas[]
  /** Todas as filtradas — os cards não separam por formato de semana. */
  filtradas: SalaComOcupacao[]

  filtros: SalasFiltrosState
  onFiltros: (f: SalasFiltrosState) => void
  unidades: string[]
  nucleos: string[]
  andares: string[]

  somenteInconsistentes: boolean
  onToggleInconsistentes: () => void
  isolada: { id: string; nome: string } | null
  onLimparIsolada: () => void
  onIsolarSala: (salaId: string, nome: string) => void

  totalInconsistencias: number
  // A contagem e o % moram no cabeçalho da página, não aqui.

  loading: boolean
  error: string | null
  /** Refaz a carga inteira — usado pelo "Tentar de novo" do bloco de erro. */
  onRecarregarTudo: () => void

  onVerDetalhes: (salaId: string) => void
  onEditarSala: (salaId: string) => void

  // Repasses para SalasGridView (modo "lista").
  salasComExclusividade: Set<string>
  salasTodas: Sala[]
  exclusividades: SalaTerapiaExclusiva[]
  profissionaisTodos: ProfissionalOpcao[]
  terapiasTodas: string[]
  encontrarAlocacaoDoProfissional: (nome: string, dow: number, turno: "Manhã" | "Tarde", exceto?: string) => AlocacaoAtual | null
  onRecarregarAlocacoes: () => Promise<void>
  /** Conteúdo de uma vista que não usa os filtros de sala (hoje: Regularizações). */
  children?: React.ReactNode
}

export function SalasListaView(props: SalasListaViewProps) {
  const {
    modo, filtradas, filtradasPadrao, gruposEspeciais,
    filtros, onFiltros, unidades, nucleos, andares,
    somenteInconsistentes, onToggleInconsistentes, isolada, onLimparIsolada, onIsolarSala,
    totalInconsistencias,
    loading, error, onRecarregarTudo, onVerDetalhes, onEditarSala,
    salasComExclusividade, salasTodas, exclusividades, profissionaisTodos, terapiasTodas,
    encontrarAlocacaoDoProfissional, onRecarregarAlocacoes, children,
  } = props

  // Regularizações lê outro recorte de dados (alocações + linhas, sem filtro de
  // sala). O seletor de vista continua visível — é por ele que se volta —, mas
  // a barra de filtros sai: filtro que não filtra nada é pior que filtro nenhum.
  const emRegularizacoes = modo === "regularizacoes"

  const { labels: statusLabels } = useStatusLabels()

  // "Isolar sala" só existe na Lista e no Mapa (o olho na linha da sala); nos
  // Cards o caminho é "Ver detalhes". Mostrar o chip de isolamento em Cards
  // exibiria um filtro que o usuário não teria como ter criado ali — ele
  // continua aplicado (a lista filtrada é a mesma), mas quem trocou de modo vê
  // um card só e o chip que explica isso.
  const chips = useMemo(
    () => chipsDeFiltro(
      filtros,
      { isolada: isolada?.nome ?? null, soInconsistentes: somenteInconsistentes },
      { status: codigo => statusLabels[codigo]?.label_curto ?? codigo },
    ),
    [filtros, isolada, somenteInconsistentes, statusLabels],
  )

  function removerChip(chip: (typeof chips)[number]) {
    if (chip.campo === "isolada") return onLimparIsolada()
    if (chip.campo === "soInconsistentes") return onToggleInconsistentes()
    onFiltros(removerChipDeFiltro(filtros, chip))
  }

  function limparTudo() {
    if (isolada) onLimparIsolada()
    if (somenteInconsistentes) onToggleInconsistentes()
    onFiltros(SALAS_FILTROS_VAZIO)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A contagem de salas e o % subiram para o cabeçalho da página (uma
          faixa só, ao lado das ações). Aqui ficam os CONTROLES: filtrar,
          escolher a vista, e o atalho de inconsistências — que é um filtro,
          não um indicador, e por isso mora junto dos outros filtros em vez de
          flutuar sozinho numa faixa acima. */}
      {/* Uma linha só. O seletor de vistas subiu para o cabeçalho da página
          (junto das ações, onde sobrava espaço): aqui embaixo, somado aos
          filtros, ele estourava a largura e quebrava para uma segunda linha —
          "Lista compacta / Mapa de calor / Regularizações" sozinhos passam de
          350px. */}
      {!emRegularizacoes && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SalasFiltros value={filtros} onChange={onFiltros} unidades={unidades} nucleos={nucleos} andares={andares} />
            {/* O aviso é um FILTRO, e por isso mora entre os filtros. Zero não
                tem cor: sem inconsistência não há o que filtrar, some. */}
            {totalInconsistencias > 0 && (
              <button
                type="button"
                onClick={onToggleInconsistentes}
                aria-pressed={somenteInconsistentes}
                title={somenteInconsistentes ? "Mostrar todas as salas" : "Mostrar só as salas com inconsistência"}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  somenteInconsistentes
                    ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-300"
                    : "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                }`}
              >
                <AlertTriangle size={14} aria-hidden />
                {totalInconsistencias} precisam de atenção
              </button>
            )}
          </div>

          {/* FiltrosChips devolve null sem filtro ativo: esta linha só existe
              quando tem o que dizer. */}
          <FiltrosChips chips={chips} onRemover={removerChip} onLimparTudo={limparTudo} />
        </div>
      )}

      {loading && !emRegularizacoes && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Carregando salas e agenda...
        </div>
      )}

      {/* Antes: uma linha vermelha solta, sem causa e sem saída. O caminho
          realista de falha aqui é statement timeout (ver o comentário no
          hook), que é justamente o caso em que tentar de novo resolve. */}
      {error && (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Não foi possível carregar as salas</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={onRecarregarTudo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={12} aria-hidden /> Tentar de novo
          </button>
        </div>
      )}

      {!loading && !error && modo === "cards" && (
        <SalasCardsGrid
          salas={filtradas}
          salasComExclusividade={salasComExclusividade}
          filtrosAtivos={chips.map(c => c.label)}
          onVerDetalhes={onVerDetalhes}
          onEditarSala={onEditarSala}
        />
      )}

      {/* Sem nada em nenhum dos dois conjuntos, a grade renderizava só o
          cabeçalho — um vazio que não se explicava. */}
      {/* Regularizações traz o próprio conteúdo e o próprio vazio. */}
      {emRegularizacoes && children}

      {!loading && !error && !emRegularizacoes && modo !== "cards" && filtradas.length === 0 && <SemSalas />}

      {!loading && !error && modo === "lista" && filtradas.length > 0 && (
        <>
          {filtradasPadrao.length === 0 && gruposEspeciais.length > 0 ? null : (
            <SalasGridView
              salas={filtradasPadrao}
              onEditarSala={onEditarSala}
              onVerDetalhes={onVerDetalhes}
              onIsolarSala={onIsolarSala}
              salaIsoladaId={isolada?.id ?? null}
              encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
              onRecarregar={onRecarregarAlocacoes}
              buscaProfissional={filtros.profissional}
              salasComExclusividade={salasComExclusividade}
              salasTodas={salasTodas}
              exclusividades={exclusividades}
              profissionaisTodos={profissionaisTodos}
              terapiasTodas={terapiasTodas}
            />
          )}
          {gruposEspeciais.map(grupo => (
            <GrupoEspecial key={grupo.chave} grupo={grupo}>
              <SalasGridView
                salas={grupo.itens}
                dias={grupo.dias}
                onEditarSala={onEditarSala}
                onVerDetalhes={onVerDetalhes}
                onIsolarSala={onIsolarSala}
                salaIsoladaId={isolada?.id ?? null}
                encontrarAlocacaoDoProfissional={encontrarAlocacaoDoProfissional}
                onRecarregar={onRecarregarAlocacoes}
                buscaProfissional={filtros.profissional}
                salasComExclusividade={salasComExclusividade}
                salasTodas={salasTodas}
                exclusividades={exclusividades}
                profissionaisTodos={profissionaisTodos}
                terapiasTodas={terapiasTodas}
              />
            </GrupoEspecial>
          ))}
        </>
      )}

      {!loading && !error && modo === "mapa" && filtradas.length > 0 && (
        <>
          {filtradasPadrao.length === 0 && gruposEspeciais.length > 0 ? null : (
            <SalasHeatmapView
              salas={filtradasPadrao}
              onIsolarSala={onIsolarSala}
              salaIsoladaId={isolada?.id ?? null}
              salasComExclusividade={salasComExclusividade}
            />
          )}
          {gruposEspeciais.map(grupo => (
            <GrupoEspecial key={grupo.chave} grupo={grupo}>
              <SalasHeatmapView
                salas={grupo.itens}
                dias={grupo.dias}
                onIsolarSala={onIsolarSala}
                salaIsoladaId={isolada?.id ?? null}
                salasComExclusividade={salasComExclusividade}
              />
            </GrupoEspecial>
          ))}
        </>
      )}
    </div>
  )
}

/** Vazio de Lista/Mapa — os Cards têm o seu em SalasCardsGrid. */
function SemSalas() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
      <DoorOpen size={22} className="text-muted-foreground" aria-hidden />
      <p className="text-sm font-semibold text-foreground">Nenhuma sala neste recorte</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Remova um dos filtros ativos acima para ver mais salas.
      </p>
    </div>
  )
}

function GrupoEspecial({ grupo, children }: { grupo: GrupoDiasSalas; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Salas com dias diferenciados ({grupo.dias.map(d => d.label).join(" + ")})
      </h3>
      {children}
    </div>
  )
}
