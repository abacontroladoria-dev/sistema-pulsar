'use client'

import React, { Suspense, useEffect } from 'react'
import { useHeader } from '@/contexts/HeaderContext'
import { AuditoriaEvolucoesShell } from '@/components/terapeutico/auditoria/AuditoriaEvolucoesShell'

export default function AuditoriaEvolucoesPage() {
  const { setHeader } = useHeader()

  useEffect(() => {
    setHeader(
      'Auditoria de Evoluções Terapêuticas',
      'Revisão técnica com IA, detecção de riscos de glosa e gestão de cobrança por profissional'
    )
    return () => setHeader('', '')
  }, [setHeader])

  // A Shell lê o recorte da URL (`useSearchParams`), e no App Router isso obriga
  // um limite de Suspense — sem ele o build falha com "should be wrapped in a
  // suspense boundary". O fallback é nulo de propósito: a própria Shell já tem
  // skeleton para a primeira carga, e um segundo esqueleto aqui piscaria antes
  // dele.
  return (
    <Suspense fallback={null}>
      <AuditoriaEvolucoesShell />
    </Suspense>
  )
}
