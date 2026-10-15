"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, ExternalLink, Eye, History, Loader2, Search,
  type LucideIcon,
} from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { InlineNotice } from "@/components/cronograma/ui/InlineNotice"

// Relatório "Sincronização do TiTa": Última execução / Histórico, cartões
// (Novos · Alterados · … · No TiTa) e listas que abrem com busca. Um formato
// neutro (RodadaRelatorio) e um adaptador por domínio: pacientes, cadastro de
// profissionais, disponibilidade — e, na Etapa 2, a agenda.

export type MudancaRelatorio = { campo: string; de?: string | null; para?: string | null }

export type ItemRelatorio = {
  chave: string
  nome: string
  href?: string | null
  /** Linha pequena abaixo do nome (ex.: "ID TiTa 123 · CPF ***.456.789-**"). */
  subtitulo?: string | null
  /** Texto pequeno à direita do nome (ex.: "ID TiTa 123"). */
  direita?: string | null
  /** Selo colorido à direita (ex.: "Novo"). */
  selo?: string | null
  mudancas?: MudancaRelatorio[]
  /** Pílulas (ex.: "+Celular", "Habilita ABA"). */
  etiquetas?: string[]
  erro?: string | null
}

export type TomSecao = "verde" | "primario" | "ambar" | "cinza"

export type SecaoRelatorio = {
  chave: string
  /** Título da sanfona (ex.: "Novos Pacientes"). */
  titulo: string
  /** Rótulo do cartão no topo (ex.: "Novos"). Sem rótulo = sem cartão. */
  rotuloCartao?: string
  total: number
  tom: TomSecao
  Icone: LucideIcon
  itens: ItemRelatorio[]
  dicaFechada: string
  vazio: string
  buscaPlaceholder: string
  semResultado: string
  /**
   * Mudança só com "para": o texto antes do valor. Padrão "preenchido com"
   * (pacientes). null = mostra o valor sozinho.
   */
  rotuloSoPara?: string | null
}

export type SituacaoRodada = "previa" | "sucesso" | "parcial" | "erro" | "em_andamento"

export type RodadaRelatorio = {
  id: string
  iniciadoEm: string
  situacao: SituacaoRodada
  /** "Disparo manual" / "Automático (rotina 04:00)". */
  origemLonga: string
  /** "Manual" / "Automático (04:00)" — no histórico. */
  origemCurta: string
  usuarioNome: string | null
  erroMensagem: string | null
  noTita: number
  /** Texto extra sob o cabeçalho (ex.: "Vale a partir de 16/10/2026"). */
  nota?: string | null
  secoes: SecaoRelatorio[]
  /** Contadores do histórico (ex.: ["0 novos", "2 atualizados"]). */
  resumoHistorico: string[]
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  } catch {
    return iso
  }
}

const TONS: Record<TomSecao, { icone: string; selo: string; cartaoAberto: string }> = {
  verde: {
    icone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    selo: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    cartaoAberto: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  primario: {
    icone: "bg-primary/10 text-primary",
    selo: "bg-primary/10 text-primary",
    cartaoAberto: "border-primary/40 bg-primary/10 text-primary",
  },
  ambar: {
    icone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    selo: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
    cartaoAberto: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  },
  cinza: {
    icone: "bg-muted text-muted-foreground",
    selo: "bg-muted text-muted-foreground",
    cartaoAberto: "border-border bg-muted text-foreground",
  },
}

function SeloSituacao({ situacao }: { situacao: SituacaoRodada }) {
  if (situacao === "sucesso") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> Sucesso
      </span>
    )
  }
  if (situacao === "parcial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" /> Concluído com falhas
      </span>
    )
  }
  if (situacao === "previa") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
        <Eye className="h-3.5 w-3.5" /> Prévia — nada gravado ainda
      </span>
    )
  }
  if (situacao === "em_andamento") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Em andamento
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
      <AlertCircle className="h-3.5 w-3.5" /> Falhou
    </span>
  )
}

function Mudanca({ m, rotuloSoPara }: { m: MudancaRelatorio; rotuloSoPara: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="font-semibold text-foreground">{m.campo}:</span>
      {m.de && m.para ? (
        <>
          <span className="line-through opacity-70">{m.de}</span>
          <span className="text-primary font-bold">➔</span>
          <span className="font-medium text-foreground">{m.para}</span>
        </>
      ) : m.para ? (
        rotuloSoPara === null
          ? <span className="font-medium text-foreground">{m.para}</span>
          : <span className="font-medium text-primary">{rotuloSoPara} {m.para}</span>
      ) : m.de ? (
        <>
          <span className="line-through opacity-70">{m.de}</span>
          <span className="font-medium text-destructive">removida</span>
        </>
      ) : null}
    </div>
  )
}

