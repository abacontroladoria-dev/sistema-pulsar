'use client'

import { Suspense, useEffect } from 'react'
import { useHeader } from '@/contexts/HeaderContext'
import { AuditoriaDocumentosShell } from '@/components/relacionamento-prestador/auditoria-documentos/AuditoriaDocumentosShell'

export default function AuditoriaDocumentosPepPage() {
  const { setHeader } = useHeader()

  useEffect(() => {
    setHeader(
      'Auditoria de Documentos PEP',
      'O conteúdo das evidências dos prestadores: o que está bom, o que pode conter erros e o que está errado'
    )
    return () => setHeader('', '')
  }, [setHeader])

  // A Shell lê o recorte da URL (useSearchParams): o App Router exige Suspense.
  return (
    <Suspense fallback={null}>
      <AuditoriaDocumentosShell />
    </Suspense>
  )
}
