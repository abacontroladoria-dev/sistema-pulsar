// Preenche um modelo .docx (já convertido por scripts/contratos/preparar-modelos.mjs)
// com as etiquetas de montarDados.ts. Puro: recebe e devolve bytes — quem lê o
// arquivo do disco é services/contratos/documento.ts.

import Docxtemplater from "docxtemplater"
import PizZip from "pizzip"
import type { Etiquetas } from "./montarDados"

export function preencherModelo(modelo: Uint8Array | Buffer, dados: Etiquetas): Buffer {
  const doc = new Docxtemplater(new PizZip(modelo), {
    // {#tem_r2} sozinho num parágrafo: o parágrafo some inteiro com o bloco.
    paragraphLoop: true,
    linebreaks: true,
    // Etiqueta sem valor = erro, nunca um buraco em branco no contrato. As
    // pendências de cadastro já foram barradas antes; chegar aqui é desencontro
    // entre o modelo e montarDados.ts.
    nullGetter(parte) {
      throw new Error(`Modelo pede a etiqueta "${parte.value}", que não foi preenchida.`)
    },
  })
  doc.render(dados)
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer
}
