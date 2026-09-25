import { describe, expect, it } from 'vitest'
import {
  avisosDaLinha,
  agruparFolhas,
  contarAbas,
  divergenciasDa,
  estadoAutorizacao,
  estadoEvolucao,
  filipetaDaSessao,
  folhaNaAba,
  guiaDaSessao,
  montarFolhas,
  pedeAvisoARecepcao,
  pontosDaFolha,
  resumoDaFolha,
  resumoDoGrupo,
  type SessaoConferencia,
} from './folhas'

const AGORA = new Date(2026, 8, 24, 12, 0) // qua 24/09/2026 12:00

function sessao(p: Partial<SessaoConferencia> = {}): SessaoConferencia {
  return {
    bloco_id: null,
    paciente_id: '1',
    paciente_nome: 'Ana',
    carteirinha: null,
    data_atendimento: '2026-09-22',
    hora_inicial: '08:00:00',
    codigo_tuss: '50000470',
    terapias: 'Psicologia ABA',
    profissionais: null,
    quantidade_sessoes: 1,
    guia: '123',
    status_assim: 'Liberado',
    situacao: 'LIBERADA',
    observacao: null,
    data_atendimento_real: null,
    grade_total: 1,
    grade_com_evolucao: 1,
    risco_evolucao: null,
    status_conferencia: null,
    conferido_por_nome: null,
    conferido_em: null,
    recepcao_avisada_em: null,
    recepcao_avisada_por_nome: null,
    observacao_conferencia: null,
    guia_vinculo: null,
    tipo_vinculo: null,
    ...p,
  }
}

describe('estadoAutorizacao', () => {
  it('glosa resolvida pela Reconciliação conta como autorizada', () => {
    expect(estadoAutorizacao('GLOSA_RESOLVIDA')).toBe('ok')
  })
  it('cancelada (Liberado *) não é ok — pede autorização nova', () => {
    expect(estadoAutorizacao('CANCELADA')).toBe('recusada')
  })
  it('sem resposta é pendente, não recusa', () => {
    expect(estadoAutorizacao('RETORNO_NAO_CONFIRMADO')).toBe('pendente')
    expect(estadoAutorizacao(null)).toBe('pendente')
  })
})

describe('estadoEvolucao', () => {
  it('dois profissionais e uma evolução é parcial', () => {
    expect(estadoEvolucao({ grade_total: 2, grade_com_evolucao: 1 })).toBe('parcial')
  })
  it('sem linha na grade não é "falta evolução"', () => {
    expect(estadoEvolucao({ grade_total: 0, grade_com_evolucao: 0 })).toBe('sem_grade')
  })
})

describe('divergenciasDa', () => {
  it('sessão futura não diverge, mesmo sem autorização', () => {
    const s = sessao({ data_atendimento: '2026-09-25', situacao: 'NAO_SOLICITADA' })
    expect(divergenciasDa(s, AGORA)).toEqual([])
  })
  it('junta as três pernas', () => {
    const s = sessao({ status_conferencia: 'sem_assinatura', situacao: 'GLOSA', grade_com_evolucao: 0 })
    expect(divergenciasDa(s, AGORA)).toEqual(['sem_assinatura', 'sem_autorizacao', 'sem_evolucao'])
  })
  it('só evolução faltando não pede aviso à recepção', () => {
    expect(pedeAvisoARecepcao(['sem_evolucao'])).toBe(false)
    expect(pedeAvisoARecepcao(['sem_autorizacao'])).toBe(true)
  })
})

