"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { usePermissoesUsuario } from "@/contexts/PermissoesUsuarioContext"
import { areaDaRota } from "@/lib/permissions/areas"
import { MENU_AREAS, MENU_ITENS, itemNoMenu, type AreaId, type MenuAreaDef } from "@/lib/permissions/menu"

// Última área escolhida, por navegador. Só conveniência: sem storage (aba
// anônima, bloqueado) o menu abre em Operacional ou na área da tela aberta.
const CHAVE = "sidebar_area"

function lerAreaGuardada(): AreaId | null {
  try {
    const v = localStorage.getItem(CHAVE)
    return MENU_AREAS.some((a) => a.id === v && a.id !== "connect") ? (v as AreaId) : null
  } catch {
    return null
  }
}

export function guardarArea(area: AreaId) {
  // Connect não fica guardado: ele tem tela própria, e voltar ao Pulsar deve
  // abrir a área em que a pessoa estava antes.
  if (area === "connect") return
  try {
    localStorage.setItem(CHAVE, area)
  } catch {}
}

/** As áreas em que a pessoa tem pelo menos uma tela liberada, na ordem do seletor. */
export function useAreasVisiveis(): MenuAreaDef[] {
  const { canAccess } = usePermissoesUsuario()
  return useMemo(
    () => MENU_AREAS.filter((a) => MENU_ITENS.some((i) => i.area === a.id && itemNoMenu(i) && canAccess(i.path))),
    [canAccess]
  )
}

/**
 * A área do Sidebar do Pulsar. Ordem: a área da tela aberta (abrir pela busca
 * uma tela de Relatórios troca o menu para Relatórios), senão a última escolhida,
 * senão a primeira liberada. Escolher Pulsar Connect navega para o Connect.
 */
export function useAreaDoMenu() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const areas = useAreasVisiveis()
  const search = searchParams.toString()

  // A escolha manual vale até a próxima navegação para uma tela de outra área.
  // Guardada junto da rota em que foi feita: mudou a rota, a área da rota manda.
  const [escolha, setEscolha] = useState<{ area: AreaId; rota: string } | null>(null)
  const rota = `${pathname}?${search}`
  const daRota = areaDaRota(pathname, search ? `?${search}` : "")

  let area: AreaId | null =
    escolha && escolha.rota === rota ? escolha.area : daRota && daRota !== "connect" ? daRota : null
  if (!area) area = escolha?.area ?? lerAreaGuardada()
  if (!area || !areas.some((a) => a.id === area)) {
    area = areas.find((a) => a.id !== "connect")?.id ?? "operacional"
  }

  // A área que veio da rota fica guardada para a próxima vez.
  useEffect(() => {
    if (daRota) guardarArea(daRota)
  }, [daRota])

  function escolher(id: AreaId) {
    if (id === "connect") {
      router.push("/connect")
      return
    }
    setEscolha({ area: id, rota })
    guardarArea(id)
  }

  return { area, areas, escolher }
}
