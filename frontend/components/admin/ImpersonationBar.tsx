'use client'

import { useImpersonation } from '@/contexts/ImpersonationContext'
import { ArrowLeft } from 'lucide-react'

export function ImpersonationBar() {
  const { isImpersonating, impersonatedTarget, stopImpersonation } = useImpersonation()

  if (!isImpersonating || !impersonatedTarget) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 flex items-center justify-between gap-4 bg-amber-100 border-b border-amber-300 px-4 py-3 text-amber-900 font-medium z-60">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-amber-600 rounded-full" />
        <span>
          Visualizando como: <strong>{impersonatedTarget.nome}</strong>
        </span>
      </div>

      <button
        onClick={stopImpersonation}
        className="flex items-center gap-2 px-3 py-1.5 bg-amber-200 hover:bg-amber-300 rounded text-amber-900 font-medium transition-colors"
      >
        <ArrowLeft size={16} />
        Voltar ao meu perfil
      </button>
    </div>
  )
}
