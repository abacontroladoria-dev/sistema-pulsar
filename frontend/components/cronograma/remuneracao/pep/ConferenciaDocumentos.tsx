"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, Bot, CheckCircle2, ChevronRight, Copy, ExternalLink, FileQuestion, Hourglass, Loader2, RefreshCw,
  ScanText, ShieldCheck, Sparkles, XCircle,
} from "lucide-react"
import toast from "react-hot-toast"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/useModalLayer"
import { CabecalhoPastel, PilulaFiltro, SecaoPastel, tom, type Tom } from "@/components/ui/pastel/pecas"
import { usePepDocumentos } from "@/hooks/usePepDocumentos"
import { EXTRACAO_STATUS, RELACAO, REVISAO, SIGLAS_COM_REGUA, VEREDITO } from "@/lib/pepDocumentos/rotulos"
import type { Achado, DocumentoPep, RevisaoStatus, SemelhancaPep, Veredito } from "@/lib/pepDocumentos/tipos"
import { mesBR } from "@/lib/roboSharepoint/rotulos"
import {
  compararDocumentos, reanalisarDocumento, revisarDocumento, revisarSemelhanca, type Comparacao, type OutroDocumento,
} from "@/services/pepDocumentos.service"
import type { SpItem } from "@/types/roboSharepoint"

// "Conferência dos documentos" (14/10/2026): o robô lê cada evidência e o
// Pulsar aponta o que está bom, o que pode conter erros e o que está errado
// — com o trecho que prova. É INDICAÇÃO: não muda entrega nem valor.
// Desenho: kit pastel da PEP (verde = bom, âmbar = olhar, vermelho = errado,
// cinza = não deu para ler). Detalhe em painel lateral; cópia lado a lado no
// comparador, como "Evolução duplicada entre pacientes" da auditoria.

type Situacao = Veredito | "aguardando"

const SITUACAO: Record<Situacao, { t: Tom; Icone: typeof Bot }> = {
  bom: { t: "verde", Icone: CheckCircle2 },
  pode_conter_erros: { t: "amber", Icone: AlertTriangle },
  errado: { t: "vermelho", Icone: XCircle },
  ilegivel: { t: "cinza", Icone: FileQuestion },
  aguardando: { t: "aco", Icone: Hourglass },
}
const ORDEM: Situacao[] = ["errado", "pode_conter_erros", "ilegivel", "aguardando", "bom"]

const dataBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"
const pct = (n: number) => `${Math.round(n * 100)}%`

function situacaoDe(doc: DocumentoPep | undefined): Situacao {
  if (!doc || !doc.veredito) return "aguardando"
  return doc.veredito
}

export function SeloSituacao({ situacao, grande = false }: { situacao: Situacao; grande?: boolean }) {
  const { t, Icone } = SITUACAO[situacao]
  return (
    <span className={`${tom(t)} inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--c-suave)] font-extrabold text-[var(--c-tinta)] ring-1 ring-[var(--c-linha)] ${grande ? "h-9 px-3.5 text-sm" : "h-7 px-2.5 text-xs"}`}>
      <Icone className={grande ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      {VEREDITO[situacao].rotulo}
    </span>
  )
}

function BotaoSharepoint({ url }: { url: string | null | undefined }) {
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`${tom("aco")} pp-btn pp-btn-suave min-h-11 text-[13px]`}>
      <ExternalLink className="h-4 w-4" aria-hidden /> Abrir no SharePoint
    </a>
  )
}

