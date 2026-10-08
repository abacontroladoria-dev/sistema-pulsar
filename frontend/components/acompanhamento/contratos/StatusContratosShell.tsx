"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, Search, X } from "lucide-react"
import { useHeader } from "@/contexts/HeaderContext"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import {
  aplicar,
  contarKpis,
  filtrosIniciais,
  opcoesDeConvenio,
  type FiltrosContratos,
  type RecorteContratos,
} from "@/lib/contratos/filtros"
import { dataBR } from "@/lib/contratos/status"
import type { ItemStatusContratos, MetaStatusContratos } from "@/types/contratosPaciente"
import { CardContrato } from "./CardContrato"
import { PainelFiltrosContratos } from "./FiltrosContratos"
import { PainelIndicadoresContratos } from "./PainelIndicadores"

// Status Contratos: uma visão de todos os pacientes e do andamento dos seus
// contratos (assinatura + vigência). Molde: AcompanhamentoLaudosShell —
// mesmo painel de filtros, mesmos cards de indicador que filtram, mesma grade
// de cartões 2→5 colunas, mesma paginação de 75, mesma busca com debounce.
//
// SÓ LEITURA. Criar, anexar, assinar e cancelar é na aba Contratos da ficha do
// paciente; o cartão leva para lá.
//
// A lista vem de /api/status-contratos (service_role: a grade do TiTa só ela
// lê). Filtrar e paginar é aqui, sobre a lista inteira — a paginação vem DEPOIS
// do filtro, então a busca acha o paciente em qualquer página.

const POR_PAGINA = 75

function filtrosAlterados(f: FiltrosContratos): boolean {
  const i = filtrosIniciais()
  return (
    f.busca !== i.busca ||
    f.recorte !== i.recorte ||
    f.tipos.size > 0 ||
    f.convenios.size > 0 ||
    f.agendamento !== i.agendamento ||
    f.situacoes.size !== i.situacoes.size ||
    [...i.situacoes].some((s) => !f.situacoes.has(s))
  )
}

