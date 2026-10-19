'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import { dataBR, papelPrecisaDeSegundoFator, ROTA_SEGURANCA_CONTA, situacaoExigencia } from '@/lib/auth/segundoFator'

// Faixa nos 7 dias antes da exigência do app autenticador, só para admin e
// diretoria que ainda não confirmaram o código nesta sessão. Some sozinha
// depois do cadastro. A partir da data quem bloqueia é o proxy.ts.
export function AvisoSegundoFator() {
  const { role } = useUsuarioAtual()
  const pathname = usePathname()
  const [semCodigo, setSemCodigo] = useState(false)
  const exigencia = situacaoExigencia()
  const elegivel = exigencia.tipo === 'aviso' && papelPrecisaDeSegundoFator(role)

  useEffect(() => {
    if (!elegivel) return
    let vivo = true
    getSupabaseClient().auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (vivo) setSemCodigo(data?.currentLevel !== 'aal2')
    })
    return () => { vivo = false }
  }, [elegivel, pathname])

  if (!elegivel || !semCodigo || exigencia.tipo !== 'aviso' || pathname?.startsWith(ROTA_SEGURANCA_CONTA)) return null

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        A partir de {dataBR(exigencia.desde)}, administradores e diretoria só entram com o app autenticador.
      </span>
      <Link href={ROTA_SEGURANCA_CONTA} className="font-extrabold underline underline-offset-2">
        Cadastrar agora
      </Link>
    </div>
  )
}
