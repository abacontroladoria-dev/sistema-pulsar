"use client"

import { Suspense } from "react"
import { GradeShell } from "@/components/cronograma/grade/GradeShell"

// Grade — agenda própria do Pulsar, por profissional e por paciente
// (docs/PLANO_GRADE_CRONOGRAMA.md). Suspense: a página lê ?visao/periodo/data/id.
export default function GradePage() {
  return (
    <Suspense fallback={null}>
      <GradeShell />
    </Suspense>
  )
}
