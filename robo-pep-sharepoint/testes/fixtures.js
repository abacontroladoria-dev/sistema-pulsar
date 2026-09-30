/**
 * SharePoint de mentira, com a MESMA estrutura do real (capturas de 30/09/2026)
 * e nomes inventados. Nenhum dado real entra no repositório.
 *
 * CPF 529.982.247-25 e CNPJ 11.222.333/0001-81 são números de exemplo com
 * dígito verificador válido, usados em documentação no Brasil inteiro.
 */

const ExcelJS = require('exceljs')

const CPF_OK = '52998224725'
const CPF_OK_2 = '11144477735'
const CNPJ_OK = '11222333000181'

let seq = 0
const id = (p) => `${p}-${++seq}`

function item({ nome, pai, pasta = false, criado = '2026-09-15T13:00:00Z', tamanho = 1000 }) {
  const i = {
    id: id(pasta ? 'D' : 'F'),
    name: nome,
    parentReference: { id: pai },
    createdDateTime: criado,
    lastModifiedDateTime: criado,
    webUrl: `https://exemplo.sharepoint.com/${encodeURIComponent(nome)}`,
    size: tamanho,
    eTag: `"${seq},1"`,
    createdBy: { user: { displayName: 'Pessoa Exemplo' } },
  }
  if (pasta) i.folder = { childCount: 0 }
  else i.file = { mimeType: 'application/pdf' }
  return i
}

/** Um prestador completo, como o administrador monta. */
function prestador(raizId, { nome = 'Fulana Exemplo', razao = 'FULANA EXEMPLO PSICOLOGIA LTDA', pacientes = ['Beltrano Exemplo da Silva'] } = {}) {
  const itens = []
  const add = (x) => { itens.push(x); return x }
  const p = add(item({ nome: `Prestador de Serviço - ${nome} (${razao})`, pai: raizId, pasta: true }))
  const plan = add(item({ nome: '1. Planejamento - Prestador de Serviço', pai: p.id, pasta: true }))
  const geral = add(item({ nome: '2. Geral', pai: p.id, pasta: true }))
  const stc = add(item({ nome: '1. Supervisão Técnica ABA do Caso', pai: geral.id, pasta: true }))
  const etc = add(item({ nome: '2. Estudo Técnico de Caso', pai: geral.id, pasta: true }))
  const pacs = add(item({ nome: '3. Pacientes', pai: p.id, pasta: true }))
  const porPaciente = {}
  for (const nomePac of pacientes) {
    const pac = add(item({ nome: nomePac, pai: pacs.id, pasta: true }))
    const subs = {}
    ;[
      '1. Treinamento de Aplicadores ABA', '2. Treinamento e Orientação Parental',
      '3. Plano Individualizado Comportamental (PIC)', '4. Relatório de Fechamento Técnico',
      '5. Orientação Escolar', '6. Avaliações Gerais', '7. Protocolo de Conduta',
    ].forEach((n, i) => { subs[i + 1] = add(item({ nome: n, pai: pac.id, pasta: true })) })
    porPaciente[nomePac] = { pasta: pac, subs }
  }
  return { itens, prestador: p, plan, geral, stc, etc, pacs, porPaciente }
}

async function planilhaBuffer({ razao = 'FULANA EXEMPLO PSICOLOGIA LTDA', cnpj = '11.222.333/0001-81', pacientes = [['Beltrano Exemplo da Silva', CPF_OK]], planejamento = [] } = {}) {
  const livro = new ExcelJS.Workbook()
  const plan = livro.addWorksheet('Planejamento')
  plan.getCell('A1').value = 'Prestador (Razão Social):'
  plan.getCell('B1').value = razao
  plan.getCell('A2').value = 'CNPJ:'
  plan.getCell('B2').value = cnpj
  plan.getCell('A3').value = 'e-mail:'
  plan.getCell('B3').value = { text: 'exemplo@exemplo.com', hyperlink: 'mailto:exemplo@exemplo.com' }
  plan.getCell('A5').value = 'Planejamento — PIC · Relatório Técnico · Orientação Escolar'
  plan.getCell('A6').value = 'Planejamento definido com autonomia técnica pelo PRESTADOR.'
  plan.getRow(7).values = ['Paciente', 'CPF (automático)', 'Documento', 'Competência']
  planejamento.forEach((linha, i) => {
    const r = plan.getRow(8 + i)
    r.getCell(1).value = linha[0]
    // CPF "automático": fórmula com resultado em cache, como o Excel salva.
    r.getCell(2).value = { formula: 'VLOOKUP(A8,Pacientes!A:B,2,0)', result: linha[1] }
    r.getCell(3).value = linha[2]
    r.getCell(4).value = linha[3] ?? null
  })

  const pac = livro.addWorksheet('Pacientes')
  pac.getCell('A1').value = 'Listas de Pacientes'
  pac.getRow(2).values = ['Nome / código do paciente', 'CPF']
  pacientes.forEach((p, i) => {
    // CPF como NÚMERO, igual à planilha real (perde zero à esquerda).
    pac.getRow(3 + i).values = [p[0], /^\d+$/.test(p[1]) ? Number(p[1]) : p[1]]
  })
  return Buffer.from(await livro.xlsx.writeBuffer())
}

module.exports = { item, prestador, planilhaBuffer, CPF_OK, CPF_OK_2, CNPJ_OK }
