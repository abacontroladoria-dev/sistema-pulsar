import { describe, expect, it } from 'vitest'
import { candidataElegivel, distanciaCurta, mapearCandidatas, sessaoDoBloco } from './vinculo'
import type { CandidataVinculo } from '../types'

/** As quatro semanas de agosto/2026 que o mês carregado cobre. */
const SEMANAS = [
  { inicio: '2026-07-27', fim: '2026-07-31' },
  { inicio: '2026-08-03', fim: '2026-08-07' },
  { inicio: '2026-08-10', fim: '2026-08-14' },
  { inicio: '2026-08-17', fim: '2026-08-21' },
]

function candidata(p: Partial<CandidataVinculo> & { bloco_id: string }): CandidataVinculo {
  return {
    paciente_id: null, paciente_nome: null, data_atendimento: null, hora_inicial: null,
    codigo_tuss: null, terapias: null, profissionais: null, quantidade_sessoes: null,
    situacao: null, guia_atual: null, status_assim: null, motivo_glosa_codigo: null,
    motivo_glosa_descricao: null, nota_manual: null, observacao: null, fila_id: null,
    tipo_falta: null,
    distancia_horas: null, ja_vinculado: false, elegivel: true,
    ...p,
  }
}

describe('candidataElegivel', () => {
  it('exige os dois booleanos, e null nunca vira "pode clicar"', () => {
    expect(candidataElegivel(candidata({ bloco_id: 'a' }))).toBe(true)
    expect(candidataElegivel(candidata({ bloco_id: 'a', elegivel: false }))).toBe(false)
    expect(candidataElegivel(candidata({ bloco_id: 'a', elegivel: null }))).toBe(false)
    expect(candidataElegivel(candidata({ bloco_id: 'a', ja_vinculado: true }))).toBe(false)
  })
})

describe('mapearCandidatas', () => {
  it('põe na grade a candidata que tem cartão, elegível ou não', () => {
    const mapa = mapearCandidatas(
      [
        candidata({ bloco_id: 'a', data_atendimento: '2026-08-19' }),
        candidata({ bloco_id: 'b', data_atendimento: '2026-08-20', elegivel: false }),
      ],
      SEMANAS,
      '2026-08-17',
      new Set(['a', 'b'])
    )
    // A já-liberada continua indexada: é o que faz o operador perceber que a
    // guia é extra, em vez de sumir e deixar a semana parecendo vazia.
    expect([...mapa.naGrade.keys()].sort()).toEqual(['a', 'b'])
    expect(mapa.totalElegiveis).toBe(1)
    // A semana aberta conta a sua candidata como qualquer outra — a faixa do
    // cabeçalho precisa dizer "1 aqui" e não deixar a atual em branco.
    expect(mapa.porSemana.get('2026-08-17')).toBe(1)
    expect(mapa.semCartao).toHaveLength(0)
  })

  it('conta por semana a elegível que a janela de 7 dias jogou para trás', () => {
    const mapa = mapearCandidatas(
      [
        candidata({ bloco_id: 'a', data_atendimento: '2026-08-17' }),
        candidata({ bloco_id: 'b', data_atendimento: '2026-08-13' }),
        candidata({ bloco_id: 'c', data_atendimento: '2026-08-12' }),
      ],
      SEMANAS,
      '2026-08-17',
      new Set(['a'])
    )
    expect(mapa.totalElegiveis).toBe(3)
    expect(mapa.naGrade.has('a')).toBe(true)
    expect(mapa.porSemana.get('2026-08-17')).toBe(1)
    expect(mapa.porSemana.get('2026-08-10')).toBe(2)
  })

  it('separa a que está fora do mês carregado — ela exige trocar de mês', () => {
    const mapa = mapearCandidatas(
      [candidata({ bloco_id: 'a', data_atendimento: '2026-07-23' })],
      SEMANAS,
      '2026-08-03',
      new Set()
    )
    expect(mapa.foraDoMes.map((c) => c.bloco_id)).toEqual(['a'])
    expect(mapa.porSemana.size).toBe(0)
  })

  it('acusa a elegível da semana aberta que não virou cartão', () => {
    // O caso que não deveria existir: cai na semana exibida e mesmo assim não
    // foi desenhada. Contada para aparecer escrita em vez de sumir calada.
    const mapa = mapearCandidatas(
      [candidata({ bloco_id: 'a', data_atendimento: '2026-08-18' })],
      SEMANAS,
      '2026-08-17',
      new Set()
    )
    expect(mapa.semCartao.map((c) => c.bloco_id)).toEqual(['a'])
    // Contada na semana mesmo assim: o total da barra e o da faixa não podem
    // discordar só porque um cartão faltou.
    expect(mapa.porSemana.get('2026-08-17')).toBe(1)
  })

  it('não deixa a candidata sem data sumir', () => {
    const mapa = mapearCandidatas(
      [candidata({ bloco_id: 'a', data_atendimento: null })],
      SEMANAS,
      '2026-08-17',
      new Set()
    )
    expect(mapa.semCartao.map((c) => c.bloco_id)).toEqual(['a'])
    expect(mapa.foraDoMes).toHaveLength(0)
    expect(mapa.porSemana.size).toBe(0)
  })

  it('não conta a não-elegível de outra semana como trabalho a fazer', () => {
    const mapa = mapearCandidatas(
      [candidata({ bloco_id: 'a', data_atendimento: '2026-08-11', elegivel: false })],
      SEMANAS,
      '2026-08-17',
      new Set()
    )
    expect(mapa.totalElegiveis).toBe(0)
    expect(mapa.porSemana.size).toBe(0)
  })
})

