"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { getSupabaseClient } from "@/lib/supabase/client"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { podeAcessarRota, uniaoDosModelos } from "@/lib/permissions/resolver"
import { carregarGruposDoUsuario, carregarPermissoesEfetivas, rotuloDosGrupos } from "@/lib/permissions/carregar"

// O que a pessoa (ou quem o admin está visualizando) pode abrir. Saiu de dentro
// do Sidebar em 22/10/2026 para o seletor de área e a busca mestre lerem a MESMA
// resposta: uma consulta só, e o "Visualizar como" vale para os três.
type PermissoesUsuario = {
  role: string | null
  // Guarda os CÓDIGOS, não as rotas já convertidas: `podeAcessarRota` (a mesma do
  // proxy.ts) faz a conversão por dentro, e é o que mantém menu e navegação com
  // uma implementação só.
  codigos: Set<string>
  // Os grupos de permissão mostrados no rodapé do Sidebar, embaixo do nome — no
  // lugar do nível técnico (`role`), que é só do banco. `null`: rótulo vazio.
  gruposRotulo: string | null
  carregando: boolean
  /** O href (pode trazer ?tab=) está liberado? */
  canAccess: (path: string) => boolean
}

const PermissoesUsuarioContext = createContext<PermissoesUsuario | undefined>(undefined)

export function PermissoesUsuarioProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseClient()
  const { isImpersonating, impersonatedTarget } = useImpersonation()
  const [role, setRole] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [codigos, setCodigos] = useState<Set<string>>(new Set())
  const [gruposRotulo, setGruposRotulo] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadRole() {
      let targetId: string | undefined
      let targetGrupoId: string | undefined
      let targetRole: string | null

      if (isImpersonating && impersonatedTarget) {
        targetId = impersonatedTarget.id
        targetGrupoId = impersonatedTarget.grupoId
        targetRole = impersonatedTarget.role
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (isMounted) setCarregando(false)
          return
        }
        targetId = user.id
        const { data } = await supabase
          .from("usuarios")
          .select("role")
          .eq("id", user.id)
          .single()
        targetRole = data?.role || null
      }

      if (!isMounted) return

      setRole(targetRole)

      if (!targetRole) {
        setCodigos(new Set())
        setCarregando(false)
        return
      }

      // Telas efetivas pelo banco (grupos ao vivo + ajustes individuais) — o
      // mesmo carregador do proxy.ts e das rotas de API. "Visualizar como grupo"
      // mostra o modelo daquele grupo sozinho, sem pessoa por trás.
      let resolvidos = new Set<string>()
      let rotulo: string | null = null
      try {
        if (targetGrupoId) {
          const { data } = await supabase
            .from("grupos_permissoes")
            .select("nome, modelo_permissoes")
            .eq("id", targetGrupoId)
            .maybeSingle()
          resolvidos = uniaoDosModelos([(data?.modelo_permissoes as Record<string, boolean>) ?? {}])
          rotulo = (data?.nome as string | undefined) ?? null
        } else {
          const alvo = isImpersonating ? targetId : undefined
          const [c, g] = await Promise.all([
            carregarPermissoesEfetivas(supabase, alvo),
            carregarGruposDoUsuario(supabase, alvo),
          ])
          resolvidos = c
          rotulo = rotuloDosGrupos(g)
        }
      } catch (error) {
        console.error("Erro ao carregar permissões do usuário:", error)
      }

      if (isMounted) {
        setCodigos(resolvidos)
        setGruposRotulo(rotulo)
        setCarregando(false)
      }
    }

    loadRole()

    return () => {
      isMounted = false
    }
  }, [isImpersonating, impersonatedTarget, supabase])

  const canAccess = useCallback(
    (path: string) => {
      if (!role) return false
      // `podeAcessarRota` é a MESMA função do proxy.ts, o gate real da navegação —
      // inclusive o "admin acessa tudo". Enquanto eram duas implementações, o admin
      // abria /autorizacoes-avulsas pelo link e não via o item no menu.
      const [barePath, query] = path.split("?")
      return podeAcessarRota(role, codigos, barePath, query ? `?${query}` : "")
    },
    [role, codigos]
  )

  const valor = useMemo(
    () => ({ role, codigos, gruposRotulo, carregando, canAccess }),
    [role, codigos, gruposRotulo, carregando, canAccess]
  )

  return <PermissoesUsuarioContext.Provider value={valor}>{children}</PermissoesUsuarioContext.Provider>
}

export function usePermissoesUsuario() {
  const context = useContext(PermissoesUsuarioContext)
  if (context === undefined) {
    throw new Error("usePermissoesUsuario deve ser usado dentro de PermissoesUsuarioProvider")
  }
  return context
}
