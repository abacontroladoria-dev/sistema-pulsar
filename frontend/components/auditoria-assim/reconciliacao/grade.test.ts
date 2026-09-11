import { describe, expect, it } from 'vitest'
import { cartaoPendente, montarGrade } from './grade'
import { guiasSubstituidas, sessaoSemCobertura, situacaoComVinculo } from './cobertura'
import type {
  AuditoriaAssimItem,
  AutorizacaoAssimSemana,
  PlacarTuss,
  VinculoAutorizacao,
} from '../types'

const DIAS = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']

/** Nada marcado — o cenário dos testes de posicionamento, que não olham marca. */
const SEM_MARCAS = { descoberta: () => false, decorrida: () => true, excedentes: new Set<string>() }

function sessao(p: Partial<AuditoriaAssimItem>): AuditoriaAssimItem {
  return {
    bloco_id: null, paciente_id: null, paciente_nome: 'X', carteirinha: null,
    data_atendimento: null, hora_inicial: null, codigo_tuss: null, convenio_nome: null,
    terapias: null, profissionais: null, quantidade_sessoes: null, guia: null,
    status_assim: null, codigo_erro: null, descricao_erro: null, data_execucao: null,
    situacao: null, prioridade: null, dias_atraso: null, possui_autorizacao: null,
    possui_solicitacao: null, observacao: null, motivo_glosa: null, teve_token: null,
    token: null, biofacial: null, criado_por: null, forma_autorizacao: null, horario_autorizacao: null,
    guia_origem: null,
    observacao_manual: null, observacao_manual_atualizado_em: null,
    observacao_manual_atualizado_por_nome: null, token_conferido: null,
    token_conferido_em: null, token_conferido_por_nome: null,
    // A cobertura é campo da aba Auditoria, que a enriquece por bloco_id. Aqui
    // o vínculo entra pelos mapas de `montarGrade`, não pela linha.
    vinculo: null,
    reclassificacao_situacao_anterior: null, reclassificacao_justificativa: null,
    reclassificacao_por: null, reclassificacao_em: null,
    ...p,
  }
}

function guia(p: Partial<AutorizacaoAssimSemana> & { guia: string }): AutorizacaoAssimSemana {
  return {
    matricula: null, paciente_nome: null, data_execucao: null, status: 'Liberado',
    codigo_tuss: null, codigo_erro: null, descricao_erro: null, teve_token: null, token: null,
    ...p,
  }
}

/**
 * A triagem do caso medido em produção (2026-08-20): a guia 15032 saiu no portal
 * às 14:39 e cobre a sessão glosada das 11:20 do mesmo dia.
 */
const VINCULO: VinculoAutorizacao = {
  id: 'v1',
  guia: '15032',
  tipo: 'vinculo',
  bloco_id: '11649_2026-08-03_22070435_11:20:00',
  guia_original: '9229',
  observacao: null,
  vinculado_por: 'Fulano',
  vinculado_em: '2026-08-24T18:10:00+00:00',
}

const PLACAR: PlacarTuss[] = [
  { codigo_tuss: '22070400', terapias: 'Terapia Ocupacional', agendadas: 0, decorridas: 0, autorizadas: 0, liberadas: 0, canceladas: 0, excedente: 0, faltante: 0, naoSolicitada: 0 },
]

const todos = (linhas: ReturnType<typeof montarGrade>) =>
  linhas.flatMap((l) => DIAS.flatMap((d) => l.celulas[d]))

