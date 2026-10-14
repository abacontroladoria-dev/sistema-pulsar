// Cópia entre documentos — o irmão, para documentos longos, do detector de
// "Evolução duplicada entre pacientes" (services/auditoriaEvolucoes.service.ts).
// Lá, trigramas de caractere funcionam porque a evolução é curta; num PIC de
// 20 mil caracteres, dois textos sem relação já dividem a maioria dos
// trigramas da língua. Aqui:
//
//   1. Só o CONTEÚDO PREENCHIDO conta. Sai o texto do modelo (linhas que
//      aparecem em documentos de vários prestadores), títulos, rótulos e
//      linhas curtas — senão todo PIC parece 70% igual a todo PIC.
//   2. Nomes viram "nome" e números viram "0": trocar o nome do paciente e a
//      data não esconde a cópia.
//   3. Sequências de 4 palavras (shingles) — texto escrito à parte quase não
//      repete 4 palavras seguidas; cópia repete quase tudo.
//   4. Uma "impressão digital" de 128 números (MinHash) por documento, que
//      fica no banco depois que o texto expira (90 dias): a cópia de um
//      documento de seis meses atrás continua aparecendo.
//
// A semelhança é o coeficiente de Dice, o mesmo da auditoria de evoluções.

import { cortar, ehTitulo, linhasDe, normalizar, rotuloValor, valorVazio } from './texto'

export const TAMANHO_SHINGLE = 4
export const TAMANHO_ASSINATURA = 128
/**
 * Abaixo disso não há conteúdo preenchido bastante para comparar. Medido em
 * 14/10/2026: folha de registro em branco (TAP) tem 52–65; documento escrito
 * de verdade tem centenas (PIC: mediana 416). Com 25, o mesmo formulário em
 * branco de um prestador virava "cópia" entre pacientes.
 */
export const MIN_SHINGLES = 100
/** ≥ isto: praticamente o mesmo texto ("Está errado"). */
export const LIMIAR_ERRADO = 0.8
/** ≥ isto: boa parte igual ("Pode conter erros"). */
export const LIMIAR_ATENCAO = 0.5

/** Linha normalizada para comparar: sem acento, minúscula, números viram 0. */
export function linhaComparavel(linha: string): string {
  return normalizar(linha).replace(/\d+/g, '0')
}

/**
 * O texto do modelo, aprendido dos próprios documentos: uma linha que aparece
 * em pelo menos `minDocs` documentos de pelo menos `minGrupos` prestadores
 * diferentes não foi escrita por ninguém — veio do modelo.
 */
export function aprenderModelo(docs: { grupo: string; texto: string }[], minDocs = 3, minGrupos = 2): Set<string> {
  const porLinha = new Map<string, { docs: number; grupos: Set<string> }>()
  for (const d of docs) {
    const vistas = new Set(linhasDe(d.texto).map(linhaComparavel).filter(l => l.length >= 8))
    for (const l of vistas) {
      const r = porLinha.get(l) ?? { docs: 0, grupos: new Set<string>() }
      r.docs++
      r.grupos.add(d.grupo)
      porLinha.set(l, r)
    }
  }
  const modelo = new Set<string>()
  for (const [l, r] of porLinha) if (r.docs >= minDocs && r.grupos.size >= minGrupos) modelo.add(l)
  return modelo
}

/** Palavras dos nomes a esconder ("João Pedro Silva" → joao, pedro, silva). */
function palavrasDeNomes(nomes: (string | null | undefined)[]): Set<string> {
  const s = new Set<string>()
  for (const n of nomes) for (const p of normalizar(n).split(' ')) if (p.length >= 3) s.add(p)
  return s
}

/**
 * As linhas que alguém escreveu: sem modelo, sem título, sem rótulo (de
 * "Paciente: João" fica só "João" — e o nome vira "nome").
 */
export function conteudoPreenchido(texto: string, modelo: Set<string>, nomes: (string | null | undefined)[] = []): string[] {
  const esconder = palavrasDeNomes(nomes)
  const saida: string[] = []
  for (const linha of linhasDe(texto)) {
    if (ehTitulo(linha)) continue
    const rv = rotuloValor(linha)
    const parte = rv ? (valorVazio(rv.valor) ? '' : rv.valor) : linha
    const comparavel = linhaComparavel(parte)
    if (comparavel.length < 25 || modelo.has(linhaComparavel(linha)) || modelo.has(comparavel)) continue
    saida.push(comparavel.split(' ').map(p => (esconder.has(p) ? 'nome' : p)).join(' '))
  }
  return saida
}

