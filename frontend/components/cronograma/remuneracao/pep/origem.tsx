"use client"

import { Bot, Check, User } from "lucide-react"
import type { PepEvidencia, PepOrigemEntrega } from "@/types/pep"

// Quem marcou cada entrega da PEP (20261002100000). Pedido do usuário
// (01/10/2026): o que o ROBÔ marcou é ROXO, o que uma PESSOA marcou é AZUL —
// em toda a tela, do check da célula ao valor apurado. Um lugar só para as
// cores: nenhuma outra peça da PEP usa violeta ou azul para outra coisa.
//
// A cor sempre vem com ícone e palavra (Bot "Robô" / User "Pessoa"): a cor
// reforça, nunca é o único sinal (DESIGN.md).

export const ORIGEM = {
  robo: {
    rotulo: "Robô",
    icone: Bot,
    selo: "bg-violet-600 text-white",
    tinta: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
    texto: "text-violet-700 dark:text-violet-300",
    barra: "bg-violet-600",
  },
  humano: {
    rotulo: "Pessoa",
    icone: User,
    selo: "bg-blue-600 text-white",
    tinta: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
    texto: "text-blue-700 dark:text-blue-300",
    barra: "bg-blue-600",
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

/** Check redondo na cor de quem entregou. Vazio = unidade pendente. */
export function SeloUnidade({ origem, tamanho = 16 }: { origem: PepOrigemEntrega | null; tamanho?: number }) {
  if (!origem) {
    return <span className="inline-block shrink-0 rounded-full border border-dashed border-slate-300 dark:border-slate-600" style={{ width: tamanho, height: tamanho }} aria-hidden />
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${ORIGEM[origem].selo}`} style={{ width: tamanho, height: tamanho }} aria-hidden>
      <Check size={Math.round(tamanho * 0.7)} strokeWidth={3} />
    </span>
  )
}

export function ChipOrigem({ origem, compacto }: { origem: PepOrigemEntrega; compacto?: boolean }) {
  const o = ORIGEM[origem]
  const Icone = o.icone
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${o.tinta}`}>
      <Icone size={12} aria-hidden /> {compacto ? null : o.rotulo}
      {compacto && <span className="sr-only">{o.rotulo}</span>}
    </span>
  )
}

/** "✓ Robô  ✓ Pessoa" — fica no topo das duas visões da PEP. */
export function LegendaOrigem({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      <span className="font-semibold text-foreground">Quem marcou:</span>
      {(["robo", "humano"] as const).map(o => {
        const Icone = ORIGEM[o].icone
        return (
          <span key={o} className="inline-flex items-center gap-1.5">
            <SeloUnidade origem={o} tamanho={16} />
            <Icone size={13} className={ORIGEM[o].texto} aria-hidden />
            <span className={`font-semibold ${ORIGEM[o].texto}`}>{o === "robo" ? "Robô SharePoint" : "Pessoa da equipe"}</span>
          </span>
        )
      })}
      <span className="inline-flex items-center gap-1.5"><SeloUnidade origem={null} tamanho={16} /> pendente</span>
    </div>
  )
}
