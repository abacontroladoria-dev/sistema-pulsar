/**
 * Leitura da "Planejamento Documentos Técnicos - <Prestador>.xlsx".
 *
 * Formato visto em 30/09/2026 (planilha da Aline Miranda):
 *
 *   aba "Planejamento"
 *     A1 "Prestador (Razão Social):"  B1 razão social
 *     A2 "CNPJ:"                       B2 CNPJ
 *     A3 "e-mail:"                     B3 e-mail
 *     linha ~7: Paciente | CPF (automático) | Documento | Competência
 *   aba "Pacientes"
 *     linha ~2: Nome / código do paciente | CPF
 *
 * Nada de endereço fixo de célula além do necessário: rótulos e cabeçalhos são
 * PROCURADOS nas primeiras linhas. Uma linha a mais no topo, ou a tabela
 * descendo uma posição, não pode derrubar a leitura.
 *
 * O arquivo chega como Buffer (baixado em memória) e nunca é gravado em disco.
 * O e-mail do prestador é lido pela planilha mas NÃO sai daqui: o banco não
 * precisa dele para reconhecer ninguém.
 */

const ExcelJS = require('exceljs')
const { normalizarCpf, normalizarCnpj, normalizarNome } = require('./validacao')

const MESES = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12,
}

/** Valor "de tela" de uma célula do ExcelJS, seja texto, fórmula, link ou data. */
function valorCelula(celula) {
  const v = celula?.value
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('result' in v) return v.result instanceof Date ? v.result : (v.result ?? null) // fórmula
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    if ('text' in v) return v.text // hiperlink
    if ('error' in v) return null
    return null
  }
  return v
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** "Mai/2026", "maio/2026", "05/2026", "2026-05" ou uma data do Excel → "2026-05". */
function lerCompetencia(v) {
  if (v instanceof Date) {
    // Data do Excel chega como meia-noite UTC; ler em UTC evita cair no mês anterior.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const s = normalizarNome(v)
  if (!s) return null
  let m = s.match(/^([a-z]+)\s*(?:de\s*)?(\d{4})$/) || s.match(/^([a-z]+)\s+(\d{4})$/)
  if (m && MESES[m[1]]) return `${m[2]}-${String(MESES[m[1]]).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\s*(\d{4})$/)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})\s*(\d{1,2})$/)
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`
  return null
}

/** Nome do documento na coluna "Documento" → sigla do catálogo PEP. */
function siglaDoDocumento(v) {
  const s = normalizarNome(v)
  if (!s) return null
  if (/\bpic\b/.test(s) || s.includes('plano individualizado')) return 'PIC'
  if (s.includes('relatorio')) return 'RT'
  if (s.includes('orientacao escolar')) return 'OE'
  return null
}

function acharAba(livro, alvo) {
  const n = normalizarNome(alvo)
  return livro.worksheets.find(a => normalizarNome(a.name) === n)
    ?? livro.worksheets.find(a => (normalizarNome(a.name) ?? '').includes(n))
    ?? null
}

/** Primeira linha (até `limite`) em que alguma célula satisfaz `teste`. */
function acharLinha(aba, teste, limite = 20) {
  for (let r = 1; r <= Math.min(limite, aba.rowCount); r++) {
    const linha = aba.getRow(r)
    for (let c = 1; c <= Math.max(linha.cellCount, 8); c++) {
      const s = normalizarNome(valorCelula(linha.getCell(c)))
      if (s && teste(s)) return { r, c }
    }
  }
  return null
}

/** Valor à direita de um rótulo ("CNPJ:" → célula seguinte não vazia). */
function valorAoLadoDoRotulo(aba, teste) {
  const achado = acharLinha(aba, teste, 10)
  if (!achado) return null
  const linha = aba.getRow(achado.r)
  for (let c = achado.c + 1; c <= achado.c + 4; c++) {
    const v = valorCelula(linha.getCell(c))
    if (texto(v)) return v
  }
  return null
}

/** Mapa coluna-por-cabeçalho numa linha. */
function colunas(aba, linhaCabecalho, regras) {
  const linha = aba.getRow(linhaCabecalho)
  const mapa = {}
  for (let c = 1; c <= Math.max(linha.cellCount, 10); c++) {
    const s = normalizarNome(valorCelula(linha.getCell(c)))
    if (!s) continue
    for (const [chave, teste] of Object.entries(regras)) {
      if (mapa[chave] === undefined && teste(s)) mapa[chave] = c
    }
  }
  return mapa
}

function lerPacientes(aba, avisos) {
  const cab = acharLinha(aba, s => s === 'cpf' || s.startsWith('cpf '))
  if (!cab) { avisos.push('aba_pacientes_sem_cabecalho'); return [] }
  const col = colunas(aba, cab.r, {
    nome: s => s.includes('nome') || s.includes('paciente') || s.includes('codigo'),
    cpf: s => s.startsWith('cpf'),
  })
  if (!col.nome || !col.cpf) { avisos.push('aba_pacientes_sem_cabecalho'); return [] }

  const lista = []
  for (let r = cab.r + 1; r <= aba.rowCount; r++) {
    const linha = aba.getRow(r)
    const nome = texto(valorCelula(linha.getCell(col.nome)))
    const cpfBruto = valorCelula(linha.getCell(col.cpf))
    if (!nome && !texto(cpfBruto)) continue
    const cpf = normalizarCpf(cpfBruto)
    lista.push({ nome, cpf, cpfInformado: !!texto(cpfBruto), cpfValido: !!cpf })
  }
  return lista
}

function lerPlanejamento(aba, avisos) {
  const cab = acharLinha(aba, s => s === 'documento')
  if (!cab) { avisos.push('aba_planejamento_sem_tabela'); return [] }
  const col = colunas(aba, cab.r, {
    paciente: s => s === 'paciente' || s.startsWith('paciente'),
    cpf: s => s.startsWith('cpf'),
    documento: s => s === 'documento',
    competencia: s => s.startsWith('competencia'),
  })
  if (!col.paciente || !col.documento) { avisos.push('aba_planejamento_sem_tabela'); return [] }

  const lista = []
  for (let r = cab.r + 1; r <= aba.rowCount; r++) {
    const linha = aba.getRow(r)
    const paciente = texto(valorCelula(linha.getCell(col.paciente)))
    const documento = valorCelula(linha.getCell(col.documento))
    if (!paciente && !texto(documento)) continue
    const competenciaBruta = col.competencia ? valorCelula(linha.getCell(col.competencia)) : null
    lista.push({
      paciente,
      cpf: col.cpf ? normalizarCpf(valorCelula(linha.getCell(col.cpf))) : null,
      sigla: siglaDoDocumento(documento),
      competencia: lerCompetencia(competenciaBruta),
      competenciaInformada: !!texto(competenciaBruta),
      documento: texto(documento) || null,
    })
  }
  return lista
}

/**
 * @param {Buffer} buffer conteúdo do .xlsx
 * @returns {Promise<{razaoSocial, cnpj, cnpjInformado, pacientes, planejamento, avisos}>}
 */
async function lerPlanilhaPlanejamento(buffer) {
  const livro = new ExcelJS.Workbook()
  await livro.xlsx.load(buffer)
  const avisos = []

  const abaPlan = acharAba(livro, 'Planejamento') ?? livro.worksheets[0]
  const abaPac = acharAba(livro, 'Pacientes')
  if (!abaPlan) avisos.push('sem_aba_planejamento')
  if (!abaPac) avisos.push('sem_aba_pacientes')

  let razaoSocial = null
  let cnpjBruto = null
  if (abaPlan) {
    razaoSocial = texto(valorAoLadoDoRotulo(abaPlan, s => s.includes('razao social'))) || null
    cnpjBruto = valorAoLadoDoRotulo(abaPlan, s => s.startsWith('cnpj'))
  }
  const cnpj = normalizarCnpj(cnpjBruto)
  if (!texto(cnpjBruto)) avisos.push('cnpj_ausente')
  else if (!cnpj) avisos.push('cnpj_invalido')

  return {
    razaoSocial,
    cnpj,
    cnpjInformado: !!texto(cnpjBruto),
    pacientes: abaPac ? lerPacientes(abaPac, avisos) : [],
    planejamento: abaPlan ? lerPlanejamento(abaPlan, avisos) : [],
    avisos,
  }
}

module.exports = { lerPlanilhaPlanejamento, lerCompetencia, siglaDoDocumento }
