'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Toaster } from 'sonner'
import { getSupabaseClient } from '@/lib/supabase/client'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { CompanySettingsProvider } from '@/hooks/nina/useCompanySettings'
import { AuthProvider } from '@/hooks/nina/useAuth'
import Sidebar from '@/components/nina/Sidebar'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'

export default function ConnectLayout({ children }: { children: React.ReactNode }) {
  // O ThemeProvider vive no layout de (dashboard), que é um route group IRMÃO —
  // nada dele alcança /connect. Sem este wrapper o useTheme lá dentro cairia no
  // default do createContext ('light', setTheme vazio): o seletor apareceria e
  // simplesmente não faria nada, que é a falha mais difícil de diagnosticar.
  return (
    <ThemeProvider>
      <ConnectShell>{children}</ConnectShell>
    </ThemeProvider>
  )
}

function ConnectShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { theme } = useTheme()
  const [ready, setReady] = useState(false)
  const [sessionData, setSessionData] = useState<{
    user: any
    session: any
  } | null>(null)

  useEffect(() => {
    getSupabaseClient().auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/login')
        return
      }
      setSessionData({
        user: data.session.user,
        session: data.session,
      })
      setReady(true)
    })
  }, [router])

  if (!ready || !sessionData) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    )
  }

  return (
    <AuthProvider user={sessionData.user} session={sessionData.session}>
      <CompanySettingsProvider>
        <OnboardingProvider>
          <div className="flex h-screen overflow-hidden bg-background text-foreground transition-colors duration-300">
            <Sidebar />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
          {/* Toaster do sonner. O layout raiz monta o da react-hot-toast, que é
              outra biblioteca: as telas do Connect chamam `toast` do sonner, e
              sem este provider toda confirmação de "salvo" era descartada em
              silêncio. `richColors` diferencia sucesso de erro sem depender só
              do texto. O `theme` acompanha o seletor: fixo em "dark" ele pintava
              um toast escuro sobre a tela clara. */}
          <Toaster position="top-right" theme={theme} richColors closeButton />
        </OnboardingProvider>
      </CompanySettingsProvider>
    </AuthProvider>
  )
}
