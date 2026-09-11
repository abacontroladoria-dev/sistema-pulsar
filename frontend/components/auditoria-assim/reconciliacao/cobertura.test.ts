import { describe, expect, it } from 'vitest'
import {
  cobertaPorAvulsa,
  guiasSubstituidas,
  sessaoNaoSolicitada,
  sessaoSemCobertura,
  situacaoComVinculo,
  SITUACOES_COBERTAS,
} from './cobertura'
import type { AuditoriaAssimItem, VinculoAutorizacao } from '../types'

/**
 * As duas perguntas que a tela faz sobre uma sessão descoberta, e por que elas
 * têm respostas diferentes.
 *
 * `sessaoSemCobertura` pergunta "alguém cobriu esta sessão?" — é o que a GRADE
 * precisa para marcar o cartão, e ali a sessão glosada conta: a recusa não
 * cobriu nada.
 *
 * `sessaoNaoSolicitada` pergunta "esta sessão é uma pendência que mais ninguém
 * está contando?" — é o que a LISTAGEM precisa, porque ali a mesma recusa já
 * entra como `glosa` pelo lado da autorização.
 *
 * O defeito que separou as duas (Yure Bernardo, agosto/2026): cinco sessões
 * glosadas em 03/08 e quatro nunca solicitadas em 07/08 saíam na linha como
 * "5 glosas + 9 não solicitadas", total 14, para nove sessões de trabalho.
 */

const CUTOFF = '2026-08-26T23:59'

function sessao(p: Partial<AuditoriaAssimItem>): AuditoriaAssimItem {
  return {
    bloco_id: null, paciente_id: null, paciente_nome: 'X', carteirinha: null,
    data_atendimento: '2026-08-03', hora_inicial: '13:00:00', codigo_tuss: null,
    convenio_nome: null, terapias: null, profissionais: null, quantidade_sessoes: null,
    guia: null, status_assim: null, codigo_erro: null, descricao_erro: null,
    data_execucao: null, situacao: null, prioridade: null, dias_atraso: null,
    possui_autorizacao: null, possui_solicitacao: null, observacao: null,
    motivo_glosa: null, teve_token: null, token: null, biofacial: null, criado_por: null,
    forma_autorizacao: null, horario_autorizacao: null, guia_origem: null,
    observacao_manual: null, observacao_manual_atualizado_em: null,
    observacao_manual_atualizado_por_nome: null, token_conferido: null,
    token_conferido_em: null, token_conferido_por_nome: null, vinculo: null,
    reclassificacao_situacao_anterior: null, reclassificacao_justificativa: null,
    reclassificacao_por: null, reclassificacao_em: null,
    ...p,
  }
}

