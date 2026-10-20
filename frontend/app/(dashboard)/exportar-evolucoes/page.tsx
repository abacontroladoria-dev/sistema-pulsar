import { Suspense } from "react"
import ExportarEvolucoesShell from "@/components/exportar-evolucoes/ExportarEvolucoesShell"

/**
 * Exportar Evoluções — evoluções realizadas (TiTa + Pulsar) em PDF ou CSV para
 * o convênio. Usada pela Autorização; permissão `exportar_evolucoes`.
 * Plano: docs/PLANO_EXPORTAR_EVOLUCOES.md.
 */
export default function ExportarEvolucoesPage() {
  // Suspense: o período mora na URL (useSearchParams).
  return (
    <Suspense>
      <ExportarEvolucoesShell />
    </Suspense>
  )
}
