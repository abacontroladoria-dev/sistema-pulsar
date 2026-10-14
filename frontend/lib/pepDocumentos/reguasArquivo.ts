// Réguas da Auditoria de Documentos PEP como arquivo (15/10/2026): baixar em
// .docx ou .md para editar fora, e subir de volta. Texto livre — diferente dos
// critérios das evoluções, não há chave congelada; o carimbo
// [regua:SIGLA@vN] (invisível no Word) só diz de qual versão o arquivo saiu,
// para avisar se outra pessoa publicou no meio do caminho.
//
// Só no navegador e só no clique (import dinâmico em ModalReguas).

import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx'
import { docxParaMarkdown } from '@/lib/auditoria/criteriosDocx'

const CARIMBO = /\[regua:([A-Z]{2,3})@v(\d+)\]/

export function reguaParaMarkdown(sigla: string, versao: number, conteudo: string, nome: string): string {
  return `# Régua ${nome} — v${versao}\n\n${conteudo.trim()}\n\n<!-- [regua:${sigla}@v${versao}] -->\n`
}

export async function reguaParaDocx(sigla: string, versao: number, conteudo: string, nome: string): Promise<Blob> {
  const paragrafos = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `Régua ${nome} — v${versao}` })] }),
    new Paragraph({ children: [new TextRun({ text: 'Edite o texto abaixo e suba o arquivo de volta na tela Auditoria de Documentos PEP → Réguas.', italics: true, color: '6B7280' })] }),
    new Paragraph({ text: '' }),
    ...conteudo.trim().split('\n').map(l => new Paragraph({ children: [new TextRun({ text: l })] })),
    new Paragraph({ text: '' }),
    new Paragraph({ children: [new TextRun({ text: `[regua:${sigla}@v${versao}]`, size: 2, color: 'FFFFFF' })] }),
  ]
  return Packer.toBlob(new Document({ sections: [{ children: paragrafos }] }))
}

/**
 * O texto da régua de um arquivo subido (.docx, .md ou .txt), sem o título que
 * o próprio download põe, sem a linha de instrução e sem o carimbo.
 */
export async function arquivoParaRegua(arquivo: File): Promise<{ conteudo: string; origem: { sigla: string; versao: number } | null }> {
  const docx = /\.docx$/i.test(arquivo.name)
  const bruto = docx ? await docxParaMarkdown(arquivo) : await arquivo.text()
  const m = bruto.match(CARIMBO)
  const conteudo = bruto
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(CARIMBO, '')
    .split('\n')
    .filter(l => !/^#\s*Régua\b/i.test(l.trim()))
    .filter(l => !/^_?Edite o texto abaixo/i.test(l.trim()))
    .map(l => l.replace(/^\*\*(.+)\*\*$/, '$1'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { conteudo, origem: m ? { sigla: m[1], versao: Number(m[2]) } : null }
}
