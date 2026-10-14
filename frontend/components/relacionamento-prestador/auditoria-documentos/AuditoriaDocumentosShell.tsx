"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, Building2, CalendarDays, ChevronRight, Copy, FileSearch, Loader2, RefreshCw, ScrollText, Search, ShieldCheck } from "lucide-react"
import toast from "react-hot-toast"
import { DatePicker } from "@/components/ui/date-picker"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { KpiFiltro } from "@/components/terapeutico/auditoria/KpiFiltro"
import { Paginacao, usePaginacao } from "@/components/terapeutico/auditoria/Paginacao"
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, CARTAO, FOCO, ROTULO } from "@/components/terapeutico/auditoria/vocabulario"
import { useToneColor } from "@/hooks/useToneColor"
import { ORDEM_SITUACAO, RELACAO, SIGLAS_PEP, SITUACAO, TOM_SITUACAO } from "@/lib/pepDocumentos/rotulos"
import { desatualizado, precisaAuditar, situacaoDoDocumento, type SituacaoAuditoria } from "@/lib/pepDocumentos/situacao"
import type { SemelhancaPep } from "@/lib/pepDocumentos/tipos"
import { mesBR, nomeCurtoPrestador } from "@/lib/roboSharepoint/rotulos"
import {
  auditarDocumentos, cancelarLote, carregarAuditoria, podeEscreverPep, progressoDoLote,
  type DadosAuditoria, type DocAuditoria, type Progresso,
} from "@/services/pepAuditoriaDocumentos.service"
import { DetalheDocumento, SeloSituacao, type OutroLado } from "./DetalheDocumento"
import { ModalReguas } from "./ModalReguas"

// Auditoria de Documentos PEP (15/10/2026). Molde: Auditoria de Evoluções
// (components/terapeutico/auditoria/AuditoriaEvolucoesShell.tsx) — cartões que
// filtram, abas, "Auditar N" com o progresso no botão, réguas versionadas.
//
// A leitura é do robô (automática); a auditoria é sob comando: documento lido
// fica "Lido, não auditado" até alguém clicar em Auditar. Cobre TODOS os
// documentos lidos — inclusive os de pastas sem planilha, que a tela Entregas
// PEP não alcança (ela organiza por analista reconhecido).

type Aba = "prestadores" | "documentos" | "duplicados"
type Recorte = { mes: string; prest: string[]; sigla: string; sit: SituacaoAuditoria | "desatualizado" | ""; q: string; aba: Aba }

const SEM_PRESTADOR = "sem"
const POR_PAGINA = 50

function lerRecorte(p: URLSearchParams): Recorte {
  const aba = p.get("aba")
  const sit = p.get("sit") ?? ""
  const sigla = (p.get("sigla") ?? "").toUpperCase()
  return {
    mes: /^\d{4}-\d{2}$/.test(p.get("mes") ?? "") ? p.get("mes")! : "",
    prest: (p.get("prest") ?? "").split(",").filter(Boolean),
    sigla: (SIGLAS_PEP as readonly string[]).includes(sigla) ? sigla : "",
    sit: ([...ORDEM_SITUACAO, "desatualizado"] as string[]).includes(sit) ? (sit as Recorte["sit"]) : "",
    q: p.get("q") ?? "",
    aba: aba === "documentos" || aba === "duplicados" ? aba : "prestadores",
  }
}

function escreverRecorte(r: Recorte): string {
  const p = new URLSearchParams()
  if (r.mes) p.set("mes", r.mes)
  if (r.prest.length) p.set("prest", r.prest.join(","))
  if (r.sigla) p.set("sigla", r.sigla)
  if (r.sit) p.set("sit", r.sit)
  if (r.q) p.set("q", r.q)
  if (r.aba !== "prestadores") p.set("aba", r.aba)
  const s = p.toString()
  return s ? `?${s}` : ""
}

const normal = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

