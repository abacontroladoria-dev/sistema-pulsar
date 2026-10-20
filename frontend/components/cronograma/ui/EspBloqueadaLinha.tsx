"use client"

import Link from "next/link"
import { Lock } from "lucide-react"
import { ROTULO_BLOQUEIO, type EspBloqueada } from "@/lib/cronograma/suspensaoTemporaria"

// Especialidade que o cadastro do paciente bloqueia (suspensão temporária,
// alta registrada, alta clínica) ou que tem alta no laudo — mostrada no painel
// "Quantidade de Sessões" no lugar da contagem, com cadeado e o motivo, para o
// operador entender por que ela não é ofertada.

const COR: Record<EspBloqueada["tipo"], { bg: string; bd: string; fg: string }> = {
  suspensao: { bg: "#fef3c7", bd: "#fcd34d", fg: "#92400e" },
  alta: { bg: "#f1f5f9", bd: "#cbd5e1", fg: "#334155" },
  alta_laudo: { bg: "#f1f5f9", bd: "#cbd5e1", fg: "#334155" },
  alta_clinica: { bg: "#fee2e2", bd: "#fca5a5", fg: "#991b1b" },
}

export function EspBloqueadaLinha({ item }: { item: EspBloqueada }) {
  const cor = COR[item.tipo]
  const rotulo = ROTULO_BLOQUEIO[item.tipo]
  return (
    <div title={`${item.esp}: bloqueada (${rotulo.toLowerCase()})`}>
      <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", marginBottom: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.esp}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
          <Lock size={13} strokeWidth={2.5} aria-label="Bloqueada" style={{ color: cor.fg, flexShrink: 0 }} />
          <span style={{ fontSize: "10px", fontWeight: 700, background: cor.bg, color: cor.fg, border: `1px solid ${cor.bd}`, borderRadius: "4px", padding: "0 5px", whiteSpace: "nowrap" }}>
            {rotulo}
          </span>
        </span>
        {item.href && (
          <Link
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Ver na ficha do paciente (${rotulo.toLowerCase()} de ${item.esp})`}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "22px", height: "22px", borderRadius: "6px", background: "var(--card)", border: `1px solid ${cor.bd}`, color: cor.fg, flexShrink: 0, textDecoration: "none", fontWeight: 900, fontSize: "13px" }}
          >
            →
          </Link>
        )}
      </div>
    </div>
  )
}