describe('montarGrade por horário', () => {
  it('anda de 40 em 40 min e pula o almoço, que não é faixa', () => {
    const linhas = montarGrade(
      [
        sessao({ bloco_id: 'a', data_atendimento: DIAS[0], hora_inicial: '08:00:00', codigo_tuss: '22070400' }),
        sessao({ bloco_id: 'b', data_atendimento: DIAS[3], hora_inicial: '17:20:00', codigo_tuss: '22070400' }),
      ],
      [], () => 'fora-da-semana', DIAS, PLACAR, SEM_MARCAS
    )
    // 11:20 → 13:00 sem faixa de meio-dia: o intervalo aparece nos rótulos, e
    // inventar uma linha que nenhuma sessão pode ocupar seria ruído.
    expect(linhas.map((l) => l.hora)).toEqual([
      '08:00', '08:40', '09:20', '10:00', '10:40', '11:20',
      '13:00', '13:40', '14:20', '15:00', '15:40', '16:20', '17:00',
    ])
    expect(linhas[0].celulas[DIAS[0]]).toHaveLength(1)
    // 17:20 cai na faixa das 17:00, e o cartão guarda o horário exato.
    expect(linhas[12].celulas[DIAS[3]][0].hora).toBe('17:20')
  })

  it('separa 14:00 de 14:40, que a escala de hora cheia empilhava', () => {
    const linhas = montarGrade(
      [
        sessao({ bloco_id: 'tarde', data_atendimento: DIAS[1], hora_inicial: '14:40:00' }),
        sessao({ bloco_id: 'cedo', data_atendimento: DIAS[1], hora_inicial: '14:00:00' }),
      ],
      [], () => 'fora-da-semana', DIAS, PLACAR, SEM_MARCAS
    )
    expect(linhas.map((l) => l.hora)).toEqual(['13:40', '14:20'])
    expect(linhas[0].celulas[DIAS[1]].map((c) => c.chave)).toEqual(['cedo'])
    expect(linhas[1].celulas[DIAS[1]].map((c) => c.chave)).toEqual(['tarde'])
  })

  it('ordena dentro da célula quando dois caem na mesma faixa', () => {
    const linhas = montarGrade(
      [
        sessao({ bloco_id: 'tarde', data_atendimento: DIAS[1], hora_inicial: '14:30:00' }),
        sessao({ bloco_id: 'cedo', data_atendimento: DIAS[1], hora_inicial: '14:20:00' }),
      ],
      [], () => 'fora-da-semana', DIAS, PLACAR, SEM_MARCAS
    )
    expect(linhas).toHaveLength(1)
    expect(linhas[0].hora).toBe('14:20')
    expect(linhas[0].celulas[DIAS[1]].map((c) => c.chave)).toEqual(['cedo', 'tarde'])
  })

  it('a autorização registrada fora da grade da clínica ganha a hora cheia', () => {
    // `data_execucao` é o instante em que a ASSIM registrou — não tem por que
    // respeitar a grade da clínica. 12:30 cai no almoço: nenhuma faixa o
    // contém, e cair em 11:20 o faria ser lido como sessão das 11:20.
    const linhas = montarGrade(
      [sessao({ bloco_id: 'a', data_atendimento: DIAS[0], hora_inicial: '11:20:00', codigo_tuss: '22070400' })],
      [guia({ guia: '999', data_execucao: `${DIAS[0]}T12:30:00`, codigo_tuss: '22070400' })],
      () => 'sem-vinculo', DIAS, PLACAR, SEM_MARCAS
    )
    expect(linhas.map((l) => l.hora)).toEqual(['11:20', '12:00'])
    expect(linhas[1].celulas[DIAS[0]][0].guia).toBe('999')
  })

  it('não perde atendimento nenhum e joga o sem-horário para o fim', () => {
    const linhas = montarGrade(
      [
        sessao({ bloco_id: 'a', data_atendimento: DIAS[0], hora_inicial: '09:20:00' }),
        sessao({ bloco_id: 'sem', data_atendimento: DIAS[0], hora_inicial: null }),
      ],
      [guia({ guia: '111', data_execucao: `${DIAS[2]}T14:34:00`, codigo_tuss: '22070400' })],
      () => 'sem-vinculo', DIAS, PLACAR, SEM_MARCAS
    )
    expect(todos(linhas)).toHaveLength(3)
    expect(linhas[linhas.length - 1].hora).toBe('—')
    expect(linhas[linhas.length - 1].celulas[DIAS[0]][0].chave).toBe('sem')
  })

  it('guia pareada não vira cartão próprio, e a órfã herda o nome da terapia', () => {
    const linhas = montarGrade(
      [],
      [
        guia({ guia: 'pareada', data_execucao: `${DIAS[0]}T10:00:00`, codigo_tuss: '22070400' }),
        guia({ guia: 'orfa', data_execucao: `${DIAS[0]}T10:05:00`, codigo_tuss: '22070400' }),
      ],
      (g) => (g === 'pareada' ? 'pareada' : 'sem-vinculo'),
      DIAS, PLACAR, SEM_MARCAS
    )
    const cartoes = todos(linhas)
    expect(cartoes).toHaveLength(1)
    expect(cartoes[0].tipo === 'autorizacao' && cartoes[0].guia).toBe('orfa')
    expect(cartoes[0].terapia).toBe('Terapia Ocupacional')
  })

  it('ignora o que cai fora dos dias úteis da semana', () => {
    const linhas = montarGrade(
      [sessao({ bloco_id: 'sabado', data_atendimento: '2026-08-22', hora_inicial: '09:00:00' })],
      [], () => 'fora-da-semana', DIAS, PLACAR, SEM_MARCAS
    )
    expect(linhas).toEqual([])
  })

  it('carimba as marcas que a listagem promete: sem cobertura e excedente', () => {
    const linhas = montarGrade(
      [
        sessao({ bloco_id: 'descoberta', data_atendimento: DIAS[0], hora_inicial: '09:00:00' }),
        sessao({ bloco_id: 'ok', data_atendimento: DIAS[0], hora_inicial: '10:00:00' }),
      ],
      [
        guia({ guia: 'normal', data_execucao: `${DIAS[1]}T09:00:00` }),
        guia({ guia: 'demais', data_execucao: `${DIAS[1]}T10:00:00` }),
      ],
      () => 'fora-da-semana',
      DIAS,
      PLACAR,
      {
        descoberta: (s) => s.bloco_id === 'descoberta',
        decorrida: () => true,
        excedentes: new Set(['demais']),
      }
    )
    const porChave = new Map(todos(linhas).map((c) => [c.chave, c]))
    expect(porChave.get('descoberta')).toMatchObject({ tipo: 'sessao', semCobertura: true })
    expect(porChave.get('ok')).toMatchObject({ tipo: 'sessao', semCobertura: false })
    expect(porChave.get(`guia-demais-${DIAS[1]}T10:00:00`)).toMatchObject({ excedente: true })
    expect(porChave.get(`guia-normal-${DIAS[1]}T09:00:00`)).toMatchObject({ excedente: false })
  })

  it('leva a triagem aos DOIS cartões do par — a guia e a sessão que ela cobre', () => {
    // O defeito que isto pina: a guia vinculada continua sem casar com sessão
    // pelo pareamento do banco (a sessão coberta guarda a guia ANTIGA), então
    // sem `vinculos` ela chegava aqui como uma guia qualquer e a grade a
    // desenhava com o rótulo de "Outra semana".
    const linhas = montarGrade(
      [sessao({ bloco_id: VINCULO.bloco_id, data_atendimento: DIAS[0], hora_inicial: '11:20:00', guia: '9229', situacao: 'GLOSA_RESOLVIDA' })],
      [guia({ guia: VINCULO.guia, data_execucao: `${DIAS[0]}T14:39:00` })],
      (g) => (g === VINCULO.guia ? 'vinculada' : 'fora-da-semana'),
      DIAS,
      PLACAR,
      SEM_MARCAS,
      { porGuia: new Map([[VINCULO.guia, VINCULO]]), porBloco: new Map([[VINCULO.bloco_id!, VINCULO]]) }
    )
    const porChave = new Map(todos(linhas).map((c) => [c.chave, c]))
    // A guia sabe que sessão cobre…
    expect(porChave.get(`guia-${VINCULO.guia}-${DIAS[0]}T14:39:00`)).toMatchObject({
      estado: 'vinculada',
      vinculo: VINCULO,
    })
    // …e a sessão sabe que guia a cobriu, que é o que a `situacao` nunca diz.
    expect(porChave.get(VINCULO.bloco_id!)).toMatchObject({ vinculo: VINCULO })
    // Nenhum dos dois pede trabalho: o par inteiro sai da contagem.
    expect(todos(linhas).filter(cartaoPendente)).toHaveLength(0)
  })

  it('aplica o vínculo na situação do cartão, sem esperar a RPC concordar', () => {
    // A RPC devolve GLOSA (o banco pode não ter a migration 20260821030000), e
    // mesmo assim o cartão precisa se ler como resolvido — senão a sessão volta
    // a ser cartão marcado e a glosa coberta reaparece na contagem do cabeçalho.
    const linhas = montarGrade(
      [sessao({ bloco_id: VINCULO.bloco_id, data_atendimento: DIAS[0], hora_inicial: '11:20:00', guia: '9229', situacao: 'GLOSA' })],
      [],
      () => 'fora-da-semana',
      DIAS,
      PLACAR,
      SEM_MARCAS,
      { porGuia: new Map(), porBloco: new Map([[VINCULO.bloco_id!, VINCULO]]) }
    )
    const cartao = todos(linhas)[0]
    expect(cartao).toMatchObject({ situacao: 'GLOSA_RESOLVIDA' })
    expect(cartaoPendente(cartao)).toBe(false)
    // O valor cru sobrevive em `origem`: o histórico não se apaga.
    expect(cartao.tipo === 'sessao' && cartao.origem.situacao).toBe('GLOSA')
  })

  it('sem triagem nenhuma, os cartões nascem com vínculo nulo', () => {
    const linhas = montarGrade(
      [sessao({ bloco_id: 'a', data_atendimento: DIAS[0], hora_inicial: '09:00:00' })],
      [guia({ guia: 'g', data_execucao: `${DIAS[0]}T10:00:00` })],
      () => 'fora-da-semana', DIAS, PLACAR, SEM_MARCAS
    )
    expect(todos(linhas).every((c) => c.vinculo === null)).toBe(true)
  })
})

