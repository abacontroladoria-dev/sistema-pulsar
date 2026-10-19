// Desenho do PDF de evoluções com pdf-lib, a partir da paginação de layout.ts.
// Roda no navegador: nada é salvo em servidor.
//
// O arquivo usa o vocabulário do Pulsar (Paciente, Descrição, Horário), não
// cita o TiTa nem a origem da evolução e não mostra o convênio (decisão D4).

import type { PDFFont, PDFImage, PDFPage } from "pdf-lib"
import type { AssinaturaProfissional, EvolucaoConteudo } from "@/types/exportarEvolucoes"
import { formatarCpf, formatarData, formatarHorario, normalizarDescricao, registroDoProfissional } from "./formato"
import { MEDIDAS, PAGINA, montarLayout, quebrarTexto } from "./layout"

type Lib = typeof import("pdf-lib")

export type OpcoesPdf = {
  /** Já na ordem de saída (paciente, data, horário) — como a API devolve. */
  itens: EvolucaoConteudo[]
  de: string
  ate: string
  assinaturas: AssinaturaProfissional[]
  emitidoEm?: Date
  aoProgredir?: (pagina: number, total: number) => void
}

const TAM_DESCRICAO = 9.5
const ASSINATURA = { largura: 150, altura: 40 }
const LINHA_NOME = 10
const LINHA_REGISTRO = 9
const LINHA_TERAPIA = 12

/** Agrupa por paciente mantendo a ordem de chegada. */
export function agruparPorPaciente(itens: EvolucaoConteudo[]): EvolucaoConteudo[][] {
  const grupos = new Map<string, EvolucaoConteudo[]>()
  for (const e of itens) {
    const k = e.paciente_id != null ? `id:${e.paciente_id}` : `nome:${e.paciente_nome}`
    const g = grupos.get(k)
    if (g) g.push(e)
    else grupos.set(k, [e])
  }
  return [...grupos.values()]
}

const doisDigitos = (n: number) => String(n).padStart(2, "0")

