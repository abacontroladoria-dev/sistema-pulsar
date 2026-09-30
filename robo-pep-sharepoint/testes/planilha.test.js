const test = require('node:test')
const assert = require('node:assert/strict')
const { lerPlanilhaPlanejamento, lerCompetencia, siglaDoDocumento } = require('../lib/planilha')
const { planilhaBuffer, CPF_OK, CNPJ_OK } = require('./fixtures')

test('lê cabeçalho, pacientes e planejamento no formato real', async () => {
  const buf = await planilhaBuffer({
    pacientes: [['Beltrano Exemplo da Silva', CPF_OK], ['Ciclana Exemplo', '12345678900']],
    planejamento: [
      ['Beltrano Exemplo da Silva', CPF_OK, 'Plano Individualizado Comportamental (PIC)', 'Mai/2026'],
      ['Beltrano Exemplo da Silva', CPF_OK, 'Relatório de Fechamento Técnico', 'Nov/2026'],
      ['Beltrano Exemplo da Silva', CPF_OK, 'Orientação Escolar', null],
    ],
  })
  const r = await lerPlanilhaPlanejamento(buf)
  assert.equal(r.cnpj, CNPJ_OK)
  assert.equal(r.razaoSocial, 'FULANA EXEMPLO PSICOLOGIA LTDA')
  assert.equal(r.pacientes.length, 2)
  assert.deepEqual(r.pacientes[0], { nome: 'Beltrano Exemplo da Silva', cpf: CPF_OK, cpfInformado: true, cpfValido: true })
  assert.equal(r.pacientes[1].cpfValido, false)
  assert.equal(r.pacientes[1].cpf, null)
  assert.deepEqual(r.planejamento.map(p => [p.sigla, p.competencia]), [['PIC', '2026-05'], ['RT', '2026-11'], ['OE', null]])
  assert.equal(r.planejamento[0].cpf, CPF_OK) // resultado em cache da fórmula
  assert.deepEqual(r.avisos, [])
})

test('o e-mail não sai da leitura', async () => {
  const r = await lerPlanilhaPlanejamento(await planilhaBuffer())
  assert.ok(!JSON.stringify(r).includes('exemplo@exemplo.com'))
})

test('CNPJ inválido ou ausente vira aviso, não exceção', async () => {
  let r = await lerPlanilhaPlanejamento(await planilhaBuffer({ cnpj: '11.222.333/0001-00' }))
  assert.equal(r.cnpj, null)
  assert.ok(r.avisos.includes('cnpj_invalido'))
  r = await lerPlanilhaPlanejamento(await planilhaBuffer({ cnpj: null }))
  assert.ok(r.avisos.includes('cnpj_ausente'))
})

test('competência em vários formatos', () => {
  assert.equal(lerCompetencia('Mai/2026'), '2026-05')
  assert.equal(lerCompetencia('maio de 2026'), '2026-05')
  assert.equal(lerCompetencia('Fev/2027'), '2027-02')
  assert.equal(lerCompetencia('08/2027'), '2027-08')
  assert.equal(lerCompetencia(new Date(Date.UTC(2026, 10, 1))), '2026-11')
  assert.equal(lerCompetencia('qualquer coisa'), null)
})

test('documento → sigla', () => {
  assert.equal(siglaDoDocumento('Plano Individualizado Comportamental (PIC)'), 'PIC')
  assert.equal(siglaDoDocumento('Relatório de Fechamento Técnico'), 'RT')
  assert.equal(siglaDoDocumento('Orientação Escolar'), 'OE')
  assert.equal(siglaDoDocumento('Avaliação'), null)
})
