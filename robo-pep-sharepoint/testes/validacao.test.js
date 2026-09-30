const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizarCpf, normalizarCnpj, normalizarNome } = require('../lib/validacao')

test('CPF válido com e sem máscara', () => {
  assert.equal(normalizarCpf('529.982.247-25'), '52998224725')
  assert.equal(normalizarCpf(52998224725), '52998224725')
})

test('CPF perde zero à esquerda na célula numérica e é recomposto', () => {
  // 012.345.678-90 é válido; o Excel guarda 1234567890.
  assert.equal(normalizarCpf(1234567890), '01234567890')
})

test('CPF com dígito trocado, repetido ou curto é recusado', () => {
  assert.equal(normalizarCpf('529.982.247-26'), null)
  assert.equal(normalizarCpf('111.111.111-11'), null)
  assert.equal(normalizarCpf(''), null)
  assert.equal(normalizarCpf(null), null)
  assert.equal(normalizarCpf('123456789012'), null)
})

test('CNPJ válido e inválido', () => {
  assert.equal(normalizarCnpj('11.222.333/0001-81'), '11222333000181')
  assert.equal(normalizarCnpj('11.222.333/0001-82'), null)
  assert.equal(normalizarCnpj('00.000.000/0000-00'), null)
})

test('nome normalizado igual ao da função do banco', () => {
  assert.equal(normalizarNome("  Adrián  Araújo-Nery  "), 'adrian araujo nery')
  assert.equal(normalizarNome("Sant'Anna"), 'sant anna')
  assert.equal(normalizarNome(''), null)
})
