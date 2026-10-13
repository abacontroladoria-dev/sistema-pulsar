// Converte os modelos do jurídico (contratos-pacientes/*.docx) em templates do
// docxtemplater (frontend/lib/contratos/modelos/*.docx).
//
//   node scripts/contratos/preparar-modelos.mjs        (de dentro de frontend/)
//
// Rodar de novo a cada versão nova de um modelo. Os originais NÃO são tocados.
//
// O que o script faz, em ordem:
//
// 1. ACEITA as alterações controladas e tira os comentários. O Termo v1.3 veio
//    com revisões pendentes (8 inserções, 10 exclusões) e um comentário; sem
//    isto, o documento iria para a assinatura com as marcas de revisão. O
//    jurídico deveria entregar o arquivo limpo — o aceite aqui é a rede.
//
// 2. APAGA os parágrafos com destaque VERDE. A convenção dos modelos é: verde =
//    instrução para quem preenche ("Observação para Preenchimento… APAGAR AO
//    ENVIAR"), amarelo = campo variável.
//
// 3. TROCA cada campo («…», "XX de XXXXX de XXXX", "(     )") por uma etiqueta
//    ÚNICA. Os modelos repetem o mesmo rótulo para pessoas diferentes («CPF» é
//    do contratante, do paciente e do responsável legal), então a troca é por
//    POSIÇÃO: cada modelo tem a sequência esperada de campos, na ordem do
//    documento, e o script confere rótulo a rótulo. Versão nova com campo a
//    mais, a menos ou fora de ordem = o script PARA e diz onde — nunca troca
//    calado o campo errado.
//
// 4. Tira todo destaque amarelo (o documento final não tem marca de campo).
//
// O campo pode estar quebrado em vários trechos de formatação (no Termo, «, o
// rótulo em negrito e » são três trechos): a troca trabalha sobre o texto do
// parágrafo inteiro e devolve a etiqueta inteira no primeiro trecho.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import PizZip from "pizzip"

const AQUI = dirname(fileURLToPath(import.meta.url))
const ORIGEM = join(AQUI, "..", "..", "..", "contratos-pacientes")
const DESTINO = join(AQUI, "..", "..", "lib", "contratos", "modelos")

// Caixa de marcação: o valor preenchido é "  X  " ou "     " (mesma largura).
const caixa = (tag) => `({${tag}})`

