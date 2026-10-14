"use client"

import { useEffect, useState } from "react"
import { Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react"
import toast from "react-hot-toast"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/useModalLayer"
import { StatusChip, TONE_CHIP, TONE_PANEL } from "@/components/ui/tones"
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, CAMPO, ROTULO } from "@/components/terapeutico/auditoria/vocabulario"
import type { Tone } from "@/hooks/useToneColor"
import { EXTRACAO_STATUS, RELACAO, REVISAO, SITUACAO, TOM_SITUACAO } from "@/lib/pepDocumentos/rotulos"
import type { SituacaoAuditoria } from "@/lib/pepDocumentos/situacao"
import type { Achado, RevisaoStatus, SemelhancaPep } from "@/lib/pepDocumentos/tipos"
import { mesBR } from "@/lib/roboSharepoint/rotulos"
import { compararDocumentos, revisarDocumento, revisarSemelhanca, type Comparacao } from "@/services/pepDocumentos.service"
import type { DocAuditoria } from "@/services/pepAuditoriaDocumentos.service"

// Detalhe de um documento na Auditoria de Documentos PEP: o que está errado e
// o que pode conter erros, cada um com o trecho que prova; a leitura da IA;
// as cópias (com o comparador lado a lado); a revisão de uma pessoa com o
// histórico. Painel lateral (AGENTS.md: side panel em vez de página).

export type OutroLado = { sp_id: string; nome: string; sigla: string | null; competencia: string | null; prestador: string | null; paciente: string | null }

const dataBR = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"
const pct = (n: number) => `${Math.round(n * 100)}%`

export function SeloSituacao({ situacao, dense = false }: { situacao: SituacaoAuditoria; dense?: boolean }) {
  return <StatusChip tone={TOM_SITUACAO[situacao]} dense={dense}>{SITUACAO[situacao].rotulo}</StatusChip>
}

function Bloco({ tom, children }: { tom: Tone; children: React.ReactNode }) {
  return <div className={`rounded-xl p-3.5 ring-1 ${TONE_PANEL[tom].bg} ${TONE_PANEL[tom].ring}`}>{children}</div>
}

function CartaoAchado({ a, tom }: { a: Achado; tom: Tone }) {
  return (
    <li>
      <Bloco tom={tom}>
        <p className={`flex flex-wrap items-center gap-2 text-sm font-bold ${TONE_CHIP[tom].text}`}>
          {a.titulo}
          {a.origem === "ia" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden /> leitura da IA
            </span>
          )}
        </p>
        {a.descricao && <p className="mt-1 text-[13px] text-foreground">{a.descricao}</p>}
        {a.trecho && (
          <blockquote className="mt-2 rounded-lg bg-background px-3 py-2 font-mono text-[12px] leading-5 text-foreground ring-1 ring-border">
            {a.trecho}
          </blockquote>
        )}
        {a.secao && <p className="mt-1.5 text-[11px] text-muted-foreground">Seção: {a.secao}</p>}
      </Bloco>
    </li>
  )
}

