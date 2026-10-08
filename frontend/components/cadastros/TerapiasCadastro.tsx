"use client"

import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { ArrowDownAZ, Database, History, Loader2, Palette, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react"
import { HistoricoCadastrosModal } from "@/components/cadastros/historico/HistoricoCadastrosModal"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"
import { useCadastroTerapias } from "@/hooks/useCadastroTerapias"
import { normTxt } from "@/lib/cronograma/constants"
import { compararTom, luminancia } from "@/lib/cadastros/terapias"
import { IconeTerapia } from "@/lib/cadastros/iconesTerapia"
import { atualizarTerapia, criarTerapia } from "@/services/cadastroTerapias.service"
import { TIPO_TERAPIA_LABEL, type CadastroTerapia, type CadastroTerapiaEdit, type TipoTerapia } from "@/types/terapia"
import { TerapiaModal } from "./terapias/TerapiaModal"

type FiltroTipo = "todos" | TipoTerapia
type FiltroSituacao = "ativas" | "inativas" | "todas"
const SITUACOES: { valor: FiltroSituacao; rotulo: string }[] = [
  { valor: "ativas", rotulo: "Ativas" },
  { valor: "inativas", rotulo: "Inativas" },
  { valor: "todas", rotulo: "Todas" },
]
type Ordem = "nome" | "tom"

// Preferência de quem está no navegador; sem storage, fica em "nome".
const CHAVE_ORDEM = "terapias:ordem"

export function TerapiasCadastro() {
  const { terapias, loading, error, migrationPendente, recarregar } = useCadastroTerapias()
  const [busca, setBusca] = useState("")
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos")
  const [modal, setModal] = useState<{ terapia?: CadastroTerapia } | null>(null)
  const [situacao, setSituacao] = useState<FiltroSituacao>("ativas")
  const [verHistorico, setVerHistorico] = useState(false)
  const [ordem, setOrdem] = useState<Ordem>("nome")
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- lê storage externo só após hidratar
      if (localStorage.getItem(CHAVE_ORDEM) === "tom") setOrdem("tom")
    } catch { /* sem storage */ }
  }, [])
  const trocarOrdem = (o: Ordem) => {
    setOrdem(o)
    try { localStorage.setItem(CHAVE_ORDEM, o) } catch { /* só não lembra */ }
  }

  const filtradas = useMemo(() => {
    const q = normTxt(busca)
    const lista = terapias.filter(t =>
      (filtroTipo === "todos" || t.tipo === filtroTipo)
      && (situacao === "todas" || t.ativo === (situacao === "ativas"))
      && (!q || normTxt(t.nome).includes(q))
    )
    return ordem === "tom"
      ? [...lista].sort((a, b) => compararTom(a.cor_hex, b.cor_hex) || a.nome.localeCompare(b.nome, "pt-BR"))
      : lista
  }, [terapias, busca, filtroTipo, situacao, ordem])

  // Cada contador respeita o OUTRO filtro: o de tipo conta dentro da situação
  // escolhida, e o de situação conta dentro do tipo escolhido.
  const naSituacao = (t: CadastroTerapia, s: FiltroSituacao) => s === "todas" || t.ativo === (s === "ativas")
  const contagem = (tipo: FiltroTipo) =>
    terapias.filter(t => naSituacao(t, situacao) && (tipo === "todos" || t.tipo === tipo)).length
  const contagemSituacao = (s: FiltroSituacao) =>
    terapias.filter(t => naSituacao(t, s) && (filtroTipo === "todos" || t.tipo === filtroTipo)).length

  const salvar = async (input: CadastroTerapiaEdit) => {
    if (modal?.terapia) {
      await atualizarTerapia(modal.terapia, input)
      toast.success("Terapia atualizada.")
    } else {
      await criarTerapia(input)
      toast.success("Terapia cadastrada.")
    }
    await recarregar()
  }

  const alternarAtivo = async (t: CadastroTerapia) => {
    try {
      await atualizarTerapia(t, { ativo: !t.ativo })
      toast.success(t.ativo ? `"${t.nome}" inativada.` : `"${t.nome}" reativada.`)
      await recarregar()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
    }
  }

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  if (migrationPendente) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <InlineNotice tone="amber" icon={<Database className="h-4 w-4" />}>
          O Cadastro de Terapias ainda não existe neste banco. Aplique a migration
          <strong> 20261006120000_cadastro_terapias.sql</strong> e recarregue a página.
        </InlineNotice>
      </div>
    )
  }

  if (error) {
    return <div className="p-8 text-center text-sm font-semibold text-red-600 dark:text-red-400">{error}</div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 animate-in fade-in duration-300 md:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-foreground">Terapias e procedimentos</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Nome e cor de cada terapia. Cadastrou? Já pode ser escolhida na disponibilidade dos
            profissionais, e a cor passa a destacar o card de quem a presta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVerHistorico(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            <History className="h-4 w-4" /> Histórico
          </button>
          <button
            onClick={() => setModal({})}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-bold text-white shadow-sm transition-all hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" /> Nova terapia
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Buscar terapia</span>
          <input
            type="search"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar terapia..."
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
          {(["todos", "terapia", "procedimento"] as FiltroTipo[]).map(t => (
            <button
              key={t}
              type="button"
              aria-pressed={filtroTipo === t}
              onClick={() => setFiltroTipo(t)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors ${
                filtroTipo === t
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {t === "todos" ? "Todas" : `${TIPO_TERAPIA_LABEL[t]}s`}
              <span className="tabular-nums opacity-70">{contagem(t)}</span>
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="group" aria-label="Filtrar por situação">
          {SITUACOES.map(({ valor, rotulo: rotuloSit }) => (
            <button
              key={valor}
              type="button"
              aria-pressed={situacao === valor}
              onClick={() => setSituacao(valor)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors ${
                situacao === valor ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {rotuloSit}
              <span className="tabular-nums opacity-70">{contagemSituacao(valor)}</span>
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-0.5 sm:ml-auto" role="group" aria-label="Ordenar">
          {([["nome", "Nome", ArrowDownAZ], ["tom", "Tom de cor", Palette]] as const).map(([valor, rotuloOrdem, Icone]) => (
            <button
              key={valor}
              type="button"
              aria-pressed={ordem === valor}
              onClick={() => trocarOrdem(valor)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors ${
                ordem === valor ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icone className="h-4 w-4" aria-hidden /> {rotuloOrdem}
            </button>
          ))}
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          <Palette className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          {busca
            ? "Nenhuma terapia encontrada com essa busca."
            : situacao === "inativas" ? "Nenhuma terapia inativa." : "Nenhuma terapia neste recorte."}
        </div>
      ) : (
        <>
          {situacao !== "ativas" && filtradas.some(t => !t.ativo) && (
            <p className="text-sm text-muted-foreground">
              Inativas não aparecem para escolha na disponibilidade; versões antigas que as usam continuam mostrando o nome e a cor.
            </p>
          )}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtradas.map(t => (
              <CartaoTerapia key={t.id} terapia={t} onEditar={() => setModal({ terapia: t })} onAlternar={() => alternarAtivo(t)} />
            ))}
          </ul>
        </>
      )}

      {modal && (
        <TerapiaModal terapia={modal.terapia} todas={terapias} onSalvar={salvar} onClose={() => setModal(null)} />
      )}

      {verHistorico && (
        <HistoricoCadastrosModal
          subtitulo="Alterações no cadastro de terapias."
          entidades={["terapia"]}
          onClose={() => setVerHistorico(false)}
        />
      )}
    </div>
  )
}

function CartaoTerapia({
  terapia,
  onEditar,
  onAlternar,
}: {
  terapia: CadastroTerapia
  onEditar: () => void
  onAlternar: () => void
}) {
  return (
    <li className={`group flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-slate-300 dark:hover:border-slate-600 ${terapia.ativo ? "" : "opacity-70"}`}>
      <button
        type="button"
        onClick={onEditar}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black/10 shadow-inner"
          style={{ backgroundColor: terapia.cor_hex, color: luminancia(terapia.cor_hex) > 0.45 ? "#0f172a" : "#ffffff" }}
          aria-hidden="true"
        >
          <IconeTerapia chave={terapia.icone} className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold text-foreground">{terapia.nome}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{terapia.cor_hex}</span>
            <span aria-hidden="true">·</span>
            {TIPO_TERAPIA_LABEL[terapia.tipo]}
            {terapia.tita_terapia_id && (
              <>
                <span aria-hidden="true">·</span>
                <span title="Id da terapia no TiTa" className="whitespace-nowrap">TiTa #{terapia.tita_terapia_id}</span>
              </>
            )}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={onEditar}
          title="Editar"
          aria-label={`Editar ${terapia.nome}`}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onAlternar}
          title={terapia.ativo ? "Inativar" : "Reativar"}
          aria-label={`${terapia.ativo ? "Inativar" : "Reativar"} ${terapia.nome}`}
          className={`rounded-lg p-2 text-slate-400 transition-colors ${
            terapia.ativo
              ? "hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              : "hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20"
          }`}
        >
          {terapia.ativo ? <Trash2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
        </button>
      </div>
    </li>
  )
}
