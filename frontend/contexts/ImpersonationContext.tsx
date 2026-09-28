'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'

export interface ImpersonationTarget {
  id?: string
  /** "Visualizar como grupo": o menu que o modelo do grupo dá, sem pessoa. */
  grupoId?: string
  nome: string
  role: string
}

interface ImpersonationContextType {
  isImpersonating: boolean
  impersonatedTarget: ImpersonationTarget | null
  effectiveRole: string | null
  realRole: string | null
  canImpersonate: boolean
  startImpersonation: (target: ImpersonationTarget) => void
  stopImpersonation: () => void
}

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined)

const IMPERSONATION_STORAGE_KEY = 'pulsar_impersonation'

export function ImpersonationProvider({ children }: { children: React.ReactNode }) {
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [impersonatedTarget, setImpersonatedTarget] = useState<ImpersonationTarget | null>(null)
  const [realRole, setRealRole] = useState<string | null>(null)
  const [canImpersonate, setCanImpersonate] = useState(false)

  const supabase = getSupabaseClient()

  useEffect(() => {
    const initializeImpersonation = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          return
        }

        const { data: perfil } = await supabase
          .from('usuarios')
          .select('role')
          .eq('id', user.id)
          .single()

        const userRole = perfil?.role || null
        setRealRole(userRole)
        setCanImpersonate(userRole === 'admin')

        if (userRole === 'admin') {
          const stored = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY)
          if (stored) {
            try {
              const target = JSON.parse(stored) as ImpersonationTarget
              setImpersonatedTarget(target)
              setIsImpersonating(true)
            } catch {
              sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY)
            }
          }
        }
      } catch (error) {
        console.error('Erro ao inicializar impersonação:', error)
      }
    }

    initializeImpersonation()
  }, [])

  const startImpersonation = (target: ImpersonationTarget) => {
    if (!canImpersonate) {
      console.warn('Usuário não tem permissão para impersonar')
      return
    }
    setImpersonatedTarget(target)
    setIsImpersonating(true)
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(target))
  }

  const stopImpersonation = () => {
    setIsImpersonating(false)
    setImpersonatedTarget(null)
    sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY)
  }

  const effectiveRole = isImpersonating && impersonatedTarget ? impersonatedTarget.role : realRole

  return (
    <ImpersonationContext.Provider
      value={{
        isImpersonating,
        impersonatedTarget,
        effectiveRole,
        realRole,
        canImpersonate,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  )
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext)
  if (context === undefined) {
    throw new Error('useImpersonation deve ser usado dentro de ImpersonationProvider')
  }
  return context
}
