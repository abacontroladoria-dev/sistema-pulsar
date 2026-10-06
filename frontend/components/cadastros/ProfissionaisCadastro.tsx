"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import toast from "react-hot-toast"
import {
  AlertCircle, BadgeCheck, Briefcase, Check, ChevronLeft, ChevronRight, CloudDownload, Database,
  History, ListFilter, Loader2, Phone, Search, UserPlus, X,
} from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { useHeader } from "@/contexts/HeaderContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { useProfissionais } from "@/hooks/useProfissionais"
import { normTxt } from "@/lib/cronograma/constants"
import { corFocal, formatarCelular, registroCompleto, terapiasDoProfissional } from "@/lib/cadastros/profissionais"
import { onlyDigits } from "@/lib/remuneracao/formatacao"
import { importarDaTita } from "@/services/profissionais.service"
import { idExibicaoProfissional, type Profissional, type TerapiaDoProfissional } from "@/types/profissional"
import { campo, foco } from "./pacientes/ui/campos"
import { AvatarProfissional, ChipTerapia, estiloCor } from "./profissionais/pecas"
import { NovoCadastroProfissionalModal } from "./profissionais/NovoCadastroProfissionalModal"
import { BarraAlfabeto, LinhaDado, SeletorModo, type ModoExibicao } from "./shared/ListaCadastro"

// Listagem do cadastro de profissionais — mesmo desenho da de pacientes (cards,
// A–Z, grade/lista), com a cor da terapia focal como destaque do card.

const POR_PAGINA = 60
const CHAVE_MODO = "profissionais:modoExibicao"

type SituacaoFiltro = "ativo" | "inativo"
const SITUACOES: { valor: SituacaoFiltro; rotulo: string }[] = [
  { valor: "ativo", rotulo: "Ativos" },
  { valor: "inativo", rotulo: "Inativos" },
]

const COLUNAS_LISTA =
  "md:grid-cols-[minmax(0,2.2fr)_minmax(0,0.6fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.6fr)]"

type Linha = {
  prof: Profissional
  terapias: TerapiaDoProfissional[]
  cor: string
}

