import { MENU_ITENS, type AreaId } from './menu'
import { CODIGO_PARA_ROTAS, hasRouteAccess } from './routes'

// Fora de menu.ts de propósito: scripts/gerar-catalogo-permissoes.mjs importa
// menu.ts direto pelo Node, que não resolve `./routes` sem extensão.

/**
 * A área da tela aberta: a do item do menu cujo código cobre a rota (a mesma
 * regra do proxy, então /cadastros/pacientes/123 cai em "Pacientes", de
 * Operacional). `null` quando nenhum item cobre a rota ou o item é de todas as
 * áreas (Dashboard) — aí o seletor fica onde estava.
 */
export function areaDaRota(pathname: string, search = ''): AreaId | null {
  for (const item of MENU_ITENS) {
    if (!item.area) continue
    const rotas = CODIGO_PARA_ROTAS[item.codigo] ?? []
    if (hasRouteAccess(pathname, search, rotas)) return item.area
  }
  return null
}