type Linha = {
  d: DocAuditoria
  sit: SituacaoAuditoria
  desat: boolean
  precisa: boolean
  prestKey: string
  prestNome: string
  semPlanilha: boolean
  pares: SemelhancaPep[]
}

export function AuditoriaDocumentosShell() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const recorte = useMemo(() => lerRecorte(new URLSearchParams(params.toString())), [params])
  const aplicar = useCallback((mudanca: Partial<Recorte>) => {
    router.replace(`${pathname}${escreverRecorte({ ...recorte, ...mudanca })}`, { scroll: false })
  }, [router, pathname, recorte])

  const [dados, setDados] = useState<DadosAuditoria | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [podeEscrever, setPodeEscrever] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)
  const [reguasAbertas, setReguasAbertas] = useState(false)
  const [busca, setBusca] = useState(recorte.q)
  const [lote, setLote] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const [enviando, setEnviando] = useState(false)
  const toneColor = useToneColor()

  const recarregar = useCallback(async () => {
    try {
      setDados(await carregarAuditoria())
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os documentos.")
    }
  }, [])
  useEffect(() => { void recarregar() }, [recarregar])
  useEffect(() => { void podeEscreverPep().then(setPodeEscrever).catch(() => setPodeEscrever(false)) }, [])

  // Busca vai para a URL depois de 350 ms parado (como em evoluções).
  useEffect(() => {
    if (busca === recorte.q) return
    const t = setTimeout(() => aplicar({ q: busca }), 350)
    return () => clearTimeout(t)
  }, [busca, recorte.q, aplicar])

  // Progresso do lote: pergunta a cada 5 s até a fila do lote esvaziar.
  useEffect(() => {
    if (!lote) return
    let vivo = true
    const tique = async () => {
      try {
        const p = await progressoDoLote(lote)
        if (!vivo) return
        setProgresso(p)
        if (p.pendentes === 0) {
          setLote(null)
          await recarregar()
          toast.success(`Auditoria concluída: ${p.feitos} documento(s)${p.falhas ? `, ${p.falhas} com falha` : ""}.`)
        }
      } catch { /* tenta no próximo tique */ }
    }
    void tique()
    const id = setInterval(tique, 5000)
    return () => { vivo = false; clearInterval(id) }
  }, [lote, recarregar])

  // ── Linhas ──────────────────────────────────────────────────────────────────
  const reguaVigente = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of dados?.reguas ?? []) if (!m.has(r.sigla)) m.set(r.sigla, `${r.sigla}@v${r.versao}`)
    return m
  }, [dados])

  const todas = useMemo<Linha[]>(() => {
    if (!dados) return []
    const paresDe = new Map<string, SemelhancaPep[]>()
    for (const p of dados.pares) for (const id of [p.a_sp_id, p.b_sp_id]) paresDe.set(id, [...(paresDe.get(id) ?? []), p])
    return dados.docs.map(d => {
      const rv = reguaVigente.get((d.item.sigla ?? "").toUpperCase()) ?? null
      const pasta = d.item.prestador_pasta_id
      return {
        d,
        sit: situacaoDoDocumento(d),
        desat: desatualizado(d, rv),
        precisa: precisaAuditar(d, rv),
        prestKey: pasta ?? SEM_PRESTADOR,
        prestNome: d.item.prestador_nome ?? (pasta ? nomeCurtoPrestador(d.prestador?.nome_pasta) : "Fora de uma pasta de prestador"),
        semPlanilha: !d.item.prestador_nome && (d.prestador?.motivo === "planilha_ausente" || !d.prestador?.status),
        pares: paresDe.get(d.sp_id) ?? [],
      }
    })
  }, [dados, reguaVigente])

  // Recorte SEM o filtro de situação: é sobre ele que os cartões contam.
  const noRecorte = useMemo(() => {
    const prest = new Set(recorte.prest)
    const q = normal(recorte.q)
    return todas.filter(l =>
      (!recorte.mes || l.d.item.competencia === recorte.mes) &&
      (prest.size === 0 || prest.has(l.prestKey)) &&
      (!recorte.sigla || (l.d.item.sigla ?? "").toUpperCase() === recorte.sigla) &&
      (!q || normal(`${l.d.item.nome} ${l.d.item.paciente_nome ?? ""} ${l.prestNome}`).includes(q)))
  }, [todas, recorte])

  const visiveis = useMemo(() => {
    if (!recorte.sit) return noRecorte
    if (recorte.sit === "desatualizado") return noRecorte.filter(l => l.desat)
    return noRecorte.filter(l => l.sit === recorte.sit)
  }, [noRecorte, recorte.sit])

  const conta = useMemo(() => {
    const c = Object.fromEntries(ORDEM_SITUACAO.map(s => [s, 0])) as Record<SituacaoAuditoria, number>
    for (const l of noRecorte) c[l.sit]++
    return c
  }, [noRecorte])

  const paresNoRecorte = useMemo(() => {
    const ids = new Set(noRecorte.map(l => l.d.sp_id))
    return (dados?.pares ?? []).filter(p => (ids.has(p.a_sp_id) || ids.has(p.b_sp_id)) && p.revisao_status !== "falso_positivo")
  }, [dados, noRecorte])

  const paraAuditar = useMemo(() => visiveis.filter(l => l.precisa).map(l => l.d.sp_id), [visiveis])
  const desatualizadosPorSigla = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of todas) if (l.desat && l.d.ia_status !== "nao_se_aplica") { const s = l.d.item.sigla ?? "—"; m[s] = (m[s] ?? 0) + 1 }
    return m
  }, [todas])

  const docPorId = useMemo(() => new Map(todas.map(l => [l.d.sp_id, l])), [todas])
  const outroLado = useCallback((spId: string): OutroLado | undefined => {
    const l = docPorId.get(spId)
    return l ? { sp_id: spId, nome: l.d.item.nome, sigla: l.d.item.sigla, competencia: l.d.item.competencia, prestador: l.prestNome, paciente: l.d.item.paciente_nome } : undefined
  }, [docPorId])

  const opcoesPrestador = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of todas) m.set(l.prestKey, l.prestNome)
    return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [todas])

  // ── Ações ───────────────────────────────────────────────────────────────────
  const auditar = useCallback(async (spIds: string[], forcar = false) => {
    if (spIds.length === 0) return
    setEnviando(true)
    try {
      const r = await auditarDocumentos(spIds, forcar)
      if (!r.lote || r.enfileirados === 0) {
        toast("Nada a auditar: esses documentos já estão em dia.")
        return
      }
      setProgresso({ total: r.enfileirados, pendentes: r.enfileirados, feitos: 0, falhas: 0, cancelados: 0 })
      setLote(r.lote)
      await recarregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível auditar.")
    } finally {
      setEnviando(false)
    }
  }, [recarregar])

  async function cancelar() {
    if (!lote) return
    try {
      const r = await cancelarLote(lote)
      toast.success(`${r.cancelados} documento(s) saíram da fila.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.")
    }
  }

  // ── Tela ────────────────────────────────────────────────────────────────────
  if (dados && !dados.disponivel) {
    return (
      <div className={`${CARTAO} p-6 text-sm text-muted-foreground`}>
        A Auditoria de Documentos ainda não está disponível neste ambiente (falta aplicar a migration 20261015100000).
      </div>
    )
  }

  const linhaAberta = aberto ? docPorId.get(aberto) ?? null : null
  const feitoPct = progresso && progresso.total > 0 ? Math.round(((progresso.total - progresso.pendentes) / progresso.total) * 100) : 0
  const sitCartao = (s: Recorte["sit"]) => () => aplicar({ sit: recorte.sit === s ? "" : s, aba: recorte.aba === "duplicados" ? "documentos" : recorte.aba })

  return (
    <div className="space-y-4">
      {erro && (
        <p className={`rounded-lg px-3 py-2 text-xs ring-1 ${TONE_PANEL.red.bg} ${TONE_PANEL.red.ring} ${TONE_CHIP.red.text}`}>{erro}</p>
      )}

      {/* Cartões que filtram (como em evoluções). */}
      {!dados ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, k) => <div key={k} className="h-[104px] rounded-2xl border-2 border-border bg-card motion-safe:animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <KpiFiltro rotulo="Lidos" valor={noRecorte.length} nota={`${noRecorte.filter(l => l.sit !== "ilegivel").length} com texto`}
            ativo={!recorte.sit} onClick={() => aplicar({ sit: "" })} rotuloFiltro="Mostrar tudo" />
          <KpiFiltro rotulo="Não auditados" valor={conta.nao_auditado}
            nota={[conta.na_fila ? `${conta.na_fila} na fila` : "", conta.falhou ? `${conta.falhou} com falha` : ""].filter(Boolean).join(" · ") || "Esperando o Auditar"} tom="gray"
            ativo={recorte.sit === "nao_auditado"} onClick={sitCartao("nao_auditado")} desabilitado={conta.nao_auditado === 0} rotuloFiltro="Ver os não auditados" />
          <KpiFiltro rotulo="Está bom" valor={conta.bom} nota="Passou nas conferências" tom="green" cor={conta.bom ? toneColor("green") : undefined}
            ativo={recorte.sit === "bom"} onClick={sitCartao("bom")} desabilitado={conta.bom === 0} rotuloFiltro="Ver os que estão bons" />
          <KpiFiltro rotulo="Pode conter erros" valor={conta.pode_conter_erros} nota="Precisa de olho humano" tom="amber" cor={conta.pode_conter_erros ? toneColor("amber") : undefined}
            ativo={recorte.sit === "pode_conter_erros"} onClick={sitCartao("pode_conter_erros")} desabilitado={conta.pode_conter_erros === 0} rotuloFiltro="Ver os que podem conter erros" />
          <KpiFiltro rotulo="Está errado" valor={conta.errado} nota="Provado pelo trecho" tom="red" cor={conta.errado ? toneColor("red") : undefined}
            ativo={recorte.sit === "errado"} onClick={sitCartao("errado")} desabilitado={conta.errado === 0} rotuloFiltro="Ver os errados" />
          <KpiFiltro rotulo="Não foi possível ler" valor={conta.ilegivel} nota="Escaneado, foto, senha" tom="gray"
            ativo={recorte.sit === "ilegivel"} onClick={sitCartao("ilegivel")} desabilitado={conta.ilegivel === 0} rotuloFiltro="Ver os ilegíveis" />
          <KpiFiltro rotulo="Cópias" valor={paresNoRecorte.length} nota="Pares de documentos parecidos" tom="purple" cor={paresNoRecorte.length ? toneColor("purple") : undefined}
            ativo={recorte.aba === "duplicados"} onClick={() => aplicar({ aba: "duplicados" })} desabilitado={paresNoRecorte.length === 0}
            rotuloFiltro="Ver as cópias" className="col-span-2 md:col-span-1" />
        </div>
      )}

      {/* Abas */}
      <div role="tablist" className="flex w-full items-center gap-5 overflow-x-auto border-b border-border">
        {([
          ["prestadores", "Por prestador", Building2],
          ["documentos", "Todos os documentos", FileSearch],
          ["duplicados", "Cópias", Copy],
        ] as const).map(([id, rotulo, Icone]) => (
          <button key={id} role="tab" type="button" aria-selected={recorte.aba === id} onClick={() => aplicar({ aba: id })}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-2 pt-1 text-xs transition ${FOCO} ${
              recorte.aba === id ? "border-brand-fg font-bold text-foreground" : "border-transparent font-semibold text-muted-foreground hover:text-foreground"}`}>
            <Icone className="h-4 w-4" aria-hidden /> {rotulo}
          </button>
        ))}
      </div>

      {/* Filtros e ações */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DatePicker
          apenasMes
          value={recorte.mes ? `${recorte.mes}-01` : ""}
          onChange={v => aplicar({ mes: v ? v.slice(0, 7) : "" })}
          classeGatilho={BOTAO_SECUNDARIO}
          rotuloGatilho={recorte.mes ? `Mês: ${mesBR(recorte.mes)}. Trocar` : "Filtrar por mês"}
          conteudoGatilho={<><CalendarDays className="h-3.5 w-3.5" aria-hidden />{recorte.mes ? mesBR(recorte.mes) : "Todos os meses"}</>}
        />
        <div className="w-full sm:w-64">
          <MultiSearchCombobox<string>
            opcoes={opcoesPrestador}
            selecionados={new Set(recorte.prest)}
            onToggle={id => aplicar({ prest: recorte.prest.includes(id) ? recorte.prest.filter(x => x !== id) : [...recorte.prest, id] })}
            onDesmarcarTodos={() => aplicar({ prest: [] })}
            placeholder="Todos os prestadores"
            ariaLabel="Filtrar por prestador"
            nomePlural="prestadores"
            adjetivoResumo="selecionados"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por documento">
          {SIGLAS_PEP.map(s => (
            <button key={s} type="button" aria-pressed={recorte.sigla === s} onClick={() => aplicar({ sigla: recorte.sigla === s ? "" : s })}
              className={`h-9 rounded-lg border px-2.5 text-xs font-semibold transition ${FOCO} ${
                recorte.sigla === s ? "border-brand-fg bg-brand-fg text-white" : "border-border bg-background text-foreground hover:bg-muted/40"}`}>
              {s}
            </button>
          ))}
        </div>
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Paciente, prestador ou arquivo"
            className="h-9 w-full rounded-lg bg-muted/50 pl-8 pr-2.5 text-xs placeholder:text-muted-foreground/70 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setReguasAbertas(true)} className={BOTAO_SECUNDARIO}>
            <ScrollText className="h-3.5 w-3.5" aria-hidden /> Réguas
          </button>
          <button type="button" onClick={() => void recarregar()} className={BOTAO_SECUNDARIO} aria-label="Atualizar">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button type="button" disabled={!!lote || enviando || paraAuditar.length === 0} onClick={() => void auditar(paraAuditar)}
            className={`${BOTAO_PRIMARIO} relative overflow-hidden`}
            title={paraAuditar.length ? "Audita os não auditados e os desatualizados do recorte" : "Nada a auditar neste recorte"}>
            {lote && <span className="absolute inset-y-0 left-0 bg-white/20 transition-[width]" style={{ width: `${feitoPct}%` }} aria-hidden />}
            <span className="relative inline-flex items-center gap-1.5">
              {lote || enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
              {lote && progresso ? `Auditando ${progresso.total - progresso.pendentes} de ${progresso.total}` : `Auditar ${paraAuditar.length}`}
            </span>
          </button>
        </div>
      </div>

      {lote && (
        <p className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${TONE_PANEL.blue.bg} ${TONE_PANEL.blue.ring} ${TONE_CHIP.blue.text}`}>
          <span>Auditando no servidor: pode sair desta tela, continua sozinho.</span>
          <button type="button" onClick={() => void cancelar()} className={`font-bold underline-offset-2 hover:underline ${FOCO}`}>Cancelar o restante</button>
        </p>
      )}
      {!lote && (desatualizadosPorSigla && Object.keys(desatualizadosPorSigla).length > 0) && (
        <p className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs ring-1 ${TONE_PANEL.amber.bg} ${TONE_PANEL.amber.ring} ${TONE_CHIP.amber.text}`}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Há documentos auditados com régua antiga ({Object.entries(desatualizadosPorSigla).map(([s, n]) => `${s}: ${n}`).join(", ")}).
          <button type="button" onClick={() => aplicar({ sit: "desatualizado", aba: "documentos" })} className={`font-bold underline-offset-2 hover:underline ${FOCO}`}>Ver e auditar de novo</button>
        </p>
      )}

      {!dados ? (
        <div className={`${CARTAO} space-y-2 p-4`}>{Array.from({ length: 6 }).map((_, k) => <div key={k} className="h-10 rounded-lg bg-muted motion-safe:animate-pulse" />)}</div>
      ) : recorte.aba === "prestadores" ? (
        <PorPrestador linhas={visiveis} onAbrir={key => aplicar({ prest: [key], aba: "documentos" })} />
      ) : recorte.aba === "documentos" ? (
        <ListaDocumentos linhas={visiveis} onAbrir={setAberto} />
      ) : (
        <ListaCopias pares={paresNoRecorte} outroLado={outroLado} onAbrir={setAberto} />
      )}

      {linhaAberta && (
        <DetalheDocumento
          doc={linhaAberta.d}
          situacao={linhaAberta.sit}
          desatualizado={linhaAberta.desat}
          pares={linhaAberta.pares}
          outroLado={outroLado}
          podeEscrever={podeEscrever}
          onFechar={() => setAberto(null)}
          onMudou={() => void recarregar()}
          onAuditar={auditar}
        />
      )}
      {reguasAbertas && dados && (
        <ModalReguas
          reguas={dados.reguas}
          podeEscrever={podeEscrever}
          desatualizadosPorSigla={desatualizadosPorSigla}
          siglaInicial={recorte.sigla || undefined}
          onFechar={() => setReguasAbertas(false)}
          onPublicada={() => void recarregar()}
        />
      )}
    </div>
  )
}

