import { describe, it, expect } from 'vitest'
import { CRITERIOS_FALLBACK, CriteriosInvalidosError } from '../criterios'
import {
  criteriosParaMarkdown,
  markdownParaCriterios,
  lerVersaoOrigem
} from '../criteriosMarkdown'
import { montarSystemPrompt } from '../prompts'

const md = (v: number | null = 1) => criteriosParaMarkdown(CRITERIOS_FALLBACK, { versaoOrigem: v })

describe('ida e volta', () => {
  it('baixar e subir sem editar devolve exatamente os mesmos critérios', () => {
    expect(markdownParaCriterios(md())).toEqual(CRITERIOS_FALLBACK)
  })

  it('e o prompt montado é byte-a-byte o mesmo', () => {
    // O que importa no fim não é o objeto, é o texto que chega na IA.
    expect(montarSystemPrompt(markdownParaCriterios(md()))).toBe(
      montarSystemPrompt(CRITERIOS_FALLBACK)
    )
  })

  it('duas voltas não acumulam deriva', () => {
    const umaVolta = markdownParaCriterios(md())
    const duasVoltas = markdownParaCriterios(
      criteriosParaMarkdown(umaVolta, { versaoOrigem: 1 })
    )
    expect(duasVoltas).toEqual(umaVolta)
  })

  it('carimba a versão de origem no cabeçalho', () => {
    expect(lerVersaoOrigem(md(7))).toBe(7)
    expect(lerVersaoOrigem(md(null))).toBeNull()
  })
})

describe('edições que devem passar', () => {
  it('reescrever o rótulo de um pilar mantém a chave', () => {
    const editado = md().replace(
      '### 1. Estado na chegada (chegou)',
      '### 1. Como chegou hoje (chegou)'
    )
    const r = markdownParaCriterios(editado)
    expect(r.pilares[0]).toMatchObject({ chave: 'chegou', rotulo: 'Como chegou hoje' })
  })

  it('acrescentar uma regra específica nova', () => {
    const editado = md().replace(
      '## Palavras e frases que geram glosa',
      '### Teleatendimento\n\nRegistrar a plataforma e a presença do responsável.\n\n' +
        '## Palavras e frases que geram glosa'
    )
    const r = markdownParaCriterios(editado)
    expect(r.regras_especificas.map(x => x.titulo)).toContain('Teleatendimento')
  })

  it('acrescentar um termo proibido', () => {
    const editado = md().replace('- nada a registrar', '- nada a registrar\n- foi tranquilo')
    const r = markdownParaCriterios(editado)
    expect(r.termos_proibidos[0].termos).toContain('foi tranquilo')
  })

  it('perder o acento do título da seção não invalida o arquivo', () => {
    // Word e editores antigos fazem isso; custar o arquivo inteiro seria cruel.
    const editado = md().replace('## Instrução geral', '## Instrucao Geral')
    expect(() => markdownParaCriterios(editado)).not.toThrow()
  })

  it('aceita quebra de linha do Windows', () => {
    expect(markdownParaCriterios(md().replace(/\n/g, '\r\n'))).toEqual(CRITERIOS_FALLBACK)
  })
})

describe('edições que devem falhar, e falhar dizendo o porquê', () => {
  const esperaErro = (markdown: string, trecho: string) => {
    expect(() => markdownParaCriterios(markdown)).toThrow(CriteriosInvalidosError)
    expect(() => markdownParaCriterios(markdown)).toThrow(new RegExp(trecho, 'i'))
  }

  it('apagar uma das quatro perguntas', () => {
    const editado = md().replace(
      /### 4\. Reação e saída \(reacao_saida\)[\s\S]*?(?=## Regras)/,
      ''
    )
    esperaErro(editado, 'reacao_saida')
  })

  it('inventar uma quinta pergunta', () => {
    const editado = md().replace(
      '## Regras para situações específicas',
      '### 5. Evolução do plano (plano)\n\nTexto.\n\n## Regras para situações específicas'
    )
    esperaErro(editado, 'não é uma das quatro perguntas')
  })

  it('tirar o código entre parênteses de um pilar', () => {
    const editado = md().replace('### 2. Objetivo planejado (objetivo)', '### 2. Objetivo planejado')
    esperaErro(editado, 'código entre parênteses')
  })

  it('renomear um nível de risco para fora do trio', () => {
    const editado = md().replace('(risco_relevante)', '(risco_altissimo)')
    esperaErro(editado, 'não é um nível de risco válido')
  })

  it('duplicar uma pergunta', () => {
    const editado = md().replace(
      '## Regras para situações específicas',
      '### 5. Outra chegada (chegou)\n\nTexto.\n\n## Regras para situações específicas'
    )
    esperaErro(editado, 'aparece 2 vezes')
  })

  it('apagar uma seção inteira', () => {
    const editado = md().replace('## Conferência estrutural', '## Conferencia removida')
    esperaErro(editado, 'não encontrei a seção')
  })

  it('esvaziar a instrução geral', () => {
    const editado = md().replace(
      /## Instrução geral\n\n[\s\S]*?(?=\n## )/,
      '## Instrução geral\n'
    )
    esperaErro(editado, 'abertura')
  })

  it('subir um arquivo que não é o desta tela', () => {
    esperaErro('Olá, isto é um documento qualquer.', 'nenhuma seção')
  })

  it('subir um arquivo vazio', () => {
    esperaErro('   ', 'vazio')
  })
})
