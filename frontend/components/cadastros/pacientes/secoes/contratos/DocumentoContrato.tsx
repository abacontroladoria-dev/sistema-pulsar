"use client"

import { useState } from "react"
import toast from "react-hot-toast"
import { AlertTriangle, Download, Eye, Loader2 } from "lucide-react"
import { Drawer } from "@/components/cronograma/ui/Drawer"
import { Z_MODAL_EMPILHADO } from "@/components/cronograma/ui/useModalLayer"
import { btnSecundario } from "@/components/cronograma/grade/estilo"
import { buscarDocumentoContrato } from "@/services/pacienteContratos.service"
import type { ContratoPaciente } from "@/types/contratosPaciente"
import { rotulo } from "../../ui/campos"

// Bloco "Documento" do detalhe do contrato: visualizar e baixar o .docx
// preenchido com o cadastro de AGORA (rota GET /api/contratos/{id}/documento/).
// Nada é guardado (sem PDF neste tema, decisão de 09/10/2026).
//
// A prévia converte o .docx em HTML no navegador (mammoth, já usado em
// lib/auditoria/criteriosDocx.ts): é simplificada — sem cabeçalho, rodapé e
// diagramação exata —, serve para CONFERIR os dados. O documento de verdade é
// o baixado.
//
// Cadastro incompleto: a rota devolve a lista do que falta, e ela aparece aqui
// no lugar do documento.

type Estado =
  | { fase: "parado" }
  | { fase: "gerando"; para: "ver" | "baixar" }
  | { fase: "pendente"; mensagem: string; pendencias: string[] }

export function DocumentoContrato({ contrato: c }: { contrato: ContratoPaciente }) {
  const [estado, setEstado] = useState<Estado>({ fase: "parado" })
  const [previa, setPrevia] = useState<{ html: string; arquivo: Blob; nome: string } | null>(null)

  async function gerar(para: "ver" | "baixar") {
    setEstado({ fase: "gerando", para })
    const r = await buscarDocumentoContrato(c.id)
    if (!r.ok) {
      if (r.pendencias.length) setEstado({ fase: "pendente", mensagem: r.mensagem, pendencias: r.pendencias })
      else {
        setEstado({ fase: "parado" })
        toast.error(r.mensagem, { duration: 8000 })
      }
      return
    }
    setEstado({ fase: "parado" })
    if (para === "baixar") {
      baixar(r.arquivo, r.nomeArquivo)
      return
    }
    try {
      const mammoth = (await import("mammoth/mammoth.browser.js")).default
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await r.arquivo.arrayBuffer() })
      setPrevia({ html: value, arquivo: r.arquivo, nome: r.nomeArquivo })
    } catch {
      toast.error("Não foi possível montar a prévia. Baixe o documento para conferir.", { duration: 8000 })
    }
  }

  const ocupado = estado.fase === "gerando"

  return (
    <section>
      <h3 className={rotulo}>Documento</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void gerar("ver")} disabled={ocupado} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
          {ocupado && estado.para === "ver" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          Visualizar
        </button>
        <button type="button" onClick={() => void gerar("baixar")} disabled={ocupado} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
          {ocupado && estado.para === "baixar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          Baixar .docx
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {c.status === "rascunho"
          ? "Preenchido com o cadastro de agora. Corrigiu o cadastro? Gere de novo."
          : "Preenchido com o cadastro de agora — pode diferir do que foi enviado para assinatura."}
      </p>

      {estado.fase === "pendente" && (
        <div role="alert" className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <p className="flex items-start gap-1.5 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {estado.mensagem}
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
            {estado.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {previa && (
        <Drawer
          title={`Prévia · ${c.numero}`}
          subtitle="Simplificada: sem cabeçalho, rodapé e diagramação exata. O documento final é o .docx."
          width="min(860px, 100vw)"
          zIndex={Z_MODAL_EMPILHADO}
          onClose={() => setPrevia(null)}
          footer={
            <button type="button" onClick={() => baixar(previa.arquivo, previa.nome)} className={`${btnSecundario} min-h-11 sm:min-h-0`}>
              <Download className="h-4 w-4" aria-hidden />
              Baixar .docx
            </button>
          }
        >
          {/* Folha de papel: branca nos dois temas, como o documento impresso. */}
          <article
            className="rounded-md bg-white px-5 py-6 text-[13px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-black/10 sm:px-10 [&_h1]:text-base [&_h1]:font-bold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_ul]:list-disc [&_ul]:pl-6"
            // HTML do mammoth: ele escapa o texto do documento; não há marcação vinda do usuário.
            dangerouslySetInnerHTML={{ __html: previa.html }}
          />
        </Drawer>
      )}
    </section>
  )
}

function baixar(arquivo: Blob, nome: string) {
  const url = URL.createObjectURL(arquivo)
  const a = document.createElement("a")
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
