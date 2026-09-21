"use client"

import { useEffect, useState } from "react"
import { useUsuarioAtual } from "@/hooks/useUsuarioAtual"
import { getUsuarioPermissoes } from "@/services/permissoes.service"
import { resolverPermissoes, temPermissao } from "@/lib/permissions/resolver"

// Se o usuário logado tem UM código de permissão específico — mesma regra
// (defaults do papel + overrides, "admin acessa tudo") que o Sidebar usa pra
// decidir o que mostrar no menu, mas exposta como hook pra telas que precisam
// de um botão/link condicional sem duplicar a leitura de role + overrides.
//
// `tem` começa `false` e só vira `true` depois que a permissão foi
// efetivamente resolvida — evita mostrar o botão e escondê-lo de novo um
// instante depois.
export function useTemPermissao(codigo: string): { tem: boolean; carregando: boolean } {
  const { userId, role, perfilLido, loading: carregandoUsuario } = useUsuarioAtual()
  const [codigos, setCodigos] = useState<Set<string>>(new Set())
  const [carregandoPermissoes, setCarregandoPermissoes] = useState(true)

  useEffect(() => {
    let ativo = true
    if (carregandoUsuario) return
    if (!perfilLido || !role || !userId) {
      setCarregandoPermissoes(false)
      return
    }
    getUsuarioPermissoes(userId)
      .then((overrides) => { if (ativo) setCodigos(resolverPermissoes(role, overrides)) })
      .finally(() => { if (ativo) setCarregandoPermissoes(false) })
    return () => { ativo = false }
  }, [userId, role, perfilLido, carregandoUsuario])

  const carregando = carregandoUsuario || carregandoPermissoes
  const tem = !carregando && !!role && temPermissao(role, codigos, codigo)
  return { tem, carregando }
}
