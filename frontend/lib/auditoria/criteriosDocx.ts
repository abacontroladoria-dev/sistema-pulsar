import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType
} from 'docx'
import mammoth from 'mammoth/mammoth.browser.js'
import type { CriteriosAuditoria } from '@/types/auditoriaCriterios'
import type { MetadadosMarkdown } from './criteriosMarkdown'

/**
 * Os critérios como arquivo .docx: mesma âncora do .md (Heading 2 = seção,
 * Heading 3 = subitem, com a chave congelada entre parênteses no título), só
 * que num Word de verdade — para quem nunca abriu um `.md` na vida.
 *
 * POR QUE HEADING STYLE E NÃO TEXTO EM NEGRITO MAIOR. O mammoth (na volta)
 * só reconhece hierarquia de título pelo estilo real do parágrafo (Heading
 * 1/2/3), não pelo tamanho da fonte. Se a pessoa reformatar um título "bonito"
 * sem usar o estilo, ele deixa de ser título — por isso o rodapé do Word
 * lembra: "não mude o estilo dessas linhas".
 */

const SECOES = {
  abertura: 'Instrução geral',
  conferencia: 'Conferência estrutural',
  pilares: 'As 4 perguntas obrigatórias',
  regras: 'Regras para situações específicas',
  termos: 'Palavras e frases que geram glosa',
  status: 'Como o risco é classificado'
} as const

const ROTULOS_STATUS: Record<string, string> = {
  sem_risco: 'Sem risco',
  risco_especifico: 'Risco específico',
  risco_relevante: 'Risco relevante'
}
const rotuloStatus = (chave: string) => ROTULOS_STATUS[chave] ?? chave

/** Fonte legível para quem não é do meio técnico — evita a Times New Roman padrão do Word. */
const FONTE = 'Calibri'

/** Estrutural (título/âncora do sistema): não se edita. Azul forte, bem distante do preto. */
const COR_ESTRUTURAL = '1F4E9C'
/** Conteúdo (o que a pessoa de fato escreve): preto normal, sinal de "aqui pode mexer". */
const COR_EDITAVEL = '000000'

function h2(texto: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: texto, color: COR_ESTRUTURAL, font: FONTE })]
  })
}

/** Título com a chave congelada entre parênteses — a chave fica ainda mais apagada que o resto do título. */
function h3ComChave(rotulo: string, chave: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [
      new TextRun({ text: rotulo, color: COR_ESTRUTURAL, font: FONTE }),
      new TextRun({ text: ` (${chave})`, color: '5A7BC4', font: FONTE })
    ]
  })
}

function h3(texto: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text: texto, color: COR_ESTRUTURAL, font: FONTE })]
  })
}

function corpo(texto: string) {
  return new Paragraph({
    children: [new TextRun({ text: texto, color: COR_EDITAVEL, font: FONTE })]
  })
}

function item(texto: string) {
  return new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({ text: texto, color: COR_EDITAVEL, font: FONTE })]
  })
}

export async function criteriosParaDocx(
  criterios: CriteriosAuditoria,
  meta: MetadadosMarkdown
): Promise<Blob> {
  const paragrafos: Paragraph[] = []

  paragrafos.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({ text: 'Critérios da auditoria de evoluções', color: COR_ESTRUTURAL, font: FONTE })
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:
            meta.versaoOrigem === null
              ? 'Partindo dos critérios padrão do sistema.'
              : `Partindo da versão ${meta.versaoOrigem}.`,
          italics: true,
          color: COR_ESTRUTURAL,
          font: FONTE
        })
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({
          text:
            'Edite apenas o texto em preto abaixo de cada título. Tudo em cinza é estrutura do ' +
            'sistema: não apague, não renomeie e não mude o estilo (Título 2 / Título 3) dessas ' +
            'linhas, e não mexa no que está entre parênteses — é o que liga cada item ao sistema.',
          italics: true,
          bold: true,
          color: '9A5B00',
          font: FONTE
        })
      ]
    }),
    new Paragraph({ text: '' }),
    // Carimbo lido por lerVersaoOrigemDocx: invisível na leitura normal do Word
    // (fonte 1pt, cor da página), mas sobrevive no texto extraído pelo mammoth.
    new Paragraph({
      children: [
        new TextRun({
          text: `[versao-origem:${meta.versaoOrigem ?? 'padrao'}]`,
          size: 2,
          color: 'FFFFFF'
        })
      ]
    })
  )

  paragrafos.push(h2(SECOES.abertura), corpo(criterios.abertura))

  paragrafos.push(h2(SECOES.conferencia))
  for (const linha of criterios.conferencia_estrutural) paragrafos.push(item(linha))

  paragrafos.push(h2(SECOES.pilares))
  paragrafos.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'São sempre quatro. Dá para reescrever, não para acrescentar ou remover.',
          italics: true,
          color: COR_ESTRUTURAL,
          font: FONTE
        })
      ]
    })
  )
  criterios.pilares.forEach((p, i) => {
    paragrafos.push(h3ComChave(`${i + 1}. ${p.rotulo}`, p.chave))
    paragrafos.push(corpo(p.descricao))
  })

  paragrafos.push(h2(SECOES.regras))
  for (const r of criterios.regras_especificas) {
    paragrafos.push(h3(r.titulo))
    paragrafos.push(corpo(r.texto))
  }

  paragrafos.push(h2(SECOES.termos))
  for (const g of criterios.termos_proibidos) {
    paragrafos.push(h3(g.categoria))
    if (g.termos.length === 0) {
      paragrafos.push(
        new Paragraph({
          children: [
            new TextRun({
              text: 'Sem lista fechada — avaliado caso a caso.',
              italics: true,
              color: COR_ESTRUTURAL,
              font: FONTE
            })
          ]
        })
      )
    } else {
      for (const t of g.termos) paragrafos.push(item(t))
    }
  }

  paragrafos.push(h2(SECOES.status))
  for (const s of criterios.status_risco) {
    paragrafos.push(h3ComChave(rotuloStatus(s.chave), s.chave))
    paragrafos.push(corpo(s.descricao))
  }

  const doc = new Document({
    sections: [{ properties: {}, children: paragrafos }],
    styles: {
      default: {
        document: { run: { font: FONTE, size: 22 } }
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { bold: true, size: 32, font: FONTE },
          paragraph: { alignment: AlignmentType.LEFT, spacing: { before: 240, after: 120 } }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { bold: true, size: 26, font: FONTE },
          paragraph: { spacing: { before: 300, after: 120 } }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { bold: true, size: 22, font: FONTE },
          paragraph: { spacing: { before: 200, after: 80 } }
        }
      ]
    }
  })

  return Packer.toBlob(doc)
}

/**
 * Extrai o .docx de volta para o mesmo formato de texto que o parser de .md
 * espera (`## `/`### ` como âncora). O mammoth mapeia Heading 1/2/3 → `#`/`##`/`###`
 * quando convertido para markdown — por isso o modelo gerado acima usa esses
 * estilos de parágrafo, não negrito com fonte maior.
 */
export async function docxParaMarkdown(arquivo: File): Promise<string> {
  const buffer = await arquivo.arrayBuffer()
  const resultado = await mammoth.convertToMarkdown({ arrayBuffer: buffer })
  return resultado.value
}

/** Acha o carimbo de versão de origem escondido no corpo do .docx. */
export function lerVersaoOrigemDocx(markdown: string): number | null {
  const m = markdown.match(/\[versao-origem:(\d+)\]/)
  return m ? Number(m[1]) : null
}