const MODELOS = [
  {
    origem: "Contrato_Particular_Avaliacao_Neuropsicologica_MODELO_v1_10.docx",
    destino: "avaliacao_neuropsicologica_v1_10.docx",
    campos: [
      ["ABA-TMP-03-XXXXX", "{numero}"],
      // Contratante / responsável financeiro
      ["«Nome completo»", "{ctr_nome}"],
      ["«CPF»", "{ctr_cpf}"],
      ["«RG»", "{ctr_rg}"],
      ["«Data de nascimento»", "{ctr_nascimento}"],
      ["«Endereço»", "{ctr_endereco}"],
      ["«Bairro / Cidade / UF»", "{ctr_bairro_cidade_uf}"],
      ["«CEP»", "{ctr_cep}"],
      ["«Celular / WhatsApp»", "{ctr_celular}"],
      ["«E-mail»", "{ctr_email}"],
      // Paciente
      ["«Nome completo do paciente»", "{pac_nome}"],
      ["«CPF»", "{pac_cpf}"],
      ["«RG»", "{pac_rg}"],
      ["«Data de nascimento»", "{pac_nascimento}"],
      // Responsável legal. O modelo v1.10 diz «Nome completo do paciente» aqui
      // — erro do modelo (é o nome do RESPONSÁVEL); a etiqueta corrige.
      ["«Nome completo do paciente»", "{leg_nome}"],
      ["«CPF»", "{leg_cpf}"],
      // Cláusula sétima — composição e valores. "até 10 (dez)" estava FIXO na
      // linha TOTAL enquanto a linha de cima pedia «___»: os dois viram o
      // mesmo campo.
      ["«___»", "{sessoes_texto}"],
      ["até 10 (dez)", "até {sessoes_texto}"],
      ["«R$ ___»", "{valor_total}"],
      ["«R$ ___»", "{valor_total}"],
      ["«valor por extenso»", "{valor_extenso}"],
      ["«R$ ___»", "{valor_total}"],
      ["«R$ ___»", "{valor_avulsa}"],
      // Cláusula décima — autorização de uso externo de imagem
      ["(  )", caixa("img_autorizo")],
      ["(  )", caixa("img_nao_autorizo")],
      ["(     )", caixa("img_site")],
      ["(     )", caixa("img_redes")],
      ["(     )", caixa("img_impressos")],
      ["(     )", caixa("img_ensino")],
      // Fecho e assinatura
      ["XX de XXXXX de XXXX", "{data_extenso}"],
      ["«Nome completo»", "{ctr_nome}"],
      ["«CPF»", "{ctr_cpf}"],
    ],
    // Blocos que somem quando não se aplicam: [etiqueta, marcador do trecho].
    blocos: [],
  },
  {
    origem: "Termo_Autorizacao_Uso_Imagem_Paciente_MODELO_v1_3.docx",
    destino: "termo_uso_imagem_v1_3.docx",
    campos: [
      ["«_________________»", "{vinc_numero}"],
      ["«__/__/____»", "{vinc_data}"],
      // Autorizante = filiação 1
      ["«Nome completo»", "{r1_nome}"],
      ["«CPF»", "{r1_cpf}"],
      ["«mãe / pai / tutor(a) / guardião(ã)»", "{r1_qualidade}"],
      ["«Nome completo do paciente»", "{pac_nome}"],
      ["«__/__/____»", "{pac_nascimento}"],
      // Segundo responsável legal = filiação 2
      ["«Nome completo»", "{r2_nome}"],
      ["«CPF»", "{r2_cpf}"],
      ["«mãe / pai»", "{r2_qualidade}"],
      // Cláusula segunda — canais e identificação
      ["(     )", caixa("img_site")],
      ["(     )", caixa("img_redes")],
      ["(     )", caixa("img_impressos")],
      ["(     )", caixa("img_ensino")],
      ["(     )", caixa("img_primeiro_nome")],
      // Fecho e assinaturas
      ["XX de XXXXX de XXXX", "{data_extenso}"],
      ["«Nome completo»", "{r1_nome}"],
      ["«CPF»", "{r1_cpf}"],
      ["«Nome completo»", "{r2_nome}"],
      ["«CPF»", "{r2_cpf}"],
    ],
    // O segundo responsável é "quando aplicável": sem filiação 2, somem o
    // parágrafo de qualificação e a tabela de assinatura dele.
    blocos: [
      ["tem_r2", "paragrafo", "{r2_nome}", 0],
      ["tem_r2", "tabela", "{r2_nome}", 1],
    ],
  },
]

// Tudo que conta como campo num parágrafo. A ordem das alternativas importa
// pouco: os padrões não se sobrepõem no texto dos modelos.
const PADRAO_CAMPO = /«[^»]*»|ABA-TMP-03-XXXXX|XX de XXXXX de\s+XXXX|\(\s{1,6}\)|até 10 \(dez\)/g

const normalizar = (s) => s.replace(/\s+/g, " ").trim()

// ─── XML ─────────────────────────────────────────────────────────────────────

const decodificar = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
const codificar = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const RE_PARAGRAFO = /<w:p(?=[ >])[\s\S]*?<\/w:p>/g
const RE_TEXTO = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g

function textoDoParagrafo(p) {
  let t = ""
  for (const m of p.matchAll(RE_TEXTO)) t += decodificar(m[1])
  return t
}

/**
 * Troca trechos do TEXTO de um parágrafo, mesmo quando o trecho atravessa
 * vários <w:t>. `trocas` = [{ de, ate, por }] em posições do texto do
 * parágrafo. A troca inteira vai para o <w:t> onde o trecho começa; os outros
 * perdem a parte coberta (e a formatação deles fica, vazia).
 */
