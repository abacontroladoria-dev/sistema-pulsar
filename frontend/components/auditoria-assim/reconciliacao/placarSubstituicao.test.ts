import { describe, expect, it } from 'vitest'
import { calcularPlacar, excedentesDoPlacar } from './contagem'
import type { AuditoriaAssimItem, AutorizacaoAssimSemana, VinculoAutorizacao } from '../types'

/**
 * A SEGUNDA fonte da pendência — a que sobrevivia ao vínculo.
 *
 * `cobertura.test.ts` trava a regra de cobertura; este arquivo trava a CONTA que
 * depende dela, e existe porque o defeito relatado (João Lucas, 21/09/2026)
 * vivia exatamente na junta entre as duas.
 *
 * O que acontecia: a Luana vinculou a guia avulsa 22070397 à falta de terapeuta
 * das 09:20, e a linha continuou dizendo "1 Autorização a mais". A guia tinha
 * saído da fila de órfãs — metade do sistema já sabia do vínculo —, mas
 * `calcularPlacar` lia a situação CRUA, pulava a falta antes de contá-la em
 * `agendadas`, e o `excedente = liberadas − agendadas` acusava 1. Daí
 * `excedentesDoPlacar` renomeava a guia recém-triada de volta como excedente.
 *
 * Nenhum dos dois números estava errado isoladamente. Errado era um deles saber
 * do vínculo e o outro não — que é a divergência que esta tela existe para caçar,
 * virada contra ela mesma.
 */

const CUTOFF = '2026-09-30T23:59'
const TUSS = '22070397'
const BLOCO = 'falta_1_2026-09-21_09:20:00_22070397'

function falta(p: Partial<AuditoriaAssimItem> = {}): AuditoriaAssimItem {
  return {
    bloco_id: BLOCO, paciente_id: null, paciente_nome: 'João Lucas', carteirinha: null,
    data_atendimento: '2026-09-21', hora_inicial: '09:20:00', codigo_tuss: TUSS,
    convenio_nome: null, terapias: 'Fonoaudiologia', profissionais: null,
    quantidade_sessoes: null, guia: null, status_assim: null, codigo_erro: null,
    descricao_erro: null, data_execucao: null, situacao: 'FALTA_TERAPEUTA',
    prioridade: null, dias_atraso: null, possui_autorizacao: null,
    possui_solicitacao: null, observacao: null, motivo_glosa: null, teve_token: null,
    token: null, biofacial: null, criado_por: null, forma_autorizacao: null,
    horario_autorizacao: null, guia_origem: null, observacao_manual: null,
    observacao_manual_atualizado_em: null, observacao_manual_atualizado_por_nome: null,
    token_conferido: null, token_conferido_em: null, token_conferido_por_nome: null,
    vinculo: null, reclassificacao_situacao_anterior: null,
    reclassificacao_justificativa: null, reclassificacao_por: null,
    reclassificacao_em: null, motivo_falta: null, justificativa_falta: null,
    data_atendimento_real: null, adiantada_justificativa: null,
    adiantada_por_nome: null, adiantada_em: null,
    ...p,
  }
}

function autorizacao(guia: string): AutorizacaoAssimSemana {
  return {
    guia, paciente_id: null, matricula: null, paciente_nome: 'João Lucas',
    data_execucao: '2026-09-21T14:03:00', status: 'Liberado', codigo_tuss: TUSS,
    codigo_erro: null, descricao_erro: null, teve_token: null, token: null,
  }
}

function triagem(tipo: VinculoAutorizacao['tipo']): VinculoAutorizacao {
  return {
    id: 'v1', guia: '321907', tipo, bloco_id: BLOCO, guia_original: null,
    observacao: null, vinculado_por: 'Luana', vinculado_em: '2026-09-22T10:00:00Z',
  }
}

describe('a falta com substituto consome cota', () => {
  const sessoes = [falta()]
  const autorizacoes = [autorizacao('321907')]

  it('sem triagem, a falta não conta como agendada e sobra excedente', () => {
    // O estado ANTES do vínculo, e ele está correto: a falta não aconteceu, a
    // guia liberada não tem sessão embaixo, e há mesmo uma autorização a mais.
    const [linha] = calcularPlacar(sessoes, autorizacoes, CUTOFF)
    expect(linha.agendadas).toBe(0)
    expect(linha.liberadas).toBe(1)
    expect(linha.excedente).toBe(1)
  })

  it('triada como "falta_terapeuta", o excedente PERMANECE — ninguém atendeu', () => {
    // Não é regressão: aqui a sessão realmente não aconteceu. A guia autorizou
    // um horário vazio, e ela é, de fato, uma autorização a mais.
    const mapa = new Map([[BLOCO, triagem('falta_terapeuta')]])
    const [linha] = calcularPlacar(sessoes, autorizacoes, CUTOFF, mapa)
    expect(linha.agendadas).toBe(0)
    expect(linha.excedente).toBe(1)
  })

  it('triada como "substituicao", a falta vira cota e o excedente ZERA', () => {
    // O conserto, medido onde o defeito vivia. A sessão aconteceu com outro
    // profissional: ela é agendada como qualquer outra, e a guia que a cobre
    // deixa de ser "a mais".
    const mapa = new Map([[BLOCO, triagem('substituicao')]])
    const [linha] = calcularPlacar(sessoes, autorizacoes, CUTOFF, mapa)
    expect(linha.agendadas).toBe(1)
    expect(linha.decorridas).toBe(1)
    expect(linha.excedente).toBe(0)
    // E, coberta, ela não entra em nenhuma das duas contagens de pendência.
    expect(linha.faltante).toBe(0)
    expect(linha.naoSolicitada).toBe(0)
  })

  it('e com o excedente zerado, nenhuma guia é renomeada como "a mais"', () => {
    /*
      A ponta final do defeito: era `excedentesDoPlacar` que trazia a guia de
      volta à contagem depois de ela ter saído da fila de órfãs. Com o placar
      certo ela não tem mais o que marcar — e é isso que apaga o badge "1
      Autorização a mais" da linha do paciente.
    */
    const mapa = new Map([[BLOCO, triagem('substituicao')]])
    const placar = calcularPlacar(sessoes, autorizacoes, CUTOFF, mapa)
    expect(excedentesDoPlacar(placar, autorizacoes).size).toBe(0)

    // O contraste: sem a triagem de substituição, a guia é marcada.
    const semTriagem = calcularPlacar(sessoes, autorizacoes, CUTOFF)
    expect([...excedentesDoPlacar(semTriagem, autorizacoes)]).toEqual(['321907'])
  })
})