export function StatusContratosShell({ buscaInicial = "" }: { buscaInicial?: string }) {
  const [itens, setItens] = useState<ItemStatusContratos[]>([])
  const [meta, setMeta] = useState<MetaStatusContratos | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // Veio por link com busca: mostra ativos E inativos, para o paciente
  // procurado não sumir atrás do filtro padrão.
  const [filtros, setFiltros] = useState<FiltrosContratos>(() =>
    buscaInicial
      ? { ...filtrosIniciais(), busca: buscaInicial, situacoes: new Set(["ativo", "inativo"]) }
      : filtrosIniciais(),
  )
  const [pagina, setPagina] = useState(1)
  /** Muda só em "Limpar filtros" — é a chave que remonta o campo de busca. */
  const [versaoFiltros, setVersaoFiltros] = useState(0)

  const aplicarBusca = useCallback((texto: string) => {
    setFiltros((f) => (f.busca === texto ? f : { ...f, busca: texto }))
    setPagina(1)
  }, [])

  const limparFiltros = useCallback(() => {
    setFiltros(filtrosIniciais())
    setPagina(1)
    setVersaoFiltros((v) => v + 1)
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      // Barra no fim: `trailingSlash: true` no next.config.
      const resposta = await fetch("/api/status-contratos/", { cache: "no-store" })
      const corpo = await resposta.json().catch(() => null)
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.mensagem ?? corpo?.error ?? `HTTP ${resposta.status}`)
      }
      setItens(corpo.itens as ItemStatusContratos[])
      setMeta(corpo.meta as MetaStatusContratos)
    } catch (e) {
      console.error("[status-contratos] falha ao carregar", e)
      setErro(e instanceof Error ? e.message : "erro desconhecido")
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const { setRightContent } = useHeader()
  useEffect(() => {
    setRightContent(
      <button
        type="button"
        onClick={() => void carregar()}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted ${foco}`}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Atualizar
      </button>,
    )
    return () => setRightContent(null)
  }, [carregar, setRightContent])

  const contagens = useMemo(() => contarKpis(itens, filtros), [itens, filtros])
  const filtrados = useMemo(() => aplicar(itens, filtros), [itens, filtros])
  const opcoesConvenio = useMemo(() => opcoesDeConvenio(itens), [itens])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const daPagina = useMemo(() => filtrados.slice(inicio, inicio + POR_PAGINA), [filtrados, inicio])

  const escolherRecorte = useCallback((recorte: RecorteContratos) => {
    setFiltros((f) => ({ ...f, recorte }))
    setPagina(1)
  }, [])

  function irPara(destino: number) {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6">
      {erro && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os contratos. {erro}</span>
        </div>
      )}

      {meta?.migracaoPendente && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Os contratos do paciente ainda não estão ativos no banco (migração pendente). A lista mostra os pacientes, todos sem
            contrato, até a aplicação de 20261008160000_pacientes_contratos.sql.
          </span>
        </div>
      )}

      {/* A grade falhou, os contratos não: "Sem contrato" depende de quem está
          possui agendamento e ficaria zerado sem explicação. */}
      {meta?.gradeErro && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Não foi possível ler a grade do TiTa. “Sem contrato” e “Possui agendamentos” ficaram sem dado, e o convênio mostrado é o do cadastro.
          </span>
        </div>
      )}

      <PainelFiltrosContratos
        filtros={filtros}
        onChange={(f) => {
          setFiltros(f)
          setPagina(1)
        }}
        onLimpar={limparFiltros}
        podeLimpar={filtrosAlterados(filtros)}
        busca={<CampoBusca key={versaoFiltros} onBusca={aplicarBusca} textoInicial={versaoFiltros === 0 ? buscaInicial : ""} />}
        opcoesConvenio={opcoesConvenio}
      />

      <PainelIndicadoresContratos contagens={contagens} recorte={filtros.recorte} onRecorte={escolherRecorte} carregando={carregando} />

      {carregando ? (
        <GradeEsqueleto />
      ) : filtrados.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
          {itens.length === 0 ? "Nenhum paciente para acompanhar." : "Nenhum paciente neste recorte."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {daPagina.map((item) => (
            <CardContrato key={item.pacienteId} item={item} />
          ))}
        </ul>
      )}

      {!carregando && filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Mostrando {inicio + 1}–{Math.min(inicio + POR_PAGINA, filtrados.length)} de {filtrados.length}{" "}
            {filtrados.length === 1 ? "paciente" : "pacientes"}
            {filtrados.length !== itens.length && ` (filtrado de ${itens.length})`}
          </p>
          {totalPaginas > 1 && (
            <nav className="flex items-center gap-2" aria-label="Paginação de pacientes">
              <button
                type="button"
                onClick={() => irPara(paginaAtual - 1)}
                disabled={paginaAtual <= 1}
                className={`inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent sm:min-h-0 ${foco}`}
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
                className={`inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent sm:min-h-0 ${foco}`}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      )}

      {/* Procedência: com que "hoje" a vigência foi calculada. */}
      {meta && (
        <p className="text-xs text-muted-foreground">
          {meta.pacientes} pacientes · {meta.contratos} contratos · vigência calculada em {dataBR(meta.hoje)} · “a vencer” = até 30 dias
        </p>
      )}
    </div>
  )
}

/**
 * Campo de busca dono do próprio texto (mesmo raciocínio do CampoBusca da
 * Status Laudos): uma tecla re-renderiza só o campo; o shell ouve o valor com
 * debounce de 200 ms. "Limpar filtros" zera remontando pela chave.
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
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        className={`h-10 w-full rounded-lg border border-border bg-background pl-9 ${
          texto ? "pr-9" : "pr-3"
        } text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring [&::-webkit-search-cancel-button]:hidden`}
        placeholder="Buscar por nome ou ID do paciente"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Buscar paciente por nome ou ID"
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

function GradeEsqueleto() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          <div className="mt-3 flex flex-col items-center">
            <div className="h-20 w-20 animate-pulse rounded-full bg-muted" />
            <div className="mt-3 h-3 w-28 animate-pulse rounded bg-muted" />
          </div>
          <hr className="my-4 border-border" />
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="h-3 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
