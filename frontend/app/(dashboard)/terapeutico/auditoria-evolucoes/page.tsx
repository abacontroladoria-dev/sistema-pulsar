'use client'

import React, { useEffect } from 'react'
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

  return <AuditoriaEvolucoesShell />
}
