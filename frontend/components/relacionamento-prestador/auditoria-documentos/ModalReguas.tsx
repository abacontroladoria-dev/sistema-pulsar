"use client"

import { useMemo, useRef, useState } from "react"
import { Download, FileUp, Loader2, ScrollText, X } from "lucide-react"
import toast from "react-hot-toast"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useConfirmacao } from "@/components/ui/pastel/confirmacao"
import { StatusChip } from "@/components/ui/tones"
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO, CAMPO, FOCO, ROTULO } from "@/components/terapeutico/auditoria/vocabulario"
import { NOMES_DOCUMENTO_PEP, SIGLAS_PEP } from "@/lib/pepDocumentos/rotulos"
import { publicarRegua, type ReguaVersao } from "@/services/pepAuditoriaDocumentos.service"

// Réguas da Auditoria de Documentos PEP (15/10/2026): o que a IA confere em
// cada tipo de documento. Uma régua por sigla, versionada (cada publicação é
// uma versão nova; nada se apaga). Ver e baixar: quem acessa a tela.
// Publicar: só RP e admin (o banco confere de novo em sp_pep_regua_publicar).
//
// Diferente dos critérios das evoluções (estrutura fixa, editados só por
// arquivo), a régua é texto livre: dá para editar aqui mesmo ou subir um
// .docx/.md baixado daqui.