/**
 * O `bloco_id` é a única pista que a guia vinculada tem da sessão que cobre: ela
 * pode estar noutra semana — a janela é de 7 dias retroativos —, e nesse caso a
 * linha da sessão não está carregada para consultar.
 */
describe('a falta de terapeuta como candidata', () => {
  /*
    O ACOPLAMENTO DE FORMATO, e por que ele merece teste próprio.

    A candidata-falta chega de `get_candidatas_vinculo` com um `bloco_id`
    SINTÉTICO, e é por essa string que ela encontra o cartão da falta na grade —
    `mapearCandidatas` casa `c.bloco_id` contra as chaves dos cartões, e a chave
    do cartão de falta é o bloco que `auditoria-assim.service.ts` monta.

    São dois lugares montando a MESMA string, em linguagens diferentes: a RPC
    (`'falta_' || paciente || '_' || data || '_' || horario || '_' || tuss`) e o
    serviço do cliente. Se divergirem — `08:00` contra `08:00:00` é o jeito mais
    fácil —, nada dá erro: a candidata simplesmente não vira alvo, e o cartão
    fica lá, não clicável, sem nenhuma pista do porquê. Este teste é a pista.

    A forma vem de produção: cinco pedaços, e a HORA antes do TUSS — ordem
    diferente do bloco real, que é `paciente_data_TUSS_hora`.
  */
  const BLOCO_FALTA = 'falta_11649_2026-08-19_08:00:00_22070435'

  it('a falta desenhada na grade vira alvo, como qualquer candidata', () => {
    const mapa = mapearCandidatas(
      [candidata({
        bloco_id: BLOCO_FALTA,
        data_atendimento: '2026-08-19',
        situacao: 'FALTA_TERAPEUTA',
        tipo_falta: 'terapeuta',
      })],
      SEMANAS,
      '2026-08-17',
      new Set([BLOCO_FALTA])
    )
    expect(mapa.naGrade.get(BLOCO_FALTA)?.situacao).toBe('FALTA_TERAPEUTA')
    expect(mapa.totalElegiveis).toBe(1)
    expect(mapa.porSemana.get('2026-08-17')).toBe(1)
    // E não cai em nenhuma das duas listas de "não está onde você a procura".
    expect(mapa.semCartao).toHaveLength(0)
    expect(mapa.foraDoMes).toHaveLength(0)
  })

  it('a falta JÁ autorizada continua visível, marcada como não escolhível', () => {
    // Mesma regra das sessões já cobertas: sumir da tela é o único desfecho
    // proibido — é vendo-a ali que se percebe que a guia é extra.
    const mapa = mapearCandidatas(
      [candidata({
        bloco_id: BLOCO_FALTA,
        data_atendimento: '2026-08-19',
        situacao: 'FALTA_TERAPEUTA',
        elegivel: false,
        ja_vinculado: true,
      })],
      SEMANAS,
      '2026-08-17',
      new Set([BLOCO_FALTA])
    )
    expect(mapa.naGrade.has(BLOCO_FALTA)).toBe(true)
    expect(mapa.totalElegiveis).toBe(0)
  })

  it('uma falta que a grade não desenhou é contada, não some', () => {
    // O bloco divergindo por um caractere é exatamente este caso, e ele aparece
    // escrito na barra em vez de virar uma candidata fantasma.
    const mapa = mapearCandidatas(
      [candidata({
        bloco_id: BLOCO_FALTA,
        data_atendimento: '2026-08-19',
        situacao: 'FALTA_TERAPEUTA',
      })],
      SEMANAS,
      '2026-08-17',
      new Set(['falta_11649_2026-08-19_08:00_22070435']) // hora sem os segundos
    )
    expect(mapa.naGrade.size).toBe(0)
    expect(mapa.semCartao).toHaveLength(1)
  })
})

describe('sessaoDoBloco', () => {
  it('lê dia e hora do bloco real da produção', () => {
    expect(sessaoDoBloco('11649_2026-08-03_22070435_11:20:00')).toEqual({
      dia: '2026-08-03',
      hora: '11:20',
    })
  })

  it('devolve nulo em vez de adivinhar quando o formato não bate', () => {
    // Bloco sintético de falta, id vazio, e um bloco com pedaço a menos: nenhum
    // deles recebe vínculo, e inventar uma data aqui viraria um "cobre Qui
    // 30/07" que não existe.
    expect(sessaoDoBloco('falta_abc')).toBeNull()
    expect(sessaoDoBloco(null)).toBeNull()
    expect(sessaoDoBloco('11649_2026-08-03_22070435')).toBeNull()
    expect(sessaoDoBloco('11649_03/08/2026_22070435_11:20:00')).toBeNull()
  })
})

describe('distanciaCurta', () => {
  it('lê o sinal da RPC: negativo é guia ANTES da sessão', () => {
    // data_execucao - (data_atendimento + hora_inicial): negativo = adiantada.
    // O modal antigo escrevia "antes da autorização" aqui, afirmando o oposto.
    expect(distanciaCurta(-3.2)).toBe('3,2 h antes')
    expect(distanciaCurta(1.25)).toBe('1,3 h depois')
  })

  it('vira dias acima de 24 h, e sempre com vírgula', () => {
    expect(distanciaCurta(72)).toBe('3,0 d depois')
    expect(distanciaCurta(-30)).toBe('1,3 d antes')
  })

  it('devolve nulo quando a RPC não mediu', () => {
    expect(distanciaCurta(null)).toBeNull()
  })
})
