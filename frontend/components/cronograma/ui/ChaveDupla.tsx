"use client"

// ChaveDupla — switch entre DUAS opções, com o rótulo de cada lado clicável
// ("Unidades ⟷ Comparar" na Ocupação Clínica; "Tratamento Multidisciplinar ⟷
// Processo Diagnóstico" na evolução do Dashboard de Pacientes). O lado
// escolhido fica em negrito; o switch no meio alterna.

export interface OpcaoChave<T extends string> {
  valor: T
  rotulo: string
}

export function ChaveDupla<T extends string>({
  valor, esquerda, direita, onChange, ariaLabel,
}: {
  valor: T
  esquerda: OpcaoChave<T>
  direita: OpcaoChave<T>
  onChange: (v: T) => void
  /** O que o switch faz quando ligado (ex.: "Comparar unidades lado a lado"). */
  ariaLabel: string
}) {
  const ligado = valor === direita.valor
  const rotulo = (o: OpcaoChave<T>) => (
    <button
      type="button"
      onClick={() => onChange(o.valor)}
      className={`min-h-10 rounded-md px-1 text-left text-sm leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${valor === o.valor ? "font-bold text-foreground" : "font-medium text-muted-foreground hover:text-foreground"}`}
    >
      {o.rotulo}
    </button>
  )
  return (
    // min-h (não h fixo): em tela estreita um rótulo longo quebra linha em vez de ser cortado.
    <div className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 shadow-sm">
      {rotulo(esquerda)}
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={ariaLabel}
        onClick={() => onChange(ligado ? esquerda.valor : direita.valor)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ligado ? "bg-[#2B5E86] dark:bg-[#5BA6D9]" : "bg-slate-300 dark:bg-slate-600"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none ${ligado ? "translate-x-5" : ""}`} aria-hidden />
      </button>
      {rotulo(direita)}
    </div>
  )
}