const carregarArquivo = () => import("@/lib/pepDocumentos/reguasArquivo")
const dataBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ModalReguas({ reguas, podeEscrever, desatualizadosPorSigla, siglaInicial, onFechar, onPublicada }: {
  reguas: ReguaVersao[]
  podeEscrever: boolean
  /** Auditados com versão anterior da régua, por sigla. */
  desatualizadosPorSigla: Record<string, number>
  siglaInicial?: string
  onFechar: () => void
  onPublicada: () => void
}) {
  const [sigla, setSigla] = useState<string>(siglaInicial ?? "PIC")
  const versoes = useMemo(() => reguas.filter(r => r.sigla === sigla).sort((a, b) => b.versao - a.versao), [reguas, sigla])
  const vigente = versoes[0] ?? null
  const [rascunho, setRascunho] = useState<string | null>(null)
  const [nota, setNota] = useState("")
  const [origem, setOrigem] = useState<{ sigla: string; versao: number } | null>(null)
  const [publicando, setPublicando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement | null>(null)
  const { confirmar, dialogo } = useConfirmacao()
  const nome = NOMES_DOCUMENTO_PEP[sigla] ?? sigla
  const pendente = rascunho !== null && rascunho.trim() !== (vigente?.conteudo ?? "").trim()

  async function descartarSePrecisar() {
    if (!pendente) return true
    return confirmar({ titulo: "Descartar a edição?", texto: "O texto editado ainda não foi publicado.", confirmar: "Descartar" })
  }

  async function trocarSigla(s: string) {
    if (s === sigla || !(await descartarSePrecisar())) return
    setSigla(s); setRascunho(null); setNota(""); setOrigem(null)
  }

  async function fechar() {
    if (await descartarSePrecisar()) onFechar()
  }

  async function baixarVersao(r: ReguaVersao, formato: "docx" | "md") {
    const m = await carregarArquivo()
    if (formato === "md") baixar(new Blob([m.reguaParaMarkdown(r.sigla, r.versao, r.conteudo, NOMES_DOCUMENTO_PEP[r.sigla] ?? r.sigla)], { type: "text/markdown" }), `regua-${r.sigla}-v${r.versao}.md`)
    else baixar(await m.reguaParaDocx(r.sigla, r.versao, r.conteudo, NOMES_DOCUMENTO_PEP[r.sigla] ?? r.sigla), `regua-${r.sigla}-v${r.versao}.docx`)
  }

  async function subir(arquivo: File | undefined) {
    if (!arquivo) return
    try {
      const m = await carregarArquivo()
      const lido = await m.arquivoParaRegua(arquivo)
      if (!lido.conteudo) { toast.error("O arquivo está vazio."); return }
      if (lido.origem && lido.origem.sigla !== sigla) {
        toast.error(`Este arquivo é da régua ${lido.origem.sigla}, não ${sigla}.`)
        return
      }
      setRascunho(lido.conteudo)
      setOrigem(lido.origem)
    } catch {
      toast.error("Não foi possível ler o arquivo. Use .docx, .md ou .txt.")
    } finally {
      if (arquivoRef.current) arquivoRef.current.value = ""
    }
  }

  async function publicar() {
    if (!rascunho?.trim() || !nota.trim()) return
    setPublicando(true)
    try {
      const r = await publicarRegua(sigla, rascunho, nota.trim())
      toast.success(`Régua ${sigla} v${r.versao} publicada.`)
      setRascunho(null); setNota(""); setOrigem(null)
      onPublicada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível publicar.")
    } finally {
      setPublicando(false)
    }
  }

  const desatualizadoOrigem = origem && vigente && origem.versao < vigente.versao
  const textoMostrado = rascunho ?? vigente?.conteudo ?? ""

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) void fechar() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="h-[90vh] w-[94vw] max-w-4xl gap-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-card p-0 sm:max-w-4xl"
        onInteractOutside={e => { if (pendente) { e.preventDefault(); void fechar() } }}
        onEscapeKeyDown={e => { if (pendente) { e.preventDefault(); void fechar() } }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 md:px-6">
          <div className="min-w-0 space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-fg">
              <ScrollText className="h-3.5 w-3.5" aria-hidden /> Réguas da auditoria
            </span>
            <DialogTitle className="text-base font-bold text-foreground">O que a IA confere em cada documento</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {podeEscrever ? "Edite aqui ou suba um arquivo; cada publicação vira uma versão nova." : "Só RP e administradores publicam uma nova versão."}
            </p>
          </div>
          <button type="button" onClick={() => void fechar()} aria-label="Fechar" className={BOTAO_SECUNDARIO}>
            <X className="h-3.5 w-3.5" aria-hidden /> Fechar
          </button>
        </header>

        <div className="overflow-auto px-5 py-4 md:px-6">
          <div role="tablist" aria-label="Documento" className="flex flex-wrap gap-1.5">
            {SIGLAS_PEP.map(s => {
              const tem = reguas.some(r => r.sigla === s)
              return (
                <button key={s} type="button" role="tab" aria-selected={sigla === s} onClick={() => void trocarSigla(s)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${FOCO} ${
                    sigla === s ? "border-brand-fg bg-brand-fg text-white" : "border-border bg-background text-foreground hover:bg-muted/40"}`}>
                  {s}
                  {!tem && <span className={sigla === s ? "text-white/80" : "text-muted-foreground"}>· sem régua</span>}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{nome}</h3>
            {vigente
              ? <StatusChip tone="blue" dense>v{vigente.versao} vigente · {dataBR(vigente.publicado_em)} · {vigente.publicado_por_nome}</StatusChip>
              : <StatusChip tone="gray" dense>Sem régua: só as conferências fixas</StatusChip>}
            {(desatualizadosPorSigla[sigla] ?? 0) > 0 && (
              <StatusChip tone="amber" dense>{desatualizadosPorSigla[sigla]} auditado(s) com versão anterior</StatusChip>
            )}
          </div>

          {desatualizadoOrigem && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Este arquivo saiu da v{origem!.versao}, mas a vigente já é a v{vigente!.versao}. Confira se não está desfazendo a mudança de outra pessoa.
            </p>
          )}

          <label htmlFor="regua-texto" className={`${ROTULO} mt-4 block`}>{pendente ? "Texto novo (ainda não publicado)" : "Texto da régua"}</label>
          <textarea
            id="regua-texto"
            value={textoMostrado}
            readOnly={!podeEscrever}
            onChange={e => setRascunho(e.target.value)}
            rows={14}
            placeholder={podeEscrever ? `Escreva o que a IA deve conferir em ${sigla}: campos obrigatórios, o que procurar, o que é erro.` : "Ainda não há régua para este documento."}
            className={`${CAMPO} mt-1.5 h-auto w-full py-2 font-mono text-[12.5px] leading-5`}
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {podeEscrever && (
              <>
                <input ref={arquivoRef} type="file" accept=".docx,.md,.txt" className="hidden" onChange={e => void subir(e.target.files?.[0])} />
                <button type="button" onClick={() => arquivoRef.current?.click()} className={BOTAO_SECUNDARIO}>
                  <FileUp className="h-3.5 w-3.5" aria-hidden /> Subir .docx ou .md
                </button>
              </>
            )}
            {vigente && (
              <>
                <button type="button" onClick={() => void baixarVersao(vigente, "docx")} className={BOTAO_SECUNDARIO}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> Baixar .docx
                </button>
                <button type="button" onClick={() => void baixarVersao(vigente, "md")} className={BOTAO_SECUNDARIO}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> Baixar .md
                </button>
              </>
            )}
          </div>

          {versoes.length > 0 && (
            <section aria-labelledby="regua-historico" className="mt-6">
              <h4 id="regua-historico" className={ROTULO}>Histórico</h4>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {versoes.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span>
                      <strong>v{r.versao}</strong> · {dataBR(r.publicado_em)} · {r.publicado_por_nome}
                      {r.nota ? <span className="text-muted-foreground"> — {r.nota}</span> : null}
                    </span>
                    <button type="button" onClick={() => void baixarVersao(r, "md")} className={BOTAO_SECUNDARIO}>
                      <Download className="h-3.5 w-3.5" aria-hidden /> Baixar
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {podeEscrever && (
          <footer className="flex flex-wrap items-end gap-3 border-t border-border px-5 py-3 md:px-6">
            <div className="min-w-[14rem] flex-1">
              <label htmlFor="regua-nota" className={ROTULO}>O que mudou nesta versão? (obrigatório)</label>
              <input id="regua-nota" value={nota} onChange={e => setNota(e.target.value)} disabled={!pendente}
                placeholder="ex.: inclui conferência do cargo do representante da escola"
                className={`${CAMPO} mt-1 w-full`} />
            </div>
            <button type="button" disabled={!pendente || !nota.trim() || publicando} onClick={() => void publicar()} className={BOTAO_PRIMARIO}>
              {publicando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ScrollText className="h-3.5 w-3.5" aria-hidden />}
              Publicar v{(vigente?.versao ?? 0) + 1}
            </button>
          </footer>
        )}
        {dialogo}
      </DialogContent>
    </Dialog>
  )
}