describe('sessaoNaoSolicitada', () => {
  it('a sessão glosada está DESCOBERTA mas não é "não solicitada"', () => {
    // O caso exato de 03/08: as duas perguntas divergem, e é essa divergência
    // que impede a linha de contar a mesma recusa duas vezes.
    const s = sessao({ situacao: 'GLOSA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(true)
    expect(sessaoNaoSolicitada(s, CUTOFF)).toBe(false)
  })

  it('a cancelada também sai — `cancelamento` já a conta', () => {
    const s = sessao({ situacao: 'CANCELADA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(true)
    expect(sessaoNaoSolicitada(s, CUTOFF)).toBe(false)
  })

  it('a sessão que ninguém pediu conta nas duas', () => {
    // O caso de 07/08: sem veredito da ASSIM, nenhuma outra espécie a conta.
    const s = sessao({ situacao: 'NAO_SOLICITADA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(true)
    expect(sessaoNaoSolicitada(s, CUTOFF)).toBe(true)
  })

  it('as outras ausências de resposta continuam contando', () => {
    // Vocabulário medido em produção (clínica inteira, 03–26/08). Nenhuma delas
    // é veredito, então nenhuma é contada por outra espécie.
    for (const situacao of ['SOLICITACAO_CANCELADA', 'SINCRONIZANDO']) {
      expect(sessaoNaoSolicitada(sessao({ situacao }), CUTOFF), situacao).toBe(true)
    }
  })

  it('a sessão coberta não entra em nenhuma das duas', () => {
    for (const situacao of ['LIBERADA', 'GLOSA_RESOLVIDA']) {
      expect(sessaoNaoSolicitada(sessao({ situacao }), CUTOFF), situacao).toBe(false)
    }
  })

  it('falta não entra: a sessão não aconteceu', () => {
    for (const situacao of ['FALTA', 'FALTA_TERAPEUTA']) {
      expect(sessaoNaoSolicitada(sessao({ situacao }), CUTOFF), situacao).toBe(false)
    }
  })

  it('a sessão que ainda não decorreu não é pendência', () => {
    // Herda o corte de 30 minutos de `sessaoSemCobertura` — cobrar autorização
    // do que ainda vai acontecer transformaria a agenda inteira em vermelho.
    const s = sessao({ situacao: 'NAO_SOLICITADA', data_atendimento: '2026-08-28' })
    expect(sessaoNaoSolicitada(s, CUTOFF)).toBe(false)
  })

  it('o vínculo cobre a sessão e ela sai das duas', () => {
    // Uma guia externa vinculada à sessão glosada a torna GLOSA_RESOLVIDA, que
    // é cobertura — a linha para de pedir trabalho antes de a RPC concordar.
    const s = sessao({ situacao: 'GLOSA', bloco_id: 'b1' })
    const vinculos = new Map([['b1', { tipo: 'vinculo' as const }]])
    expect(sessaoSemCobertura(s, CUTOFF, vinculos)).toBe(false)
    expect(sessaoNaoSolicitada(s, CUTOFF, vinculos)).toBe(false)
  })
})

/**
 * A pergunta que a COR da grade faz: esta cobertura veio de uma avulsa?
 *
 * `situacaoComVinculo` manda toda sessão coberta por triagem para
 * GLOSA_RESOLVIDA ou LIBERADA, e as duas são esmeralda — as mesmas de uma
 * liberação que o robô tirou na hora. Reportado da tela: a glosa substituída
 * "não pode ficar verdinha também, porque confunde com uma liberada comum".
 * Quem separa é a procedência, e é esta função que a decide.
 */
describe('cobertaPorAvulsa', () => {
  it('a glosa substituída é marcada — é o caso reportado', () => {
    expect(cobertaPorAvulsa('GLOSA', { tipo: 'vinculo' })).toBe(true)
  })

  it('a não solicitada coberta por avulsa também — ela vira LIBERADA', () => {
    // O caso mais grave dos dois: aqui `situacaoComVinculo` não deixa nem o
    // rótulo "Glosa Resolvida" para trás, então sem esta marca a substituição
    // fica indistinguível de uma liberação de rotina.
    for (const situacao of ['NAO_SOLICITADA', 'CANCELADA', 'SOLICITACAO_CANCELADA']) {
      expect(cobertaPorAvulsa(situacao, { tipo: 'vinculo' }), situacao).toBe(true)
    }
  })

  it('sem vínculo não há procedência a marcar', () => {
    expect(cobertaPorAvulsa('LIBERADA', null)).toBe(false)
    expect(cobertaPorAvulsa('GLOSA', undefined)).toBe(false)
  })

  it('a triagem "autorização extra" não cobre sessão nenhuma', () => {
    expect(cobertaPorAvulsa('GLOSA', { tipo: 'sem_sessao' })).toBe(false)
  })

  it('falta não entra: uma guia não faz a sessão acontecer', () => {
    // Mesma fronteira que `situacaoComVinculo` respeita — falta continua falta
    // depois do vínculo, então não há cobertura cuja procedência marcar.
    for (const situacao of ['FALTA', 'FALTA_TERAPEUTA']) {
      expect(cobertaPorAvulsa(situacao, { tipo: 'vinculo' }), situacao).toBe(false)
    }
  })

  it('situacaoComVinculo é IDEMPOTENTE — o defeito da "Glosa Coberta" que não aparecia', () => {
    /*
      O caso reportado (Kourtney Savino Lopes, 03–07/08). Esta função é o eco de
      um CASE que a RPC já resolve, logo ela recebe de volta a própria saída: com
      a migration viva, `get_auditoria_assim` devolve GLOSA_RESOLVIDA. Sem a
      guarda, `'GLOSA_RESOLVIDA' !== 'GLOSA'` caía no `else` e rebaixava para
      LIBERADA — e o cartão escrevia "Coberta" onde devia escrever "Glosa
      Coberta", perdendo a distinção entre "havia recusa e ela foi coberta" e
      "ninguém tinha pedido".
    */
    expect(situacaoComVinculo('GLOSA_RESOLVIDA', { tipo: 'vinculo' })).toBe('GLOSA_RESOLVIDA')
    expect(situacaoComVinculo('LIBERADA', { tipo: 'vinculo' })).toBe('LIBERADA')

    // A propriedade, e não só os dois casos: aplicar duas vezes é aplicar uma.
    for (const crua of ['GLOSA', 'NAO_SOLICITADA', 'CANCELADA', 'SOLICITACAO_CANCELADA', 'FALTA']) {
      const uma = situacaoComVinculo(crua, { tipo: 'vinculo' })
      expect(situacaoComVinculo(uma, { tipo: 'vinculo' }), crua).toBe(uma)
    }
  })

  it('o par (crua, resolvida) decide as duas palavras que o cartão escreve', () => {
    // O caso reportado (Kourtney Savino Lopes, 03–07/08): uma glosa vinculada.
    // A situação resolvida é que escolhe entre as duas palavras — "Glosa
    // Coberta" quando havia recusa para cobrir, "Coberta" quando não havia —, e
    // a crua é que diz se alguma delas se aplica. As duas em violeta, porque
    // esmeralda ficou só para a liberação de rotina.
    const glosa = { crua: 'GLOSA', resolvida: situacaoComVinculo('GLOSA', { tipo: 'vinculo' }) }
    expect(cobertaPorAvulsa(glosa.crua, { tipo: 'vinculo' })).toBe(true)
    expect(glosa.resolvida).toBe('GLOSA_RESOLVIDA')

    const nunca = situacaoComVinculo('NAO_SOLICITADA', { tipo: 'vinculo' })
    expect(cobertaPorAvulsa('NAO_SOLICITADA', { tipo: 'vinculo' })).toBe(true)
    expect(nunca).toBe('LIBERADA')

    // E a liberação de rotina não é nenhuma das duas: sem vínculo, nada a marcar.
    expect(cobertaPorAvulsa('LIBERADA', null)).toBe(false)
  })

  it('decide pela situação CRUA, não pela já resolvida', () => {
    // O contrato da função, e a razão de ela receber `situacaoCrua`: depois de
    // `situacaoComVinculo` as duas viram esmeralda e a origem se perde. Se
    // alguém lhe passar o valor resolvido, a resposta continua "sim" — o que
    // não pode acontecer é a chamada perder a distinção antes de chegar aqui.
    expect(situacaoComVinculo('GLOSA', { tipo: 'vinculo' })).toBe('GLOSA_RESOLVIDA')
    expect(situacaoComVinculo('NAO_SOLICITADA', { tipo: 'vinculo' })).toBe('LIBERADA')
    // …e as duas são cobertura, portanto esmeralda na grade.
    for (const s of ['GLOSA_RESOLVIDA', 'LIBERADA']) {
      expect(SITUACOES_COBERTAS.has(s), s).toBe(true)
    }
  })
})

function vinculo(p: Partial<VinculoAutorizacao> & { guia: string; tipo: 'vinculo' | 'sem_sessao' }): VinculoAutorizacao {
  return {
    id: 'v', bloco_id: null, guia_original: null, observacao: null,
    vinculado_por: null, vinculado_em: null,
    ...p,
  }
}

describe('guiasSubstituidas', () => {
  it('tipo "vinculo" aposenta a guia da sessão que ele cobre', () => {
    const s = sessao({ bloco_id: 'b1', guia: 'G-GLOSADA' })
    const mapa = new Map([['b1', vinculo({ guia: '15032', tipo: 'vinculo' })]])
    expect([...guiasSubstituidas([s], mapa)]).toEqual(['G-GLOSADA'])
  })

  it('tipo "sem_sessao" NÃO aposenta guia nenhuma', () => {
    /*
      A metade do defeito do caso Saory que não dependia da ordem em
      `calcularLedger`: `sem_sessao` é "esta guia é autorização extra", e sempre
      tem `bloco_id: null` (constraint da tabela). Sem este filtro,
      `vinculosPorBloco.has(s.bloco_id ?? '')` batia contra QUALQUER sessão cujo
      `bloco_id` também fosse nulo — as faltas sintetizadas no serviço —,
      aposentando a guia glosada de uma falta por uma triagem que não a cobre.
    */
    const semBloco = sessao({ bloco_id: null, guia: 'G-FALTA' })
    const mapa = new Map([['', vinculo({ guia: '15032', tipo: 'sem_sessao' })]])
    expect(guiasSubstituidas([semBloco], mapa).size).toBe(0)
  })

  it('sem vínculo para o bloco, a guia continua na fila', () => {
    const s = sessao({ bloco_id: 'b1', guia: 'G1' })
    expect(guiasSubstituidas([s], new Map()).size).toBe(0)
  })

  it('sessão sem guia não entra no conjunto', () => {
    const s = sessao({ bloco_id: 'b1', guia: null })
    const mapa = new Map([['b1', vinculo({ guia: '15032', tipo: 'vinculo' })]])
    expect(guiasSubstituidas([s], mapa).size).toBe(0)
  })
})
