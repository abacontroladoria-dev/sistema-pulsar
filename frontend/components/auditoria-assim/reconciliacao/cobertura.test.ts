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
    motivo_falta: null, justificativa_falta: null,
    data_atendimento_real: null, adiantada_justificativa: null,
    adiantada_por_nome: null, adiantada_em: null,
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

  /*
    UNIDADE_FECHADA entrou aqui em 2026-09-17, e é o caso que motivou o conserto:
    em 07/09 (Independência) as 336 sessões do dia apareciam na Conferência como
    RETORNO_NAO_CONFIRMADO, cobrando tratativa de um dia em que a clínica não
    abriu. Uma sessão que não existiu não pode estar "sem cobertura".
  */
  it('falta não entra: a sessão não aconteceu', () => {
    for (const situacao of ['FALTA', 'FALTA_TERAPEUTA', 'UNIDADE_FECHADA']) {
      expect(sessaoNaoSolicitada(sessao({ situacao }), CUTOFF), situacao).toBe(false)
      expect(sessaoSemCobertura(sessao({ situacao }), CUTOFF), situacao).toBe(false)
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
    for (const situacao of ['FALTA', 'FALTA_TERAPEUTA', 'UNIDADE_FECHADA']) {
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

function vinculo(
  p: Partial<VinculoAutorizacao> & { guia: string; tipo: VinculoAutorizacao['tipo'] }
): VinculoAutorizacao {
  return {
    id: 'v', bloco_id: null, guia_original: null, observacao: null,
    vinculado_por: null, vinculado_em: null,
    ...p,
  }
}

/*
  A FALTA AUTORIZADA — o que vincular a uma falta de terapeuta NÃO faz.

  A ação existe desde 2026-09-21 e é vínculo PURO: a guia sai da fila de órfãs e
  o slot passa a dizer de onde veio a autorização, e mais nada. Estes testes
  existem para que a palavra "vínculo" no nome do tipo nunca convença ninguém a
  tratá-lo como cobertura — a sessão não aconteceu, e uma guia não a faz
  acontecer. Se algum dia alguém "consertar" isto para LIBERADA, é aqui que a
  conta quebra antes de quebrar a assiduidade de um paciente.
*/
describe('falta autorizada por uma guia (tipo falta_terapeuta)', () => {
  it('a falta continua falta — nenhuma situação sem sessão é promovida', () => {
    for (const s of ['FALTA', 'FALTA_TERAPEUTA', 'UNIDADE_FECHADA']) {
      expect(situacaoComVinculo(s, { tipo: 'falta_terapeuta' }), s).toBe(s)
      // E o mesmo vale pelo outro caminho: um vínculo comum apontado a uma falta
      // (o bloco virou falta depois de vinculado) também não a promove.
      expect(situacaoComVinculo(s, { tipo: 'vinculo' }), s).toBe(s)
    }
  })

  it('não afirma cobertura em situação nenhuma — nem nas que o vínculo cobriria', () => {
    // `falta_terapeuta` nunca chega a um bloco de sessão; se chegasse, ainda
    // assim não poderia cobrir. Só `tipo: 'vinculo'` afirma cobertura.
    for (const s of ['GLOSA', 'NAO_SOLICITADA', 'CANCELADA']) {
      expect(situacaoComVinculo(s, { tipo: 'falta_terapeuta' }), s).toBe(s)
    }
  })

  it('não pinta a marca de cobertura por avulsa', () => {
    // A marca responde "houve triagem manual COBRINDO esta sessão?", e aqui não
    // houve cobertura nenhuma — o matiz continua sendo o da falta.
    expect(cobertaPorAvulsa('FALTA_TERAPEUTA', { tipo: 'falta_terapeuta' })).toBe(false)
    expect(cobertaPorAvulsa('GLOSA', { tipo: 'falta_terapeuta' })).toBe(false)
  })

  it('a falta não conta como sessão sem cobertura, nem antes nem depois', () => {
    // Uma falta nunca foi pendência (não havia sessão para autorizar), e
    // registrar a autorização não pode torná-la uma.
    const falta = sessao({ bloco_id: 'falta_1_2026-08-19_08:00:00_22070435', situacao: 'FALTA_TERAPEUTA' })
    const mapa = new Map([[falta.bloco_id!, { tipo: 'falta_terapeuta' as const }]])
    expect(sessaoSemCobertura(falta, '2026-08-31T23:59', mapa)).toBe(false)
    expect(sessaoSemCobertura(falta, '2026-08-31T23:59', new Map())).toBe(false)
  })

  it('é idempotente, como as outras', () => {
    for (const crua of ['FALTA_TERAPEUTA', 'GLOSA', 'LIBERADA']) {
      const uma = situacaoComVinculo(crua, { tipo: 'falta_terapeuta' })
      expect(situacaoComVinculo(uma, { tipo: 'falta_terapeuta' }), crua).toBe(uma)
    }
  })
})

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

  it('tipo "falta_terapeuta" NÃO aposenta guia nenhuma', () => {
    // Aposentar é o gesto de "esta guia glosada deixou de pedir tratativa porque
    // outra a substituiu na sessão". Numa falta não há sessão nem cobertura, e a
    // falta sintetizada nem carrega `guia` — se um dia carregar, continua não
    // sendo substituída por uma autorização que não cobriu nada.
    const falta = sessao({ bloco_id: 'falta_1_2026-08-19_08:00:00_22070435', guia: 'G-QUALQUER' })
    const mapa = new Map([[falta.bloco_id!, vinculo({ guia: '15032', tipo: 'falta_terapeuta' })]])
    expect(guiasSubstituidas([falta], mapa).size).toBe(0)
  })

  it('tipo "substituicao" APOSENTA — ali houve sessão', () => {
    // O par do teste acima, e a diferença entre os dois é a razão de o tipo
    // existir: mesmo bloco sintético, mesma falta na origem, desfecho oposto.
    const falta = sessao({ bloco_id: 'falta_1_2026-09-21_09:20:00_22070397', guia: 'G-ANTIGA' })
    const mapa = new Map([[falta.bloco_id!, vinculo({ guia: '321907', tipo: 'substituicao' })]])
    expect([...guiasSubstituidas([falta], mapa)]).toEqual(['G-ANTIGA'])
  })
})

/*
  O caso João Lucas Pereira Da Silva (21/09/2026), que criou este tipo.

  O titular de Fonoaudiologia faltou às 09:20 — fato, lançado corretamente — e
  OUTRO PROFISSIONAL ASSUMIU: a sessão aconteceu. Pediu-se a avulsa 22070397 para
  autorizá-la, e triá-la como 'falta_terapeuta' — o único desfecho que existia —
  deixava "1 Autorização a mais" de pé na listagem.

  A causa não era a contagem: era que a falta não consumia cota, então a guia
  liberada ficava sem sessão embaixo e o excedente do placar a renomeava de
  volta. Estes testes travam o que separa os dois desfechos — não a falta, que é
  a mesma nos dois, mas ter havido substituto ou não. Se algum dia alguém
  unificar os tipos, é aqui que quebra antes de quebrar a assiduidade de um
  paciente (nos DOIS sentidos: creditando o que não houve, ou negando o que houve).
*/
describe('substituicao — o titular faltou e outro assumiu', () => {
  const BLOCO = 'falta_1_2026-09-21_09:20:00_22070397'

  it('promove a falta a LIBERADA — a sessão aconteceu', () => {
    expect(situacaoComVinculo('FALTA_TERAPEUTA', { tipo: 'substituicao' })).toBe('LIBERADA')
  })

  it('e o irmão NÃO promove — é a única diferença entre os dois', () => {
    // Lado a lado de propósito: as duas chegam com a MESMA situação crua, e só o
    // tipo as separa. Nenhum dado do banco distingue os casos.
    expect(situacaoComVinculo('FALTA_TERAPEUTA', { tipo: 'falta_terapeuta' })).toBe('FALTA_TERAPEUTA')
  })

  it('a falta com substituto deixa de ser sessão sem cobertura', () => {
    const falta = sessao({ bloco_id: BLOCO, situacao: 'FALTA_TERAPEUTA' })
    const mapa = new Map([[BLOCO, { tipo: 'substituicao' as const }]])
    expect(sessaoSemCobertura(falta, '2026-09-30T23:59', mapa)).toBe(false)
    expect(sessaoNaoSolicitada(falta, '2026-09-30T23:59', mapa)).toBe(false)
  })

  it('pinta a marca de procedência — o cartão não pode parecer liberação comum', () => {
    // Sem ela, um slot que a origem ainda chama de falta sairia esmeralda e
    // indistinguível de uma sessão que nunca teve problema nenhum.
    expect(cobertaPorAvulsa('FALTA_TERAPEUTA', { tipo: 'substituicao' })).toBe(true)
    // E o irmão segue sem pintar: ali não houve cobertura.
    expect(cobertaPorAvulsa('FALTA_TERAPEUTA', { tipo: 'falta_terapeuta' })).toBe(false)
  })

  it('é idempotente — LIBERADA reaplicada continua LIBERADA', () => {
    // A mesma armadilha que rebaixava GLOSA_RESOLVIDA em 2026-08-27: esta função
    // recebe de volta a própria saída quando a RPC já resolveu a linha.
    const uma = situacaoComVinculo('FALTA_TERAPEUTA', { tipo: 'substituicao' })
    expect(situacaoComVinculo(uma, { tipo: 'substituicao' })).toBe(uma)
  })

  it('a glosa coberta por substituição continua dizendo GLOSA_RESOLVIDA', () => {
    // O bloco de uma falta não chega glosado, mas a regra não pode depender
    // disso: `substituicao` é cobertura, e cobertura sobre glosa é resolução.
    expect(situacaoComVinculo('GLOSA', { tipo: 'substituicao' })).toBe('GLOSA_RESOLVIDA')
  })
})