export async function gerarPdfEvolucoes(o: OpcoesPdf): Promise<Uint8Array> {
  const lib: Lib = await import("pdf-lib")
  const { PDFDocument, StandardFonts, rgb } = lib
  const doc = await PDFDocument.create()
  doc.setTitle("Relatório de Atendimentos Realizados")
  doc.setCreator("Clínica Universo ABA")
  doc.setProducer("Clínica Universo ABA")
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold)

  const COR = {
    texto: rgb(0.12, 0.16, 0.23),
    suave: rgb(0.39, 0.45, 0.55),
    linha: rgb(0.85, 0.88, 0.92),
    fundo: rgb(0.96, 0.97, 0.99),
  }

  // Caracteres fora do WinAnsi (emoji etc.) viram um equivalente ou "?".
  const cabe = new Map<string, boolean>()
  const seguro = (t: string) =>
    t
      .replace(/[→⇒]/g, "->")
      .replace(/[✓✔]/g, "ok")
      .replace(/[\u00a0\u2007\u202f]/g, " ")
      // Emoji e símbolos pictográficos não têm equivalente na fonte: saem.
      .replace(/[\u200b-\u200d\ufe0f]|\p{Extended_Pictographic}/gu, "")
      // Por ponto de código: um caractere fora do BMP vira UM "?", não dois.
      .match(/[\s\S]/gu)
      ?.map(ch => {
        let ok = cabe.get(ch)
        if (ok === undefined) {
          try {
            fonte.encodeText(ch)
            ok = true
          } catch {
            ok = false
          }
          cabe.set(ch, ok)
        }
        return ok ? ch : "?"
      })
      .join("") ?? ""

  /** Quebra em linhas que caibam na largura. Nome nunca é cortado com "…". */
  const quebrar = (t: string, f: PDFFont, s: number, largura: number) =>
    t ? quebrarTexto(seguro(t), largura, x => f.widthOfTextAtSize(x, s)) : []

  // Assinaturas: embutidas uma vez cada e reaproveitadas em todas as páginas.
  const imagens = new Map<number, PDFImage>()
  for (const a of o.assinaturas) {
    try {
      imagens.set(a.profissional_id, a.tipo === "png" ? await doc.embedPng(a.dados) : await doc.embedJpg(a.dados))
    } catch {
      // imagem corrompida: sai a linha em branco, como sem assinatura
    }
  }

  const { largura: W, altura: H, margem: M } = PAGINA
  const xTexto = M + MEDIDAS.recuo
  const xAssin = W - M - MEDIDAS.recuo - ASSINATURA.largura
  const colHora = M + 92
  const colTerapia = M + 196

  // Cabeçalho de cada bloco já quebrado em linhas: terapia, nome e registro do
  // profissional saem inteiros. O cabeçalho padrão comporta 1 linha de nome + 1
  // de registro (e a terapia até a altura da assinatura); o que passar disso
  // empurra a descrição para baixo.
  const cabecalhos = new Map<EvolucaoConteudo, { terapia: string[]; nome: string[]; registro: string[]; extra: number }>()
  for (const e of o.itens) {
    const terapia = quebrar(e.terapia, fonte, 10, xAssin - colTerapia - 12)
    const nome = quebrar(e.profissional_nome, negrito, 8.5, ASSINATURA.largura)
    const registro = quebrar(registroDoProfissional(e), fonte, 7.5, ASSINATURA.largura)
    const extraAssinatura = LINHA_NOME * Math.max(0, nome.length - 1) + LINHA_REGISTRO * Math.max(0, registro.length - 1)
    const extraTerapia = Math.max(0, LINHA_TERAPIA * (terapia.length - 1) - 40)
    cabecalhos.set(e, { terapia, nome, registro, extra: Math.max(extraAssinatura, extraTerapia) })
  }

  const grupos = agruparPorPaciente(o.itens)
  // Linha a linha: a quebra de linha não existe na fonte e viraria "?".
  const descricoes = grupos.map(g => g.map(e => normalizarDescricao(e.descricao).split("\n").map(seguro).join("\n")))
  const extras = grupos.map(g => g.map(e => cabecalhos.get(e)!.extra))
  const paginas = montarLayout(descricoes, t => fonte.widthOfTextAtSize(t, TAM_DESCRICAO), extras)

  const emitido = o.emitidoEm ?? new Date()
  const textoEmitido = `Emitido em ${doisDigitos(emitido.getDate())}/${doisDigitos(emitido.getMonth() + 1)}/${emitido.getFullYear()} às ${doisDigitos(emitido.getHours())}:${doisDigitos(emitido.getMinutes())}`
  const periodo = `Período: ${formatarData(o.de)} a ${formatarData(o.ate)}`

  const centro = (p: PDFPage, t: string, y: number, f: PDFFont, s: number, c = COR.texto) => {
    const txt = seguro(t)
    p.drawText(txt, { x: (W - f.widthOfTextAtSize(txt, s)) / 2, y, font: f, size: s, color: c })
  }

  for (const [n, pl] of paginas.entries()) {
    const grupo = grupos[pl.grupo]
    const pac = grupo[0]
    const p = doc.addPage([W, H])
    const topo = H - M

    // ── Cabeçalho do documento ────────────────────────────────────────────
    centro(p, "CLÍNICA UNIVERSO ABA", topo - 12, negrito, 13)
    centro(p, "Relatório de Atendimentos Realizados", topo - 28, fonte, 11)
    centro(p, periodo, topo - 42, fonte, 9, COR.suave)

    // ── Faixa do paciente ─────────────────────────────────────────────────
    const faixaTopo = topo - 54
    p.drawRectangle({ x: M, y: faixaTopo - 50, width: W - 2 * M, height: 50, color: COR.fundo, borderColor: COR.linha, borderWidth: 0.6 })
    const colPac = M + 10
    const colCpf = M + 320
    const colNasc = M + 430
    const rotulo = (t: string, x: number, y: number) => p.drawText(t, { x, y, font: fonte, size: 7.5, color: COR.suave })
    rotulo("Paciente", colPac, faixaTopo - 16)
    rotulo("CPF", colCpf, faixaTopo - 16)
    rotulo("Data de nascimento", colNasc, faixaTopo - 16)
    // Nome inteiro sempre: se não couber numa linha, a letra diminui e quebra.
    const larguraPac = colCpf - colPac - 12
    let tamPac = 10.5
    let linhasPac = quebrar(pac.paciente_nome, negrito, tamPac, larguraPac)
    if (linhasPac.length > 1) linhasPac = quebrar(pac.paciente_nome, negrito, (tamPac = 9.5), larguraPac)
    if (linhasPac.length > 2) linhasPac = quebrar(pac.paciente_nome, negrito, (tamPac = 8), larguraPac)
    const yPac = linhasPac.length === 1 ? faixaTopo - 32 : faixaTopo - 28
    linhasPac.forEach((l, i) => p.drawText(l, { x: colPac, y: yPac - i * (tamPac + 1.5), font: negrito, size: tamPac, color: COR.texto }))
    p.drawText(seguro(formatarCpf(pac.paciente_cpf)), { x: colCpf, y: faixaTopo - 32, font: fonte, size: 10, color: COR.texto })
    p.drawText(seguro(formatarData(pac.paciente_nascimento)), { x: colNasc, y: faixaTopo - 32, font: fonte, size: 10, color: COR.texto })

    // ── Blocos ────────────────────────────────────────────────────────────
    const areaTopo = topo - MEDIDAS.topo

    for (const parte of pl.partes) {
      const e = grupo[parte.indice]
      const y0 = areaTopo - parte.y - 6
      let yTitulo: number

      if (!parte.continuacao) {
        rotulo("Data", xTexto, y0 - 8)
        rotulo("Horário", colHora, y0 - 8)
        rotulo("Terapia", colTerapia, y0 - 8)
        rotulo("Assinatura", xAssin, y0 - 8)
        p.drawText(seguro(formatarData(e.data)), { x: xTexto, y: y0 - 22, font: negrito, size: 10, color: COR.texto })
        p.drawText(seguro(formatarHorario(e.hora_inicio, e.hora_fim)), { x: colHora, y: y0 - 22, font: fonte, size: 10, color: COR.texto })
        const cab = cabecalhos.get(e)!
        cab.terapia.forEach((l, i) => p.drawText(l, { x: colTerapia, y: y0 - 22 - i * LINHA_TERAPIA, font: fonte, size: 10, color: COR.texto }))

        // Assinatura: imagem (se houver) sobre a linha; nome e registro embaixo.
        const caixaBase = y0 - 14 - ASSINATURA.altura
        const img = e.profissional_id != null ? imagens.get(e.profissional_id) : undefined
        if (img) {
          const escala = Math.min((ASSINATURA.largura - 6) / img.width, (ASSINATURA.altura - 2) / img.height)
          const w = img.width * escala
          const h = img.height * escala
          p.drawImage(img, { x: xAssin + (ASSINATURA.largura - w) / 2, y: caixaBase + 1, width: w, height: h })
        }
        p.drawLine({ start: { x: xAssin, y: caixaBase }, end: { x: xAssin + ASSINATURA.largura, y: caixaBase }, thickness: 0.7, color: COR.suave })
        // Nome e registro inteiros, centralizados, em quantas linhas precisarem.
        let yAssin = caixaBase - 10
        for (const l of cab.nome) {
          p.drawText(l, { x: xAssin + (ASSINATURA.largura - negrito.widthOfTextAtSize(l, 8.5)) / 2, y: yAssin, font: negrito, size: 8.5, color: COR.texto })
          yAssin -= LINHA_NOME
        }
        for (const l of cab.registro) {
          p.drawText(l, { x: xAssin + (ASSINATURA.largura - fonte.widthOfTextAtSize(l, 7.5)) / 2, y: yAssin, font: fonte, size: 7.5, color: COR.suave })
          yAssin -= LINHA_REGISTRO
        }

        yTitulo = y0 - MEDIDAS.cabecalhoBloco - parte.extra + 4
        p.drawText("Descrição", { x: xTexto, y: yTitulo, font: negrito, size: 9, color: COR.texto })
      } else {
        yTitulo = y0 - 8
        const titulo = `Descrição (continuação) — ${formatarData(e.data)} · ${formatarHorario(e.hora_inicio, e.hora_fim)}`
        p.drawText(seguro(titulo), { x: xTexto, y: yTitulo, font: negrito, size: 9, color: COR.texto })
      }

      parte.linhas.forEach((linha, i) => {
        if (!linha) return
        p.drawText(linha, { x: xTexto, y: yTitulo - 14 - i * MEDIDAS.linha, font: fonte, size: TAM_DESCRICAO, color: COR.texto })
      })

      const base = areaTopo - parte.y - parte.altura + 4
      p.drawLine({ start: { x: M, y: base }, end: { x: W - M, y: base }, thickness: 0.6, color: COR.linha })
    }

    // ── Rodapé ────────────────────────────────────────────────────────────
    p.drawLine({ start: { x: M, y: M + 16 }, end: { x: W - M, y: M + 16 }, thickness: 0.6, color: COR.linha })
    p.drawText(textoEmitido, { x: M, y: M + 4, font: fonte, size: 8, color: COR.suave })
    const pag = `Página ${pl.paginaNoGrupo} de ${pl.totalNoGrupo}`
    p.drawText(pag, { x: W - M - fonte.widthOfTextAtSize(pag, 8), y: M + 4, font: fonte, size: 8, color: COR.suave })

    o.aoProgredir?.(n + 1, paginas.length)
    // Devolve a vez ao navegador de tempos em tempos: a tela continua usável.
    if (n % 8 === 7) await new Promise(r => setTimeout(r, 0))
  }

  return doc.save()
}

/** Baixa o conteúdo como arquivo no navegador. */
export function baixarArquivo(conteudo: BlobPart, tipo: string, nomeArquivo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement("a")
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
