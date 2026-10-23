"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertCircle, ArrowDownUp, ChevronLeft, ChevronRight, CloudDownload, Database,
  History, ListFilter, Search, UserPlus, X,
} from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { useHeader } from "@/contexts/HeaderContext"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { useProfissionais } from "@/hooks/useProfissionais"
import { normTxt } from "@/lib/cronograma/constants"
import { corFocal, formatarCelular, registroCompleto, terapiasDoProfissional } from "@/lib/cadastros/profissionais"
import { compararTom } from "@/lib/cadastros/terapias"
import { onlyDigits } from "@/lib/remuneracao/formatacao"
import { idExibicaoProfissional, type ProfissionalLista, type TerapiaDoProfissional } from "@/types/profissional"
import { campo, foco } from "./pacientes/ui/campos"
import { AvatarProfissional, ChipTerapia, corDoCatalogo } from "./profissionais/pecas"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import { dataBR, somarDias } from "@/lib/disponibilidadeProfissional"
import { NovoCadastroProfissionalModal } from "./profissionais/NovoCadastroProfissionalModal"
import type { SituacaoGrade, SituacaoGradeProfissional } from "@/types/disponibilidadeProfissional"
import { BarraAlfabeto, OpcaoFiltro, PopoverFiltro, SeletorModo, alternarEm, type ModoExibicao } from "./shared/ListaCadastro"
import { btnSecundario } from "@/components/cronograma/grade/estilo"
import { EstadoVazio } from "@/components/ui/padrao"

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

// Ordenação da lista. "terapia" agrupa por terapia, com cabeçalho — e quem
// presta mais de uma aparece em cada grupo. "tom" só ordena pela cor do card,
// sem separar por terapia.
type Ordem = "nome" | "terapia" | "tom"
const ORDENS: { valor: Ordem; rotulo: string }[] = [
  { valor: "nome", rotulo: "Nome" },
  { valor: "terapia", rotulo: "Terapia" },
  { valor: "tom", rotulo: "Tom da cor" },
]
const CHAVE_ORDEM = "profissionais:ordem"

/** Um card na tela. Em "terapia", o mesmo profissional gera um por terapia. */
type Entrada = { linha: Linha; grupo: string | null; corGrupo: string; chave: string }

type Linha = {
  prof: ProfissionalLista
  terapias: TerapiaDoProfissional[]
  cor: string
  /** Terapia que pinta o card (a focal, ou a de mais horários). */
  focal: string | null
  /** "Seg, Qua, Sex · manhã" da versão vigente (só quando há versão vigente). */
  resumo: string | null
  /** null quando a situação não pôde ser lida (migration pendente). */
  grade: SituacaoGradeProfissional | null
  situacaoGrade: SituacaoGrade | null
}

