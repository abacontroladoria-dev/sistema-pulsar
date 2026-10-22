import { Suspense } from "react"
import { FaturamentoMensalShell } from "@/components/cronograma/remuneracao/FaturamentoMensalShell"

export default function RelacionamentoPrestadorRPPage() {
  return (
    <Suspense fallback={null}>
      <FaturamentoMensalShell />
    </Suspense>
  )
}
