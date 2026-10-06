"use client"

import { useEffect, useState } from "react"
import { getFotoUrlAssinada } from "@/services/pacientesFoto.service"

/**
 * URL assinada de um path do bucket privado de fotos (com o cache de
 * getFotoUrlAssinada). Sem path, ou path órfão, devolve null — quem usa cai no
 * desenho padrão em vez de mostrar imagem quebrada.
 */
export function useUrlAssinada(path: string | null | undefined): string | null {
  const [resolvida, setResolvida] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!path) return
    let ativo = true
    getFotoUrlAssinada(path).then(url => { if (ativo) setResolvida({ path, url }) })
    return () => { ativo = false }
  }, [path])

  // Só vale a URL do path ATUAL: trocou a foto, a antiga some na hora.
  return path && resolvida?.path === path ? resolvida.url : null
}
