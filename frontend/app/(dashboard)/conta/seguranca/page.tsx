'use client'

import { useEffect } from 'react'
import { useHeader } from '@/contexts/HeaderContext'
import { SegurancaContaShell } from '@/components/conta/SegurancaContaShell'

// Segurança da conta — app autenticador (segundo fator). Liberada a todo
// usuário logado (ROTAS_DE_TODOS em lib/permissions/routes.ts); é para cá que o
// proxy manda quem precisa confirmar o código (lib/auth/segundoFator.ts).
export default function SegurancaContaPage() {
  const { setHeader } = useHeader()

  useEffect(() => {
    setHeader('Segurança da conta', 'Código do app autenticador além da senha')
    return () => setHeader('', '')
  }, [setHeader])

  return <SegurancaContaShell />
}
