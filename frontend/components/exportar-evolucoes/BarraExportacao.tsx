"use client"

import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react"

// Barra fixa no rodapé: quantas estão selecionadas e os dois botões. Durante a
// geração mostra o progresso, e a tela continua usável.

export type Progresso = { texto: string; feito: number; total: number }

export function BarraExportacao({
  selecionadas,
  semAssinatura,
  progresso,
  onCsv,
  onPdf,
}: {
  selecionadas: number
  /** Profissionais das selecionadas sem assinatura no cadastro. */
  semAssinatura: number
  progresso: Progresso | null
  onCsv: () => void
  onPdf: () => void
}) {
  const ocupado = progresso !== null
  const desabilitado = selecionadas === 0 || ocupado
  const pct = progresso && progresso.total > 0 ? Math.round((progresso.feito / progresso.total) * 100) : 0

  return (
    <div className="sticky bottom-0 z-20 rounded-2xl border border-border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur sm:px-4">
      {progresso && (
        <div className="mb-2" aria-live="polite">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {progresso.texto}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-sky-700 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">
            {selecionadas === 1 ? "1 selecionada" : `${selecionadas.toLocaleString("pt-BR")} selecionadas`}
          </div>
          {selecionadas > 0 && semAssinatura > 0 && (
            <div className="text-[12px] text-muted-foreground">
              {semAssinatura === 1 ? "1 profissional sem assinatura" : `${semAssinatura} profissionais sem assinatura`} no cadastro: no PDF sai a linha em branco
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCsv}
          disabled={desabilitado}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-background px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> Exportar CSV
        </button>
        <button
          type="button"
          onClick={onPdf}
          disabled={desabilitado}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-sky-700 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" /> Exportar PDF
        </button>
      </div>
    </div>
  )
}