export function ProfissionaisCadastro() {
  const { profissionais, habilitadas, grade, loading, error, migrationPendente, recarregar } = useProfissionais()
  const { terapias: catalogo, indice } = useCadastroTerapias()

  const [buscaTexto, setBuscaTexto] = useState("")
  const [busca, setBusca] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setBusca(buscaTexto), 200)
    return () => clearTimeout(t)
  }, [buscaTexto])
  const [situacoes, setSituacoes] = useState<Set<SituacaoFiltro>>(() => new Set(["ativo"]))
  const [filtroTerapias, setFiltroTerapias] = useState<Set<number>>(new Set())
  const [letra, setLetra] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)
  const [modalNovo, setModalNovo] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const [importando, setImportando] = useState(false)

  const [modo, setModo] = useState<ModoExibicao>("grade")
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODO)
      if (salvo === "grade" || salvo === "lista") setModo(salvo)
    } catch {
      // Sem storage, fica no default.
    }
  }, [])
  const trocarModo = useCallback((novo: ModoExibicao) => {
    setModo(novo)
    try { localStorage.setItem(CHAVE_MODO, novo) } catch { /* só não lembra */ }
  }, [])

  const catalogoPorId = useMemo(() => new Map(catalogo.map(t => [t.id, t])), [catalogo])

  // Terapias e cor de cada profissional — calculadas uma vez por carga.
  const linhas = useMemo<Linha[]>(() => profissionais.map(prof => {
    const terapias = terapiasDoProfissional(
      prof,
      habilitadas.get(prof.id) ?? [],
      prof.tita_profissional_id ? grade.get(prof.tita_profissional_id) ?? [] : [],
      catalogoPorId,
      indice
    )
    return { prof, terapias, cor: corFocal(prof, terapias).cor }
  }), [profissionais, habilitadas, grade, catalogoPorId, indice])

  // Opções do filtro de terapia: só as que alguém tem.
  const opcoesTerapia = useMemo(() => {
    const vistas = new Map<number, string>()
    for (const l of linhas) for (const t of l.terapias) if (t.terapiaId !== null) vistas.set(t.terapiaId, t.nome)
    return [...vistas].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  }, [linhas])

  const filtradasSemLetra = useMemo(() => {
    let lista = linhas.filter(l => situacoes.has(l.prof.ativo ? "ativo" : "inativo"))
    if (filtroTerapias.size) {
      lista = lista.filter(l => l.terapias.some(t => t.terapiaId !== null && filtroTerapias.has(t.terapiaId)))
    }
    const termo = normTxt(busca)
    if (!termo) return lista
    const digitos = onlyDigits(busca)
    return lista.filter(({ prof: p }) => {
      if (normTxt(p.nome).includes(termo)) return true
      if (p.codigo_registro && normTxt(p.codigo_registro).includes(termo)) return true
      if (!digitos) return false
      if (p.cpf?.includes(digitos)) return true
      return idExibicaoProfissional(p).includes(digitos)
    })
  }, [linhas, situacoes, filtroTerapias, busca])

  const letrasDisponiveis = useMemo(() => {
    const s = new Set<string>()
    for (const l of filtradasSemLetra) {
      const c = normTxt(l.prof.nome).charAt(0).toUpperCase()
      if (c >= "A" && c <= "Z") s.add(c)
    }
    return s
  }, [filtradasSemLetra])

  const filtradas = useMemo(
    () => (letra ? filtradasSemLetra.filter(l => normTxt(l.prof.nome).toUpperCase().startsWith(letra)) : filtradasSemLetra),
    [filtradasSemLetra, letra]
  )

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const daPagina = useMemo(() => filtradas.slice(inicio, inicio + POR_PAGINA), [filtradas, inicio])

  const irPara = (destino: number) => {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const importar = useCallback(async () => {
    setImportando(true)
    try {
      const r = await importarDaTita()
      const partes = [
        r.novos ? `${r.novos} novo${r.novos === 1 ? "" : "s"}` : null,
        r.vinculados_por_cpf ? `${r.vinculados_por_cpf} vinculado${r.vinculados_por_cpf === 1 ? "" : "s"} pelo CPF` : null,
        r.atualizados ? `${r.atualizados} com dados da TiTa atualizados` : null,
        r.terapias_vinculadas ? `${r.terapias_vinculadas} terapias habilitadas` : null,
      ].filter(Boolean)
      toast.success(partes.length ? `TiTa: ${partes.join(" · ")}.` : `TiTa conferida: ${r.vistos_na_tita} profissionais, nada novo.`, { duration: 6000 })
      await recarregar()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
    } finally {
      setImportando(false)
    }
  }, [recarregar])

  const { setRightContent } = useHeader()
  useEffect(() => {
    setRightContent(
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            className={`${campo} pl-9 ${buscaTexto ? "pr-9" : ""} w-64`}
            placeholder="Buscar nome, CPF, registro ou ID"
            value={buscaTexto}
            onChange={e => { setBuscaTexto(e.target.value); setPagina(1) }}
            aria-label="Buscar profissional"
          />
          {buscaTexto && (
            <button
              type="button"
              onClick={() => { setBuscaTexto(""); setPagina(1) }}
              className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${foco}`}
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <FiltroSituacao value={situacoes} onChange={v => { setSituacoes(v); setPagina(1) }} />
        <div className="w-56 shrink-0">
          <MultiSearchCombobox
            opcoes={opcoesTerapia}
            selecionados={filtroTerapias}
            onToggle={id => {
              setFiltroTerapias(prev => {
                const n = new Set(prev)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })
              setPagina(1)
            }}
            onDesmarcarTodos={() => { setFiltroTerapias(new Set()); setPagina(1) }}
            ariaLabel="Filtrar por terapia"
            nomePlural="terapias"
            placeholder="Terapia: todas"
          />
        </div>
        <SeletorModo value={modo} onChange={trocarModo} />
        <button
          type="button"
          onClick={() => setVerHistorico(true)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
        >
          <History className="h-4 w-4" aria-hidden="true" /> Histórico
        </button>
        <button
          type="button"
          onClick={importar}
          disabled={importando || migrationPendente}
          title="Traz quem está na grade da TiTa e completa campos vazios. Nunca sobrescreve o que foi editado aqui."
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 ${foco}`}
        >
          {importando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CloudDownload className="h-4 w-4" aria-hidden="true" />}
          Importar da TiTa
        </button>
        <button
          type="button"
          onClick={() => setModalNovo(true)}
          disabled={migrationPendente}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ${foco}`}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Novo profissional
        </button>
      </div>
    )
    return () => setRightContent(null)
  }, [buscaTexto, situacoes, filtroTerapias, opcoesTerapia, modo, trocarModo, importando, importar, migrationPendente, setRightContent])

  if (migrationPendente) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <InlineNotice tone="amber" icon={<Database className="h-4 w-4" />}>
          O Cadastro de Profissionais ainda não existe neste banco. Aplique as migrations
          <strong> 20261006120000</strong>, <strong>20261006120100</strong> e <strong>20261006130000</strong> e recarregue a página.
        </InlineNotice>
      </div>
    )
  }

  const vazio = !loading && profissionais.length === 0

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os profissionais. {error}</span>
        </div>
      )}

      {vazio ? (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <CloudDownload className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-bold text-foreground">Nenhum profissional cadastrado ainda</h2>
          <p className="text-sm text-muted-foreground">
            Comece trazendo quem já está na grade da TiTa — nome, CPF, celular, CBO e registro vêm junto.
            Quem ainda não está na TiTa entra por &quot;Novo profissional&quot;.
          </p>
          <button
            type="button"
            onClick={importar}
            disabled={importando}
            className={`mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ${foco}`}
          >
            {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />} Importar da TiTa
          </button>
        </div>
      ) : (
        <>
          <BarraAlfabeto value={letra} disponiveis={letrasDisponiveis} onChange={v => { setLetra(v); setPagina(1) }} />

          {loading ? (
            <GridEsqueleto />
          ) : filtradas.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-16 text-center text-sm text-muted-foreground">
              {busca
                ? "Nenhum profissional encontrado para essa busca."
                : letra
                  ? `Nenhum profissional com o nome começando em "${letra}" neste recorte.`
                  : situacoes.size === 0
                    ? "Marque ao menos uma opção no filtro de Situação."
                    : "Nenhum profissional neste recorte."}
            </p>
          ) : modo === "lista" ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className={`hidden gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground md:grid ${COLUNAS_LISTA}`} aria-hidden="true">
                <span>Profissional</span>
                <span>ID</span>
                <span>Registro</span>
                <span>Celular</span>
                <span>Terapias</span>
                <span>Situação</span>
              </div>
              <ul>
                {daPagina.map(l => <LinhaProfissional key={l.prof.id} linha={l} />)}
              </ul>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {daPagina.map(l => <CardProfissional key={l.prof.id} linha={l} />)}
            </ul>
          )}

          {!loading && filtradas.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-3 sm:grid sm:grid-cols-3 sm:items-center">
              <p className="text-xs text-muted-foreground sm:justify-self-start" aria-live="polite">
                Mostrando {inicio + 1}–{Math.min(inicio + POR_PAGINA, filtradas.length)} de {filtradas.length}{" "}
                {filtradas.length === 1 ? "profissional" : "profissionais"}
              </p>
              {totalPaginas > 1 && (
                <nav className="flex items-center gap-2 sm:col-start-2 sm:justify-self-center" aria-label="Paginação de profissionais">
                  <button type="button" onClick={() => irPara(paginaAtual - 1)} disabled={paginaAtual <= 1}
                    className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 ${foco}`}>
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Anterior
                  </button>
                  <span className="text-xs text-muted-foreground">Página {paginaAtual} de {totalPaginas}</span>
                  <button type="button" onClick={() => irPara(paginaAtual + 1)} disabled={paginaAtual >= totalPaginas}
                    className={`inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 ${foco}`}>
                    Próxima <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </nav>
              )}
            </div>
          )}
        </>
      )}

      {modalNovo && <NovoCadastroProfissionalModal existentes={profissionais} onFechar={() => setModalNovo(false)} />}
      {verHistorico && (
        <HistoricoCadastrosModal
          subtitulo="Todas as alterações em profissionais — mais recentes primeiro."
          entidades={["profissional"]}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </div>
  )
}

