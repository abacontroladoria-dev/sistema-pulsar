"use client"

// SegmentedTabs — sub-navegação em pílula. Substitui os toggles de sub-aba
// (Inconsistências: Regras/Exceções) e a barra de pills de filtro segmentado.
// Padrão de pill ativo/inativo do §2.6 do plano.

import type { ReactNode } from "react"

export interface SegmentedTab<T extends string> {
  value: T
  label: ReactNode
  count?: number
}

interface SegmentedTabsProps<T extends string> {
  value: T
  onChange: (v: T) => void
  tabs: SegmentedTab<T>[]
  className?: string
  ariaLabel?: string
  /** "sm" (padrão, densidade de dashboard) ou "lg" pra quando a escolha é uma
   *  decisão de destaque na tela, não um filtro secundário. */
  size?: "sm" | "lg"
}

const SIZE_CLS: Record<"sm" | "lg", string> = {
  sm: "px-3 py-1 text-xs",
  lg: "px-4 py-2 text-sm",
}

export function SegmentedTabs<T extends string>({
  value, onChange, tabs, className = "", ariaLabel, size = "sm",
}: SegmentedTabsProps<T>) {
  return (
    // `group` + `aria-pressed`, NÃO `tablist`/`tab`.
    //
    // O contrato ARIA de tablist exige `role="tabpanel"` com `aria-controls`
    // apontando para ele e navegação por setas com roving tabindex. Nada disso
    // existe em nenhum dos 11 consumidores: o leitor de tela anunciava "aba 1
    // de 4" e as setas não faziam nada — uma promessa que a marcação não
    // cumpria. `aria-pressed` descreve honestamente o que estes botões são.
    <div role="group" aria-label={ariaLabel} className={`inline-flex flex-wrap gap-1.5 ${className}`}>
      {tabs.map(t => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.value)}
            className={`inline-flex min-h-11 items-center gap-1 rounded-full font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 ${SIZE_CLS[size]} ${
              active
                // Navy da marca (B.navy) em vez de slate-900, o primário
                // default de template. No dark inverte para branco: navy sobre
                // fundo escuro não se destaca.
                ? "bg-[#222847] text-white border-[#222847] dark:bg-white dark:text-slate-900 dark:border-white"
                : "bg-transparent text-foreground border-border hover:bg-muted/50"
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 tabular-nums ${active ? "opacity-70" : "text-muted-foreground"}`}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}