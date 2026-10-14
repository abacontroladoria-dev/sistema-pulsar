// Ferramentas de texto da conferência dos documentos. Nada aqui sabe de
// PEP: entra texto, sai texto. O texto chega do robô com uma linha por
// parágrafo (Word) ou por linha da página (PDF).

/** "Avaliação" → "Avaliacao". */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Sem acento, minúsculo, só letras/números, espaço único. */
export function normalizar(s: string | null | undefined): string {
  return semAcento(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Linhas não vazias, já aparadas. */
export function linhasDe(texto: string): string[] {
  return texto.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Trecho curto para mostrar na tela. */
export function cortar(s: string, max = 200): string {
  const t = s.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

/** "Data da reunião: 04/09/2026" → { rotulo: 'Data da reunião', valor: '04/09/2026' }. */
export function rotuloValor(linha: string): { rotulo: string; chave: string; valor: string } | null {
  const m = linha.match(/^([\p{L}][\p{L}\p{N} ()/º°ª.-]{0,48}?)\s*:\s*(.*)$/u)
  if (!m) return null
  const rotulo = m[1].trim()
  // "14:00" não é rótulo; nem frase longa com dois-pontos no meio.
  if (/^\d/.test(rotulo) || rotulo.split(' ').length > 7) return null
  return { rotulo, chave: normalizar(rotulo), valor: m[2].trim() }
}

/** Valor que não diz nada: vazio, só traços, pontos, barras ou sublinhados. */
export function valorVazio(v: string): boolean {
  return /^[\s_.\-–—/\\|:]*$/.test(v)
}

/** "2. INFORMAÇÕES SOBRE O PACIENTE" → nível 1; "2.1 Diagnóstico" → nível 2. */
export function tituloNumerado(linha: string): { nivel: number } | null {
  if (linha.length > 90 || /[.;,]$/.test(linha)) return null
  const m = linha.match(/^(\d{1,2}(?:\.\d{1,2})*)[.)]?\s+[\p{Lu}\p{Ll}]/u)
  if (!m) return null
  return { nivel: m[1].split('.').filter(Boolean).length }
}

/** Título em caixa alta ("PARTICIPANTES") ou numerado. Usado só para achar a seção. */
export function ehTitulo(linha: string): boolean {
  if (tituloNumerado(linha)) return true
  if (linha.length > 80 || linha.length < 4) return false
  const letras = linha.replace(/[^\p{L}]/gu, '')
  return letras.length >= 4 && letras === letras.toUpperCase() && letras !== letras.toLowerCase()
}

/** A seção de uma linha: o título mais próximo acima dela. */
export function secaoDaLinha(linhas: string[], i: number): string | undefined {
  for (let j = i - 1; j >= 0; j--) if (ehTitulo(linhas[j])) return cortar(linhas[j], 80)
  return undefined
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export type DataLida = { texto: string; iso: string | null }

/** Datas da linha: "04/09/2026", "4/9/26", "4 de setembro de 2026". iso=null quando a data não existe (31/02). */
export function datasDaLinha(linha: string): DataLida[] {
  const out: DataLida[] = []
  for (const m of linha.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4}|\d{2})\b/g)) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    out.push({ texto: m[0], iso: isoValida(ano, Number(m[2]), Number(m[1])) })
  }
  const sem = semAcento(linha).toLowerCase()
  for (const m of sem.matchAll(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/g)) {
    const mes = MESES.indexOf(m[2]) + 1
    if (mes > 0) out.push({ texto: m[0], iso: isoValida(Number(m[3]), mes, Number(m[1])) })
  }
  return out
}

function isoValida(ano: number, mes: number, dia: number): string | null {
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCMonth() !== mes - 1) return null
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** "14h30" / "14:30" / "14h" → minutos do dia; null se não for hora válida. */
export function minutos(h: string, m: string | undefined): number | null {
  const hh = Number(h)
  const mm = m ? Number(m) : 0
  if (!Number.isInteger(hh) || hh > 23 || mm > 59) return null
  return hh * 60 + mm
}

/** "14h às 15h10", "14:00 - 15:00", "das 8h30 até 9h". */
export const RE_INTERVALO = /\b(\d{1,2})\s*[:hH]\s*(\d{2})?\s*(?:min)?\s*(?:às|as|à|a|-|–|—|até|ate)\s*(\d{1,2})\s*[:hH]\s*(\d{2})?/g

/** Uma hora só: "14:00", "14h", "14h30". */
export const RE_HORA = /\b(\d{1,2})\s*[:hH]\s*(\d{2})?\b/
