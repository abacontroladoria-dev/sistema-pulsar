"use client"

// ChaveVisao — liga/desliga entre ver as unidades em cartões e compará-las
// numa tabela. Fica colada ao seletor de semana para quem abre a tela notar
// que a comparação existe (como abas à direita, passava despercebida).

export type Visao = "unidades" | "comparar"

export function ChaveVisao({ visao, onChange }: { visao: Visao; onChange: (v: Visao) => void }) {
  const comparar = visao === "comparar"
  const rotulo = (v: Visao, texto: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`min-h-10 rounded-md px-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${visao === v ? "font-bold text-foreground" : "font-medium text-muted-foreground hover:text-foreground"}`}
    >
      {texto}
    </button>
  )
  return (
    <div className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-sm">
      {rotulo("unidades", "Unidades")}
      <button
        type="button"
        role="switch"
        aria-checked={comparar}
        aria-label="Comparar unidades lado a lado"
        onClick={() => onChange(comparar ? "unidades" : "comparar")}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${comparar ? "bg-[#2B5E86] dark:bg-[#5BA6D9]" : "bg-slate-300 dark:bg-slate-600"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${comparar ? "translate-x-5" : ""}`} aria-hidden />
      </button>
      {rotulo("comparar", "Comparar")}
    </div>
  )
}