export function shingles(linhas: string[], k = TAMANHO_SHINGLE): Set<string> {
  const palavras = linhas.join(' ').split(' ').filter(Boolean)
  const s = new Set<string>()
  for (let i = 0; i + k <= palavras.length; i++) s.add(palavras.slice(i, i + k).join(' '))
  return s
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a]
  let comum = 0
  for (const x of menor) if (maior.has(x)) comum++
  return (2 * comum) / (a.size + b.size)
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function misturar(x: number, semente: number): number {
  let h = (x ^ semente) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

const SEMENTES = Array.from({ length: TAMANHO_ASSINATURA }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0)

/** Impressão digital do conteúdo (MinHash). null quando há pouco conteúdo. */
export function assinatura(conjunto: Set<string>): number[] | null {
  if (conjunto.size < MIN_SHINGLES) return null
  const min = new Array<number>(TAMANHO_ASSINATURA).fill(0xffffffff)
  for (const s of conjunto) {
    const x = fnv1a(s)
    for (let i = 0; i < TAMANHO_ASSINATURA; i++) {
      const h = misturar(x, SEMENTES[i])
      if (h < min[i]) min[i] = h
    }
  }
  // int4 no banco: guarda com sinal (só a igualdade importa).
  return min.map(v => v | 0)
}

/** Dice estimado de duas impressões digitais. */
export function diceEstimado(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let iguais = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) iguais++
  const jaccard = iguais / a.length
  return (2 * jaccard) / (1 + jaccard)
}

// ── Comparador (tela) ──────────────────────────────────────────────────────────

export type Segmento = { t: string; igual: boolean }
export type ParagrafoComparado = { segmentos: Segmento[]; modelo: boolean; semelhanca: number }

const palavrasDe = (s: string) => s.split(/(\s+)/).filter(Boolean)

/** Maior subsequência comum por palavra, num parágrafo (limitado a 400 palavras). */
function marcarIguais(texto: string, outro: string): Segmento[] {
  const a = palavrasDe(texto)
  const ehPalavra = (t: string) => !/^\s+$/.test(t)
  const pa = a.filter(ehPalavra).slice(0, 400)
  const pb = palavrasDe(outro).filter(ehPalavra).slice(0, 400)
  // Na tela, número diferente aparece diferente ("2 minutos" × "3 minutos").
  const na = pa.map(normalizar)
  const nb = pb.map(normalizar)
  const dp = Array.from({ length: na.length + 1 }, () => new Uint16Array(nb.length + 1))
  for (let i = na.length - 1; i >= 0; i--) {
    for (let j = nb.length - 1; j >= 0; j--) {
      dp[i][j] = na[i] && na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const iguais = new Set<number>()
  let i = 0, j = 0
  while (i < na.length && j < nb.length) {
    if (na[i] && na[i] === nb[j]) { iguais.add(i); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  // Remonta com os espaços, juntando vizinhos do mesmo tipo.
  const out: Segmento[] = []
  let k = 0
  for (const t of a) {
    const igual = ehPalavra(t) ? iguais.has(k++) : (out[out.length - 1]?.igual ?? false)
    const ult = out[out.length - 1]
    if (ult && ult.igual === igual) ult.t += t
    else out.push({ t, igual })
  }
  return out
}

function trigramas(s: string): Set<string> {
  const t = `  ${s} `
  const r = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) r.add(t.slice(i, i + 3))
  return r
}

/**
 * Lado a lado: cada parágrafo de `texto` contra o parágrafo mais parecido de
 * `outro`. Parágrafo do modelo fica apagado (não é cópia de ninguém);
 * parágrafo escrito e parecido (≥ 60%) ganha o realce palavra a palavra.
 */
export function compararParagrafos(texto: string, outro: string, modelo: Set<string>): ParagrafoComparado[] {
  const doOutro = linhasDe(outro).map(l => ({ l, tri: trigramas(linhaComparavel(l)) }))
  return linhasDe(texto).map(l => {
    const comparavel = linhaComparavel(l)
    const ehModelo = modelo.has(comparavel) || ehTitulo(l)
    if (ehModelo || comparavel.length < 25) return { segmentos: [{ t: l, igual: false }], modelo: ehModelo, semelhanca: 0 }
    const tri = trigramas(comparavel)
    let melhor = { l: '', s: 0 }
    for (const o of doOutro) {
      const s = dice(tri, o.tri)
      if (s > melhor.s) melhor = { l: o.l, s }
    }
    if (melhor.s < 0.6) return { segmentos: [{ t: l, igual: false }], modelo: false, semelhanca: melhor.s }
    return { segmentos: marcarIguais(l, melhor.l), modelo: false, semelhanca: melhor.s }
  })
}

/** Primeiro trecho escrito que se repete — o "trecho" do achado de cópia. */
export function trechoRepetido(texto: string, outro: string, modelo: Set<string>): string | undefined {
  const p = compararParagrafos(texto, outro, modelo).find(x => !x.modelo && x.semelhanca >= 0.8)
  return p ? cortar(p.segmentos.map(s => s.t).join('')) : undefined
}
