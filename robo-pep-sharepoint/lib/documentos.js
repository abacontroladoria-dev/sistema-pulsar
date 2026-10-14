/**
 * Conteúdo das evidências (0.5.0, 14/10/2026). O robô baixa cada evidência
 * NOVA ou ALTERADA (o banco diz quais: `robo_pep_documentos_a_ler`), tira o
 * texto e manda ao banco — quem analisa é o Pulsar, não o robô. Aqui só:
 *
 *   • o texto, de .docx (mammoth) e .pdf (unpdf/pdf.js);
 *   • a impressão digital do arquivo (SHA-256: arquivo idêntico em dois
 *     lugares é o mesmo arquivo, sem precisar ler o conteúdo);
 *   • o motivo quando não dá para ler — vira "Não foi possível ler" na tela:
 *     PDF escaneado (imagem, sem texto), com senha, corrompido, formato que o
 *     robô não lê (.doc antigo, foto) ou grande demais.
 *
 * O texto NÃO vai para log: só contagens. Ele viaja no corpo da RPC e fica
 * numa tabela que nenhum login lê (sp_pep_documentos_texto).
 */

const crypto = require('node:crypto')

const TAMANHO_MAX = 30 * 1024 * 1024
const TEXTO_MAX = 300000
// Abaixo disso, um PDF é imagem (escaneado): não há o que ler sem OCR.
const TEXTO_MIN = 40

function extensaoDe(nome) {
  const m = String(nome ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)
  return m ? m[1] : ''
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/** Espaços uniformes, sem linhas em branco repetidas. Mantém a quebra de linha. */
function limparTexto(t) {
  return String(t ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   \t]/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** O que o robô sabe ler. Decide antes de baixar (formato e tamanho). */
function podeLer(nome, tamanho) {
  const ext = extensaoDe(nome)
  if (tamanho && tamanho > TAMANHO_MAX) return { ok: false, status: 'grande_demais', detalhe: `${Math.round(tamanho / 1048576)} MB` }
  if (ext === 'pdf' || ext === 'docx' || ext === 'docm') return { ok: true, ext }
  if (ext === 'doc') return { ok: false, status: 'formato_nao_suportado', detalhe: 'Word antigo (.doc): salve como .docx ou PDF' }
  return { ok: false, status: 'formato_nao_suportado', detalhe: ext ? `.${ext}` : 'sem extensão' }
}

let _unpdf = null
async function unpdf() {
  // unpdf é só ESM; o robô é CommonJS.
  if (!_unpdf) _unpdf = await import('unpdf')
  return _unpdf
}

async function textoDoPdf(buf) {
  const { getDocumentProxy, extractText } = await unpdf()
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    const paginas = Array.isArray(text) ? text : [String(text ?? '')]
    return { status: 'ok', texto: paginas.map(limparTexto).join('\n\n'), paginas: totalPages }
  } catch (e) {
    const nome = e?.name ?? ''
    if (/Password/i.test(nome)) return { status: 'protegido', detalhe: 'PDF com senha' }
    if (/InvalidPDF|FormatError|UnexpectedResponse/i.test(nome)) return { status: 'corrompido', detalhe: 'PDF inválido' }
    return { status: 'erro', detalhe: String(e?.message ?? e).slice(0, 200) }
  }
}

async function textoDoDocx(buf) {
  const mammoth = require('mammoth')
  try {
    const r = await mammoth.extractRawText({ buffer: buf })
    return { status: 'ok', texto: limparTexto(r.value), paginas: null }
  } catch (e) {
    // .docx é um zip; zip quebrado = arquivo corrompido (ou outro formato renomeado).
    if (/zip|central directory|end of data|corrupt/i.test(String(e?.message ?? ''))) {
      return { status: 'corrompido', detalhe: 'Word inválido' }
    }
    return { status: 'erro', detalhe: String(e?.message ?? e).slice(0, 200) }
  }
}

/**
 * @param {Buffer} buf
 * @param {string} nome
 * @returns {Promise<{status:string, texto?:string, paginas?:number|null, detalhe?:string, caracteres:number}>}
 */
async function extrairTexto(buf, nome) {
  const ext = extensaoDe(nome)
  const r = ext === 'pdf' ? await textoDoPdf(buf) : await textoDoDocx(buf)
  if (r.status !== 'ok') return { ...r, caracteres: 0 }
  const texto = r.texto.slice(0, TEXTO_MAX)
  if (texto.replace(/\s/g, '').length < TEXTO_MIN) {
    return {
      status: 'sem_texto', caracteres: texto.length, paginas: r.paginas,
      detalhe: ext === 'pdf' ? 'PDF escaneado (imagem): sem texto para ler' : 'Documento sem texto',
    }
  }
  return { status: 'ok', texto, paginas: r.paginas, caracteres: texto.length, detalhe: r.texto.length > TEXTO_MAX ? 'texto cortado' : undefined }
}

module.exports = { extrairTexto, podeLer, sha256, extensaoDe, limparTexto, TAMANHO_MAX }
