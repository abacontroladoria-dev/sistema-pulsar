import { normTxt } from "@/lib/cronograma/constants"
import { MENU_AREA_POR_ID, MENU_ITENS, itemNoMenu, type MenuItemDef } from "@/lib/permissions/menu"

export type ResultadoFerramenta = {
  item: MenuItemDef
  /** "Relatórios › Indicadores" — onde a tela fica no menu. */
  caminho: string
}

/**
 * As telas do menu que batem com o termo, SÓ entre as que a pessoa pode abrir
 * (`podeAbrir` é o `canAccess` do Sidebar — a mesma regra do proxy). Roda no
 * navegador, sem consulta: aparece enquanto o servidor ainda busca os cadastros.
 *
 * Ordem: o nome da tela começa com o termo › contém o termo › só o grupo, a
 * área ou uma palavra-chave contém. Empate fica na ordem do menu.
 */
export function buscarFerramentas(
  termo: string,
  podeAbrir: (path: string) => boolean,
  limite = 6
): ResultadoFerramenta[] {
  const t = normTxt(termo)
  if (!t) return []

  const achados: { item: MenuItemDef; nota: number; ordem: number }[] = []
  MENU_ITENS.forEach((item, ordem) => {
    const nome = normTxt(item.label)
    const area = item.area ? MENU_AREA_POR_ID[item.area].nome : ""
    const resto = normTxt(`${item.grupo} ${area} ${item.palavrasChave ?? ""}`)
    const nota = nome.startsWith(t) ? 0 : nome.includes(t) ? 1 : resto.includes(t) ? 2 : -1
    if (nota < 0 || !itemNoMenu(item) || !podeAbrir(item.path)) return
    achados.push({ item, nota, ordem })
  })

  return achados
    .sort((a, b) => a.nota - b.nota || a.ordem - b.ordem)
    .slice(0, limite)
    .map(({ item }) => ({ item, caminho: caminhoDaTela(item) }))
}

function caminhoDaTela(item: MenuItemDef): string {
  // Dashboard e Connect estão no grupo "Geral", que não existe no menu como
  // grupo: o caminho mostra só a área (ou nada).
  const grupo = item.grupo === "Geral" ? null : item.grupo
  const area = item.area && item.area !== "connect" ? MENU_AREA_POR_ID[item.area].nome : null
  return [area, grupo].filter(Boolean).join(" › ")
}
