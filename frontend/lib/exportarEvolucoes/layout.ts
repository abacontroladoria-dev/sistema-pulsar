// Paginação do PDF de evoluções — função pura, sem pdf-lib (testável).
//
// Regras (plano, seção 7):
//   - nenhuma evolução é cortada entre duas páginas: o bloco que não cabe no
//     espaço que sobra vai inteiro para a página seguinte;
//   - a única exceção é a evolução que sozinha passa de uma página inteira: ela
//     é dividida, e cada parte seguinte abre com "Descrição (continuação)";
//   - cada paciente começa em página nova e tem a própria numeração
//     ("Página 2 de 7" — decisão D3), para dar para separar por convênio.
//
// Quem mede o texto é quem chama (`medir`, a largura real na fonte do PDF).

export const PAGINA = { largura: 595.28, altura: 841.89, margem: 36 } as const

export const MEDIDAS = {
  /** Cabeçalho do documento + faixa do paciente, em toda página. */
  topo: 118,
  /** "Emitido em…" e "Página X de Y". */
  rodape: 28,
  /** Linha Data/Horário/Terapia + caixa da assinatura + nome + registro. */
  cabecalhoBloco: 76,
  /** Título "Descrição" (ou "Descrição (continuação) — …"). */
  tituloDescricao: 16,
  /** Altura de cada linha da descrição. */
  linha: 12.5,
  /** Respiro de cima e de baixo do bloco, com o separador. */
  respiroBloco: 18,
  /** Recuo do texto dentro do bloco, de cada lado. */
  recuo: 8,
} as const

/** Altura disponível para os blocos em cada página. */
export const AREA_UTIL = PAGINA.altura - 2 * PAGINA.margem - MEDIDAS.topo - MEDIDAS.rodape

/** Largura da linha de texto da descrição. */
export const LARGURA_TEXTO = PAGINA.largura - 2 * PAGINA.margem - 2 * MEDIDAS.recuo

export type Medir = (texto: string) => number

/**
 * Quebra a descrição em linhas que cabem em `largura`, respeitando as quebras de
 * linha originais. Palavra maior que a linha é cortada por caractere.
 */
export function quebrarTexto(texto: string, largura: number, medir: Medir): string[] {
  const linhas: string[] = []
  for (const paragrafo of texto.split("\n")) {
    const palavras = paragrafo.split(/ +/).filter(p => p.length > 0)
    if (palavras.length === 0) {
      linhas.push("")
      continue
    }
    let atual = ""
    for (let palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra
      if (medir(tentativa) <= largura) {
        atual = tentativa
        continue
      }
      if (atual) linhas.push(atual)
      atual = ""
      // Palavra que sozinha não cabe: corta em pedaços que caibam.
      while (medir(palavra) > largura) {
        let n = 1
        while (n < palavra.length && medir(palavra.slice(0, n + 1)) <= largura) n++
        linhas.push(palavra.slice(0, n))
        palavra = palavra.slice(n)
      }
      atual = palavra
    }
    linhas.push(atual)
  }
  return linhas
}

export function alturaDoBloco(qtdLinhas: number, comCabecalho: boolean): number {
  return (comCabecalho ? MEDIDAS.cabecalhoBloco : 0) + MEDIDAS.tituloDescricao + qtdLinhas * MEDIDAS.linha + MEDIDAS.respiroBloco
}

/** Um pedaço de evolução desenhado numa página (normalmente a evolução inteira). */
export type ParteNaPagina = {
  /** Índice da evolução dentro do grupo (paciente). */
  indice: number
  linhas: string[]
  /** Parte seguinte de uma evolução dividida: sem a linha Data/Horário/Terapia. */
  continuacao: boolean
  /** Distância do topo da área útil até o topo do bloco. */
  y: number
  altura: number
}

export type PaginaLayout = {
  /** Índice do grupo (paciente). */
  grupo: number
  paginaNoGrupo: number
  totalNoGrupo: number
  partes: ParteNaPagina[]
}

/**
 * Distribui as evoluções nas páginas. `grupos[g][i]` é a descrição já pronta
 * (normalizada e segura para a fonte) da evolução `i` do paciente `g`.
 */
export function montarLayout(grupos: string[][], medir: Medir): PaginaLayout[] {
  const paginas: PaginaLayout[] = []

  grupos.forEach((descricoes, g) => {
    const doGrupo: PaginaLayout[] = []
    let pagina: PaginaLayout = { grupo: g, paginaNoGrupo: 1, totalNoGrupo: 0, partes: [] }
    let usado = 0
    doGrupo.push(pagina)

    const novaPagina = () => {
      pagina = { grupo: g, paginaNoGrupo: doGrupo.length + 1, totalNoGrupo: 0, partes: [] }
      doGrupo.push(pagina)
      usado = 0
    }
    const colocar = (indice: number, linhas: string[], continuacao: boolean) => {
      const altura = alturaDoBloco(linhas.length, !continuacao)
      pagina.partes.push({ indice, linhas, continuacao, y: usado, altura })
      usado += altura
    }

    descricoes.forEach((descricao, indice) => {
      const linhas = quebrarTexto(descricao, LARGURA_TEXTO, medir)
      const altura = alturaDoBloco(linhas.length, true)

      if (altura <= AREA_UTIL - usado) return colocar(indice, linhas, false)
      if (altura <= AREA_UTIL) {
        novaPagina()
        return colocar(indice, linhas, false)
      }

      // Maior que uma página inteira: começa numa página vazia e é dividida.
      if (pagina.partes.length > 0) novaPagina()
      const cabemNaPrimeira = Math.floor((AREA_UTIL - alturaDoBloco(0, true)) / MEDIDAS.linha)
      const cabemNasSeguintes = Math.floor((AREA_UTIL - alturaDoBloco(0, false)) / MEDIDAS.linha)
      colocar(indice, linhas.slice(0, cabemNaPrimeira), false)
      for (let i = cabemNaPrimeira; i < linhas.length; i += cabemNasSeguintes) {
        novaPagina()
        colocar(indice, linhas.slice(i, i + cabemNasSeguintes), true)
      }
    })

    for (const p of doGrupo) p.totalNoGrupo = doGrupo.length
    paginas.push(...doGrupo)
  })

  return paginas
}
