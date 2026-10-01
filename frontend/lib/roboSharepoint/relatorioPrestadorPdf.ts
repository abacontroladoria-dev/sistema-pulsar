// Desenha o Relatorio (relatorioPrestador.ts) num PDF A4 com pdf-lib. Feito
// para quem nem conhece a sigla: cada linha diz o documento por extenso, quanto
// o mês espera, quanto já está na pasta, quanto falta e a situação em cor.
// Fonte Helvetica (WinAnsi): o texto passa por `seguro` para não quebrar com
// caractere fora da tabela.

import type { PDFFont, PDFPage, RGB } from 'pdf-lib'
import type { LinhaItem, Relatorio, Situacao } from './relatorioPrestador'

type Lib = typeof import('pdf-lib')

const A4 = { w: 595.28, h: 841.89 }
const M = 40 // margem
const RODAPE = 36

export async function gerarPdfRelatorio(r: Relatorio, geradoEm = new Date()): Promise<Uint8Array> {
  const lib: Lib = await import('pdf-lib')
  const { PDFDocument, StandardFonts, rgb } = lib
  const doc = await PDFDocument.create()
  doc.setTitle(`Pendências de entregas PEP — ${r.razaoSocial} — ${r.mesRotulo}`)
  doc.setCreator('Pulsar')
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold)

  const COR = {
    texto: rgb(0.12, 0.16, 0.23), suave: rgb(0.39, 0.45, 0.55), linha: rgb(0.89, 0.91, 0.94),
    fundo: rgb(0.97, 0.98, 0.99), marca: rgb(0.16, 0.57, 0.75), marcaEsc: rgb(0.10, 0.40, 0.55),
    verde: rgb(0.02, 0.47, 0.34), verdeF: rgb(0.86, 0.97, 0.91),
    ambar: rgb(0.71, 0.33, 0.04), ambarF: rgb(1, 0.95, 0.85),
    rosa: rgb(0.75, 0.07, 0.24), rosaF: rgb(1, 0.91, 0.93),
    cinza: rgb(0.39, 0.45, 0.55), cinzaF: rgb(0.94, 0.95, 0.97),
    branco: rgb(1, 1, 1),
  }

  // Caracteres fora do WinAnsi viram um equivalente.
  const cabe = new Map<string, boolean>()
  const seguro = (t: string) => t
    .replace(/[→⇒]/g, '->').replace(/[✓✔]/g, 'ok').replace(/[   ]/g, ' ')
    .split('').map(ch => {
      let ok = cabe.get(ch)
      if (ok === undefined) { try { fonte.encodeText(ch); ok = true } catch { ok = false } cabe.set(ch, ok) }
      return ok ? ch : '?'
    }).join('')

  let pagina: PDFPage = doc.addPage([A4.w, A4.h])
  let y = A4.h - M

  const texto = (t: string, x: number, yy: number, o: { f?: PDFFont; s?: number; c?: RGB } = {}) =>
    pagina.drawText(seguro(t), { x, y: yy, font: o.f ?? fonte, size: o.s ?? 9, color: o.c ?? COR.texto })

  const quebrar = (t: string, largura: number, f: PDFFont, s: number) => {
    const palavras = seguro(t).split(/\s+/)
    const linhas: string[] = []
    let atual = ''
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p
      if (f.widthOfTextAtSize(teste, s) <= largura) atual = teste
      else { if (atual) linhas.push(atual); atual = p }
    }
    if (atual) linhas.push(atual)
    return linhas.length ? linhas : ['']
  }

  const novaPagina = () => { pagina = doc.addPage([A4.w, A4.h]); y = A4.h - M }
  const garantir = (h: number, aoQuebrar?: () => void) => { if (y - h < M + RODAPE) { novaPagina(); aoQuebrar?.() } }

  // ── Cabeçalho: identificação jurídica (nunca o nome da pessoa) ─────────────
  pagina.drawRectangle({ x: 0, y: A4.h - 96, width: A4.w, height: 96, color: COR.marca })
  pagina.drawRectangle({ x: 0, y: A4.h - 100, width: A4.w, height: 4, color: COR.verde })
  texto('PENDÊNCIAS DE ENTREGAS PEP · O QUE ESTÁ NAS PASTAS E O QUE FALTA', M, A4.h - 30, { f: negrito, s: 9, c: COR.branco })
  const ident = `${r.cnpj ? `CNPJ ${r.cnpj} – ` : ''}${r.razaoSocial}`
  const linhasIdent = quebrar(ident, A4.w - 2 * M, negrito, 14).slice(0, 2)
  linhasIdent.forEach((l, i) => texto(l, M, A4.h - 52 - i * 16, { f: negrito, s: 14, c: COR.branco }))
  texto(`Mês de atendimento: ${r.mesRotulo}`, M, A4.h - 56 - linhasIdent.length * 16 + 2, { s: 10, c: COR.branco })
  y = A4.h - 116

  // Faixa de aviso, no espírito do Demonstrativo de Faturamento.
  const aviso = 'Documento informativo. Mostra o que foi localizado nas pastas do SharePoint e o que consta como pendente na data '
    + 'de geração. Não é apuração de faturamento nem avaliação do conteúdo técnico dos documentos: a aceitação das entregas '
    + 'e os valores dependem da validação do Relacionamento com o Prestador.'
  const linhasAviso = quebrar(aviso, A4.w - 2 * M - 20, fonte, 8)
  const hAviso = linhasAviso.length * 10 + 12
  pagina.drawRectangle({ x: M, y: y - hAviso, width: A4.w - 2 * M, height: hAviso, color: COR.fundo, borderColor: COR.linha, borderWidth: 0.6 })
  pagina.drawRectangle({ x: M, y: y - hAviso, width: 3, height: hAviso, color: COR.marca })
  linhasAviso.forEach((l, i) => texto(l, M + 12, y - 14 - i * 10, { s: 8, c: COR.suave }))
  y -= hAviso + 14

  // ── Resumo em 4 caixas ─────────────────────────────────────────────────────
  const caixas: { valor: string; rotulo: string; cor: RGB; fundo: RGB }[] = [
    { valor: String(r.totais.esperados), rotulo: 'documentos esperados no mês', cor: COR.texto, fundo: COR.fundo },
    { valor: String(r.totais.naPasta), rotulo: 'já estão nas pastas', cor: COR.verde, fundo: COR.verdeF },
    { valor: String(r.totais.faltam), rotulo: 'faltam entregar', cor: r.totais.faltam > 0 ? COR.rosa : COR.verde, fundo: r.totais.faltam > 0 ? COR.rosaF : COR.verdeF },
    { valor: r.temPlanilha ? 'Tem' : 'Falta', rotulo: 'planilha de planejamento', cor: r.temPlanilha ? COR.verde : COR.ambar, fundo: r.temPlanilha ? COR.verdeF : COR.ambarF },
  ]
  const larg = (A4.w - 2 * M - 3 * 8) / 4
  caixas.forEach((c, i) => {
    const x = M + i * (larg + 8)
    pagina.drawRectangle({ x, y: y - 58, width: larg, height: 58, color: c.fundo, borderColor: COR.linha, borderWidth: 0.6 })
    texto(c.valor, x + 10, y - 30, { f: negrito, s: 20, c: c.cor })
    quebrar(c.rotulo, larg - 20, fonte, 8).slice(0, 2).forEach((l, j) => texto(l, x + 10, y - 44 - j * 9, { s: 8, c: COR.suave }))
  })
  y -= 76

  const paragrafo = (t: string, s = 9, c = COR.suave) => {
    for (const l of quebrar(t, A4.w - 2 * M, fonte, s)) { garantir(s + 4); texto(l, M, y, { s, c }); y -= s + 4 }
  }
  paragrafo('Um documento só conta quando está na pasta certa do SharePoint e com o nome no padrão (veja o fim deste PDF). '
    + 'Abaixo, para cada documento do mês: quanto é esperado, quanto já está na pasta e quanto ainda falta entregar.')
  if (!r.temPlanilha) {
    y -= 2
    paragrafo('Atenção: falta a planilha de planejamento na pasta "1. Planejamento". Sem ela, o robô não reconhece os pacientes e nada abaixo é contado.', 9, COR.ambar)
  }
  y -= 10

  // ── Tabela ─────────────────────────────────────────────────────────────────
  const COLS = [
    { titulo: 'Documento', x: M, w: 200 },
    { titulo: 'Esperado', x: M + 205, w: 50 },
    { titulo: 'Na pasta', x: M + 260, w: 50 },
    { titulo: 'Falta', x: M + 315, w: 40 },
    { titulo: 'Situação', x: M + 360, w: A4.w - M - (M + 360) },
  ]
  const SIT: Record<Situacao, { rotulo: string; cor: RGB; fundo: RGB }> = {
    completo: { rotulo: 'Completo', cor: COR.verde, fundo: COR.verdeF },
    parcial: { rotulo: 'Incompleto', cor: COR.ambar, fundo: COR.ambarF },
    faltando: { rotulo: 'Falta entregar', cor: COR.rosa, fundo: COR.rosaF },
    previsto: { rotulo: 'Ainda não é deste mês', cor: COR.cinza, fundo: COR.cinzaF },
    sem_planejamento: { rotulo: 'Sem planejamento', cor: COR.ambar, fundo: COR.ambarF },
  }

  const cabecalhoTabela = () => {
    pagina.drawRectangle({ x: M, y: y - 16, width: A4.w - 2 * M, height: 18, color: COR.fundo })
    COLS.forEach(c => texto(c.titulo.toUpperCase(), c.x + 4, y - 11, { f: negrito, s: 7, c: COR.suave }))
    y -= 20
  }

  const linha = (l: LinhaItem) => {
    const doc1 = quebrar(`${l.sigla} · ${l.documento}`, COLS[0].w - 8, negrito, 8.5)
    const nota = quebrar(l.nota, COLS[4].w - 8, fonte, 7.5)
    const h = Math.max(doc1.length * 11, 16 + nota.length * 9) + 6
    garantir(h, cabecalhoTabela)
    doc1.forEach((t, i) => texto(t, COLS[0].x + 4, y - 10 - i * 11, { f: negrito, s: 8.5 }))
    texto(l.esperado === null ? 'semestral' : String(l.esperado), COLS[1].x + 4, y - 10, { s: l.esperado === null ? 7.5 : 9, c: l.esperado === null ? COR.suave : COR.texto })
    texto(String(l.naPasta), COLS[2].x + 4, y - 10, { f: negrito, s: 9, c: l.naPasta > 0 ? COR.verde : COR.suave })
    texto(String(l.falta), COLS[3].x + 4, y - 10, { f: negrito, s: 9, c: l.falta > 0 ? COR.rosa : COR.suave })
    const sit = SIT[l.situacao]
    const wSit = negrito.widthOfTextAtSize(sit.rotulo, 7.5) + 10
    pagina.drawRectangle({ x: COLS[4].x + 4, y: y - 13, width: wSit, height: 12, color: sit.fundo })
    texto(sit.rotulo, COLS[4].x + 9, y - 10, { f: negrito, s: 7.5, c: sit.cor })
    nota.forEach((t, i) => texto(t, COLS[4].x + 4, y - 24 - i * 9, { s: 7.5, c: COR.suave }))
    y -= h
    pagina.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.5, color: COR.linha })
  }

  const titulo = (t: string, sub?: string) => {
    garantir(50)
    texto(t, M, y, { f: negrito, s: 12, c: COR.marcaEsc })
    y -= 14
    if (sub) { for (const l of quebrar(sub, A4.w - 2 * M, fonte, 8)) { texto(l, M, y, { s: 8, c: COR.suave }); y -= 10 } }
    y -= 4
  }

  titulo('Geral do prestador', 'Supervisão e Estudo de Caso: uma de cada por semana do mês, valem para todos os pacientes.')
  cabecalhoTabela()
  r.geral.forEach(linha)
  y -= 14

  for (const p of r.pacientes) {
    // O paciente começa numa página nova quando o bloco dele não cabe inteiro
    // (cada linha ~36 pt + título e cabeçalho), para não sobrar uma linha solta.
    garantir(Math.min(60 + p.itens.length * 36, A4.h - 2 * M - RODAPE - 20))
    titulo(`Paciente: ${p.nome}`, p.aviso ?? undefined)
    cabecalhoTabela()
    p.itens.forEach(linha)
    y -= 12
  }

  // ── Arquivos que não contam ────────────────────────────────────────────────
  if (r.foraDoPadrao.length > 0) {
    titulo(`Arquivos que não contam (${r.foraDoPadrao.length})`, 'Estão nas pastas, mas o nome não segue o padrão. Renomeie como em "Nome certo" e o robô passa a contar na leitura seguinte.')
    for (const f of r.foraDoPadrao) {
      const a = quebrar(f.arquivo, 220, negrito, 8)
      const b = quebrar(`${f.onde} · ${f.motivo}`, 220, fonte, 7.5)
      const h = (a.length * 10) + (b.length * 9) + 8
      garantir(h)
      a.forEach((t, i) => texto(t, M, y - 9 - i * 10, { f: negrito, s: 8 }))
      b.forEach((t, i) => texto(t, M, y - 9 - a.length * 10 - i * 9, { s: 7.5, c: COR.rosa }))
      if (f.nomeCerto) {
        texto('Nome certo:', M + 240, y - 9, { s: 7.5, c: COR.suave })
        texto(f.nomeCerto, M + 240, y - 20, { f: negrito, s: 8.5, c: COR.verde })
      }
      y -= h
      pagina.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.5, color: COR.linha })
    }
    y -= 12
  }

  // ── Como nomear ────────────────────────────────────────────────────────────
  titulo('Como nomear os arquivos', 'MMAAAA é o mês e o ano (setembro de 2026 = 092026). NN é o número da semana ou da sessão: 01, 02, 03, 04.')
  const exemplos: [string, string][] = [
    ['Geral (Supervisão, Estudo de Caso)', 'STC-01-092026 · ETC-02-092026'],
    ['Paciente', 'TOP-JOAO SILVA-092026 · PIC-JOAO SILVA-092026 · RT-JOAO SILVA-092026 · OE-JOAO SILVA-092026'],
    ['TAP (quinzenal, leva o número)', 'TAP-01-JOAO SILVA-092026 · TAP-02-JOAO SILVA-092026'],
    ['Reprogramação', 'REP-PIC-JOAO SILVA-092026'],
  ]
  for (const [onde, ex] of exemplos) {
    const linhas = quebrar(ex, A4.w - 2 * M - 170, negrito, 8)
    garantir(linhas.length * 10 + 6)
    texto(onde, M, y - 9, { s: 8, c: COR.suave })
    linhas.forEach((t, i) => texto(t, M + 170, y - 9 - i * 10, { f: negrito, s: 8 }))
    y -= linhas.length * 10 + 6
  }

  // ── Confidencialidade (LGPD), como no Demonstrativo de Faturamento ─────────
  y -= 10
  const conf = 'DOCUMENTO CONFIDENCIAL — Informações protegidas pela Lei nº 13.709/2018 (LGPD), inclusive dados de pacientes. '
    + 'Destinado exclusivamente ao prestador identificado no cabeçalho. Vedado o compartilhamento, a reprodução ou o uso '
    + 'para outra finalidade sem autorização prévia da Universo ABA.'
  const linhasConf = quebrar(conf, A4.w - 2 * M - 20, fonte, 7.5)
  const hConf = linhasConf.length * 9.5 + 12
  garantir(hConf + 4)
  pagina.drawRectangle({ x: M, y: y - hConf, width: A4.w - 2 * M, height: hConf, color: COR.fundo, borderColor: COR.linha, borderWidth: 0.6 })
  linhasConf.forEach((l, i) => texto(l, M + 10, y - 13 - i * 9.5, { f: i === 0 ? negrito : fonte, s: 7.5, c: COR.suave }))
  y -= hConf

  // ── Rodapé em todas as páginas ─────────────────────────────────────────────
  const paginas = doc.getPages()
  const quando = geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  paginas.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: M + 14 }, end: { x: A4.w - M, y: M + 14 }, thickness: 0.5, color: COR.linha })
    pg.drawText(seguro(`Documento elaborado em ${quando} · Universo ABA · Uso exclusivo do prestador identificado acima · ${r.mesRotulo}`), { x: M, y: M, font: fonte, size: 7, color: COR.suave })
    const pgTxt = `página ${i + 1} de ${paginas.length}`
    pg.drawText(pgTxt, { x: A4.w - M - fonte.widthOfTextAtSize(pgTxt, 7), y: M, font: fonte, size: 7, color: COR.suave })
  })

  return doc.save()
}

/** Baixa os bytes como arquivo no navegador. */
export function baixarPdf(bytes: Uint8Array, nomeArquivo: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