function trocarNoParagrafo(p, trocas) {
  const nos = []
  let pos = 0
  for (const m of p.matchAll(RE_TEXTO)) {
    const texto = decodificar(m[1])
    nos.push({ inicioXml: m.index, fimXml: m.index + m[0].length, de: pos, ate: pos + texto.length, texto })
    pos += texto.length
  }
  // Da direita para a esquerda: as posições das trocas anteriores continuam valendo.
  for (const tr of [...trocas].sort((a, b) => b.de - a.de)) {
    let primeiro = true
    for (const no of nos) {
      if (no.ate <= tr.de || no.de >= tr.ate) continue
      const a = Math.max(tr.de, no.de) - no.de
      const b = Math.min(tr.ate, no.ate) - no.de
      no.texto = no.texto.slice(0, a) + (primeiro && tr.de >= no.de ? tr.por : "") + no.texto.slice(b)
      primeiro = false
      no.mudou = true
    }
  }
  let saida = ""
  let ultimo = 0
  for (const no of nos) {
    saida += p.slice(ultimo, no.inicioXml)
    saida += no.mudou ? `<w:t xml:space="preserve">${codificar(no.texto)}</w:t>` : p.slice(no.inicioXml, no.fimXml)
    ultimo = no.fimXml
  }
  return saida + p.slice(ultimo)
}

// ─── 1. Revisões e comentários ───────────────────────────────────────────────

