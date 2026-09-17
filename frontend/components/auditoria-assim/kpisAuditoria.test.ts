import { describe, expect, it } from 'vitest'
import { acumularKpis, contarKpis, ehFalta, kpisVazios } from './kpisAuditoria'
import type { LinhaContavel } from './kpisAuditoria'

function linha(situacao: string | null, teve_token: boolean | null = null): LinhaContavel {
  return { situacao, teve_token }
}

describe('contarKpis — as regras que as duas pontas precisam compartilhar', () => {
  it('desconta o token de liberadas, para o Total não contar a sessão duas vezes', () => {
    const k = contarKpis([
      linha('LIBERADA'),
      linha('LIBERADA', true),
      linha('LIBERADA', true),
    ])
    expect(k.total).toBe(3)
    expect(k.tokens).toBe(2)
    // 3 LIBERADA − 2 com token = 1 no card "Liberadas"
    expect(k.liberadas).toBe(1)
    // O Total continua sendo a âncora: liberadas + tokens reconstroem as 3.
    expect(k.liberadas + k.tokens).toBe(3)
  })

  it('trata AGUARDANDO_RETORNO como RETORNO_NAO_CONFIRMADO', () => {
    const k = contarKpis([linha('RETORNO_NAO_CONFIRMADO'), linha('AGUARDANDO_RETORNO')])
    expect(k.retorno_nao_confirmado).toBe(2)
  })

  it('conta SOLICITACAO_CANCELADA dentro de nao_solicitadas — a ação exigida é a mesma', () => {
    const k = contarKpis([linha('NAO_SOLICITADA'), linha('SOLICITACAO_CANCELADA')])
    expect(k.nao_solicitadas).toBe(2)
  })

  it('NÃO soma GLOSA_RESOLVIDA em glosas — os dois pedem ações opostas', () => {
    const k = contarKpis([linha('GLOSA'), linha('GLOSA'), linha('GLOSA_RESOLVIDA')])
    expect(k.glosas).toBe(2)
    expect(k.glosas_resolvidas).toBe(1)
  })

  it('mantém as faltas fora de total, cada espécie no seu campo', () => {
    const k = contarKpis([
      linha('LIBERADA'),
      linha('FALTA'),
      linha('FALTA_TERAPEUTA'),
      linha('UNIDADE_FECHADA'),
    ])
    expect(k.total).toBe(1)
    expect(k.faltas).toBe(1)
    expect(k.faltas_terapeuta).toBe(1)
    expect(k.unidade_fechada).toBe(1)
  })

  /*
    O defeito que este teste tranca: enquanto eram DUAS espécies de falta, o
    roteamento era `if FALTA ... else faltas_terapeuta`, e esse `else` significava
    "a outra". Com a terceira, ele passou a despejar UNIDADE_FECHADA em
    `faltas_terapeuta` — feriado contado como lacuna de escala da clínica.

    É o mesmo `else` de duas pernas que existia em quatro lugares (aqui, no
    service, no CASE do resumo diário e no da RPC de faltas); os quatro viraram
    comparação exata em 2026-09-17.
  */
  it('não confunde unidade fechada com falta do terapeuta (o `else` de duas pernas)', () => {
    const k = contarKpis([linha('UNIDADE_FECHADA'), linha('UNIDADE_FECHADA')])
    expect(k.unidade_fechada).toBe(2)
    expect(k.faltas_terapeuta).toBe(0)
    expect(k.faltas).toBe(0)
    // E, como as outras duas, fora da régua de autorização.
    expect(k.total).toBe(0)
  })

  it('situação desconhecida entra no total e em card nenhum — não some da âncora', () => {
    const k = contarKpis([linha('COISA_NOVA'), linha(null)])
    expect(k.total).toBe(2)
    expect(k.liberadas).toBe(0)
    expect(k.glosas).toBe(0)
    expect(k.nao_solicitadas).toBe(0)
  })
})

describe('acumularKpis — peso', () => {
  /**
   * A garantia que sustenta a visão gerencial: uma linha de resumo valendo N
   * sessões tem de dar o mesmo que N linhas cruas. Sem isto o modal e a tela
   * diária divergem no primeiro dia com repetição.
   */
  it('uma linha com peso N equivale a N linhas de peso 1', () => {
    const agregado = kpisVazios()
    acumularKpis(agregado, linha('GLOSA'), 5)
    acumularKpis(agregado, linha('LIBERADA', true), 3)

    const cru = contarKpis([
      ...Array.from({ length: 5 }, () => linha('GLOSA')),
      ...Array.from({ length: 3 }, () => linha('LIBERADA', true)),
    ])

    expect(agregado).toEqual(cru)
  })

  it('peso também vale para as faltas', () => {
    const acc = kpisVazios()
    acumularKpis(acc, linha('FALTA'), 4)
    expect(acc.faltas).toBe(4)
    expect(acc.total).toBe(0)
  })
})

describe('ehFalta', () => {
  it('cobre as três espécies e nada além delas', () => {
    expect(ehFalta('FALTA')).toBe(true)
    expect(ehFalta('FALTA_TERAPEUTA')).toBe(true)
    // "Falta" aqui significa "não houve sessão", não "alguém faltou": a
    // unidade fechada entra pela mesma porta e sai do ciclo de autorização.
    expect(ehFalta('UNIDADE_FECHADA')).toBe(true)
    expect(ehFalta('CANCELADA')).toBe(false)
    expect(ehFalta(null)).toBe(false)
  })
})