describe('montarFolhas', () => {
  it('corta em folhas de 10, em ordem cronológica entre terapias', () => {
    const sessoes: SessaoConferencia[] = []
    for (let d = 22; d <= 23; d++) {
      for (let h = 8; h < 14; h++) {
        sessoes.push(sessao({ data_atendimento: `2026-09-${d}`, hora_inicial: `${String(h).padStart(2, '0')}:00:00` }))
      }
    }
    // embaralha para provar que a ordem vem da regra, não da entrada
    sessoes.reverse()
    const folhas = montarFolhas(sessoes, AGORA)
    expect(folhas.map((f) => f.linhas.length)).toEqual([10, 2])
    expect(folhas[0].totalFolhas).toBe(2)
    expect(folhas[0].linhas[0].sessao.hora_inicial).toBe('08:00:00')
    expect(folhas[0].linhas[0].sessao.data_atendimento).toBe('2026-09-22')
    expect(folhas[1].linhas[1]).toMatchObject({ linha: 2 })
    expect(folhas[1].linhas[1].sessao.hora_inicial).toBe('13:00:00')
  })

  it('na quinzena, semana nova é folha nova — a folha não atravessa a virada', () => {
    const folhas = montarFolhas(
      [
        sessao({ data_atendimento: '2026-09-22' }),
        sessao({ data_atendimento: '2026-09-15' }),
        sessao({ data_atendimento: '2026-09-16' }),
      ],
      AGORA
    )
    expect(folhas.map((f) => [f.semana, f.numero, f.totalFolhas, f.linhas.length])).toEqual([
      ['2026-09-14', 1, 1, 2],
      ['2026-09-21', 1, 1, 1],
    ])
  })

  it('agrupa por paciente_id e ordena por nome sem acento', () => {
    const folhas = montarFolhas(
      [
        sessao({ paciente_id: '2', paciente_nome: 'Érica' }),
        sessao({ paciente_id: '1', paciente_nome: 'Bruno' }),
        sessao({ paciente_id: '3', paciente_nome: 'Ana' }),
      ],
      AGORA
    )
    expect(folhas.map((f) => f.paciente_nome)).toEqual(['Ana', 'Bruno', 'Érica'])
  })

  it('situação da folha: pendente > divergente > conferida; só futuras = futura', () => {
    const [pend] = montarFolhas([sessao()], AGORA)
    expect(pend.situacao).toBe('pendente')

    const [div] = montarFolhas([sessao({ status_conferencia: 'assinada', situacao: 'GLOSA' })], AGORA)
    expect(div.situacao).toBe('divergente')
    expect(div.semAviso).toBe(1)

    const [ok] = montarFolhas([sessao({ status_conferencia: 'assinada' })], AGORA)
    expect(ok.situacao).toBe('conferida')

    const [fut] = montarFolhas([sessao({ data_atendimento: '2026-09-26' })], AGORA)
    expect(fut.situacao).toBe('futura')
    expect(fut.realizadas).toBe(0)
  })

  it('aviso registrado tira o problema da conta dela: a folha fica "com a recepção"', () => {
    const [f] = montarFolhas(
      [sessao({ status_conferencia: 'sem_assinatura', recepcao_avisada_em: '2026-09-24T10:00:00Z' })],
      AGORA
    )
    expect(f.divergentes).toBe(0)
    expect(f.comRecepcao).toBe(1)
    expect(f.semAviso).toBe(0)
    expect(f.situacao).toBe('recepcao')
    expect(folhaNaAba(f, 'recepcao')).toBe(true)
    expect(folhaNaAba(f, 'divergencias')).toBe(false)
  })
  it('o aviso não resolve a evolução: continua problema', () => {
    const [f] = montarFolhas(
      [sessao({ status_conferencia: 'sem_assinatura', grade_com_evolucao: 0, recepcao_avisada_em: '2026-09-24T10:00:00Z' })],
      AGORA
    )
    expect(f.divergentes).toBe(1)
    expect(f.comRecepcao).toBe(1)
    expect(f.situacao).toBe('divergente')
  })
})