export function ProfissionaisCadastro() {
  const { profissionais, habilitadas, grade, situacaoGrade, situacaoIndisponivel, resumoVigente, loading, error, migrationPendente } = useProfissionais()
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

  const [modo, setModo] = useState<ModoExibicao>("grade")
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODO)
      // Preferência do navegador lida depois de montar, para não divergir do HTML do servidor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (salvo === "grade" || salvo === "lista") setModo(salvo)
    } catch {
      // Sem storage, fica no default.
    }
  }, [])
  const trocarModo = useCallback((novo: ModoExibicao) => {
    setModo(novo)
    try { localStorage.setItem(CHAVE_MODO, novo) } catch { /* só não lembra */ }
  }, [])

  const [ordem, setOrdem] = useState<Ordem>("nome")
  useEffect(() => {
    try {
      const salva = localStorage.getItem(CHAVE_ORDEM)
      // Preferência do navegador lida depois de montar, para não divergir do HTML do servidor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (salva === "terapia" || salva === "tom") setOrdem(salva)
    } catch {
      // Sem storage, fica em "nome".
    }
  }, [])
  const trocarOrdem = useCallback((nova: Ordem) => {
    setOrdem(nova)
    setPagina(1)
    try { localStorage.setItem(CHAVE_ORDEM, nova) } catch { /* só não lembra */ }
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
    const g = situacaoGrade.get(prof.id) ?? null
    const f = corFocal(prof, terapias)
    return {
      prof, terapias, cor: f.cor, focal: f.terapia?.nome ?? null, resumo: resumoVigente.get(prof.id) ?? null,
      grade: g,
      situacaoGrade: situacaoIndisponivel ? null : g?.situacao ?? "sem_grade",
    }
  }), [profissionais, habilitadas, grade, catalogoPorId, indice, situacaoGrade, situacaoIndisponivel, resumoVigente])

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

  const entradas = useMemo<Entrada[]>(() => {
    const lista = letra ? filtradasSemLetra.filter(l => normTxt(l.prof.nome).toUpperCase().startsWith(letra)) : filtradasSemLetra
    const porNome = (a: Linha, b: Linha) => a.prof.nome.localeCompare(b.prof.nome, "pt-BR")
    const unica = (l: Linha): Entrada => ({ linha: l, grupo: null, corGrupo: "", chave: String(l.prof.id) })

    if (ordem === "nome") return lista.map(unica)
    if (ordem === "tom") {
      const semTerapiaPorUltimo = (a: Linha, b: Linha) => (a.focal === null ? 1 : 0) - (b.focal === null ? 1 : 0)
      return [...lista].sort((a, b) => semTerapiaPorUltimo(a, b) || compararTom(a.cor, b.cor) || porNome(a, b)).map(unica)
    }

    // "terapia": uma entrada por terapia do profissional. Com o filtro de
    // terapia ligado, só nos grupos filtrados.
    const out: Entrada[] = []
    for (const l of lista) {
      const ts = l.terapias.filter(t => !filtroTerapias.size || (t.terapiaId !== null && filtroTerapias.has(t.terapiaId)))
      if (!ts.length) out.push({ linha: l, grupo: null, corGrupo: "", chave: `sem-${l.prof.id}` })
      for (const t of ts) out.push({ linha: l, grupo: t.nome, corGrupo: t.cor, chave: `${t.nome}-${l.prof.id}` })
    }
    return out.sort((a, b) =>
      (a.grupo === null ? 1 : 0) - (b.grupo === null ? 1 : 0)
      || (a.grupo ?? "").localeCompare(b.grupo ?? "", "pt-BR")
      || porNome(a.linha, b.linha)
    )
  }, [filtradasSemLetra, letra, ordem, filtroTerapias])

  // Quantos cards em cada grupo no recorte inteiro (o cabeçalho mostra o total,
  // não só o que coube na página) e quantos profissionais distintos há.
  const totalPorGrupo = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entradas) m.set(e.grupo ?? "", (m.get(e.grupo ?? "") ?? 0) + 1)
    return m
  }, [entradas])
  const totalProfissionais = useMemo(() => new Set(entradas.map(e => e.linha.prof.id)).size, [entradas])

  const totalPaginas = Math.max(1, Math.ceil(entradas.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const daPagina = useMemo(() => entradas.slice(inicio, inicio + POR_PAGINA), [entradas, inicio])
  // Só "terapia" tem grupos com cabeçalho.
  const grupos = useMemo(() => {
    if (ordem !== "terapia") return [{ chave: "todos", nome: null as string | null, cor: "", itens: daPagina }]
    const out: { chave: string; nome: string | null; cor: string; itens: Entrada[] }[] = []
    for (const e of daPagina) {
      const ultimo = out[out.length - 1]
      if (ultimo && ultimo.nome === e.grupo) ultimo.itens.push(e)
      else out.push({ chave: `${e.grupo ?? "sem"}-${out.length}`, nome: e.grupo, cor: e.corGrupo, itens: [e] })
    }
    return out
  }, [daPagina, ordem])

  const irPara = (destino: number) => {
    setPagina(Math.min(Math.max(1, destino), totalPaginas))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }


  const { setRightContent } = useHeader()

  // No header ficam só as AÇÕES (padrão da lista de Pacientes). Busca e
  // filtros moram no bloco da página, junto com a barra A–Z.
  useEffect(() => {
    setRightContent(
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setVerHistorico(true)}
          aria-label="Histórico"
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted ${foco}`}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Histórico</span>
        </button>
        <button
          type="button"
          onClick={() => setModalNovo(true)}
          disabled={migrationPendente}
          className={`inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 ${foco}`}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Novo profissional
        </button>
      </div>
    )
    return () => setRightContent(null)
  }, [migrationPendente, setRightContent])

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
    // Mesma largura e mesmo bloco de filtros da lista de Pacientes.
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6">
      {/* Busca, filtros e A–Z num bloco só: tudo que recorta a lista mora junto,
          e a lista abaixo é a resposta. */}
      {!vazio && (
        <div className="mb-5 rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
            <div className="relative w-full md:w-80 lg:w-96">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                className={`${campo} w-full pl-9 ${buscaTexto ? "pr-11 sm:pr-9" : ""}`}
                placeholder="Buscar por nome, CPF, registro ou ID…"
                value={buscaTexto}
                onChange={e => { setBuscaTexto(e.target.value); setPagina(1) }}
                aria-label="Buscar profissional"
              />
              {buscaTexto && (
                <button
                  type="button"
                  onClick={() => { setBuscaTexto(""); setPagina(1) }}
                  // 40px no toque (o campo inteiro tem essa altura), 24px no mouse.
                  className={`absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground sm:right-1.5 sm:h-6 sm:w-6 ${foco}`}
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="w-full sm:w-52">
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
                className="min-h-11 text-sm sm:min-h-0"
              />
            </div>
            <FiltroSituacao value={situacoes} onChange={v => { setSituacoes(v); setPagina(1) }} />
            <OrdenarPor value={ordem} onChange={trocarOrdem} />
            <div className="ml-auto flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              {!loading && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  {ordem === "terapia" ? (
                    <>
                      <span className="text-sm font-semibold text-foreground">{totalProfissionais}</span>{" "}
                      {totalProfissionais === 1 ? "profissional" : "profissionais"} · {entradas.length} cards
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-semibold text-foreground">{entradas.length}</span> de{" "}
                      {profissionais.length} {profissionais.length === 1 ? "profissional" : "profissionais"}
                    </>
                  )}
                </span>
              )}
              <SeletorModo value={modo} onChange={trocarModo} destaque />
            </div>
          </div>
          <div className="px-3 pb-3">
            <BarraAlfabeto embutida value={letra} disponiveis={letrasDisponiveis} onChange={v => { setLetra(v); setPagina(1) }} />
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Não foi possível carregar os profissionais. {error}</span>
        </div>
      )}

      {vazio ? (
        <EstadoVazio
          Icone={CloudDownload}
          titulo="Nenhum profissional cadastrado ainda"
          texto={<>Os profissionais do TiTa chegam pela carga diária (04:00) ou em Administração → Carregar do TiTa —
            nome, CPF, celular, CBO e registro vêm junto. Quem ainda não está no TiTa entra por &quot;Novo profissional&quot;.</>}
          className="mx-auto max-w-xl"
        />
      ) : (
        <>
          {loading ? (
            <GridEsqueleto />
          ) : entradas.length === 0 ? (
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
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className={`hidden gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground md:grid ${COLUNAS_LISTA}`} aria-hidden="true">
                <span>Profissional</span>
                <span>ID</span>
                <span>Registro</span>
                <span>Celular</span>
                <span>Terapias</span>
                <span>Situação</span>
              </div>
              {grupos.map(g => (
                <div key={g.chave}>
                  {ordem === "terapia" && (
                    <div className="border-b border-border bg-muted/30 px-4 py-2">
                      <CabecalhoGrupo nome={g.nome} cor={g.cor} total={totalPorGrupo.get(g.nome ?? "") ?? g.itens.length} />
                    </div>
                  )}
                  <ul>
                    {g.itens.map(e => <LinhaProfissional key={e.chave} linha={e.linha} />)}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {grupos.map(g => (
                <section key={g.chave} aria-label={g.nome ?? "Todos"}>
                  {ordem === "terapia" && (
                    <div className="mb-3">
                      <CabecalhoGrupo nome={g.nome} cor={g.cor} total={totalPorGrupo.get(g.nome ?? "") ?? g.itens.length} />
                    </div>
                  )}
                  <ul className="ua-grid">
                    {g.itens.map(e => <CardProfissional key={e.chave} linha={e.linha} />)}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {!loading && totalPaginas > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Paginação de profissionais">
              <button type="button" onClick={() => irPara(paginaAtual - 1)} disabled={paginaAtual <= 1} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Anterior
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Página {paginaAtual} de {totalPaginas} · {inicio + 1}–{Math.min(inicio + POR_PAGINA, entradas.length)}
              </span>
              <button type="button" onClick={() => irPara(paginaAtual + 1)} disabled={paginaAtual >= totalPaginas} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
                Próxima
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </nav>
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

/** Cabeçalho de um grupo na ordenação por terapia: bolinha na cor, nome e quantos. */
function CabecalhoGrupo({ nome, cor, total }: { nome: string | null; cor: string; total: number }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
      {nome ? (
        <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: cor }} aria-hidden />
      ) : (
        <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-muted-foreground" aria-hidden />
      )}
      {nome ?? "Sem terapia"}
      <span className="font-semibold tabular-nums text-muted-foreground">{total}</span>
      <span className="ml-2 h-px flex-1 bg-border" aria-hidden />
    </h3>
  )
}

/** "Ordenar: Nome / Terapia / Tom da cor" — escolha única, mesmo gatilho dos filtros. */
function OrdenarPor({ value, onChange }: { value: Ordem; onChange: (v: Ordem) => void }) {
  return (
    <PopoverFiltro
      icone={ArrowDownUp}
      nome="Ordenar"
      valor={ORDENS.find(o => o.valor === value)?.rotulo ?? ""}
      rotuloPainel="Ordenar profissionais"
      larguraPainel="w-48"
      unico
    >
      {ORDENS.map(o => (
        <OpcaoFiltro key={o.valor} marcado={value === o.valor} onAlternar={() => onChange(o.valor)}>
          <span className="flex-1">{o.rotulo}</span>
        </OpcaoFiltro>
      ))}
    </PopoverFiltro>
  )
}

function FiltroSituacao({ value, onChange }: { value: Set<SituacaoFiltro>; onChange: (v: Set<SituacaoFiltro>) => void }) {
  const resumo = value.size === 0 ? "Nenhuma" : value.size === SITUACOES.length ? "Todos" : SITUACOES.filter(s => value.has(s.valor)).map(s => s.rotulo).join(", ")
  return (
    <PopoverFiltro icone={ListFilter} nome="Situação" valor={resumo} rotuloPainel="Filtrar por situação" larguraPainel="w-48">
      {SITUACOES.map(s => (
        <OpcaoFiltro key={s.valor} marcado={value.has(s.valor)} onAlternar={() => onChange(alternarEm(value, s.valor))}>
          <span className="flex-1">{s.rotulo}</span>
        </OpcaoFiltro>
      ))}
    </PopoverFiltro>
  )
}

/** Selo discreto: só "Inativo" chama atenção (o card inteiro muda de tom). */
function Situacao({ ativo }: { ativo: boolean }) {
  return <span className={`ua-status ${ativo ? "" : "before:!bg-[var(--ua-stone-500)]"}`}>{ativo ? "Ativo" : "Inativo"}</span>
}

/** Até `max` chips, cada um com os tons da própria terapia, + "+N". */
function ChipsTerapias({ terapias, max = 3, inativo = false }: { terapias: TerapiaDoProfissional[]; max?: number; inativo?: boolean }) {
  if (!terapias.length) return <span className="text-xs text-[var(--ua-ink-subtle)]">Sem terapia</span>
  const resto = terapias.length - max
  return (
    <div className="flex w-full min-w-0 flex-wrap gap-1.5">
      {terapias.slice(0, max).map(t => <ChipTerapia key={t.nome} terapia={t} inativo={inativo} />)}
      {resto > 0 && (
        <span className="ua-chip ua-chip-mais" title={terapias.slice(max).map(t => t.nome).join(", ")}>+{resto}</span>
      )}
    </div>
  )
}

/** Disponibilidade no card: verde com o resumo quando há grade vigente; âmbar quando é pendência. */
function LinhaDisponibilidade({ linha }: { linha: Linha }) {
  const g = linha.grade
  switch (linha.situacaoGrade) {
    case null:
      return null
    case "vigente":
      return <div className="ua-avail ok">{linha.resumo ?? `Grade vigente desde ${dataBR(g?.vigente_desde)}`}</div>
    case "agendada":
      return <div className="ua-avail none">Sem grade hoje · começa em {dataBR(g?.proxima_de)}</div>
    case "inativa":
      return <div className="ua-avail none">Grade inativa desde {g?.encerrada_em ? dataBR(somarDias(g.encerrada_em, 1)) : "—"}</div>
    default:
      return <div className="ua-avail none">Sem disponibilidade cadastrada</div>
  }
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd className={valor ? "" : "empty"}>{valor || "Não informado"}</dd>
    </>
  )
}

const CardProfissional = memo(function CardProfissional({ linha }: { linha: Linha }) {
  const { prof, terapias } = linha
  // A terapia principal (a que pinta o card) e as outras, cada uma com seus tons.
  const principal = terapias.find(t => t.nome === linha.focal) ?? null
  const outras = terapias.filter(t => t !== principal)
  const inativo = !prof.ativo
  return (
    <li>
      <Link
        href={`/cadastros/profissionais/${prof.id}`}
        style={estiloTons(corDoCatalogo(principal))}
        className={`ua-tons ua-card ${inativo ? "is-inactive" : ""}`}
      >
        <header className="ua-head">
          <div className="ua-top">
            <span className="ua-id">ID <b>{idExibicaoProfissional(prof)}</b></span>
            <Situacao ativo={prof.ativo} />
          </div>
          <AvatarProfissional icone={principal?.icone ?? null} fotoPath={prof.foto_path} cor={corDoCatalogo(principal)} inativo={inativo} />
          <h2 className="ua-name"><span className="line-clamp-2" title={prof.nome}>{prof.nome}</span></h2>
          {principal
            ? <span className="ua-role"><span className="truncate">{principal.nome}</span></span>
            : <span className="text-xs text-[var(--ua-ink-subtle)]">Sem terapia</span>}
        </header>

        <div className="ua-body">
          <dl className="ua-fields">
            <Campo rotulo="Tipo" valor={prof.tipo_registro} />
            <Campo rotulo="Registro" valor={[prof.codigo_registro, prof.uf_registro].filter(Boolean).join(" · ") || null} />
            <Campo rotulo="CBO" valor={prof.cbo} />
            <Campo rotulo="Celular" valor={formatarCelular(prof.celular)} />
          </dl>

          <LinhaDisponibilidade linha={linha} />

          {outras.length > 0 && (
            <div className="ua-chips mt-auto">
              <ChipsTerapias terapias={outras} max={3} inativo={inativo} />
            </div>
          )}
        </div>
      </Link>
    </li>
  )
})

const LinhaProfissional = memo(function LinhaProfissional({ linha }: { linha: Linha }) {
  const { prof, terapias } = linha
  const principal = terapias.find(t => t.nome === linha.focal) ?? null
  return (
    <li className="border-b border-border last:border-b-0">
      <Link
        href={`/cadastros/profissionais/${prof.id}`}
        className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-sm transition-colors hover:bg-muted/50 motion-reduce:transition-none ${COLUNAS_LISTA} ${foco} focus-visible:ring-inset`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AvatarProfissional icone={principal?.icone ?? null} fotoPath={prof.foto_path} cor={corDoCatalogo(principal)} tamanho="sm" inativo={!prof.ativo} />
          <div className="min-w-0">
            <span className="block break-words font-medium text-primary group-hover:underline">{prof.nome}</span>
            <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
              ID {idExibicaoProfissional(prof)}{terapias[0] ? ` · ${terapias[0].nome}` : ""}
            </p>
          </div>
        </div>
        <span className="hidden tabular-nums text-foreground md:block">{idExibicaoProfissional(prof)}</span>
        <span className="hidden truncate text-foreground md:block">{registroCompleto(prof) ?? "—"}</span>
        <span className="hidden truncate tabular-nums text-foreground md:block">{formatarCelular(prof.celular) ?? "—"}</span>
        <span className="hidden min-w-0 md:block"><ChipsTerapias terapias={terapias} max={2} inativo={!prof.ativo} /></span>
        <span className="justify-self-end md:justify-self-start"><Situacao ativo={prof.ativo} /></span>
      </Link>
    </li>
  )
})

function GridEsqueleto() {
  return (
    <div className="ua-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ua-card">
          <div className="ua-head">
            <div className="ua-top">
              <div className="h-3 w-14 animate-pulse rounded bg-muted" />
              <div className="h-4 w-12 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-[76px] w-[76px] animate-pulse rounded-full bg-muted" />
            <div className="mt-4 h-3 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-2.5 w-20 animate-pulse rounded bg-muted" />
          </div>
          <div className="ua-body">
            {Array.from({ length: 4 }).map((__, j) => <div key={j} className="h-3 w-40 animate-pulse rounded bg-muted" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