export function ConferenciaDocumentos({ itens, catalogoSiglas }: {
  /** Arquivos do robô para o analista e o mês abertos. */
  itens: SpItem[]
  /** sigla por item_id, para o título. */
  catalogoSiglas: Map<string, string>
}) {
  // Só evidências que ainda estão na pasta: o que foi ignorado ou apagado não se confere.
  const evidencias = useMemo(
    () => itens.filter(i => i.tipo === "evidencia" && !i.removido_em && i.status !== "ignorado" && i.status !== "removido"),
    [itens]
  )
  const ids = useMemo(() => evidencias.map(i => i.sp_id), [evidencias])
  const { documentos, pares, outros, disponivel, analisando, recarregar } = usePepDocumentos(ids)
  const docDe = useMemo(() => new Map(documentos.map(d => [d.sp_id, d])), [documentos])
  const [filtro, setFiltro] = useState<Situacao | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const linhas = useMemo(() => evidencias
    .map(i => ({ item: i, doc: docDe.get(i.sp_id), situacao: situacaoDe(docDe.get(i.sp_id)) }))
    .sort((a, b) => ORDEM.indexOf(a.situacao) - ORDEM.indexOf(b.situacao) || a.item.nome.localeCompare(b.item.nome)),
  [evidencias, docDe])
  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { bom: 0, pode_conter_erros: 0, errado: 0, ilegivel: 0, aguardando: 0 }
    for (const l of linhas) c[l.situacao]++
    return c
  }, [linhas])
  const visiveis = filtro ? linhas.filter(l => l.situacao === filtro) : linhas

  if (!disponivel || evidencias.length === 0) return null

  const sigla = (i: SpItem) => (i.item_id ? catalogoSiglas.get(i.item_id) : null) ?? i.sigla ?? "—"
  const titulo = (i: SpItem) => `${sigla(i)} · ${i.paciente_nome ?? "Geral (sem paciente)"}`
  const linhaAberta = aberto ? linhas.find(l => l.item.sp_id === aberto) ?? null : null

  return (
    <SecaoPastel titulo="titulo-conferencia-docs">
      <CabecalhoPastel
        id="titulo-conferencia-docs"
        titulo="Conferência dos documentos"
        t="aco"
        Icone={ScanText}
        tamanho="medio"
        nivel="h3"
        apoio={<>O robô lê cada documento e aponta o que pode estar errado. É indicação: não muda a entrega nem o valor.</>}
        ajuda={[
          { t: "vermelho", Icone: XCircle, texto: <><strong>Está errado:</strong> erro comprovado pelo trecho — sobra do modelo, campo vazio, data que não existe, documento de outro paciente, cópia.</> },
          { t: "amber", Icone: AlertTriangle, texto: <><strong>Pode conter erros:</strong> algo suspeito que precisa de olho humano. Tudo o que a IA aponta fica aqui.</> },
          { t: "cinza", Icone: FileQuestion, texto: <><strong>Não foi possível ler:</strong> PDF escaneado, com senha ou formato que o robô não lê. Confira à mão.</> },
        ]}
        direita={analisando ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--pp-ink-muted)]" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Analisando…
          </span>
        ) : null}
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
        {ORDEM.map(s => (
          <PilulaFiltro key={s} t={contagem[s] ? SITUACAO[s].t : "cinza"} Icone={SITUACAO[s].Icone} rotulo={VEREDITO[s].rotulo}
            contagem={contagem[s]} ativo={filtro === s} onClick={() => setFiltro(filtro === s ? null : s)} title={VEREDITO[s].explica} />
        ))}
      </div>

      <ul className="divide-y divide-[var(--pp-border)] overflow-hidden rounded-2xl ring-1 ring-[var(--pp-border)]">
        {visiveis.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-[var(--pp-ink-muted)]">Nenhum documento nesta situação.</li>
        )}
        {visiveis.map(({ item, doc, situacao }) => {
          const nErrado = (doc?.achados ?? []).filter(a => a.nivel === "errado").length
            + pares.filter(p => (p.a_sp_id === item.sp_id || p.b_sp_id === item.sp_id) && p.nivel === "errado" && p.revisao_status !== "falso_positivo").length
          const nAtencao = (doc?.achados ?? []).filter(a => a.nivel === "atencao").length + (doc?.ia_achados?.length ?? 0)
            + pares.filter(p => (p.a_sp_id === item.sp_id || p.b_sp_id === item.sp_id) && p.nivel === "atencao" && p.revisao_status !== "falso_positivo").length
          return (
            <li key={item.sp_id}>
              <button type="button" onClick={() => setAberto(item.sp_id)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--pp-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pp-foco)]">
                <SeloSituacao situacao={situacao} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">{titulo(item)}</span>
                  <span className="block truncate text-xs text-[var(--pp-ink-muted)]" title={item.nome}>{item.nome}</span>
                </span>
                <span className="hidden shrink-0 text-right text-xs font-semibold text-[var(--pp-ink-muted)] sm:block">
                  {nErrado > 0 && <span className="block text-[oklch(0.5_0.13_12)] dark:text-[oklch(0.8_0.1_12)]">{nErrado} erro{nErrado > 1 ? "s" : ""}</span>}
                  {nAtencao > 0 && <span className="block">{nAtencao} para olhar</span>}
                  {doc && doc.revisao_status !== "pendente" && <span className="block">{REVISAO[doc.revisao_status]}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--pp-ink-muted)]" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>

      {linhaAberta && (
        <DetalheDocumento
          item={linhaAberta.item}
          sigla={sigla(linhaAberta.item)}
          titulo={titulo(linhaAberta.item)}
          doc={linhaAberta.doc}
          situacao={linhaAberta.situacao}
          pares={pares.filter(p => p.a_sp_id === linhaAberta.item.sp_id || p.b_sp_id === linhaAberta.item.sp_id)}
          outros={outros}
          onFechar={() => setAberto(null)}
          onMudou={recarregar}
        />
      )}
    </SecaoPastel>
  )
}

