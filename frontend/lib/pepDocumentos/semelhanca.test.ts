import { describe, expect, test } from 'vitest'
import {
  aprenderModelo, assinatura, compararParagrafos, conteudoPreenchido, dice, diceEstimado, shingles,
} from './semelhanca'

// Modelo de PIC fictício: cabeçalho e instruções que todo prestador recebe.
const MODELO = [
  'PLANO INDIVIDUALIZADO COMPORTAMENTAL',
  '1. INFORMAÇÕES GERAIS',
  'Este plano descreve os objetivos terapêuticos definidos para o semestre a partir da avaliação inicial.',
  'As metas abaixo foram construídas em conjunto com a família e a equipe de aplicadores do caso.',
  '2. OBJETIVOS',
].join('\n')

const ESCRITO_JOAO = [
  'Paciente: João Pedro Silva',
  'João apresenta comunicação vocal funcional com frases de três palavras e pedidos espontâneos em contexto de brincadeira.',
  'Observa-se recusa frequente nas transições entre atividades, com choro e fuga em média quatro vezes por sessão.',
  'Objetivo: aumentar tolerância à espera para 2 minutos com apoio visual, em 80% das oportunidades por 3 sessões seguidas.',
  'Objetivo: reduzir comportamentos de fuga nas transições para no máximo uma ocorrência por sessão até dezembro.',
  'Na avaliação inicial, o repertório de imitação vocal apareceu em sete das dez tentativas, com ajuda ecoica nas restantes.',
  'A família relata sono irregular nas últimas semanas e pede prioridade para a rotina da manhã antes da escola.',
  'Os aplicadores registraram melhora na espera pelo lanche quando o cronômetro visual fica à vista durante toda a atividade.',
  'Será introduzido o programa de pedidos com duas palavras usando itens de alta preferência levantados na entrevista.',
  'A escola recebeu orientação sobre antecipação das transições e enviará registro semanal das ocorrências em sala.',
  'Critério de mudança de fase: três sessões seguidas acima de oitenta por cento sem ajuda física em cada programa.',
].join('\n')

const ESCRITO_OUTRO = [
  'Paciente: Lucas Andrade Rocha',
  'Lucas se comunica principalmente por gestos e figuras, com repertório inicial de imitação motora grossa e fina.',
  'Há seletividade alimentar importante, aceitando apenas cinco alimentos, segundo relato da mãe na entrevista inicial.',
  'Objetivo: ampliar o uso de pranchas de comunicação para dez pedidos diferentes ao longo do semestre letivo.',
  'Objetivo: introduzir três novos alimentos com dessensibilização gradual, registrando aceitação em todas as refeições.',
  'O pai acompanha as sessões de sábado e já aplica o reforço social combinado durante as brincadeiras no parque.',
  'Foi observado choro intenso ao ouvir o liquidificador, por isso o protocolo de exposição sonora começa em volume baixo.',
  'A pediatra suspendeu a medicação para refluxo em agosto e a equipe acompanha mudanças no apetite durante o mês.',
  'O treino de uso do banheiro segue com horário fixo a cada noventa minutos e registro em planilha pela cuidadora.',
  'Na escola há um mediador novo desde setembro que receberá treinamento sobre as pranchas de comunicação.',
  'Revisão prevista para o fim do semestre com nova aplicação do protocolo de avaliação de linguagem expressiva.',
].join('\n')

const docJoao = `${MODELO}\n${ESCRITO_JOAO}`
// Cópia: o mesmo texto com o nome trocado e um número diferente.
const docCopia = `${MODELO}\n${ESCRITO_JOAO.replace(/João Pedro Silva/g, 'Lucas Andrade Rocha').replace(/João/g, 'Lucas').replace('2 minutos', '3 minutos')}`
const docOutro = `${MODELO}\n${ESCRITO_OUTRO}`

const modelo = aprenderModelo([
  { grupo: 'A', texto: docJoao }, { grupo: 'B', texto: docOutro }, { grupo: 'C', texto: MODELO },
])

const conj = (t: string, nomes: string[]) => shingles(conteudoPreenchido(t, modelo, nomes))

describe('semelhança entre documentos', () => {
  test('aprende o texto do modelo (linhas em 3+ docs de 2+ prestadores)', () => {
    expect(modelo.size).toBeGreaterThanOrEqual(3)
  })

  test('cópia com nome trocado é praticamente igual; textos diferentes, não', () => {
    const a = conj(docJoao, ['João Pedro Silva'])
    const copia = conj(docCopia, ['Lucas Andrade Rocha'])
    const outro = conj(docOutro, ['Lucas Andrade Rocha'])
    expect(dice(a, copia)).toBeGreaterThan(0.8)
    expect(dice(a, outro)).toBeLessThan(0.1)
  })

  test('o modelo sozinho não deixa dois documentos parecidos', () => {
    // Os dois têm o mesmo modelo inteiro e nada escrito igual.
    expect(dice(conj(docJoao, ['João Pedro Silva']), conj(docOutro, ['Lucas Andrade Rocha']))).toBeLessThan(0.1)
  })

  test('a impressão digital estima o mesmo que o texto', () => {
    const a = conj(docJoao, ['João Pedro Silva'])
    const copia = conj(docCopia, ['Lucas Andrade Rocha'])
    const outro = conj(docOutro, ['Lucas Andrade Rocha'])
    expect(diceEstimado(assinatura(a), assinatura(copia))).toBeGreaterThan(0.7)
    expect(diceEstimado(assinatura(a), assinatura(outro))).toBeLessThan(0.15)
  })

  test('pouco conteúdo não tem impressão digital', () => {
    expect(assinatura(conj(MODELO, []))).toBeNull()
  })

  test('comparador: modelo apagado, parágrafo copiado realçado', () => {
    const p = compararParagrafos(docCopia, docJoao, modelo)
    expect(p.filter(x => x.modelo).length).toBeGreaterThanOrEqual(3)
    const copiado = p.find(x => x.segmentos.some(s => s.t.includes('tolerância')))!
    expect(copiado.semelhanca).toBeGreaterThan(0.8)
    expect(copiado.segmentos.some(s => s.igual)).toBe(true)
    expect(copiado.segmentos.some(s => !s.igual && s.t.includes('3'))).toBe(true)
  })
})

describe('calibração (14/10/2026)', () => {
  test('folha de registro em branco (mesmo formulário do prestador) não tem impressão digital', () => {
    const folha = (paciente: string) => [
      'Informações gerais', `Paciente: ${paciente}`, 'Data:_________ Terapeuta: _________',
      'Cada bloco abaixo corresponde a um programa de ensino, terapeuta/AT deverão registrar os estímulos alvos e a resposta emitida pelo paciente em cada programa, em caso de respostas com ajuda, registrar o tipo de ajuda utilizada.',
      'Siglas das respostas: erros ( - ), respostas independentes ( i ), ajuda gestual (AG), ajuda física parcial (AFP), ajuda física total (AFT), ajuda ecoica (AE).',
      ...Array.from({ length: 10 }, (_, i) => `Alvo R ${i + 1}`),
    ].join('\n')
    expect(assinatura(shingles(conteudoPreenchido(folha('João Pedro Silva'), new Set(), ['João Pedro Silva'])))).toBeNull()
  })
})
