import { describe, expect, it } from 'vitest'
import { MENU_ITENS, MENU_ORDEM_GRUPOS } from './menu'
import { CODIGO_PARA_ROTAS, hasRouteAccess } from './routes'

// Trava a regra de 29/09/2026: o catálogo de permissões espelha o Sidebar, e cada
// item do menu tem um código só dele. Se alguém criar uma tela nova e esquecer
// um dos lados, este teste acusa antes do deploy.

describe('menu × catálogo de permissões', () => {
  it('todo item do menu tem código em CODIGO_PARA_ROTAS', () => {
    const semRota = MENU_ITENS.filter((i) => !CODIGO_PARA_ROTAS[i.codigo]).map((i) => i.codigo)
    expect(semRota).toEqual([])
  })

  it('todo código de CODIGO_PARA_ROTAS tem item no menu', () => {
    const noMenu = new Set(MENU_ITENS.map((i) => i.codigo))
    const semItem = Object.keys(CODIGO_PARA_ROTAS).filter((c) => !noMenu.has(c))
    expect(semItem).toEqual([])
  })

  it('nenhum código se repete no menu', () => {
    const codigos = MENU_ITENS.map((i) => i.codigo)
    expect(codigos.length).toBe(new Set(codigos).size)
  })

  it('nenhum rótulo se repete dentro do mesmo grupo', () => {
    const chaves = MENU_ITENS.map((i) => `${i.grupo}::${i.label}`)
    expect(chaves.length).toBe(new Set(chaves).size)
  })

  it('o link de cada item abre com o código do próprio item', () => {
    for (const item of MENU_ITENS) {
      const [path, query] = item.path.split('?')
      const permitido = hasRouteAccess(path, query ? `?${query}` : '', CODIGO_PARA_ROTAS[item.codigo])
      expect(permitido, item.codigo).toBe(true)
    }
  })

  it('todo grupo usado pelos itens existe na ordem dos grupos', () => {
    const fora = MENU_ITENS.filter((i) => !MENU_ORDEM_GRUPOS.includes(i.grupo)).map((i) => i.codigo)
    expect(fora).toEqual([])
  })
})
