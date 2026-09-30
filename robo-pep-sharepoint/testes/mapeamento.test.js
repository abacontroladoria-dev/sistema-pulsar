const test = require('node:test')
const assert = require('node:assert/strict')
const { classificarArquivo, competenciaDoArquivo, numeroDaPasta, lerPastaPrestador, pastasDePrestador } = require('../lib/mapeamento')
const { item, prestador } = require('./fixtures')

const RAIZ = 'RAIZ'

function arvoreDe(itens) {
  const m = new Map()
  for (const i of itens) m.set(i.id, { id: i.id, nome: i.name, paiId: i.parentReference.id, pasta: !!i.folder })
  return m
}

function classificar(estrutura, arquivo) {
  const arvore = arvoreDe([...estrutura.itens, arquivo])
  return classificarArquivo(arvore, RAIZ, { id: arquivo.id, nome: arquivo.name })
}

test('número da pasta, não o texto', () => {
  assert.equal(numeroDaPasta('3. Pacientes'), 3)
  assert.equal(numeroDaPasta('03 - Pacientes'), 3)
  assert.equal(numeroDaPasta('3) Pacientes'), 3)
  assert.equal(numeroDaPasta('Pacientes'), null)
})

test('pasta de prestador: nome curto e razão social', () => {
  assert.deepEqual(
    lerPastaPrestador('Prestador de Serviço - Aline Exemplo (ALINE EXEMPLO PSICOLOGIA LTDA)'),
    { nomeCurto: 'Aline Exemplo', razaoSocial: 'ALINE EXEMPLO PSICOLOGIA LTDA' },
  )
  assert.equal(lerPastaPrestador('Documentos antigos'), null)
})

test('as 7 subpastas do paciente e as 2 do Geral', () => {
  const e = prestador(RAIZ)
  const pac = e.porPaciente['Beltrano Exemplo da Silva']
  const esperado = { 1: 'TAP', 2: 'TOP', 3: 'PIC', 4: 'RT', 5: 'OE' }
  for (const [n, sigla] of Object.entries(esperado)) {
    const c = classificar(e, item({ nome: 'doc.pdf', pai: pac.subs[n].id }))
    assert.equal(c.tipo, 'evidencia')
    assert.equal(c.sigla, sigla)
    assert.equal(c.pacientePastaId, pac.pasta.id)
    assert.equal(c.prestadorPastaId, e.prestador.id)
  }
  for (const n of [6, 7]) {
    const c = classificar(e, item({ nome: 'doc.pdf', pai: pac.subs[n].id }))
    assert.equal(c.tipo, 'ignorado')
    assert.equal(c.motivo, 'pasta_fora_do_pep')
  }
  assert.equal(classificar(e, item({ nome: 'a.pdf', pai: e.stc.id })).sigla, 'STC')
  assert.equal(classificar(e, item({ nome: 'a.pdf', pai: e.etc.id })).sigla, 'ETC')
  assert.equal(classificar(e, item({ nome: 'a.pdf', pai: e.stc.id })).pacientePastaId, undefined)
})

test('subpasta dentro da pasta de item herda o item', () => {
  const e = prestador(RAIZ)
  const sub = item({ nome: 'Setembro', pai: e.porPaciente['Beltrano Exemplo da Silva'].subs[1].id, pasta: true })
  e.itens.push(sub)
  const c = classificar(e, item({ nome: 'doc.pdf', pai: sub.id }))
  assert.equal(c.tipo, 'evidencia')
  assert.equal(c.sigla, 'TAP')
})

test('planilha na pasta 1; outro arquivo lá é ignorado', () => {
  const e = prestador(RAIZ)
  assert.equal(classificar(e, item({ nome: 'Planejamento Documentos Técnicos - X.xlsx', pai: e.plan.id })).tipo, 'planilha')
  assert.equal(classificar(e, item({ nome: 'rascunho.docx', pai: e.plan.id })).tipo, 'ignorado')
})

test('fora do padrão vai para revisão, com motivo', () => {
  const e = prestador(RAIZ)
  const estranha = item({ nome: 'Documentos antigos', pai: RAIZ, pasta: true })
  e.itens.push(estranha)
  assert.equal(classificar(e, item({ nome: 'x.pdf', pai: estranha.id })).motivo, 'pasta_prestador_fora_padrao')
  assert.equal(classificar(e, item({ nome: 'x.pdf', pai: RAIZ })).motivo, 'arquivo_na_raiz')
  const nova = item({ nome: '8. Outros', pai: e.porPaciente['Beltrano Exemplo da Silva'].pasta.id, pasta: true })
  e.itens.push(nova)
  assert.equal(classificar(e, item({ nome: 'x.pdf', pai: nova.id })).motivo, 'item_paciente_desconhecido')
})

test('pai desconhecido: caminho incompleto, nunca exceção', () => {
  const e = prestador(RAIZ)
  assert.equal(classificar(e, item({ nome: 'x.pdf', pai: 'SUMIU' })).motivo, 'caminho_incompleto')
})

test('competência: nome no padrão do PRD tem prioridade', () => {
  assert.deepEqual(competenciaDoArquivo('STC-01-082026.pdf', '2026-09-20T12:00:00Z'), { competencia: '2026-08', fonte: 'nome' })
  assert.deepEqual(competenciaDoArquivo('TAP-02-FULANO-08-2026.pdf', null), { competencia: '2026-08', fonte: 'nome' })
})

test('competência: data de envio no fuso de Brasília', () => {
  // 31/10 22h em Brasília = 01/11 01h UTC — é outubro.
  assert.deepEqual(competenciaDoArquivo('relatorio.pdf', '2026-11-01T01:00:00Z'), { competencia: '2026-10', fonte: 'envio' })
  assert.deepEqual(competenciaDoArquivo('relatorio.pdf', null), { competencia: null, fonte: null })
})

test('pastas de prestador na raiz', () => {
  const e = prestador(RAIZ)
  const lista = pastasDePrestador(arvoreDe(e.itens), RAIZ)
  assert.equal(lista.length, 1)
  assert.equal(lista[0].padrao, true)
  assert.equal(lista[0].razaoSocial, 'FULANA EXEMPLO PSICOLOGIA LTDA')
})
