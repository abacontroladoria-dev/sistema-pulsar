import { describe, expect, test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { montarRelatorio, type CatalogoRelatorio } from './relatorioPrestador'
import { gerarPdfRelatorio } from './relatorioPrestadorPdf'

const C = (sigla: string, nome: string, classe: 'recorrente' | 'semestral', tipo: 'GERAL' | 'POR_PACIENTE', periodicidade: string, qtd: number | null): CatalogoRelatorio =>
  ({ id: sigla, sigla, nome, classe, tipo_registro: tipo, periodicidade, qtd_referencia_mes: qtd })
const CATALOGO = [
  C('STC', 'Supervisão Técnica ABA do Caso', 'recorrente', 'GERAL', 'semanal', 4),
  C('ETC', 'Estudo Técnico de Caso', 'recorrente', 'GERAL', 'semanal', 4),
  C('TAP', 'Treinamento de Aplicadores ABA', 'recorrente', 'POR_PACIENTE', 'quinzenal', 2),
  C('TOP', 'Treinamento e Orientação Parental', 'recorrente', 'POR_PACIENTE', 'mensal', 1),
  C('PIC', 'Plano Individualizado Comportamental', 'semestral', 'POR_PACIENTE', 'semestral', null),
  C('RT', 'Relatório Técnico', 'semestral', 'POR_PACIENTE', 'semestral', null),
  C('OE', 'Orientação Escolar', 'semestral', 'POR_PACIENTE', 'semestral', null),
]
const arq = (nome: string, sigla: string, pasta: string | null, competencia = '2026-09') =>
  ({ nome, sigla, competencia, status: 'sugerido', paciente_pasta_id: pasta })

function exemplo() {
  return montarRelatorio({
    nomePasta: 'Aline Miranda', prestadorNome: 'Aline Miranda', razaoSocial: 'ALINE MIRANDA PSICOLOGIA LTDA',
    temPlanilha: true, competencia: '2026-09', semanas: 4, catalogo: CATALOGO,
    pacientes: [
      { pasta_id: 'A', nome_pasta: 'Adrian Costa', paciente_nome: 'Adrian Costa', motivo: null },
      { pasta_id: 'J', nome_pasta: 'Joao Silva Santos', paciente_nome: 'Joao Silva Santos', motivo: null },
    ],
    arquivos: [
      arq('STC-01-092026.pdf', 'STC', null), arq('STC-02-092026.pdf', 'STC', null), arq('ETC-092026.pdf', 'ETC', null),
      arq('Relatorio.pdf', 'PIC', 'A'), arq('PIC Adrian.docx', 'PIC', 'A'), arq('avaliacao.pdf', 'PIC', 'A'), arq('PIC-ADRIAN-092026 (2).pdf', 'PIC', 'A'),
      arq('TOP - Adrian Costa - 092026.pdf', 'TOP', 'A'),
      arq('TAP-01-JOAO SILVA-092026.pdf', 'TAP', 'J'), arq('TAP-02-JOAO SILVA-092026.pdf', 'TAP', 'J'),
      arq('PIC-JOAO SILVA-092026.pdf', 'PIC', 'J'),
    ],
    registros: [],
    planos: [
      { paciente_nome: 'Joao Silva Santos', item_id: 'PIC', competencia_planejada: '2026-12' },
      { paciente_nome: 'Adrian Costa', item_id: 'RT', competencia_planejada: '2026-08' },
      { paciente_nome: 'Joao Silva Santos', item_id: 'OE', competencia_planejada: '2027-02' },
    ],
  })
}

describe('relatório por prestador — o que está nas pastas e o que falta', () => {
  const r = exemplo()
  const item = (pac: string | null, sigla: string) =>
    (pac ? r.pacientes.find(p => p.nome === pac)!.itens : r.geral).find(i => i.sigla === sigla)!

  test('Geral: 2 STC na pasta de 4 esperadas; ETC sem número não conta', () => {
    expect(item(null, 'STC')).toMatchObject({ esperado: 4, naPasta: 2, falta: 2, situacao: 'parcial' })
    expect(item(null, 'ETC')).toMatchObject({ esperado: 4, naPasta: 0, falta: 4, situacao: 'faltando' })
  })
  test('Adrian: os 4 arquivos do PIC não contam (sem planejamento); RT vencido', () => {
    expect(item('Adrian Costa', 'PIC').situacao).toBe('sem_planejamento')
    expect(item('Adrian Costa', 'PIC').naPasta).toBe(0)
    expect(item('Adrian Costa', 'RT')).toMatchObject({ situacao: 'faltando', falta: 1 })
    expect(item('Adrian Costa', 'TOP')).toMatchObject({ naPasta: 1, falta: 0, situacao: 'completo' })
    expect(item('Adrian Costa', 'TAP')).toMatchObject({ naPasta: 0, falta: 2 })
  })
  test('João: TAP 2/2, PIC entregue no ciclo, OE ainda não é deste mês', () => {
    expect(item('Joao Silva Santos', 'TAP')).toMatchObject({ naPasta: 2, falta: 0, situacao: 'completo' })
    expect(item('Joao Silva Santos', 'PIC').situacao).toBe('completo')
    expect(item('Joao Silva Santos', 'OE').situacao).toBe('previsto')
  })
  test('arquivos fora do padrão vêm com o nome certo', () => {
    const nomes = r.foraDoPadrao.map(f => f.arquivo)
    expect(nomes).toEqual(expect.arrayContaining(['ETC-092026.pdf', 'Relatorio.pdf', 'PIC Adrian.docx', 'avaliacao.pdf', 'PIC-ADRIAN-092026 (2).pdf']))
    expect(r.foraDoPadrao.find(f => f.arquivo === 'Relatorio.pdf')!.nomeCerto).toBe('PIC-ADRIAN COSTA-092026')
  })
  test('totais: esperado = recorrentes do mês + semestrais vencidos', () => {
    // Geral 8 + (TAP 2 + TOP 1) × 2 pacientes = 14, + RT do Adrian vencido = 15
    expect(r.totais.esperados).toBe(15)
    expect(r.totais.naPasta).toBe(2 + 0 + 1 + 2 + 0)
    expect(r.totais.faltam).toBe(2 + 4 + 2 + 0 + 1 + 0 + 1)
  })
  test('gera um PDF válido', async () => {
    const bytes = await gerarPdfRelatorio(r, new Date('2026-10-02T15:00:00Z'))
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    if (process.env.PDF_EXEMPLO) writeFileSync(process.env.PDF_EXEMPLO, bytes)
  }, 30000)
})