function aceitarRevisoes(xml, nome) {
  let x = xml
  // Texto excluído (inclusive o que foi inserido e depois excluído).
  x = x.replace(/<w:del\b[^>]*[^/]>[\s\S]*?<\/w:del>/g, "")
  // Parágrafo cuja MARCA foi excluída: nos modelos, todos ficaram vazios depois
  // de tirar o texto excluído — some inteiro. Com texto sobrando, seria uma
  // junção de parágrafos que este script não sabe fazer: para.
  x = x.replace(RE_PARAGRAFO, (p) => {
    const marca = /<w:pPr>[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>[\s\S]*?<\/w:pPr>/.exec(p)
    if (!marca || !/<w:del\b/.test(marca[1])) return p
    if (textoDoParagrafo(p).trim()) {
      throw new Error(`${nome}: parágrafo com marca excluída e texto restante ("${textoDoParagrafo(p).slice(0, 60)}"). Aceite as alterações no Word.`)
    }
    return ""
  })
  x = x.replace(/<w:ins\b[^>]*\/>/g, "").replace(/<w:del\b[^>]*\/>/g, "")
  x = x.replace(/<w:ins\b[^>]*>/g, "").replace(/<\/w:ins>/g, "")
  x = x.replace(/<w:(pPrChange|rPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange)\b[\s\S]*?<\/w:\1>/g, "")
  // Comentários: âncoras e a referência (que mora num run próprio).
  x = x.replace(/<w:commentRange(Start|End)\b[^>]*\/>/g, "")
  x = x.replace(/<w:r(?=[ >])(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>[\s\S]*?<\/w:r>/g, "")

  const sobra = /<w:(ins|del|delText|moveFrom|moveTo|commentReference)\b/.exec(x)
  if (sobra) throw new Error(`${nome}: sobrou marca de revisão <w:${sobra[1]}> depois do aceite.`)
  return x
}

function tirarPartesDeComentario(zip) {
  for (const nome of Object.keys(zip.files)) {
    if (/^word\/comments[A-Za-z]*\.xml$/.test(nome)) zip.remove(nome)
  }
  const rels = "word/_rels/document.xml.rels"
  zip.file(rels, zip.file(rels).asText().replace(/<Relationship [^>]*Target="comments[A-Za-z]*\.xml"\/>/g, ""))
  const tipos = "[Content_Types].xml"
  zip.file(tipos, zip.file(tipos).asText().replace(/<Override PartName="\/word\/comments[A-Za-z]*\.xml"[^>]*\/>/g, ""))
}

// ─── 2–4. Instruções, campos, destaques ──────────────────────────────────────

function prepararCorpo(xml, modelo) {
  // 2. Instruções em verde.
  let x = xml.replace(RE_PARAGRAFO, (p) => (/<w:highlight w:val="green"\/>/.test(p) ? "" : p))

  // 3. Campos, por posição.
  const esperados = [...modelo.campos]
  let n = 0
  x = x.replace(RE_PARAGRAFO, (p) => {
    const texto = textoDoParagrafo(p)
    const trocas = []
    for (const m of texto.matchAll(PADRAO_CAMPO)) {
      const esperado = esperados.shift()
      n++
      if (!esperado) throw new Error(`${modelo.origem}: campo a mais "${m[0]}" (o ${n}º) em "${texto.slice(0, 80)}".`)
      if (normalizar(m[0]) !== normalizar(esperado[0])) {
        throw new Error(`${modelo.origem}: o ${n}º campo deveria ser "${esperado[0]}" e é "${m[0]}" em "${texto.slice(0, 80)}".`)
      }
      trocas.push({ de: m.index, ate: m.index + m[0].length, por: esperado[1] })
    }
    return trocas.length ? trocarNoParagrafo(p, trocas) : p
  })
  if (esperados.length) {
    throw new Error(`${modelo.origem}: faltaram ${esperados.length} campo(s), a partir de "${esperados[0][0]}".`)
  }

  // 4. Destaques.
  x = x.replace(/<w:highlight w:val="[a-zA-Z]+"\/>/g, "")

  // Blocos condicionais: parágrafos só com {#tag} / {/tag} em volta do trecho
  // (com paragraphLoop, o docxtemplater apaga esses parágrafos inteiros).
  for (const [tag, tipo, marcador, ocorrencia] of modelo.blocos) {
    x = envolverBloco(x, tag, tipo, marcador, ocorrencia, modelo.origem)
  }
  return x
}

const paragrafoSo = (texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`

function envolverBloco(x, tag, tipo, marcador, ocorrencia, nome) {
  let pos = -1
  for (let i = 0; i <= ocorrencia; i++) {
    pos = x.indexOf(marcador, pos + 1)
    if (pos < 0) throw new Error(`${nome}: bloco ${tag}: "${marcador}" nº ${ocorrencia + 1} não encontrado.`)
  }
  let ini, fim
  if (tipo === "paragrafo") {
    ini = x.lastIndexOf("<w:p ", pos)
    const iniSemAtributo = x.lastIndexOf("<w:p>", pos)
    ini = Math.max(ini, iniSemAtributo)
    fim = x.indexOf("</w:p>", pos) + "</w:p>".length
  } else {
    ini = x.lastIndexOf("<w:tbl>", pos)
    fim = x.indexOf("</w:tbl>", pos) + "</w:tbl>".length
    if (x.slice(ini, fim).includes("<w:tbl>", 1)) throw new Error(`${nome}: bloco ${tag}: tabela aninhada.`)
  }
  return x.slice(0, ini) + paragrafoSo(`{#${tag}}`) + x.slice(ini, fim) + paragrafoSo(`{/${tag}}`) + x.slice(fim)
}

// ─── Principal ───────────────────────────────────────────────────────────────

mkdirSync(DESTINO, { recursive: true })
for (const modelo of MODELOS) {
  const zip = new PizZip(readFileSync(join(ORIGEM, modelo.origem)))
  const partes = Object.keys(zip.files).filter((f) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(f))
  for (const parte of partes) {
    let xml = aceitarRevisoes(zip.file(parte).asText(), `${modelo.origem}/${parte}`)
    if (parte === "word/document.xml") xml = prepararCorpo(xml, modelo)
    else xml = xml.replace(/<w:highlight w:val="[a-zA-Z]+"\/>/g, "")
    zip.file(parte, xml)
  }
  tirarPartesDeComentario(zip)
  writeFileSync(join(DESTINO, modelo.destino), zip.generate({ type: "nodebuffer", compression: "DEFLATE" }))
  console.log(`ok  ${modelo.destino}  (${modelo.campos.length} campos)`)
}