function CartaoPar({ par, outro, podeRevisar, onComparar, onMudou }: {
  par: SemelhancaPep
  outro: OutroLado | undefined
  podeRevisar: boolean
  onComparar: () => void
  onMudou: () => void
}) {
  const [salvando, setSalvando] = useState(false)
  const tom: Tone = par.revisao_status === "falso_positivo" ? "gray" : par.nivel === "errado" ? "red" : "amber"
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
    <li>
      <Bloco tom={tom}>
        <p className={`flex flex-wrap items-center gap-2 text-sm font-bold ${TONE_CHIP[tom].text}`}>
          <Copy className="h-4 w-4" aria-hidden />
          {par.tipo === "identico" ? "Arquivo idêntico" : `${pct(par.similaridade)} igual`} a um documento {RELACAO[par.relacao]}
        </p>
        <p className="mt-1 text-[13px] text-foreground">
          <strong>{outro?.sigla ?? "—"} · {outro?.paciente ?? "Geral"}</strong>
          {outro?.competencia ? ` · ${mesBR(outro.competencia)}` : ""}
          {outro?.prestador ? ` · ${outro.prestador}` : ""}
        </p>
        {outro?.nome && <p className="truncate text-xs text-muted-foreground" title={outro.nome}>{outro.nome}</p>}
        {par.revisao_status !== "pendente" && (
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {par.revisao_status === "falso_positivo" ? "Alarme falso" : "Cópia confirmada"}
            {par.revisao_por_nome ? ` por ${par.revisao_por_nome}` : ""}{par.revisao_em ? ` em ${dataBR(par.revisao_em)}` : ""}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" onClick={onComparar} className={BOTAO_SECUNDARIO}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Comparar lado a lado
          </button>
          {podeRevisar && (par.revisao_status === "pendente" ? (
            <>
              <button type="button" disabled={salvando} onClick={() => marcar("problema_confirmado")} className={BOTAO_SECUNDARIO}>É cópia</button>
              <button type="button" disabled={salvando} onClick={() => marcar("falso_positivo")} className={BOTAO_SECUNDARIO}>Alarme falso</button>
            </>
          ) : (
            <button type="button" disabled={salvando} onClick={() => marcar("pendente")} className={BOTAO_SECUNDARIO}>Desfazer revisão</button>
          ))}
        </div>
      </Bloco>
    </li>
  )
}

const OPCOES_REVISAO: { status: RevisaoStatus; rotulo: string }[] = [
  { status: "problema_confirmado", rotulo: "Problema confirmado" },
  { status: "falso_positivo", rotulo: "Alarme falso" },
  { status: "corrigido", rotulo: "Corrigido" },
]

export function DetalheDocumento({ doc, situacao, desatualizado, pares, outroLado, podeEscrever, onFechar, onMudou, onAuditar }: {
  doc: DocAuditoria
  situacao: SituacaoAuditoria
  desatualizado: boolean
  pares: SemelhancaPep[]
  outroLado: (spId: string) => OutroLado | undefined
  /** RP/admin: revisar e "Auditar de novo" (o banco confere de novo). */
  podeEscrever: boolean
  onFechar: () => void
  onMudou: () => void
  onAuditar: (spIds: string[], forcar: boolean) => Promise<void>
}) {
  const [obs, setObs] = useState(doc.revisao_obs ?? "")
  const [salvando, setSalvando] = useState(false)
  const [comparando, setComparando] = useState<SemelhancaPep | null>(null)
  const i = doc.item
  const errados = doc.achados.filter(a => a.nivel === "errado")
  const atencao = [...doc.achados.filter(a => a.nivel === "atencao"), ...doc.ia_achados]
  const ativos = pares.filter(p => p.revisao_status !== "falso_positivo")
  const paresErrado = pares.filter(p => p.nivel === "errado")
  const paresAtencao = pares.filter(p => p.nivel === "atencao")
  const auditado = ["bom", "pode_conter_erros", "errado"].includes(situacao)

  async function revisar(status: RevisaoStatus) {
    setSalvando(true)
    try {
      await revisarDocumento(doc.sp_id, status, obs.trim() || null)
      toast.success("Revisão salva.")
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.")
    } finally {
      setSalvando(false)
    }
  }

  async function auditar(forcar: boolean) {
    setSalvando(true)
    try { await onAuditar([doc.sp_id], forcar) } finally { setSalvando(false) }
  }

  return (
    <Drawer
      title={`${i.sigla ?? "—"} · ${i.paciente_nome ?? (i.sigla === "STC" || i.sigla === "ETC" ? "Geral" : "Paciente não identificado")}`}
      subtitle={i.nome}
      width={580}
      onClose={onFechar}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <SeloSituacao situacao={situacao} />
            <p className="text-[13px] text-muted-foreground">{SITUACAO[situacao].explica}</p>
            {desatualizado && <p className="text-[12px] font-semibold text-muted-foreground">Auditado com régua ou conferências antigas: audite de novo para atualizar.</p>}
          </div>
          {i.web_url && (
            <a href={i.web_url} target="_blank" rel="noreferrer" className={BOTAO_SECUNDARIO}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir no SharePoint
            </a>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div><dt className={ROTULO}>Prestador</dt><dd>{i.prestador_nome ?? "Pasta sem planilha (não reconhecido)"}</dd></div>
          <div><dt className={ROTULO}>Mês</dt><dd>{mesBR(i.competencia)}</dd></div>
          <div><dt className={ROTULO}>Lido pelo robô</dt><dd>{dataBR(doc.extraido_em)}</dd></div>
          <div><dt className={ROTULO}>Auditado</dt><dd>{auditado ? `${dataBR(doc.analisado_em)}${doc.auditoria_pedida_por_nome ? ` · pedido por ${doc.auditoria_pedida_por_nome}` : ""}` : "—"}</dd></div>
        </dl>

        {situacao === "ilegivel" && (
          <Bloco tom="gray">
            <p className="text-sm font-bold">{EXTRACAO_STATUS[doc.extracao_status] ?? doc.extracao_status}</p>
            {doc.extracao_detalhe && <p className="mt-1 text-[13px]">{doc.extracao_detalhe}</p>}
            <p className="mt-1 text-[13px] text-muted-foreground">Abra o arquivo e confira à mão. Se possível, peça o documento em .docx ou PDF com texto.</p>
          </Bloco>
        )}

        {(situacao === "nao_auditado" || situacao === "falhou") && (
          <Bloco tom={situacao === "falhou" ? "purple" : "gray"}>
            <p className="text-[13px]">
              {situacao === "falhou"
                ? `A auditoria falhou${doc.analise_erro ? `: ${doc.analise_erro}` : ""}.`
                : "Ninguém pediu a auditoria deste documento ainda."}
            </p>
            <button type="button" disabled={salvando} onClick={() => auditar(false)} className={`${BOTAO_PRIMARIO} mt-2.5`}>
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
              Auditar este documento
            </button>
          </Bloco>
        )}

        {situacao === "na_fila" && (
          <Bloco tom="blue"><p className="text-[13px]">Na fila de auditoria{doc.auditoria_pedida_por_nome ? ` (pedido por ${doc.auditoria_pedida_por_nome})` : ""}: aparece aqui em alguns minutos.</p></Bloco>
        )}

        {situacao === "bom" && ativos.length === 0 && (
          <Bloco tom="green"><p className={`flex items-center gap-2 text-sm font-bold ${TONE_CHIP.green.text}`}><ShieldCheck className="h-4 w-4" aria-hidden /> Nada a apontar nas conferências.</p></Bloco>
        )}

        {auditado && (errados.length > 0 || paresErrado.length > 0) && (
          <section aria-labelledby="doc-errado">
            <h4 id="doc-errado" className="mb-2 text-sm font-bold">O que está errado</h4>
            <ul className="space-y-2">
              {errados.map((a, k) => <CartaoAchado key={`e${k}`} a={a} tom="red" />)}
              {paresErrado.map(p => (
                <CartaoPar key={`${p.a_sp_id}${p.b_sp_id}`} par={p} outro={outroLado(p.a_sp_id === doc.sp_id ? p.b_sp_id : p.a_sp_id)}
                  podeRevisar={podeEscrever} onComparar={() => setComparando(p)} onMudou={onMudou} />
              ))}
            </ul>
          </section>
        )}

        {auditado && (atencao.length > 0 || paresAtencao.length > 0) && (
          <section aria-labelledby="doc-atencao">
            <h4 id="doc-atencao" className="mb-2 text-sm font-bold">O que pode conter erros</h4>
            <ul className="space-y-2">
              {atencao.map((a, k) => <CartaoAchado key={`a${k}`} a={a} tom="amber" />)}
              {paresAtencao.map(p => (
                <CartaoPar key={`${p.a_sp_id}${p.b_sp_id}`} par={p} outro={outroLado(p.a_sp_id === doc.sp_id ? p.b_sp_id : p.a_sp_id)}
                  podeRevisar={podeEscrever} onComparar={() => setComparando(p)} onMudou={onMudou} />
              ))}
            </ul>
          </section>
        )}

        {auditado && (
          <p className="text-xs text-muted-foreground">
            {doc.ia_status === "nao_se_aplica"
              ? `Ainda não há régua de conteúdo para ${i.sigla}: este documento passou só pelas conferências fixas (modelo, campos, datas, paciente, cópia).`
              : doc.ia_status === "erro"
                ? "A leitura pela IA falhou; o sistema tenta de novo sozinho. As conferências fixas já valem."
                : doc.ia_resumo ? `Leitura da IA (${doc.ia_regua ?? "régua"}): ${doc.ia_resumo}` : null}
          </p>
        )}

        {auditado && (
          <section aria-labelledby="doc-revisao" className="space-y-2.5 rounded-xl bg-muted/50 p-3.5">
            <h4 id="doc-revisao" className="text-sm font-bold">Revisão</h4>
            <p className="text-[13px] text-muted-foreground">
              {doc.revisao_status === "pendente" ? "Ninguém revisou ainda." : `${REVISAO[doc.revisao_status]}${doc.revisao_por_nome ? ` por ${doc.revisao_por_nome}` : ""} em ${dataBR(doc.revisao_em)}.`}
            </p>
            {podeEscrever ? (
              <>
                <label htmlFor={`obs-${doc.sp_id}`} className={ROTULO}>Observação (fica no histórico)</label>
                <textarea id={`obs-${doc.sp_id}`} value={obs} onChange={e => setObs(e.target.value)} rows={2}
                  placeholder="ex.: prestador avisado por WhatsApp em 15/10"
                  className={`${CAMPO} h-auto w-full py-2 text-sm`} />
                <div className="flex flex-wrap gap-2">
                  {OPCOES_REVISAO.map(o => (
                    <button key={o.status} type="button" disabled={salvando} onClick={() => revisar(o.status)}
                      aria-pressed={doc.revisao_status === o.status}
                      className={doc.revisao_status === o.status ? BOTAO_PRIMARIO : BOTAO_SECUNDARIO}>
                      {o.rotulo}
                    </button>
                  ))}
                  {doc.revisao_status !== "pendente" && (
                    <button type="button" disabled={salvando} onClick={() => revisar("pendente")} className={BOTAO_SECUNDARIO}>Reabrir</button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Só RP e administradores registram a revisão.</p>
            )}
            {doc.historico.length > 0 && (
              <ol className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {doc.historico.slice().reverse().map((h, k) => (
                  <li key={k}>
                    {dataBR(h.em)} · {h.por ?? "sistema"} · {REVISAO[h.acao as RevisaoStatus] ?? (h.acao === "conteudo_mudou" ? "Arquivo mudou" : h.acao)}
                    {h.obs ? ` — “${h.obs}”` : ""}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {auditado && podeEscrever && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <span>{doc.ia_modelo ? `IA ${doc.ia_modelo}` : "Sem leitura pela IA"}{doc.ia_regua ? ` · régua ${doc.ia_regua}` : ""}</span>
            <button type="button" disabled={salvando} onClick={() => auditar(true)} className={BOTAO_SECUNDARIO}>
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              Auditar de novo
            </button>
          </div>
        )}
      </div>

      {comparando && <Comparador par={comparando} referencia={doc.sp_id} onFechar={() => setComparando(null)} />}
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
  const marca = `rounded px-0.5 text-inherit ${TONE_CHIP.red.bg}`
  return (
    <Drawer
      title={par.tipo === "identico" ? "Arquivo idêntico em dois lugares" : "Documentos parecidos"}
      subtitle={`${par.tipo === "identico" ? "100%" : pct(par.similaridade)} de semelhança · documento ${RELACAO[par.relacao]}`}
      width="min(1280px, 96vw)"
      zIndex={Z_MODAL_EMPILHADO}
      onClose={onFechar}
    >
      <div className="space-y-3">
        {!dados && !erro && (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Montando a comparação…
          </p>
        )}
        {erro && <p className="rounded-lg bg-muted p-3 text-sm">{erro}</p>}
        {dados?.expirado && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            O texto destes documentos já foi apagado do Pulsar (guardamos por 90 dias). A semelhança continua registrada: abra os dois arquivos no SharePoint para comparar.
          </p>
        )}
        {dados && !dados.expirado && (
          <>
            <p className="text-xs text-muted-foreground">
              <mark className={marca}>Realçado</mark> = escrito igual nos dois. Texto apagado = vem do modelo, todo mundo tem.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {lados.map((l, k) => (
                <div key={l.sp_id} className="min-w-0 rounded-xl border border-border bg-card p-3.5">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {k === 0 && <StatusChip tone="blue" dense>Referência</StatusChip>}
                      <p className="mt-1 text-sm font-bold">{l.sigla ?? "—"} · {l.paciente ?? "Geral"}{l.competencia ? ` · ${mesBR(l.competencia)}` : ""}</p>
                      <p className="truncate text-xs text-muted-foreground" title={l.nome ?? ""}>{l.prestador ?? ""}{l.nome ? ` · ${l.nome}` : ""}</p>
                    </div>
                    {l.web_url && (
                      <a href={l.web_url} target="_blank" rel="noreferrer" className={BOTAO_SECUNDARIO}>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir
                      </a>
                    )}
                  </div>
                  {l.paragrafos && (
                    <div className="max-h-[65vh] space-y-2 overflow-auto rounded-lg bg-muted/40 p-3 text-[13px] leading-6">
                      {l.paragrafos.map((p, j) => (
                        <p key={j} className={p.modelo ? "text-muted-foreground opacity-60" : "text-foreground"}>
                          {p.segmentos.map((s, m) => s.igual ? <mark key={m} className={marca}>{s.t}</mark> : <span key={m}>{s.t}</span>)}
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
