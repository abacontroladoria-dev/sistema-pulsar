const test = require('node:test')
const assert = require('node:assert/strict')
const { extrairTexto, podeLer, limparTexto, sha256 } = require('../lib/documentos')
const { executar } = require('../lib/execucao')
const { item, prestador } = require('./fixtures')

// Arquivos de verdade, montados aqui: um .docx mínimo (zip com o XML do Word,
// via jszip, que já vem com o exceljs) e um PDF mínimo escrito à mão.

async function docx(paragrafos) {
  const JSZip = require('jszip')
  const z = new JSZip()
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const corpo = paragrafos.map(p => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`)
  return z.generateAsync({ type: 'nodebuffer' })
}

/** PDF de uma página com as linhas dadas (Helvetica, só ASCII). */
function pdf(linhas) {
  const conteudo = `BT /F1 12 Tf 50 750 Td 14 TL ${linhas.map(l => `(${l.replace(/[()\\]/g, '')}) Tj T*`).join(' ')} ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let s = '%PDF-1.4\n'
  const offs = []
  objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = s.length
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(s, 'latin1')
}

const OE = [
  'ORIENTAÇÃO ESCOLAR',
  'Data do registro: 15/09/2026',
  'Horário: 14h00 às 15h00',
  'Paciente: João Pedro Silva',
  'Foi apresentado à coordenação o plano de manejo de comportamentos de fuga durante a transição do recreio.',
]

test('podeLer: formato e tamanho decidem antes de baixar', () => {
  assert.deepEqual(podeLer('OE-JOAO-092026.pdf', 1000), { ok: true, ext: 'pdf' })
  assert.equal(podeLer('OE-JOAO-092026.docx', 1000).ok, true)
  assert.equal(podeLer('OE-JOAO-092026.doc', 1000).status, 'formato_nao_suportado')
  assert.equal(podeLer('foto.jpeg', 1000).status, 'formato_nao_suportado')
  assert.equal(podeLer('OE-JOAO-092026.pdf', 40 * 1024 * 1024).status, 'grande_demais')
})

test('limparTexto: espaços e linhas em branco', () => {
  assert.equal(limparTexto('a  b\r\n\r\n\r\n\r\n  c  '), 'a b\n\nc')
})

test('extrairTexto: .docx', async () => {
  const r = await extrairTexto(await docx(OE), 'OE-JOAO-092026.docx')
  assert.equal(r.status, 'ok')
  assert.match(r.texto, /Paciente: João Pedro Silva/)
  assert.match(r.texto, /ORIENTAÇÃO ESCOLAR/)
})

test('extrairTexto: .pdf com texto', async () => {
  const r = await extrairTexto(pdf(['ORIENTACAO ESCOLAR', 'Data do registro: 15/09/2026', 'Paciente: Joao Pedro Silva', 'Foi apresentado a coordenacao o plano de manejo.']), 'OE.pdf')
  assert.equal(r.status, 'ok')
  assert.equal(r.paginas, 1)
  assert.match(r.texto, /Paciente: Joao Pedro Silva/)
})

test('extrairTexto: PDF sem texto (escaneado) e arquivo quebrado', async () => {
  assert.equal((await extrairTexto(pdf([]), 'scan.pdf')).status, 'sem_texto')
  assert.equal((await extrairTexto(Buffer.from('não é pdf'), 'x.pdf')).status, 'corrompido')
  assert.equal((await extrairTexto(Buffer.from('não é zip'), 'x.docx')).status, 'corrompido')
})

test('sha256: mesmo arquivo, mesma impressão digital', async () => {
  const a = pdf(['igual']), b = pdf(['igual'])
  assert.equal(sha256(a), sha256(b))
  assert.notEqual(sha256(a), sha256(pdf(['outro'])))
})

// ── A etapa dentro da execução ───────────────────────────────────────────────

const RAIZ = 'RAIZ'
function graphFalso(itens, arquivos) {
  return {
    metricas: { chamadas: 0, bytes: 0, esperas429: 0 },
    async obterToken() { return 'tok' },
    async biblioteca() { return { driveId: 'DRIVE', nome: 'Documentos', raizId: RAIZ } },
    async delta() { return { itens, deltaLink: 'link', completo: true } },
    async baixar(driveId, id) { if (!arquivos[id]) throw new Error('Graph HTTP 404'); return arquivos[id] },
  }
}
function apiFalsa(pedido) {
  return {
    metricas: { chamadas: 0, ms: 0, bytesEnviados: 0 },
    etapas: [], documentos: [], fim: null,
    async iniciarExecucao() { return { execucao_id: 'EXEC', delta_link: null, drive_id: null, pastas: [] } },
    async etapa(id, etapa, status, ms, detalhe) { this.etapas.push({ etapa, status, detalhe }) },
    async registrarLote() { return { ms_banco: 1 } },
    async documentosALer() { if (pedido instanceof Error) throw pedido; return pedido },
    async registrarDocumentos(id, docs) { this.documentos.push(...docs); return { gravados: docs.length } },
    async finalizarExecucao(id, f) { this.fim = f },
  }
}

test('execução lê os documentos pedidos pelo banco e manda texto + impressão digital', async () => {
  const e = prestador(RAIZ)
  const pac = e.porPaciente['Beltrano Exemplo da Silva']
  const oe = item({ nome: 'OE-BELTRANO-092026.docx', pai: pac.subs[4].id })
  const graph = graphFalso([...e.itens, oe], { [oe.id]: await docx(OE) })
  const api = apiFalsa({ total: 3, itens: [
    { sp_id: oe.id, e_tag: 'e1', nome: oe.name, tamanho: 2000 },
    { sp_id: 'FOTO', e_tag: 'e2', nome: 'foto.heic', tamanho: 2000 },
    { sp_id: 'SUMIU', e_tag: 'e3', nome: 'PIC-X-092026.pdf', tamanho: 2000 },
  ] })

  const r = await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })

  assert.equal(r.status, 'concluido')
  const porId = Object.fromEntries(api.documentos.map(d => [d.sp_id, d]))
  assert.equal(porId[oe.id].status, 'ok')
  assert.match(porId[oe.id].texto, /João Pedro Silva/)
  assert.equal(porId[oe.id].sha256.length, 64)
  assert.equal(porId.FOTO.status, 'formato_nao_suportado')
  assert.equal(porId.FOTO.texto, undefined)
  assert.equal(porId.SUMIU.status, 'erro')
  const etapa = api.etapas.find(x => x.etapa === 'documentos' && x.status === 'concluida')
  assert.equal(etapa.detalhe.lidos, 3)
  assert.equal(etapa.detalhe.nao_legiveis, 2)
})

test('banco sem a migration: etapa "indisponível", execução concluída', async () => {
  const e = prestador(RAIZ)
  const api = apiFalsa(new Error('robo_pep_documentos_a_ler: HTTP 404 — PGRST202'))
  const r = await executar({ graph: graphFalso(e.itens, {}), api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  assert.equal(r.status, 'concluido')
  assert.deepEqual(api.etapas.find(x => x.etapa === 'documentos' && x.status === 'concluida').detalhe, { indisponivel: true })
})

test('falha do banco na etapa não derruba a execução', async () => {
  const e = prestador(RAIZ)
  const api = apiFalsa(new Error('robo_pep_documentos_a_ler: HTTP 500 — boom'))
  const r = await executar({ graph: graphFalso(e.itens, {}), api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  assert.equal(r.status, 'concluido')
  assert.ok(api.etapas.some(x => x.etapa === 'documentos' && x.status === 'erro'))
})