describe('abas', () => {
  it('folha com pendência E divergência aparece nas duas', () => {
    const [f] = montarFolhas(
      [sessao(), sessao({ hora_inicial: '09:00:00', status_conferencia: 'sem_assinatura' })],
      AGORA
    )
    expect(folhaNaAba(f, 'pendentes')).toBe(true)
    expect(folhaNaAba(f, 'divergencias')).toBe(true)
    expect(folhaNaAba(f, 'conferidas')).toBe(false)
  })
  it('na aba de problemas o resumo fala do problema, não do que falta marcar', () => {
    const [f] = montarFolhas(
      [sessao(), sessao({ hora_inicial: '09:00:00', status_conferencia: 'sem_assinatura' })],
      AGORA
    )
    expect(resumoDaFolha(f)).toEqual({ texto: '1 a conferir', tom: 'pendente' })
    expect(resumoDaFolha(f, 'divergencias')).toEqual({ texto: '1 problema', tom: 'problema' })
  })
  it('folha só com sessões futuras não conta como conferida', () => {
    const folhas = montarFolhas([sessao({ data_atendimento: '2026-09-26' })], AGORA)
    expect(contarAbas(folhas)).toEqual({ pendentes: 0, divergencias: 0, recepcao: 0, conferidas: 0, todas: 1 })
  })
})

describe('palavras da folha', () => {
  it('sessão em ordem não diz nada', () => {
    expect(avisosDaLinha(sessao(), false)).toEqual([])
  })
  it('só a autorização vira texto — a evolução tem indicador próprio', () => {
    const s = sessao({ situacao: 'GLOSA', grade_total: 2, grade_com_evolucao: 1 })
    expect(avisosDaLinha(s, false).map((a) => a.texto)).toEqual(['Glosa da ASSIM'])
    expect(avisosDaLinha(sessao({ grade_com_evolucao: 0 }), false)).toEqual([])
  })
  it('futura cala, e a tirinha a pinta como futura', () => {
    const [f] = montarFolhas([sessao({ status_conferencia: 'assinada' }), sessao({ data_atendimento: '2026-09-26' })], AGORA)
    expect(avisosDaLinha(f.linhas[1].sessao, true)).toEqual([])
    expect(pontosDaFolha(f)).toEqual(['assinada', 'futura'])
    expect(resumoDaFolha(f)).toEqual({ texto: 'Pronta', tom: 'pronta' })
  })
})

describe('guiaDaSessao', () => {
  it('substituição: a guia vem do vínculo, a da sessão é vazia', () => {
    expect(guiaDaSessao({ guia: null, guia_vinculo: '321907', situacao: 'LIBERADA' })).toBe('321907')
  })
  it('glosa resolvida sem vínculo lido não mostra a guia recusada', () => {
    expect(guiaDaSessao({ guia: '999', guia_vinculo: null, situacao: 'GLOSA_RESOLVIDA' })).toBeNull()
  })
  it('glosa sem cobertura não tem guia a conferir', () => {
    expect(guiaDaSessao({ guia: '999', guia_vinculo: null, situacao: 'GLOSA' })).toBeNull()
  })
})

describe('paciente com duas folhas na semana', () => {
  // 12 sessões: 10 na folha 1 (todas assinadas), 2 na folha 2 (por marcar).
  function dozeSessoes() {
    const sessoes: SessaoConferencia[] = []
    for (let d = 22; d <= 23; d++) {
      for (let h = 8; h < 14; h++) {
        const n = sessoes.length
        sessoes.push(
          sessao({
            data_atendimento: `2026-09-${d}`,
            hora_inicial: `${String(h).padStart(2, '0')}:00:00`,
            status_conferencia: n < 10 ? 'assinada' : null,
          })
        )
      }
    }
    return montarFolhas(sessoes, AGORA)
  }
  it('é um item só na fila, com as duas folhas', () => {
    const grupos = agruparFolhas(dozeSessoes())
    expect(grupos).toHaveLength(1)
    expect(grupos[0].folhas.map((f) => f.numero)).toEqual([1, 2])
  })
  it('conta um paciente, e não está pronto enquanto a folha 2 tiver o que marcar', () => {
    expect(contarAbas(dozeSessoes())).toEqual({ pendentes: 1, divergencias: 0, recepcao: 0, conferidas: 0, todas: 1 })
  })
  it('o resumo soma as folhas', () => {
    expect(resumoDoGrupo(agruparFolhas(dozeSessoes())[0])).toEqual({ texto: '2 a conferir', tom: 'pendente' })
  })
})

