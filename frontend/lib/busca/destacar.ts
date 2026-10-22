export type PedacoDestacado = { texto: string; casou: boolean }

/**
 * Divide `texto` em pedaços, marcando o primeiro trecho que casa com `termo`
 * sem olhar acento, maiúscula nem espaço repetido — a mesma comparação da busca.
 * "Ana Láura" com "laura" → ["Ana ", "Láura"✓]. Sem casamento: o texto inteiro.
 */
export function destacar(texto: string, termo: string): PedacoDestacado[] {
  const alvo = normalizar(termo)
  if (!alvo) return [{ texto, casou: false }]

  // Cada caractere normalizado lembra de qual posição do original veio, para o
  // corte cair no texto com acento.
  let norm = ""
  const origem: number[] = []
  for (let i = 0; i < texto.length; i++) {
    let c = texto[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    if (/\s/.test(c)) {
      if (norm.endsWith(" ")) continue
      c = " "
    }
    for (const ch of c) {
      norm += ch
      origem.push(i)
    }
  }

  const ini = norm.indexOf(alvo)
  if (ini < 0) return [{ texto, casou: false }]
  const a = origem[ini]
  const b = origem[ini + alvo.length - 1] + 1
  return [
    { texto: texto.slice(0, a), casou: false },
    { texto: texto.slice(a, b), casou: true },
    { texto: texto.slice(b), casou: false },
  ].filter((p) => p.texto.length > 0)
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}