function CartaoAchado({ a, t }: { a: Achado; t: Tom }) {
  return (
    <li className={`${tom(t)} rounded-2xl bg-[var(--c-suave)] p-3.5 ring-1 ring-[var(--c-linha)]`}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-[var(--c-sobre)]">
        {a.titulo}
        {a.origem === "ia" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pp-surface)] px-2 py-0.5 text-[11px] font-bold text-[var(--pp-ink-muted)]">
            <Sparkles className="h-3 w-3" aria-hidden /> leitura da IA
          </span>
        )}
      </p>
      {a.descricao && <p className="mt-1 text-[13px] text-[var(--pp-ink)]">{a.descricao}</p>}
      {a.trecho && (
        <blockquote className="mt-2 rounded-xl bg-[var(--pp-surface)] px-3 py-2 font-mono text-[12px] leading-5 text-[var(--c-tinta)] ring-1 ring-[var(--c-linha)]">
          {a.trecho}
        </blockquote>
      )}
      {a.secao && <p className="mt-1.5 text-[11px] font-semibold text-[var(--pp-ink-muted)]">Seção: {a.secao}</p>}
    </li>
  )
}

function CartaoPar({ par, outro, onComparar, onMudou }: {
  par: SemelhancaPep
  outro: OutroDocumento | undefined
  onComparar: () => void
  onMudou: () => void
}) {
  const [salvando, setSalvando] = useState(false)
  const t: Tom = par.revisao_status === "falso_positivo" ? "cinza" : par.nivel === "errado" ? "vermelho" : "amber"
  async function marcar(status: "problema_confirmado" | "falso_positivo" | "pendente") {
    setSalvando(true)
    try {
      await revisarSemelhanca(par.a_sp_id, par.b_sp_id, status, null)
      toast.success(status === "falso_positivo" ? "Marcado como alarme falso." : status === "pendente" ? "Revisão desfeita." : "Cópia confirmada.")
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.")
    } finally {
      setSalvando(false)
    }
  }
  return (
    <li className={`${tom(t)} rounded-2xl bg-[var(--c-suave)] p-3.5 ring-1 ring-[var(--c-linha)]`}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-[var(--c-sobre)]">
        <Copy className="h-4 w-4" aria-hidden />
        {par.tipo === "identico" ? "Arquivo idêntico" : `${pct(par.similaridade)} igual`} a um documento {RELACAO[par.relacao]}
      </p>
      <p className="mt-1 text-[13px] text-[var(--pp-ink)]">
        <strong>{outro?.sigla ?? "—"} · {outro?.paciente_nome ?? "Geral"}</strong>
        {outro?.competencia ? ` · ${mesBR(outro.competencia)}` : ""}
        {outro?.prestador_nome ? ` · ${outro.prestador_nome}` : ""}
      </p>
      {outro?.nome && <p className="truncate text-xs text-[var(--pp-ink-muted)]" title={outro.nome}>{outro.nome}</p>}
      {par.revisao_status !== "pendente" && (
        <p className="mt-1 text-xs font-semibold text-[var(--c-tinta)]">
          {par.revisao_status === "falso_positivo" ? "Alarme falso" : "Cópia confirmada"}
          {par.revisao_por_nome ? ` por ${par.revisao_por_nome}` : ""}{par.revisao_em ? ` em ${dataBR(par.revisao_em)}` : ""}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={onComparar} className={`${tom("aco")} pp-btn min-h-11 text-[13px]`}>
          <Copy className="h-4 w-4" aria-hidden /> Comparar lado a lado
        </button>
        {par.revisao_status === "pendente" ? (
          <>
            <button type="button" disabled={salvando} onClick={() => marcar("problema_confirmado")} className={`${tom("vermelho")} pp-btn pp-btn-suave min-h-11 text-[13px]`}>
              É cópia
            </button>
            <button type="button" disabled={salvando} onClick={() => marcar("falso_positivo")} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11 text-[13px]`}>
              Alarme falso
            </button>
          </>
        ) : (
          <button type="button" disabled={salvando} onClick={() => marcar("pendente")} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11 text-[13px]`}>
            Desfazer revisão
          </button>
        )}
      </div>
    </li>
  )
}

const OPCOES_REVISAO: { status: RevisaoStatus; rotulo: string; t: Tom }[] = [
  { status: "problema_confirmado", rotulo: "Problema confirmado", t: "vermelho" },
  { status: "falso_positivo", rotulo: "Alarme falso", t: "cinza" },
  { status: "corrigido", rotulo: "Corrigido", t: "verde" },
]

function DetalheDocumento({ item, sigla, titulo, doc, situacao, pares, outros, onFechar, onMudou }: {
  item: SpItem
  sigla: string
  titulo: string
  doc: DocumentoPep | undefined
  situacao: Situacao
  pares: SemelhancaPep[]
  outros: Map<string, OutroDocumento>
  onFechar: () => void
  onMudou: () => Promise<unknown>
}) {
  const [obs, setObs] = useState(doc?.revisao_obs ?? "")
  const [salvando, setSalvando] = useState(false)
  const [comparando, setComparando] = useState<SemelhancaPep | null>(null)
  const errados = (doc?.achados ?? []).filter(a => a.nivel === "errado")
  const atencao = [...(doc?.achados ?? []).filter(a => a.nivel === "atencao"), ...(doc?.ia_achados ?? [])]
  const paresErrado = pares.filter(p => p.nivel === "errado")
  const paresAtencao = pares.filter(p => p.nivel === "atencao")
  const semRegua = !SIGLAS_COM_REGUA.includes(sigla as (typeof SIGLAS_COM_REGUA)[number])

  async function revisar(status: RevisaoStatus) {
    if (!doc) return
    setSalvando(true)
    try {
      await revisarDocumento(doc.sp_id, status, obs.trim() || null)
      toast.success("Revisão salva.")
      await onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.")
    } finally {
      setSalvando(false)
    }
  }

  async function reanalisar() {
    if (!doc) return
    setSalvando(true)
    try {
      await reanalisarDocumento(doc.sp_id)
      toast.success("Documento analisado de novo.")
      await onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reanalisar.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Drawer title={titulo} subtitle={item.nome} width={560} onClose={onFechar}>
      <div className="pp space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SeloSituacao situacao={situacao} grande />
            <p className="mt-1.5 text-[13px] text-[var(--pp-ink-muted)]">{VEREDITO[situacao].explica}</p>
          </div>
          <BotaoSharepoint url={item.web_url} />
        </div>

        {situacao === "aguardando" && (
          <p className="rounded-2xl bg-[var(--pp-muted)] p-3.5 text-sm text-[var(--pp-ink)]">
            {doc ? "O documento está na fila de análise: aparece aqui em alguns minutos." : "O robô ainda não leu este documento. Ele lê toda madrugada (ou em “Executar agora”, no painel do robô)."}
          </p>
        )}

        {situacao === "ilegivel" && doc && (
          <div className={`${tom("cinza")} rounded-2xl bg-[var(--c-suave)] p-3.5 ring-1 ring-[var(--c-linha)]`}>
            <p className="text-sm font-extrabold">{EXTRACAO_STATUS[doc.extracao_status] ?? doc.extracao_status}</p>
            {doc.extracao_detalhe && <p className="mt-1 text-[13px]">{doc.extracao_detalhe}</p>}
            <p className="mt-1 text-[13px] text-[var(--pp-ink-muted)]">Abra o arquivo e confira à mão. Se possível, peça o documento em .docx ou PDF com texto.</p>
          </div>
        )}

        {situacao === "bom" && (
          <p className={`${tom("verde")} flex items-center gap-2 rounded-2xl bg-[var(--c-suave)] p-3.5 text-sm font-bold text-[var(--c-sobre)]`}>
            <ShieldCheck className="h-5 w-5" aria-hidden /> Nada a apontar nas conferências.
          </p>
        )}

        {(errados.length > 0 || paresErrado.length > 0) && (
          <section aria-labelledby="doc-errado">
            <h4 id="doc-errado" className="mb-2 text-[15px] font-extrabold">O que está errado</h4>
            <ul className="space-y-2">
              {errados.map((a, i) => <CartaoAchado key={`e${i}`} a={a} t="vermelho" />)}
              {paresErrado.map(p => (
                <CartaoPar key={`${p.a_sp_id}${p.b_sp_id}`} par={p} outro={outros.get(p.a_sp_id === item.sp_id ? p.b_sp_id : p.a_sp_id)}
                  onComparar={() => setComparando(p)} onMudou={() => void onMudou()} />
              ))}
            </ul>
          </section>
        )}

        {(atencao.length > 0 || paresAtencao.length > 0) && (
          <section aria-labelledby="doc-atencao">
            <h4 id="doc-atencao" className="mb-2 text-[15px] font-extrabold">O que pode conter erros</h4>
            <ul className="space-y-2">
              {atencao.map((a, i) => <CartaoAchado key={`a${i}`} a={a} t="amber" />)}
              {paresAtencao.map(p => (
                <CartaoPar key={`${p.a_sp_id}${p.b_sp_id}`} par={p} outro={outros.get(p.a_sp_id === item.sp_id ? p.b_sp_id : p.a_sp_id)}
                  onComparar={() => setComparando(p)} onMudou={() => void onMudou()} />
              ))}
            </ul>
          </section>
        )}

        {doc && doc.extracao_status === "ok" && doc.analise_status === "concluida" && (
          <p className="text-xs text-[var(--pp-ink-muted)]">
            {semRegua
              ? `Ainda não há régua de conteúdo para ${sigla}: este documento passou só pelas conferências fixas (modelo, campos, datas, paciente, cópia).`
              : doc.ia_status === "erro"
                ? "A leitura pela IA falhou; o robô tenta de novo sozinho. As conferências fixas já valem."
                : doc.ia_status === "concluida" && doc.ia_resumo ? `Leitura da IA: ${doc.ia_resumo}` : null}
          </p>
        )}

        {doc && (
          <section aria-labelledby="doc-revisao" className="space-y-2.5 rounded-2xl bg-[var(--pp-muted)] p-3.5">
            <h4 id="doc-revisao" className="text-[15px] font-extrabold">Sua revisão</h4>
            <p className="text-[13px] text-[var(--pp-ink-muted)]">
              {doc.revisao_status === "pendente" ? "Ninguém revisou ainda." : `${REVISAO[doc.revisao_status]}${doc.revisao_por_nome ? ` por ${doc.revisao_por_nome}` : ""} em ${dataBR(doc.revisao_em)}.`}
            </p>
            <label htmlFor={`obs-${doc.sp_id}`} className="block text-xs font-bold text-[var(--pp-ink-muted)]">Observação (fica no histórico)</label>
            <textarea id={`obs-${doc.sp_id}`} value={obs} onChange={e => setObs(e.target.value)} rows={2}
              placeholder="ex.: prestador avisado por WhatsApp em 15/10"
              className="w-full rounded-xl border border-[var(--pp-border)] bg-[var(--pp-surface)] px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2">
              {OPCOES_REVISAO.map(o => (
                <button key={o.status} type="button" disabled={salvando} onClick={() => revisar(o.status)}
                  aria-pressed={doc.revisao_status === o.status}
                  className={`${tom(o.t)} pp-btn ${doc.revisao_status === o.status ? "" : "pp-btn-suave"} min-h-11 text-[13px]`}>
                  {o.rotulo}
                </button>
              ))}
              {doc.revisao_status !== "pendente" && (
                <button type="button" disabled={salvando} onClick={() => revisar("pendente")} className={`${tom("cinza")} pp-btn pp-btn-suave min-h-11 text-[13px]`}>
                  Reabrir
                </button>
              )}
            </div>
            {doc.historico.length > 0 && (
              <ol className="space-y-1 border-t border-[var(--pp-border)] pt-2 text-xs text-[var(--pp-ink-muted)]">
                {doc.historico.slice().reverse().map((h, i) => (
                  <li key={i}>
                    {dataBR(h.em)} · {h.por ?? "sistema"} · {REVISAO[h.acao as RevisaoStatus] ?? (h.acao === "conteudo_mudou" ? "Arquivo mudou" : h.acao)}
                    {h.obs ? ` — “${h.obs}”` : ""}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {doc && doc.extracao_status === "ok" && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--pp-border)] pt-3 text-[11px] text-[var(--pp-ink-muted)]">
            <span>
              Lido em {dataBR(doc.extraido_em)}{doc.analisado_em ? ` · analisado em ${dataBR(doc.analisado_em)}` : ""}
              {doc.ia_modelo ? ` · IA ${doc.ia_modelo}` : ""}{doc.ia_regua ? ` · régua ${doc.ia_regua}` : ""}
            </span>
            <button type="button" disabled={salvando} onClick={reanalisar} className={`${tom("aco")} pp-btn pp-btn-suave min-h-11 text-[12px]`}>
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              Analisar de novo
            </button>
          </div>
        )}
      </div>

      {comparando && (
        <Comparador par={comparando} referencia={item.sp_id} onFechar={() => setComparando(null)} />
      )}
    </Drawer>
  )
}

function Comparador({ par, referencia, onFechar }: { par: SemelhancaPep; referencia: string; onFechar: () => void }) {
  const [dados, setDados] = useState<Comparacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    compararDocumentos(par.a_sp_id, par.b_sp_id)
      .then(d => { if (vivo) setDados(d) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível comparar.") })
    return () => { vivo = false }
  }, [par.a_sp_id, par.b_sp_id])
  // A coluna da esquerda é o documento aberto (Referência).
  const lados = dados ? (dados.a.sp_id === referencia ? [dados.a, dados.b] : [dados.b, dados.a]) : []
  return (
    <Drawer
      title={par.tipo === "identico" ? "Arquivo idêntico em dois lugares" : "Documentos parecidos"}
      subtitle={`${par.tipo === "identico" ? "100%" : pct(par.similaridade)} de semelhança · documento ${RELACAO[par.relacao]}`}
      width="min(1280px, 96vw)"
      zIndex={Z_MODAL_EMPILHADO}
      onClose={onFechar}
    >
      <div className="pp space-y-3">
        {!dados && !erro && (
          <p className="inline-flex items-center gap-2 text-sm text-[var(--pp-ink-muted)]" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Montando a comparação…
          </p>
        )}
        {erro && <p className="rounded-xl bg-[var(--pp-muted)] p-3 text-sm">{erro}</p>}
        {dados?.expirado && (
          <p className="rounded-xl bg-[var(--pp-muted)] p-3 text-sm">
            O texto destes documentos já foi apagado do Pulsar (guardamos por 90 dias). A semelhança continua registrada: abra os dois arquivos no SharePoint para comparar.
          </p>
        )}
        {dados && (
          <>
            <p className="text-xs text-[var(--pp-ink-muted)]">
              <mark className="rounded bg-[oklch(0.9_0.07_12)] px-1 text-inherit dark:bg-[oklch(0.42_0.08_12)]">Realçado</mark> = escrito igual nos dois.
              Texto apagado = vem do modelo, todo mundo tem.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {lados.map((l, i) => (
                <div key={l.sp_id} className={`${tom(i === 0 ? "aco" : "cinza")} min-w-0 rounded-2xl bg-[var(--c-suave)] p-3.5 ring-1 ring-[var(--c-linha)]`}>
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {i === 0 && <span className="mb-1 inline-flex rounded-full bg-[var(--c)] px-2 py-0.5 text-[11px] font-extrabold text-[var(--c-sobre)]">Referência</span>}
                      <p className="text-sm font-extrabold">{l.sigla ?? "—"} · {l.paciente ?? "Geral"}{l.competencia ? ` · ${mesBR(l.competencia)}` : ""}</p>
                      <p className="truncate text-xs text-[var(--pp-ink-muted)]" title={l.nome ?? ""}>{l.prestador ?? ""}{l.nome ? ` · ${l.nome}` : ""}</p>
                    </div>
                    <BotaoSharepoint url={l.web_url} />
                  </div>
                  {l.paragrafos && (
                    <div className="max-h-[65vh] space-y-2 overflow-auto rounded-xl bg-[var(--pp-surface)] p-3 text-[13px] leading-6">
                      {l.paragrafos.map((p, j) => (
                        <p key={j} className={p.modelo ? "text-[var(--pp-ink-muted)] opacity-60" : "text-[var(--pp-ink)]"}>
                          {p.segmentos.map((s, k) => s.igual
                            ? <mark key={k} className="rounded bg-[oklch(0.9_0.07_12)] px-0.5 text-inherit dark:bg-[oklch(0.42_0.08_12)]">{s.t}</mark>
                            : <span key={k}>{s.t}</span>)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