/**
 * O predicado que decide a silhueta do cartão E o que o navegador do rodapé
 * percorre. São o mesmo, de propósito: divergirem faria o rodapé prometer "3
 * pendências" e a grade destacar duas.
 */
describe('cartaoPendente', () => {
  const base = { chave: 'k', hora: '09:00', codigo_tuss: null, terapia: null } as const
  const linha = sessao({})

  it('promove a sessão descoberta e a que está em glosa, mas não a liberada', () => {
    const sessaoBase = { ...base, tipo: 'sessao', guia: null, legenda: null, motivoBruto: null, teve_token: null, token: null, decorrida: true, vinculo: null, origem: linha } as const
    expect(cartaoPendente({ ...sessaoBase, situacao: 'LIBERADA', semCobertura: false })).toBe(false)
    expect(cartaoPendente({ ...sessaoBase, situacao: 'GLOSA_RESOLVIDA', semCobertura: false })).toBe(false)
    expect(cartaoPendente({ ...sessaoBase, situacao: 'GLOSA', semCobertura: false })).toBe(true)
    // Vencida é pendência mesmo quando a situação, sozinha, não seria.
    expect(cartaoPendente({ ...sessaoBase, situacao: 'SINCRONIZANDO', semCobertura: false })).toBe(false)
    expect(cartaoPendente({ ...sessaoBase, situacao: 'SINCRONIZANDO', semCobertura: true })).toBe(true)
  })

  it('promove a guia órfã e a excedente, e deixa a de outra semana quieta', () => {
    const guiaBase = { ...base, tipo: 'autorizacao', guia: 'g', status: 'Liberado', descricao_erro: null, teve_token: null, token: null, vinculo: null, origem: guia({ guia: 'g' }) } as const
    expect(cartaoPendente({ ...guiaBase, estado: 'fora-da-semana', excedente: false })).toBe(false)
    expect(cartaoPendente({ ...guiaBase, estado: 'sem-vinculo', excedente: false })).toBe(true)
    expect(cartaoPendente({ ...guiaBase, estado: 'fora-da-semana', excedente: true })).toBe(true)
  })

  /**
   * O caso Theo Meneses (27/08): a guia 405760, recusada por
   * `1601-REINCIDENCIA`, contava como "1 Glosa" na listagem mas o cartão dela
   * na grade — `estado: 'fora-da-semana'`, sem triagem, fora da fila de órfãs
   * — não era `cartaoPendente`, então nem o header da semana a somava nem ela
   * vestia o matiz de glosa (caía no `else` de `CartaoAtendimento` e saía
   * esmeralda, "como se fosse liberada").
   */
  it('promove a guia RECUSADA que não é liberada, cancelada, órfã nem triada', () => {
    const recusada = {
      ...base, tipo: 'autorizacao', guia: 'g', status: '1601-REINCIDENCIA NO ATEN',
      descricao_erro: null, teve_token: null, token: null, vinculo: null,
      origem: guia({ guia: 'g', status: '1601-REINCIDENCIA NO ATEN' }),
    } as const
    expect(cartaoPendente({ ...recusada, estado: 'fora-da-semana', excedente: false })).toBe(true)
    // Cancelada e liberada continuam quietas nesse mesmo estado — só a
    // recusada de verdade é que precisava da rede.
    expect(
      cartaoPendente({
        ...recusada, estado: 'fora-da-semana', excedente: false,
        status: 'Liberado *',
        origem: guia({ guia: 'g', status: 'Liberado *' }),
      })
    ).toBe(false)
    expect(
      cartaoPendente({
        ...recusada, estado: 'fora-da-semana', excedente: false,
        status: 'Liberado',
        origem: guia({ guia: 'g', status: 'Liberado' }),
      })
    ).toBe(false)
    // Já órfã (`sem-vinculo`) ou já triada continuam pela regra própria delas
    // — esta é só a rede para quando nenhuma das duas ainda pegou a guia.
    expect(cartaoPendente({ ...recusada, estado: 'sem-vinculo', excedente: false })).toBe(true)
  })

  it('aposenta a guia já triada — vinculada ou descartada não é fila de trabalho', () => {
    // O depois da ação: a pergunta "que sessão esta guia cobre?" foi respondida,
    // e a guia não pode continuar contando como cartão marcado. Se contasse, a
    // faixa de semanas prometeria trabalho que a listagem já não vê.
    const guiaBase = { ...base, tipo: 'autorizacao', guia: 'g', status: 'Liberado', descricao_erro: null, teve_token: null, token: null, vinculo: VINCULO, origem: guia({ guia: 'g' }) } as const
    expect(cartaoPendente({ ...guiaBase, estado: 'vinculada', excedente: false })).toBe(false)
    expect(cartaoPendente({ ...guiaBase, estado: 'sem-sessao', excedente: false })).toBe(false)
    // A cota é outro eixo: o excedente provoca a glosa 1601 esteja a guia triada
    // ou não, e por isso sobrevive à triagem.
    expect(cartaoPendente({ ...guiaBase, estado: 'vinculada', excedente: true })).toBe(true)
  })
})