function Secao({ s, aberta, onAlternar, onNavegar }: { s: SecaoRelatorio; aberta: boolean; onAlternar: () => void; onNavegar?: () => void }) {
  const [busca, setBusca] = useState("")
  const t = TONS[s.tom]
  const rotuloSoPara = s.rotuloSoPara === undefined ? "preenchido com" : s.rotuloSoPara
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return s.itens
    return s.itens.filter(i =>
      i.nome.toLowerCase().includes(termo)
      || (i.subtitulo ?? "").toLowerCase().includes(termo)
      || (i.direita ?? "").toLowerCase().includes(termo)
      || (i.etiquetas ?? []).some(e => e.toLowerCase().includes(termo))
      || (i.mudancas ?? []).some(m => m.campo.toLowerCase().includes(termo) || (m.para ?? "").toLowerCase().includes(termo)))
  }, [s.itens, busca])

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden transition-all">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-center justify-between p-3.5 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={aberta}
      >
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${t.icone}`}>
            <s.Icone className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">{s.titulo}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${t.selo}`}>{s.total}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{aberta ? "Toque para fechar a lista" : s.dicaFechada}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-[11px] font-medium hidden sm:inline">{aberta ? "Recolher" : "Ver lista"}</span>
          {aberta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {aberta && (
        <div className="border-t border-border/70 p-3 space-y-2.5 bg-muted/10">
          {s.itens.length > 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder={s.buscaPlaceholder}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {filtrados.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-center text-xs text-muted-foreground">
              {busca ? s.semResultado : s.vazio}
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border bg-card max-h-80 overflow-y-auto">
              {filtrados.map(i => (
                <li key={i.chave} className="p-3 text-xs space-y-1.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      {i.href ? (
                        <Link href={i.href} className="font-medium text-foreground hover:text-primary hover:underline flex items-center gap-1" onClick={onNavegar}>
                          <span className="truncate">{i.nome}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-foreground">{i.nome}</span>
                      )}
                      {i.subtitulo && <p className="mt-0.5 text-[11px] text-muted-foreground">{i.subtitulo}</p>}
                    </div>
                    {i.selo ? (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.selo}`}>{i.selo}</span>
                    ) : i.direita ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{i.direita}</span>
                    ) : null}
                  </div>
                  {i.mudancas && i.mudancas.length > 0 && (
                    <div className="mt-1 space-y-1 rounded bg-muted/40 p-2">
                      {i.mudancas.map((m, idx) => <Mudanca key={idx} m={m} rotuloSoPara={rotuloSoPara} />)}
                    </div>
                  )}
                  {i.etiquetas && i.etiquetas.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {i.etiquetas.map(e => (
                        <span key={e} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{e}</span>
                      ))}
                    </div>
                  )}
                  {i.erro && (
                    <p className="flex items-start gap-1 text-[11px] font-medium text-destructive">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {i.erro}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Cabeçalho + cartões + listas de UMA rodada (usado também na prévia, antes de gravar). */
export function CorpoRelatorio({ rodada, onNavegar }: { rodada: RodadaRelatorio; onNavegar?: () => void }) {
  // Quem usa passa key={rodada.id}: trocar de rodada recomeça com tudo fechado.
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const alternar = (chave: string) =>
    setAbertas(prev => {
      const n = new Set(prev)
      if (n.has(chave)) n.delete(chave)
      else n.add(chave)
      return n
    })
  const cartoes = rodada.secoes.filter(s => s.rotuloCartao)

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeloSituacao situacao={rodada.situacao} />
              <span className="text-xs text-muted-foreground">{rodada.origemLonga}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {formatarDataHora(rodada.iniciadoEm)}
              {rodada.usuarioNome && ` · por ${rodada.usuarioNome}`}
            </p>
            {rodada.nota && <p className="mt-1 text-xs text-muted-foreground">{rodada.nota}</p>}
          </div>
        </div>

        {rodada.erroMensagem && (
          <InlineNotice tone="red" icon={<AlertCircle className="h-4 w-4" />}>
            {rodada.erroMensagem}
          </InlineNotice>
        )}

        <div className="grid gap-2 pt-1 border-t border-border/60" style={{ gridTemplateColumns: `repeat(${cartoes.length + 1}, minmax(0, 1fr))` }}>
          {cartoes.map(s => {
            const aberta = abertas.has(s.chave)
            return (
              <button
                key={s.chave}
                type="button"
                onClick={() => alternar(s.chave)}
                className={`rounded-lg p-2.5 text-center transition-all border ${
                  aberta ? TONS[s.tom].cartaoAberto : "border-transparent bg-muted/40 hover:bg-muted/70 text-foreground cursor-pointer"
                }`}
                title={`Clique para abrir ou recolher a lista: ${s.titulo.toLowerCase()}`}
              >
                <div className="text-lg font-bold tabular-nums">{s.total}</div>
                <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  {s.rotuloCartao} <span className="text-[10px]">{aberta ? "▲" : "▼"}</span>
                </div>
              </button>
            )
          })}
          <div className="rounded-lg bg-muted/40 p-2.5 text-center">
            <div className="text-lg font-bold text-foreground tabular-nums">{rodada.noTita}</div>
            <div className="text-[11px] text-muted-foreground">No TiTa</div>
          </div>
        </div>
      </div>

      {rodada.secoes.map(s => (
        <Secao key={s.chave} s={s} aberta={abertas.has(s.chave)} onAlternar={() => alternar(s.chave)} onNavegar={onNavegar} />
      ))}
    </>
  )
}

/**
 * Drawer com Última execução / Histórico. `rodadas[0]` é a mais recente.
 * `detalhar` carrega as listas de uma rodada do histórico sob demanda
 * (pacientes já vêm com tudo; disponibilidade busca os itens).
 */
export function RelatorioSincronizacaoTita({
  titulo = "Sincronização do TiTa",
  subtitulo = "Detalhes das alterações trazidas da cópia da agenda do TiTa.",
  rodadas,
  detalhar,
  vazio,
  onClose,
}: {
  titulo?: string
  subtitulo?: string
  rodadas: RodadaRelatorio[]
  detalhar?: (r: RodadaRelatorio) => Promise<RodadaRelatorio>
  vazio: ReactNode
  onClose: () => void
}) {
  const [aba, setAba] = useState<"mudancas" | "historico">("mudancas")
  const [selecionadaId, setSelecionadaId] = useState<string | null>(rodadas[0]?.id ?? null)
  const [detalhadas, setDetalhadas] = useState<Map<string, RodadaRelatorio>>(new Map())
  const [erros, setErros] = useState<Map<string, string>>(new Map())

  const base = rodadas.find(r => r.id === selecionadaId) ?? rodadas[0] ?? null
  const ativa = base ? detalhadas.get(base.id) ?? base : null
  const erro = base ? erros.get(base.id) ?? null : null
  const carregando = !!base && !!detalhar && !detalhadas.has(base.id) && !erro

  useEffect(() => {
    if (!base || !detalhar || detalhadas.has(base.id) || erros.has(base.id)) return
    let vivo = true
    detalhar(base)
      .then(r => { if (vivo) setDetalhadas(prev => new Map(prev).set(base.id, r)) })
      .catch(e => { if (vivo) setErros(prev => new Map(prev).set(base.id, e instanceof Error ? e.message : String(e))) })
    return () => { vivo = false }
  }, [base, detalhar, detalhadas, erros])

  const abaClasse = (sel: boolean) =>
    `border-b-2 px-3 pb-2.5 transition-colors ${sel ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`

  return (
    <Drawer title={titulo} subtitle={subtitulo} width="min(560px, 95vw)" onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex border-b border-border text-sm font-medium">
          <button type="button" onClick={() => setAba("mudancas")} className={abaClasse(aba === "mudancas")}>Última Execução</button>
          <button type="button" onClick={() => setAba("historico")} className={abaClasse(aba === "historico")}>Histórico ({rodadas.length})</button>
        </div>

        {aba === "historico" ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Selecione uma rodada para inspecionar as alterações registradas:</p>
            {rodadas.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma execução anterior encontrada no registro.</p>
            ) : (
              rodadas.map(h => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => { setSelecionadaId(h.id); setAba("mudancas") }}
                  className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                    h.id === ativa?.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      {h.situacao === "sucesso" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : h.situacao === "parcial" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      {formatarDataHora(h.iniciadoEm)}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{h.origemCurta}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {h.resumoHistorico.map((t, i) => (
                      <span key={t} className="flex items-center gap-3">{i > 0 && <span>·</span>}<span>{t}</span></span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : !ativa ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <History className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Nenhuma importação registrada</p>
            <p className="text-xs text-muted-foreground max-w-xs">{vazio}</p>
          </div>
        ) : (
          <>
            {erro && <InlineNotice tone="red" icon={<AlertCircle className="h-4 w-4" />}>{erro}</InlineNotice>}
            {carregando && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando as listas…</p>
            )}
            <CorpoRelatorio key={ativa.id} rodada={ativa} onNavegar={onClose} />
          </>
        )}
      </div>
    </Drawer>
  )
}
