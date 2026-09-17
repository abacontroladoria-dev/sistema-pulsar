import { describe, expect, it } from 'vitest'
import { agruparPacientes, carteirinhaUtil } from './agruparPacientes'
import type { AuditoriaAssimItem, AutorizacaoAssimSemana } from '../types'

/**
 * Uma sessão da agenda TiTa. `agruparPacientes` só lê quatro campos dela, e
 * declarar os outros quarenta como null aqui seria ruído que esconde o que o
 * teste de fato controla — daí o cast.
 */
function sessao(p: Partial<AuditoriaAssimItem>): AuditoriaAssimItem {
  return {
    paciente_id: null,
    paciente_nome: null,
    carteirinha: null,
    convenio_nome: null,
    ...p,
  } as AuditoriaAssimItem
}

/** Uma guia do extrato da ASSIM. Idem. */
function guia(p: Partial<AutorizacaoAssimSemana> & { guia: string }): AutorizacaoAssimSemana {
  return {
    paciente_id: null, matricula: null, paciente_nome: null, data_execucao: null,
    status: 'Liberado', codigo_tuss: null, codigo_erro: null, descricao_erro: null,
    teve_token: null, token: null,
    ...p,
  }
}

describe('agruparPacientes', () => {
  // O caso que motivou a função. Dados de produção, paciente 11578: a agenda
  // escreve o nome inteiro e uma carteirinha sem pontos; a ASSIM trunca o nome
  // em 20 caracteres e pontua a matrícula de outro jeito. Só o id casa.
  it('junta a guia da ASSIM à sessão da agenda pelo paciente_id', () => {
    const linhas = agruparPacientes(
      [sessao({
        paciente_id: '11578',
        paciente_nome: 'Davi Lucas Araújo Alves Moreira',
        carteirinha: '000000074749794400',
      })],
      [guia({ guia: '57703', paciente_id: 11578, matricula: '000000.0747497.00', paciente_nome: 'DAVI LUCAS ARAUJO AL' })]
    )

    expect(linhas).toHaveLength(1)
    expect(linhas[0].sessoes).toHaveLength(1)
    expect(linhas[0].autorizacoes).toHaveLength(1)
    // O nome exibido é o da agenda, não o rótulo truncado da ASSIM.
    expect(linhas[0].nome).toBe('Davi Lucas Araújo Alves Moreira')
  })

  // A regressão de verdade: sem o índice por id, este caso dava DUAS linhas —
  // uma com as pendências e outra dizendo "sem pendências".
  it('não duplica o paciente quando nome e carteirinha divergem entre as origens', () => {
    const linhas = agruparPacientes(
      [sessao({ paciente_id: '11639', paciente_nome: 'João Philipe Neves Dias', carteirinha: '000000075734201' })],
      [guia({ guia: '25429', paciente_id: 11639, matricula: '000000.0757342.01', paciente_nome: 'JOAO PHILIPE NEVES D' })]
    )
    expect(linhas).toHaveLength(1)
  })

  it('a segunda guia do mesmo paciente cai na linha que a primeira abriu', () => {
    const linhas = agruparPacientes(
      [],
      [
        guia({ guia: 'A', paciente_id: 11578, matricula: '000000.0747497.00' }),
        guia({ guia: 'B', paciente_id: 11578, matricula: null }),
      ]
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0].autorizacoes.map((a) => a.guia)).toEqual(['A', 'B'])
  })

  it('guia sem sessão nenhuma no mês continua abrindo linha própria', () => {
    const linhas = agruparPacientes(
      [sessao({ paciente_id: '1', paciente_nome: 'Quem Teve Sessão' })],
      [guia({ guia: 'X', paciente_id: 999, paciente_nome: 'SO TEM GUIA' })]
    )
    expect(linhas).toHaveLength(2)
  })

  // Homônimos com ids distintos são duas pessoas. Juntá-los faria alguém
  // vincular a guia de uma na sessão da outra.
  it('separa homônimos que têm ids diferentes', () => {
    const linhas = agruparPacientes(
      [
        sessao({ paciente_id: '1', paciente_nome: 'Maria Silva' }),
        sessao({ paciente_id: '2', paciente_nome: 'Maria Silva' }),
      ],
      []
    )
    expect(linhas).toHaveLength(2)
  })

  // O incidente Benicio/Helena: carteirinha toda de zeros é ausência, não
  // identidade, e usá-la como chave fundia irmãos numa linha só.
  it('carteirinha zerada não funde pacientes diferentes', () => {
    expect(carteirinhaUtil('000000.0000000.00')).toBeNull()
    const linhas = agruparPacientes(
      [
        sessao({ paciente_id: null, paciente_nome: 'Benicio Asta Moraes', carteirinha: '000000.0000000.00' }),
        sessao({ paciente_id: null, paciente_nome: 'Helena Asta Moraes', carteirinha: '000000.0000000.00' }),
      ],
      []
    )
    expect(linhas).toHaveLength(2)
  })

  // A linha de falta não traz carteirinha (a RPC de faltas não a devolve), mas
  // vem da mesma origem que as outras sessões — então o nome ainda é ponte ali.
  it('a falta sem carteirinha entra no paciente pelo nome da própria agenda', () => {
    const linhas = agruparPacientes(
      [
        sessao({ paciente_id: null, paciente_nome: 'Ana Souza', carteirinha: '000000.0111111.00' }),
        sessao({ paciente_id: null, paciente_nome: 'Ana Souza', carteirinha: null }),
      ],
      []
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0].sessoes).toHaveLength(2)
  })

  it('guia sem paciente_id ainda casa pela matrícula', () => {
    const linhas = agruparPacientes(
      [sessao({ paciente_id: '7', paciente_nome: 'Com Carteirinha', carteirinha: '000000.0222222.00' })],
      [guia({ guia: 'Y', paciente_id: null, matricula: '000000.0222222.00' })]
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0].autorizacoes).toHaveLength(1)
  })
})
