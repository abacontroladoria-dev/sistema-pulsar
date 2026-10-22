"use client"

import toast from "react-hot-toast"
import { Copy } from "lucide-react"
import { foco } from "./campos"

// "Copiar link" / "Copiar mensagem" dos formulários que a família preenche
// (Disponibilidade e Escola). O link é sempre o público — quem copia no
// localhost não pode mandar "http://localhost:3000/..." para a família.

export function BotoesCopiarLink({ link, mensagem }: { link: string; mensagem: string }) {
  async function copiar(texto: string, sucesso: string) {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(sucesso)
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente: " + texto)
    }
  }

  const botao = `inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted sm:min-h-0 ${foco}`

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void copiar(link, "Link copiado.")} className={botao}>
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copiar link
      </button>
      <button type="button" onClick={() => void copiar(mensagem, "Mensagem copiada.")} className={botao}>
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copiar mensagem
      </button>
    </div>
  )
}
