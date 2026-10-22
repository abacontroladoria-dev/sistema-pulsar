'use client'

import Sidebar from "@/components/Sidebar"
import SinoAlertas from '@/components/alertas/SinoAlertas'
import { ImpersonationBar } from '@/components/admin/ImpersonationBar'
import { AvisoSegundoFator } from '@/components/conta/AvisoSegundoFator'
import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'

import {
  HeaderProvider,
  useHeaderState,
} from '@/contexts/HeaderContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ImpersonationProvider, useImpersonation } from '@/contexts/ImpersonationContext'
import { PermissoesUsuarioProvider } from '@/contexts/PermissoesUsuarioContext'
import { UnsavedChangesProvider } from '@/contexts/UnsavedChangesContext'

const supabase = getSupabaseClient()

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        router.replace('/login')
        return
      }
      const { data: perfil } = await supabase
        .from('usuarios')
        .select('role')
        .eq('id', data.session.user.id)
        .single()
      if (perfil?.role === 'disponibilidade_terapeuta') {
        router.replace('/disponibilidade-terapeuta/')
        return
      }
      setChecking(false)
    })
  }, [])

  if (checking) return null

  return (
    <ImpersonationProvider>
      <PermissoesUsuarioProvider>
        <ThemeProvider>
          <HeaderProvider>
            <UnsavedChangesProvider>
              <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
                <ImpersonationBar />
                <Suspense fallback={null}>
                  <Sidebar />
                </Suspense>
                <DashboardShellContent>
                  {children}
                </DashboardShellContent>
              </div>
            </UnsavedChangesProvider>
          </HeaderProvider>
        </ThemeProvider>
      </PermissoesUsuarioProvider>
    </ImpersonationProvider>
  )
}

function DashboardShellContent({
  children,
}: {
  children: React.ReactNode
}) {
  const { title, subtitle, rightContent } = useHeaderState()
  const { isImpersonating } = useImpersonation()

  return (
    // pt-16 só quando a ImpersonationBar (fixed top) está visível; caso contrário
    // o conteúdo encosta no topo (sem espaço morto).
    <div
      className={`ml-64 flex flex-col h-screen ${
        isImpersonating ? 'pt-16' : ''
      }`}
    >
      {/* SINO DA CENTRAL DE ALERTAS — fora do `{title &&}` de propósito.
          16 das 32 páginas do dashboard nunca chamam setHeader (inclusive
          /solicitar, a tela da recepção), então o header não é renderizado nelas.
          Dentro do bloco condicional, o principal destinatário dos alertas nunca
          veria o sino. Como âncora fixa ele existe em toda página, e o `pr-20` do
          header abaixo reserva o espaço para não cobrir o rightContent. */}
      <SinoAlertas />

      <AvisoSegundoFator />

      {/* HEADER — só exibe quando há título */}
      {title && (
        <header className="h-20 bg-card border-b border-border flex items-center justify-between pl-6 pr-20 shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          {rightContent && <div className="flex items-center">{rightContent}</div>}
        </header>
      )}

      {/* PAGE — min-h-0 obrigatório: em flex-col, flex-1 sem min-h-0 ainda
          pode transbordar o pai, impedindo o overflow-auto de criar um scroll
          container real (e quebrando o position:sticky do SidePanel). */}
      <main className="flex-1 min-h-0 p-6 overflow-auto">
        {children}
      </main>
    </div>
  )
}