function FiltroSituacao({ value, onChange }: { value: Set<SituacaoFiltro>; onChange: (v: Set<SituacaoFiltro>) => void }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  const alternar = (s: SituacaoFiltro) => {
    const n = new Set(value)
    if (n.has(s)) n.delete(s)
    else n.add(s)
    onChange(n)
  }
  const resumo = value.size === 0 ? "Nenhuma" : value.size === SITUACOES.length ? "Todos" : SITUACOES.filter(s => value.has(s.valor)).map(s => s.rotulo).join(", ")

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
        className={`inline-flex w-44 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}>
        <ListFilter className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Situação: {resumo}</span>
      </button>
      {aberto && (
        <div role="listbox" aria-label="Filtrar por situação" className="absolute left-0 top-[calc(100%+4px)] z-[100] w-44 rounded-md border border-border bg-popover p-1 shadow-lg">
          {SITUACOES.map(s => (
            <button key={s.valor} type="button" role="option" aria-selected={value.has(s.valor)} onClick={() => alternar(s.valor)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${foco}`}>
              {s.rotulo}
              {value.has(s.valor) && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Situacao({ ativo }: { ativo: boolean }) {
  return ativo ? (
    <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">Ativo</span>
  ) : (
    <span className="inline-flex rounded-full bg-rose-500/10 px-2 py-0.5 text-sm font-medium text-rose-600 dark:text-rose-400">Inativo</span>
  )
}

/** Até 3 chips (focal primeiro) + "+N". */
function ChipsTerapias({ terapias, max = 3, destacarPrimeira = false }: { terapias: TerapiaDoProfissional[]; max?: number; destacarPrimeira?: boolean }) {
  if (!terapias.length) return <span className="text-xs text-muted-foreground">Sem terapia</span>
  const resto = terapias.length - max
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {terapias.slice(0, max).map((t, i) => <ChipTerapia key={t.nome} terapia={t} destaque={destacarPrimeira && i === 0} />)}
      {resto > 0 && (
        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground" title={terapias.slice(max).map(t => t.nome).join(", ")}>
          +{resto}
        </span>
      )}
    </div>
  )
}

const CardProfissional = memo(function CardProfissional({ linha }: { linha: Linha }) {
  const { prof, terapias, cor } = linha
  const focal = terapias[0]
  return (
    <li>
      <Link
        href={`/cadastros/profissionais/${prof.id}`}
        style={estiloCor(cor)}
        className={`group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1.5 hover:border-[var(--t-linha)] hover:shadow-lg motion-reduce:transform-none motion-reduce:transition-none ${foco} ${prof.ativo ? "" : "opacity-75"}`}
      >
        {/* Véu da terapia focal no topo — some em degradê até o meio do avatar. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--t-faixa)] to-transparent"
        />
        <div className="relative flex items-start justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            ID <span className="font-semibold text-foreground">{idExibicaoProfissional(prof)}</span>
          </span>
          <div className="flex flex-wrap justify-end gap-1">
            <Situacao ativo={prof.ativo} />
          </div>
        </div>

        <div className="relative mt-3 flex flex-col items-center text-center">
          <AvatarProfissional nome={prof.nome} cor={cor} />
          <h2 className="mt-4 w-full truncate text-base font-bold leading-snug text-foreground" title={prof.nome}>
            {prof.nome}
          </h2>
          {focal ? (
            <p className="mt-1 inline-flex max-w-full items-center gap-1.5 text-xs font-semibold text-[var(--t-tinta)] dark:text-[var(--t-tinta-escuro)]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--t-cor)] ring-1 ring-black/10" aria-hidden="true" />
              <span className="truncate">{focal.nome}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Sem terapia</p>
          )}
        </div>

        <hr className="relative my-4 border-border" />

        <dl className="relative space-y-3 pb-4 text-sm">
          <LinhaDado icone={BadgeCheck} rotulo="Registro" valor={registroCompleto(prof)} />
          <LinhaDado icone={Briefcase} rotulo="CBO" valor={prof.cbo} />
          <LinhaDado icone={Phone} rotulo="Celular" valor={formatarCelular(prof.celular)} />
        </dl>

        {/* A focal já está sob o nome; aqui só as outras. */}
        {terapias.length > 1 && (
          <div className="relative mt-auto border-t border-border pt-3">
            <ChipsTerapias terapias={terapias.slice(1)} max={2} />
          </div>
        )}
      </Link>
    </li>
  )
})

const LinhaProfissional = memo(function LinhaProfissional({ linha }: { linha: Linha }) {
  const { prof, terapias, cor } = linha
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/cadastros/profissionais/${prof.id}`}
        className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition-colors hover:bg-muted/50 motion-reduce:transition-none ${COLUNAS_LISTA} ${foco} focus-visible:ring-inset`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AvatarProfissional nome={prof.nome} cor={cor} tamanho="sm" />
          <div className="min-w-0">
            <span className="block truncate font-medium text-primary group-hover:underline" title={prof.nome}>{prof.nome}</span>
            <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
              ID {idExibicaoProfissional(prof)}{terapias[0] ? ` · ${terapias[0].nome}` : ""}
            </p>
          </div>
        </div>
        <span className="hidden tabular-nums text-foreground md:block">{idExibicaoProfissional(prof)}</span>
        <span className="hidden truncate text-foreground md:block">{registroCompleto(prof) ?? "—"}</span>
        <span className="hidden truncate tabular-nums text-foreground md:block">{formatarCelular(prof.celular) ?? "—"}</span>
        <span className="hidden min-w-0 md:block"><ChipsTerapias terapias={terapias} max={2} destacarPrimeira /></span>
        <span className="justify-self-end md:justify-self-start"><Situacao ativo={prof.ativo} /></span>
      </Link>
    </li>
  )
})

function GridEsqueleto() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="h-3 w-14 animate-pulse rounded bg-muted" />
            <div className="h-4 w-12 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-3 flex flex-col items-center">
            <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
            <div className="mt-4 h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-2.5 w-20 animate-pulse rounded bg-muted" />
          </div>
          <hr className="my-4 border-border" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((__, j) => <div key={j} className="h-3 w-32 animate-pulse rounded bg-muted" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
