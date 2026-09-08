"use client"

// ExportEscopoDialog — pergunta se o export XLSX da Previsão de Receitas deve
// respeitar o filtro de unidade ativo na tela ou ignorá-lo (todas as
// unidades do mês selecionado). Só aparece quando há unidade marcada (sem
// filtro ativo as duas opções produzem o mesmo arquivo, e o diálogo seria só
// atrito). Mesmo estilo visual de components/cronograma/ui/ConfirmDialog.tsx,
// mas com 3 saídas em vez de 2 (aquele componente é binário Confirmar/Cancelar).

import { useEffect } from "react"
import { B } from "@/lib/cronograma/constants"

interface Props {
  unidades: string[]
  onEscolher: (escopo: "filtro" | "tudo") => void
  onCancel: () => void
}

export function ExportEscopoDialog({ unidades, onEscolher, onCancel }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div style={{
        background: "var(--card)", borderRadius: "16px",
        boxShadow: "0 16px 48px rgba(0,0,0,.22)",
        padding: "24px", width: "min(460px, 94vw)",
        display: "flex", flexDirection: "column", gap: "16px",
      }}>
        <div style={{ fontWeight: 800, fontSize: "16px", color: B.navy }}>Exportar XLSX</div>

        <div style={{ fontSize: "13px", color: "var(--muted-foreground)" }}>
          Há {unidades.length === 1 ? "uma unidade filtrada" : `${unidades.length} unidades filtradas`} na tela
          ({unidades.join(", ")}). Deseja exportar exatamente conforme esse filtro, ou todas as unidades do mês selecionado?
          <br /><br />
          &ldquo;Todas&rdquo; traz só o mês em memória — não busca outros meses.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={() => onEscolher("filtro")}
            style={{
              padding: "10px 16px", borderRadius: "10px",
              background: "#16a34a", color: "white", border: "none",
              cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "13px",
              textAlign: "left",
            }}
          >
            Conforme o filtro atual
          </button>
          <button
            onClick={() => onEscolher("tudo")}
            style={{
              padding: "10px 16px", borderRadius: "10px",
              background: "var(--muted)", color: "var(--card-foreground)",
              border: "1px solid var(--border)", cursor: "pointer",
              fontFamily: "inherit", fontWeight: 700, fontSize: "13px",
              textAlign: "left",
            }}
          >
            Todas as unidades do mês
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px", borderRadius: "10px",
              background: "transparent", color: "var(--muted-foreground)",
              border: "none", cursor: "pointer",
              fontFamily: "inherit", fontWeight: 600, fontSize: "13px",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