/**
 * A regra que substituiu `decorridas − liberadas`. O caso que importa é o
 * último: a subtração fechava zero e escondia a sessão descoberta.
 */
describe('sessaoSemCobertura', () => {
  const CUTOFF = '2026-08-19T12:00'

  it('não cobra do que ainda não venceu', () => {
    const s = sessao({ data_atendimento: DIAS[4], hora_inicial: '09:00:00', situacao: 'NAO_SOLICITADA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(false)
  })

  it('não cobra de falta — a sessão não aconteceu', () => {
    const s = sessao({ data_atendimento: DIAS[0], hora_inicial: '09:00:00', situacao: 'FALTA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(false)
  })

  it('não cobra do que já saiu liberado, nem da glosa que o vínculo cobriu', () => {
    for (const situacao of ['LIBERADA', 'GLOSA_RESOLVIDA']) {
      const s = sessao({ data_atendimento: DIAS[0], hora_inicial: '09:00:00', situacao })
      expect(sessaoSemCobertura(s, CUTOFF)).toBe(false)
    }
  })

  it('aponta a sessão decorrida que ninguém liberou', () => {
    const s = sessao({ data_atendimento: DIAS[0], hora_inicial: '09:00:00', situacao: 'GLOSA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(true)
  })

  it('continua cobrando da CANCELADA — a liberação foi desfeita', () => {
    // `CANCELADA` é `status = 'Liberado *'`: a ASSIM desfez a liberação, então
    // nada cobre a sessão e ela segue passível de vínculo com uma guia solta.
    // Só a MANCHETE do cartão muda (ver SITUACOES_COM_VEREDITO) — a pendência
    // não, e é o que este caso pina.
    const s = sessao({ data_atendimento: DIAS[0], hora_inicial: '09:00:00', situacao: 'CANCELADA' })
    expect(sessaoSemCobertura(s, CUTOFF)).toBe(true)
    expect(
      cartaoPendente({
        tipo: 'sessao', chave: 'k', hora: '09:00', codigo_tuss: null, terapia: null,
        guia: null, legenda: null, motivoBruto: null, teve_token: null, token: null,
        decorrida: true, vinculo: null, origem: s, situacao: 'CANCELADA', semCobertura: true,
      })
    ).toBe(true)
  })

  it('sem horário, só conta a partir do dia seguinte', () => {
    const hoje = sessao({ data_atendimento: CUTOFF.slice(0, 10), hora_inicial: null, situacao: 'GLOSA' })
    const ontem = sessao({ data_atendimento: DIAS[0], hora_inicial: null, situacao: 'GLOSA' })
    expect(sessaoSemCobertura(hoje, CUTOFF)).toBe(false)
    expect(sessaoSemCobertura(ontem, CUTOFF)).toBe(true)
  })
})

/**
 * A outra metade de "sair da contagem". `sessaoSemCobertura` já tira a sessão de
 * "faltando" e a fila de órfãs já tira a guia de "sem vínculo"; o que sobrava de
 * pé era a GLOSA original, que é uma linha de `autorizacoes_assim` e não muda
 * quando o vínculo é gravado.
 */
/**
 * O eco local da migration 20260821030000. Existe porque a tela não pode ficar
 * dizendo "Glosa · pendência" sobre uma sessão que ela mesma acabou de cobrir só
 * porque a RPC ainda não concorda — foi assim que a glosa coberta continuou
 * contando como pendência no cabeçalho do modal.
 */
describe('situacaoComVinculo', () => {
  const VIN = { tipo: 'vinculo' } as const

  it('aplica os dois ramos que a RPC aplica', () => {
    expect(situacaoComVinculo('GLOSA', VIN)).toBe('GLOSA_RESOLVIDA')
    // Sem glosa prévia não há o que "resolver": a sessão passa a ser liberada.
    expect(situacaoComVinculo('NAO_SOLICITADA', VIN)).toBe('LIBERADA')
    expect(situacaoComVinculo('CANCELADA', VIN)).toBe('LIBERADA')
  })

  it('não mexe em nada sem vínculo do tipo certo', () => {
    expect(situacaoComVinculo('GLOSA', null)).toBe('GLOSA')
    // 'sem_sessao' é o oposto de cobertura: o operador disse que a guia NÃO
    // corresponde a sessão nenhuma. Ela nunca tem bloco, mas a guarda é barata.
    expect(situacaoComVinculo('GLOSA', { tipo: 'sem_sessao' })).toBe('GLOSA')
  })

  it('falta continua falta — uma guia não faz a sessão ter acontecido', () => {
    expect(situacaoComVinculo('FALTA', VIN)).toBe('FALTA')
    expect(situacaoComVinculo('FALTA_TERAPEUTA', VIN)).toBe('FALTA_TERAPEUTA')
  })

  it('a sessão coberta para de ser cobrada mesmo com a RPC dizendo GLOSA', () => {
    // O caso reportado: header do modal continuava contando a glosa coberta.
    const s = sessao({
      bloco_id: VINCULO.bloco_id,
      data_atendimento: '2026-08-17',
      hora_inicial: '09:00:00',
      situacao: 'GLOSA',
    })
    const porBloco = new Map([[VINCULO.bloco_id!, VINCULO]])
    expect(sessaoSemCobertura(s, '2026-08-19T12:00')).toBe(true)
    expect(sessaoSemCobertura(s, '2026-08-19T12:00', porBloco)).toBe(false)
  })
})

describe('guiasSubstituidas', () => {
  const BLOCO = VINCULO.bloco_id!
  const porBloco = new Map([[BLOCO, VINCULO]])

  it('nomeia a guia antiga a partir da sessão que o vínculo cobriu', () => {
    const sessoes = [
      sessao({ bloco_id: BLOCO, guia: '9229', situacao: 'GLOSA_RESOLVIDA' }),
      sessao({ bloco_id: 'outro', guia: '7777', situacao: 'GLOSA' }),
    ]
    // Só a do bloco coberto: a glosa do bloco vizinho continua pedindo tratativa.
    expect([...guiasSubstituidas(sessoes, porBloco)]).toEqual(['9229'])
  })

  it('não inventa guia quando a sessão nunca teve uma', () => {
    // Cenário B da migration: sessão que nunca foi solicitada pelo Pulsar e que
    // o vínculo passou a cobrir. Não havia glosa para aposentar.
    const sessoes = [sessao({ bloco_id: BLOCO, guia: null, situacao: 'LIBERADA' })]
    expect(guiasSubstituidas(sessoes, porBloco).size).toBe(0)
  })

  it('não casa sessão sem bloco com um mapa vazio de chave vazia', () => {
    // `bloco_id` nulo vira `''` na consulta ao mapa. Se alguma triagem entrasse
    // no índice com chave vazia, TODA sessão sem id sairia "substituída".
    const sessoes = [sessao({ bloco_id: null, guia: '9229' })]
    expect(guiasSubstituidas(sessoes, porBloco).size).toBe(0)
    expect(guiasSubstituidas(sessoes, new Map()).size).toBe(0)
  })
})
