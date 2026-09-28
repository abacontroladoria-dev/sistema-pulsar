import { ABAS_POR_ROTA, codigosToRotas, hasRouteAccess } from "./routes"

// Resolução da permissão efetiva de um usuário (29/09/2026, grupos ao vivo):
//
//   telas = união dos modelos dos grupos dele
//           + ajustes individuais liberados − ajustes individuais retirados
//
// O perfil padrão (`role`) não entra mais no cálculo de telas. O runtime (proxy,
// menu, rotas de API) lê o resultado pronto do banco, pela função
// permissoes_efetivas() (ver ./carregar.ts) — é a mesma regra que as policies
// aplicam em usuario_tem_permissao() (20260929140000). Esta versão em TS existe
// para a tela de Permissões, que calcula várias pessoas de uma vez com os dados
// que já tem na mão; resolver.test.ts trava as duas no mesmo comportamento.
//
// Puro de propósito: recebe os dados já lidos, não fala com o Supabase.

export type OverridePermissao = { permissao_codigo: string; permitido: boolean }

/** União dos modelos: um código entra se QUALQUER grupo o libera. */
export function uniaoDosModelos(modelos: Record<string, boolean>[]): Set<string> {
  const uniao = new Set<string>()
  for (const modelo of modelos) {
    for (const [codigo, permitido] of Object.entries(modelo)) if (permitido) uniao.add(codigo)
  }
  return uniao
}

/**
 * Ajuste individual vence o grupo: um código retirado sai mesmo que um grupo o
 * libere, e um liberado entra mesmo que nenhum grupo o dê.
 */
export function resolverPermissoes(
  ajustes: OverridePermissao[],
  modelosDosGrupos: Record<string, boolean>[]
): Set<string> {
  const codigos = uniaoDosModelos(modelosDosGrupos)
  for (const o of ajustes) {
    if (o.permitido) codigos.add(o.permissao_codigo)
    else codigos.delete(o.permissao_codigo)
  }
  return codigos
}

/**
 * `admin` acessa tudo. Ponto único da regra: o proxy.ts, o Sidebar e as rotas de
 * API a consultam daqui, em vez de cada um repetir `role === "admin"`.
 */
export function isSuperRole(role: string): boolean {
  return role === "admin"
}

/**
 * Um código de permissão específico (usado pela API, que raciocina em código e
 * não em rota — ex: PERMISSAO_INSUMOS).
 */
export function temPermissao(role: string, codigos: Set<string>, codigo: string): boolean {
  return isSuperRole(role) || codigos.has(codigo)
}

/**
 * Uma ROTA está liberada? Resposta única para o gate de navegação (proxy.ts) e
 * para o menu (Sidebar).
 *
 * Existe porque os dois já divergiram na prática: o proxy retornava cedo para
 * `admin` e o `canAccess` do Sidebar não, então um admin abria
 * /autorizacoes-avulsas pelo link e não via o item no menu — o código não estava
 * no conjunto dele. Menu e navegação discordando é sempre
 * bug: ou a tela é inalcançável, ou aparece um item que a navegação recusa.
 *
 * `search` importa: há permissões por aba (ex:
 * /cronograma/indicadores?tab=previsao-receitas), e é `routeMatches` quem sabe
 * comparar rota+querystring.
 */
export function podeAcessarRota(
  role: string,
  codigos: Set<string>,
  pathname: string,
  search = ""
): boolean {
  if (isSuperRole(role)) return true
  return hasRouteAccess(pathname, search, codigosToRotas(codigos))
}

/**
 * Para uma rota de ABAS_POR_ROTA aberta sem `?tab=`: o endereço da primeira aba
 * liberada. `null` quando a rota não é dessas, quando o `?tab=` já veio, ou
 * quando nenhuma aba está liberada (aí a checagem normal manda para
 * /sem-permissao).
 */
export function abaPadraoLiberada(
  role: string,
  codigos: Set<string>,
  pathname: string,
  search = ""
): string | null {
  const abas = ABAS_POR_ROTA[pathname]
  if (!abas || new URLSearchParams(search).has("tab")) return null
  for (const aba of abas) {
    const alvo = `?tab=${aba}`
    if (podeAcessarRota(role, codigos, pathname, alvo)) return `${pathname}${alvo}`
  }
  return null
}