describe('filipetaDaSessao', () => {
  it('token do relatório: filipeta com número', () => {
    expect(filipetaDaSessao(sessao({ teve_token: true, token: ' 252680 ' }))).toEqual({
      numero: '252680',
      motivo: 'token',
      conferida: false,
    })
  })
  it('dispositivo indisponível (biofacial 8-): papel sem número', () => {
    expect(filipetaDaSessao(sessao({ biofacial: '8-DISPOSITIVO INDISPONIVE' }))).toMatchObject({
      numero: null,
      motivo: 'dispositivo_indisponivel',
    })
  })
  it('erro facial com glosa explícita não tem papel', () => {
    expect(
      filipetaDaSessao(sessao({ forma_autorizacao: 'Erro no Reconhecimento Facial', status_assim: 'Negado' }))
    ).toBeNull()
  })
  it('QR Code não deixa papel; campos ausentes (RPC antiga) também não', () => {
    expect(filipetaDaSessao(sessao({ forma_autorizacao: 'QR Code' }))).toBeNull()
    expect(filipetaDaSessao(sessao())).toBeNull()
  })
  it('lê a conferência já feita na Conferência de Filipetas', () => {
    expect(filipetaDaSessao(sessao({ teve_token: true, token: '1', filipeta_conferida: true }))?.conferida).toBe(true)
  })
})

describe('falta na folha', () => {
  const falta = (p: Partial<SessaoConferencia> = {}) =>
    sessao({ falta: 'paciente', situacao: 'FALTA', guia: null, grade_total: 0, grade_com_evolucao: 0, ...p })

  it('ocupa uma linha (a recepção escreve "falta" no papel) e empurra a numeração', () => {
    const [f] = montarFolhas(
      [sessao({ hora_inicial: '08:00:00' }), falta({ hora_inicial: '08:40:00' }), sessao({ hora_inicial: '09:20:00' })],
      AGORA
    )
    expect(f.linhas.map((l) => [l.linha, l.falta])).toEqual([
      [1, null],
      [2, 'paciente'],
      [3, null],
    ])
    expect(pontosDaFolha(f)).toEqual(['pendente', 'falta', 'pendente'])
  })

  it('não pede conferência nem conta como problema ou progresso', () => {
    const [f] = montarFolhas([sessao(), falta({ hora_inicial: '08:40:00' })], AGORA)
    expect(divergenciasDa(falta(), AGORA)).toEqual([])
    expect(f.pendentes).toBe(1)
    expect(f.divergentes).toBe(0)
    expect(f.realizadas).toBe(1)
    expect(f.faltas).toBe(1)
  })

  it('conta nas 10 linhas: 10 sessões + 1 falta abrem a folha 2', () => {
    const lista = Array.from({ length: 10 }, (_, i) => sessao({ hora_inicial: `${String(8 + i).padStart(2, '0')}:00:00` }))
    const folhas = montarFolhas([...lista, falta({ data_atendimento: '2026-09-23' })], AGORA)
    expect(folhas.map((f) => f.linhas.length)).toEqual([10, 1])
  })

  it('semana só de faltas não é "Pronta" nem "Ainda vai acontecer"', () => {
    const folhas = montarFolhas([falta(), falta({ hora_inicial: '08:40:00' })], AGORA)
    expect(folhas[0].situacao).toBe('conferida')
    expect(resumoDoGrupo(agruparFolhas(folhas)[0]).texto).toBe('Só faltas')
    expect(contarAbas(folhas).conferidas).toBe(0)
  })
})