// ── Abas ──────────────────────────────────────────────────────────────────────

function PorPrestador({ linhas, onAbrir }: { linhas: Linha[]; onAbrir: (key: string) => void }) {
  const grupos = useMemo(() => {
    const m = new Map<string, { nome: string; semPlanilha: boolean; linhas: Linha[] }>()
    for (const l of linhas) {
      const g = m.get(l.prestKey) ?? { nome: l.prestNome, semPlanilha: l.semPlanilha, linhas: [] }
      g.linhas.push(l)
      m.set(l.prestKey, g)
    }
    const peso = (g: { linhas: Linha[] }) => g.linhas.filter(l => l.sit === "errado").length * 1000 + g.linhas.filter(l => l.sit === "pode_conter_erros").length
    return [...m].sort((a, b) => peso(b[1]) - peso(a[1]) || a[1].nome.localeCompare(b[1].nome))
  }, [linhas])

  if (grupos.length === 0) return <p className={`${CARTAO} p-6 text-center text-sm text-muted-foreground`}>Nenhum documento neste recorte.</p>
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {grupos.map(([key, g]) => {
        const c = (s: SituacaoAuditoria) => g.linhas.filter(l => l.sit === s).length
        return (
          <button key={key} type="button" onClick={() => onAbrir(key)}
            className={`${CARTAO} flex flex-col gap-3 p-4 text-left transition hover:-translate-y-px hover:shadow-md ${FOCO}`}>
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{g.nome}</span>
                <span className="text-xs text-muted-foreground">{g.linhas.length} documento(s)</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </span>
            {g.semPlanilha && <StatusChip tone="amber" dense>Pasta sem planilha: prestador não reconhecido</StatusChip>}
            <span className="flex flex-wrap gap-1.5">
              {ORDEM_SITUACAO.filter(s => c(s) > 0).map(s => (
                <StatusChip key={s} tone={TOM_SITUACAO[s]} dense>{SITUACAO[s].rotulo} {c(s)}</StatusChip>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ListaDocumentos({ linhas, onAbrir }: { linhas: Linha[]; onAbrir: (spId: string) => void }) {
  const ordenadas = useMemo(() => linhas.slice().sort((a, b) =>
    ORDEM_SITUACAO.indexOf(a.sit) - ORDEM_SITUACAO.indexOf(b.sit) || a.prestNome.localeCompare(b.prestNome) || a.d.item.nome.localeCompare(b.d.item.nome)), [linhas])
  const { pagina, setPagina, totalPaginas, fatia } = usePaginacao(ordenadas, POR_PAGINA)
  if (linhas.length === 0) return <p className={`${CARTAO} p-6 text-center text-sm text-muted-foreground`}>Nenhum documento neste recorte.</p>
  return (
    <div className={`${CARTAO} overflow-hidden`}>
      <ul className="divide-y divide-border">
        {fatia.map(l => {
          const erros = l.d.achados.filter(a => a.nivel === "errado").length + l.pares.filter(p => p.nivel === "errado" && p.revisao_status !== "falso_positivo").length
          const olhar = l.d.achados.filter(a => a.nivel === "atencao").length + l.d.ia_achados.length
          return (
            <li key={l.d.sp_id}>
              <button type="button" onClick={() => onAbrir(l.d.sp_id)}
                className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40 ${FOCO}`}>
                <SeloSituacao situacao={l.sit} dense />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {l.d.item.sigla ?? "—"} · {l.d.item.paciente_nome ?? (l.d.item.sigla === "STC" || l.d.item.sigla === "ETC" ? "Geral" : "Paciente não identificado")}
                    <span className="font-normal text-muted-foreground"> · {mesBR(l.d.item.competencia)} · {l.prestNome}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" title={l.d.item.nome}>{l.d.item.nome}</span>
                </span>
                <span className="hidden shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                  {erros > 0 && <span className={`block font-bold ${TONE_CHIP.red.text}`}>{erros} erro(s)</span>}
                  {olhar > 0 && <span className="block">{olhar} para olhar</span>}
                  {l.desat && <span className="block">régua antiga</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={ordenadas.length} porPagina={POR_PAGINA} onMudar={setPagina} rotuloItem={["documento", "documentos"]} />
    </div>
  )
}

function ListaCopias({ pares, outroLado, onAbrir }: {
  pares: SemelhancaPep[]
  outroLado: (spId: string) => OutroLado | undefined
  onAbrir: (spId: string) => void
}) {
  const ordenados = useMemo(() => pares.slice().sort((a, b) => (a.nivel === b.nivel ? b.similaridade - a.similaridade : a.nivel === "errado" ? -1 : 1)), [pares])
  if (pares.length === 0) return <p className={`${CARTAO} p-6 text-center text-sm text-muted-foreground`}>Nenhuma cópia neste recorte. As cópias aparecem depois da auditoria.</p>
  const lado = (id: string) => {
    const o = outroLado(id)
    return o ? `${o.sigla ?? "—"} · ${o.paciente ?? "Geral"} · ${mesBR(o.competencia)} · ${o.prestador ?? ""}` : id
  }
  return (
    <ul className="space-y-2">
      {ordenados.map(p => (
        <li key={`${p.a_sp_id}${p.b_sp_id}`}>
          <button type="button" onClick={() => onAbrir(p.a_sp_id)}
            className={`${CARTAO} flex w-full flex-col gap-1.5 p-4 text-left transition hover:shadow-md ${FOCO}`}>
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip tone={p.nivel === "errado" ? "red" : "amber"} dense>
                {p.tipo === "identico" ? "Arquivo idêntico" : `${Math.round(p.similaridade * 100)}% igual`}
              </StatusChip>
              <span className={ROTULO}>documento {RELACAO[p.relacao]}</span>
            </span>
            <span className="text-sm"><strong>Referência:</strong> {lado(p.a_sp_id)}</span>
            <span className="text-sm text-muted-foreground">× {lado(p.b_sp_id)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

