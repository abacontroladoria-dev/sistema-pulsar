"use client"

import { Bot, Check, User } from "lucide-react"
import type { PepEvidencia, PepOrigemEntrega } from "@/types/pep"

// Quem marcou cada entrega da PEP (20261002100000). O que o ROBÔ marcou é
// violeta suave, o que uma PESSOA marcou é azul suave — nunca cor cheia com
// texto branco. A cor sempre vem acompanhada de ícone e rótulo (DESIGN.md).

export const ORIGEM = {
  robo: {
    rotulo: "Robô",
    icone: Bot,
    selo: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800",
    tinta: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
    texto: "text-violet-700 dark:text-violet-300",
    barra: "bg-violet-500",
  },
  humano: {
    rotulo: "Pessoa",
    icone: User,
    selo: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800",
    tinta: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    texto: "text-blue-700 dark:text-blue-300",
    barra: "bg-blue-500",
  },
} as const

/** Origem da unidade i de um registro (evidência sem origem = pessoa). */
export function origemDaUnidade(evidencias: PepEvidencia[] | null | undefined, i: number): PepOrigemEntrega {
  return evidencias?.[i]?.origem === "robo" ? "robo" : "humano"
}

/** Quantas unidades de cada origem (recorrente: quantidade_entregue; semestral: 1 se entregue). */
export function contarOrigem(registro: { quantidade_entregue?: number | null; status?: string; evidencias?: PepEvidencia[] | null } | null) {
  if (!registro) return { robo: 0, humano: 0 }
  const total = registro.quantidade_entregue ?? (registro.status === "entregue" ? 1 : 0)
  let robo = 0
  for (let i = 0; i < total; i++) if (origemDaUnidade(registro.evidencias, i) === "robo") robo++
  return { robo, humano: total - robo }
}

/** Marca redonda suave na cor de quem entregou. Vazio = unidade pendente. */
export function SeloUnidade({ origem, tamanho = 16 }: { origem: PepOrigemEntrega | null; tamanho?: number }) {
  if (!origem) {
    return <span className="inline-block shrink-0 rounded-full border border-dashed border-border" style={{ width: tamanho, height: tamanho }} aria-hidden />
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${ORIGEM[origem].selo}`} style={{ width: tamanho, height: tamanho }} aria-hidden>
      <Check size={Math.round(tamanho * 0.7)} strokeWidth={2.5} />
    </span>
  )
}

export function ChipOrigem({ origem, compacto }: { origem: PepOrigemEntrega; compacto?: boolean }) {
  const o = ORIGEM[origem]
  const Icone = o.icone
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${o.selo}`}>
      <Icone size={12} aria-hidden /> {compacto ? null : o.rotulo}
      {compacto && <span className="sr-only">{o.rotulo}</span>}
    </span>
  )
}

/** Linha simples de legenda no topo da visão do analista, sem cartão próprio. */
export function LegendaOrigem({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      <span className="font-semibold text-foreground">Quem marcou:</span>
      {(["robo", "humano"] as const).map(o => {
        const Icone = ORIGEM[o].icone
        return (
          <span key={o} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ${ORIGEM[o].selo}`}>
            <SeloUnidade origem={o} tamanho={14} />
            <Icone size={12} aria-hidden />
            <span>{o === "robo" ? "Robô SharePoint" : "Pessoa da equipe"}</span>
          </span>
        )
      })}
      <span className="inline-flex items-center gap-1.5"><SeloUnidade origem={null} tamanho={14} /> pendente</span>
    </div>
  )
}
