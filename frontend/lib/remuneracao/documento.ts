import { cleanTxt, onlyDigits, htmlEsc } from "./formatacao"
import { normKey } from "./constants"
import type { ProfRemunReal } from "./calculo"
import { montarDemonstrativo, pepDasLinhas } from "./demonstrativo"
import type { PepApuracaoMensal } from "@/types/pep"

export function formatCPF(v: string | null | undefined): string {
  const d = onlyDigits(v)
  if (d.length !== 11) return ""
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export function formatCNPJ(v: string | null | undefined): string {
  const d = onlyDigits(v)
  if (d.length !== 14) return ""
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export function findCadastroPrestador(cadastros: Record<string, any>, prof: string | null | undefined): any {
  if (!cadastros || !prof) return {}
  if (cadastros[prof]) return cadastros[prof] || {}
  const nk = normKey(prof)
  const key = Object.keys(cadastros).find(k => normKey(k) === nk)
  return key ? (cadastros[key] || {}) : {}
}

export function pickFirst(...vals: any[]): string {
  return vals.map(cleanTxt).find(Boolean) || ""
}

/** O que o documento imprime quando não há contrato cadastrado — não é um contrato real. */
export const CONTRATO_PROVISORIO = { pj: "PS.ABA-01-00000001", pf: "PS.ABA-PF-00000001" } as const

export function resolverContratoPrestador(cadastro: any, p: any, tipo: "pj" | "pf"): string {
  const contrato = tipo === "pj"
    ? pickFirst(cadastro.contratoPJ, cadastro.contratoPj, cadastro.contrato, p.contratoPJ, p.contratoPj, p.contratoNovo)
    : pickFirst(cadastro.contratoPF, cadastro.contratoPf, cadastro.contrato, p.contratoPF, p.contratoPf, p.contratoNovo)
  if (contrato) return contrato
  return CONTRATO_PROVISORIO[tipo]
}

export interface DocInfo {
  tipo: "pj" | "pf"
  icone: string
  docLabel: string
  docNumero: string
  principal: string
  principalUpper: string
  responsavelLegal: string
  contrato: string
  // Campos que o documento vai imprimir com texto provisório — a tela avisa
  // antes de exportar, em vez de o prestador receber "00.000.000/0000-00".
  /** Nem CNPJ nem CPF válidos no cadastro. */
  docProvisorio: boolean
  /** PJ sem razão social: sai "RAZÃO SOCIAL NÃO CADASTRADA". */
  razaoProvisoria: boolean
  /** Sem número de contrato: sai o placeholder CONTRATO_PROVISORIO. */
  contratoProvisorio: boolean
}

export function montarInfoDocumentoPrestador(p: any, cadastros: Record<string, any>): DocInfo {
  const cadastro = findCadastroPrestador(cadastros, p?.prof)
  const rawCNPJ = pickFirst(cadastro.cnpj, cadastro.CNPJ, p?.cnpj, p?.CNPJ)
  const rawCPF = pickFirst(cadastro.cpf, cadastro.CPF, p?.cpf, p?.CPF)
  const razaoSocial = pickFirst(cadastro.razaoSocial, cadastro.razao_social, cadastro.razao, cadastro.nomePJ, cadastro.pessoaJuridica, p?.razaoSocial, p?.razao_social)
  const temCPFRegistrado = !!formatCPF(rawCPF)
  // Só o CNPJ decide PJ — razaoSocial sozinha não vale como sinal: um cadastro
  // que trocou de CNPJ pra CPF pode ter deixado a razão social antiga presa no
  // banco (é campo escondido na tela quando o documento vira CPF), e usá-la
  // aqui reabriria esse mesmo bug do lado da leitura.
  const temPJ = !!formatCNPJ(rawCNPJ)
  // Auto: usa o que estiver cadastrado (CNPJ ou CPF); sem nenhum dos dois
  // cadastrado, o padrão é CNPJ — não existe mais escolha manual de PF/PJ.
  const tipo = temPJ || !temCPFRegistrado ? "pj" : "pf"
  const nomePF = pickFirst(cadastro.nome, cadastro.nomeCompleto, p?.prof) || "NOME DO PRESTADOR"
  const principal = tipo === "pj" ? (razaoSocial || "RAZÃO SOCIAL NÃO CADASTRADA") : nomePF
  const responsavelLegal = pickFirst(cadastro.responsavelLegal, cadastro.responsavel, cadastro.representanteLegal, p?.prof) || nomePF
  const docNumero = tipo === "pj" ? (formatCNPJ(rawCNPJ) || "00.000.000/0000-00") : (formatCPF(rawCPF) || "000.000.000-00")
  const contrato = resolverContratoPrestador(cadastro, p || {}, tipo)

  return {
    tipo,
    icone: tipo === "pj" ? "🏢" : "👤",
    docLabel: tipo === "pj" ? "CNPJ" : "CPF",
    docNumero,
    principal,
    principalUpper: principal.toUpperCase(),
    responsavelLegal,
    contrato,
    docProvisorio: !temPJ && !temCPFRegistrado,
    razaoProvisoria: tipo === "pj" && !razaoSocial,
    contratoProvisorio: contrato === CONTRATO_PROVISORIO[tipo],
  }
}

export interface PdfOpts {
  remPeriodo?: { inicio: string, fim: string } | null
  ccPA: number
  ccPE: number
  etaBonus: number
  taxasPA: Record<string, number>
  cadastroPrestadores: Record<string, any>
  autoPrint?: boolean
  wordMode?: boolean
  // Apuração da PEP (pep_apuracao_mensal) do prestador na competência do
  // período — null/undefined quando ainda não apurada na aba Entregas PEP.
  pepApuracao?: PepApuracaoMensal[] | null
}

export function montarHtmlDocumentoFaturamento(p: ProfRemunReal, opts: PdfOpts): string {
  const { remPeriodo, ccPA, etaBonus, taxasPA, cadastroPrestadores, autoPrint = false, wordMode = false, pepApuracao } = opts
  // A conta mora em demonstrativo.ts — a mesma que a tela Remuneração Individual
  // mostra antes de exportar. Aqui só se desenha.
  const d = montarDemonstrativo(p, { ccPA, etaBonus, taxasPA, pep: pepDasLinhas(pepApuracao) })
  const { isCC, totalSessoes } = d
  const per = remPeriodo
  const periodoTxt = `${per?.inicio || "—"} a ${per?.fim || "—"}`
  const docInfo = montarInfoDocumentoPrestador(p, cadastroPrestadores)
  const valorConfirmadoPrestador = d.total
  const pacientesCCAbrev = d.pacientesCC

  const money = (v: number | string) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`
  const esc = htmlEsc

  let linhasFinanceiras = d.linhas.map(l => {
    switch (l.tipo) {
      case "pa":
      case "ppd":
        return `<tr><td><strong>${l.titulo}</strong><br><span>${esc(l.detalhe ?? "")}</span></td><td>${l.qtd} ${l.tipo === "pa" ? "sessão(ões)" : "dia(s)"} × ${money(l.taxa ?? 0)}</td><td class="val">${money(l.valor ?? 0)}</td></tr>`
      case "semPA":
        return `<tr><td><strong>${l.titulo}</strong><br><span>${esc(l.detalhe ?? "")}</span></td><td>${l.qtd} sessão(ões)</td><td class="val">${l.valorTexto}</td></tr>`
      case "fixoBH":
        return `<tr><td><strong>${l.titulo}</strong>${l.detalhe ? `<br><span>${esc(l.detalhe)}</span>` : ""}</td><td>${l.calculoTexto}</td><td class="val">${money(l.valor ?? 0)}</td></tr>`
      case "pep":
        return l.valor === null
          ? `<tr><td><strong>${l.titulo}</strong></td><td class="muted">${l.calculoTexto}</td><td class="val">${l.valorTexto}</td></tr>`
          : `<tr><td><strong>${l.titulo}</strong></td><td>${l.qtd} paciente(s) apurado(s)</td><td class="val">${money(l.valor)}</td></tr>`
      case "eta":
        return `<tr><td><strong>${l.titulo}</strong></td><td>${l.qtd} semana(s) × ${money(l.taxa ?? 0)}</td><td class="val">${money(l.valor ?? 0)}</td></tr>`
    }
  }).join("")

  if (!linhasFinanceiras) linhasFinanceiras = `<tr><td colspan="3" class="muted">Nenhum valor confirmado para o período.</td></tr>`

  const siglasHTML = isCC
    ? `<div class="siglas"><div><strong>PEP</strong> – Parcela por Entregas por Paciente, apurada por competência conforme as entregas registradas</div><div><strong>PA</strong> – Valor unitário por atendimento efetivamente realizado</div></div>`
    : `<div class="siglas"><div><strong>PA</strong> – Valor unitário por atendimento efetivamente realizado e aceito pela CONTRATANTE</div></div>`

  const fluxoHTML = `<div class="section-title">Resumo das Sessões do Período</div>
    <table class="cards"><tbody><tr>
      <td class="card green"><div class="card-ico">✅</div><div class="card-num">${p.evoluidasProprias}</div><div class="card-title">Evoluções próprias</div></td>
      <td class="card blue"><div class="card-ico">🔄</div><div class="card-num">${p.substituicoesRealizadas}</div><div class="card-title">Substituições</div></td>
      <td class="card total"><div class="card-ico">💰</div><div class="card-num">${totalSessoes}</div><div class="card-title">${p.modalidade === "banco_horas" ? "Cobertas pelo valor fixo" : "Total elegíveis ao PA"}</div></td>
    </tr></tbody></table>`

  const pacientesHTML = isCC && pacientesCCAbrev.length > 0 ? `
    <div class="section-title">Pacientes Vinculados (CC) — ${pacientesCCAbrev.length}</div>
    <table class="pac-grid"><tbody>${pacientesCCAbrev.reduce((acc, pac, i) => {
      if (i % 3 === 0) acc += "<tr>"
      acc += `<td>${esc(pac)}</td>`
      if (i % 3 === 2) acc += "</tr>"
      return acc
    }, "")}${pacientesCCAbrev.length % 3 ? "</tr>" : ""}</tbody></table>` : ""

  const responsavelPJ = docInfo.tipo === "pj" ? `<div class="meta-line"><strong>Responsável Legal:</strong> ${esc(docInfo.responsavelLegal)}</div>` : ""
  const headerHTML = `<table class="header"><tbody><tr>
    <td class="header-icon">${docInfo.icone}</td>
    <td>
      <div class="doc-id">${docInfo.docLabel} ${esc(docInfo.docNumero)} – ${esc(docInfo.principalUpper)}</div>
      ${responsavelPJ}
      <div class="meta-line"><strong>Contrato:</strong> ${esc(docInfo.contrato)}</div>
    </td>
  </tr></tbody></table>`

  const wordXml = wordMode ? `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->` : ""
  const printScript = autoPrint ? `<script>window.addEventListener("load",()=>{window.print();})</script>` : ""
  const htmlAttrs = wordMode ? 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"' : ""

  return `<!DOCTYPE html><html lang="pt-BR" ${htmlAttrs}><head><meta charset="UTF-8">
<title>Universo ABA — ${esc(p.prof)}</title>${wordXml}
<style>
@page{margin:1.8cm;size:A4}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;font-size:11px;color:#222847;line-height:1.42;margin:0;background:#fff}
.header{width:100%;border-collapse:collapse;border-bottom:3px solid #222847;margin-bottom:14px;padding-bottom:10px}.header td{vertical-align:middle;padding:0 0 10px 0}.header-icon{width:48px;font-size:32px}.doc-id{font-size:17px;font-weight:800;color:#222847;margin-bottom:5px}.meta-line{font-size:10px;color:#555;line-height:1.65}
.banner{background:#222847;color:#fff;border-radius:8px;padding:12px 16px;margin:12px 0 10px}.banner-title{font-size:13px;font-weight:bold;margin-bottom:4px}.banner-sub{font-size:10px;opacity:.86}
.siglas{font-size:10px;color:#444;background:#f8fafc;border-left:3px solid #2A92C0;padding:8px 12px;margin:8px 0 14px;line-height:1.55}
.section-title{font-size:12px;font-weight:bold;color:#222847;border-left:3px solid #2A92C0;padding-left:8px;margin:15px 0 8px}
.cards{width:100%;border-collapse:separate;border-spacing:6px;margin:0 0 6px}.card{vertical-align:top;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:8px;width:33.33%}.card-ico{font-size:15px}.card-num{font-size:20px;font-weight:bold;line-height:1;color:#222847}.card-title{font-size:10px;font-weight:bold;margin:2px 0}.card.green{background:#f0fdf4;border-color:#86efac}.card.green .card-num{color:#16a34a}.card.blue{background:#eff6ff;border-color:#93c5fd}.card.blue .card-num{color:#2563eb}.card.total{background:#222847;border-color:#222847;color:#fff}.card.total .card-num{color:#86efac}
table.fin{width:100%;border-collapse:collapse;margin-bottom:12px}table.fin th{background:#f0f4f8;text-align:left;padding:7px 10px;font-size:10px;color:#555;border-bottom:2px solid #e2e8f0}table.fin td{padding:7px 10px;font-size:10.5px;border-bottom:1px solid #f0f0f0}table.fin td span{font-size:9px;color:#666}.val{text-align:right;font-weight:bold}.total-row td{font-weight:bold;font-size:13px;background:#f0fdf4;padding:10px!important}.total-row .val{color:#3aaa5c;font-size:15px}.muted{color:#777;text-align:center}
.pac-grid{width:100%;border-collapse:separate;border-spacing:4px}.pac-grid td{background:#f0f4f8;border-radius:4px;padding:5px 8px;font-size:9.5px;width:33.33%}
.footer{margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:8.5px;color:#777;text-align:center;line-height:1.55}.conf{margin-top:8px;padding:8px 10px;background:#fafafa;border:1px solid #e5e7eb;border-radius:4px;font-size:8px;color:#555}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
${headerHTML}
<div class="banner"><div class="banner-title">Demonstrativo de Faturamento – Contraprestação dos Serviços · ${periodoTxt}</div><div class="banner-sub">Documento informativo e estimativo. Valores condicionados à efetiva execução dos serviços e à validação das entregas correspondentes.</div></div>
${siglasHTML}
${fluxoHTML}
<div class="section-title">Apuração do Faturamento · ${periodoTxt}</div>
<table class="fin"><thead><tr><th>Componente</th><th>Cálculo</th><th style="text-align:right">Total no período</th></tr></thead><tbody>
${linhasFinanceiras}
<tr class="total-row"><td colspan="2">TOTAL CONFIRMADO DO PERÍODO</td><td class="val">${money(valorConfirmadoPrestador)}</td></tr>
</tbody></table>
${pacientesHTML}
<div class="footer">Documento elaborado em ${new Date().toLocaleDateString("pt-BR")} · Universo ABA · Uso exclusivo do prestador identificado acima.</div>
<div class="conf"><strong>DOCUMENTO CONFIDENCIAL</strong> — Informações protegidas pela Lei nº 13.709/2018 (LGPD). Destinado exclusivamente ao prestador identificado. Vedado o compartilhamento sem autorização prévia da Universo ABA.</div>
${printScript}</body></html>`
}

export function gerarPDF(p: ProfRemunReal, opts: PdfOpts): void {
  const html = montarHtmlDocumentoFaturamento(p, { ...opts, autoPrint: true })
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank", "width=900,height=700")
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

export function gerarWord(p: ProfRemunReal, opts: PdfOpts): void {
  const html = montarHtmlDocumentoFaturamento(p, { ...opts, wordMode: true })
  const blob = new Blob(["\uFEFF", html], { type: "application/msword;charset=utf-8" }) // BOM character is \uFEFF
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const docInfo = montarInfoDocumentoPrestador(p, opts.cadastroPrestadores)
  const nomeArq = p.prof.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "")
  const periodo = opts.remPeriodo?.inicio ? opts.remPeriodo.inicio.replace(/\//g, "-") : "periodo"
  a.download = `Faturamento_${docInfo.tipo.toUpperCase()}_${nomeArq}_${periodo}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
