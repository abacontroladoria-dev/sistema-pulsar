import { CHAVES_PILARES, CHAVES_STATUS_RISCO } from '@/types/auditoriaCriterios'
import type { CriteriosAuditoria } from '@/types/auditoriaCriterios'
import { parseCriterios, CriteriosInvalidosError } from './criterios'

/**
 * Os critérios como arquivo .md: baixar, editar no Word/Bloco de Notas, subir.
 *
 * POR QUE MARKDOWN E NÃO JSON. Quem calibra a régua é o setor terapêutico, e
 * JSON pune erro de digitação com "arquivo inválido" sem dizer onde. O .md tem
 * cabeçalhos de seção e listas — a pessoa vê o texto, não a estrutura.
 *
 * O PREÇO, e como ele é pago: markdown é ambíguo, então este formato NÃO é
 * markdown livre. É um formato fixo que por acaso se lê como markdown. As
 * âncoras são os `## ` e os `### `, e as chaves congeladas viajam entre
 * parênteses no título (`### 1. Estado na chegada (chegou)`) porque o rótulo é
 * editável e a chave não — sem ela, renomear "Estado na chegada" para outra
 * coisa desconectaria o pilar do checklist.
 *
 * O parser recusa em vez de adivinhar: seção faltando, chave desconhecida,
 * pilar repetido, tudo vira erro com o número da linha. A alternativa — aceitar
 * o que dá e ignorar o resto — publicaria uma régua silenciosamente mutilada.
 */

const MARCA_INICIO = '<!-- criterios-auditoria-evolucoes -->'

/** Títulos de seção. A ordem aqui é a ordem do arquivo gerado. */
const SECOES = {
  abertura: 'Instrução geral',
  conferencia: 'Conferência estrutural',
  pilares: 'As 4 perguntas obrigatórias',
  regras: 'Regras para situações específicas',
  termos: 'Palavras e frases que geram glosa',
  status: 'Como o risco é classificado'
} as const

export interface MetadadosMarkdown {
  versaoOrigem: number | null
}

/**
 * Gera o .md a partir dos critérios.
 *
 * O cabeçalho carimba a versão de origem para que o upload saiba de onde a
 * pessoa partiu — é o que permite avisar "alguém publicou enquanto você editava
 * fora" em vez de sobrescrever calado.
 */
export function criteriosParaMarkdown(
  criterios: CriteriosAuditoria,
  meta: MetadadosMarkdown
): string {
  const l: string[] = []

  l.push(MARCA_INICIO)
  l.push(`<!-- versao-origem: ${meta.versaoOrigem ?? 'padrao'} -->`)
  l.push('')
  l.push('# Critérios da auditoria de evoluções')
  l.push('')
  l.push(
    meta.versaoOrigem === null
      ? '> Partindo dos critérios padrão do sistema.'
      : `> Partindo da versão ${meta.versaoOrigem}.`
  )
  l.push('>')
  l.push('> Edite os textos abaixo e suba o arquivo de volta na tela de Critérios.')
  l.push('> Não apague nem renomeie as linhas que começam com `##` ou `###`, e não')
  l.push('> mexa no que está entre parênteses nos títulos — é o que liga cada item')
  l.push('> ao sistema.')
  l.push('')

  l.push(`## ${SECOES.abertura}`)
  l.push('')
  l.push(criterios.abertura)
  l.push('')

  l.push(`## ${SECOES.conferencia}`)
  l.push('')
  for (const item of criterios.conferencia_estrutural) l.push(`- ${item}`)
  l.push('')

  l.push(`## ${SECOES.pilares}`)
  l.push('')
  l.push('<!-- São sempre quatro. Dá para reescrever, não para acrescentar ou remover. -->')
  l.push('')
  criterios.pilares.forEach((p, i) => {
    l.push(`### ${i + 1}. ${p.rotulo} (${p.chave})`)
    l.push('')
    l.push(p.descricao)
    l.push('')
  })

  l.push(`## ${SECOES.regras}`)
  l.push('')
  for (const r of criterios.regras_especificas) {
    l.push(`### ${r.titulo}`)
    l.push('')
    l.push(r.texto)
    l.push('')
  }

  l.push(`## ${SECOES.termos}`)
  l.push('')
  for (const g of criterios.termos_proibidos) {
    l.push(`### ${g.categoria}`)
    l.push('')
    if (g.termos.length === 0) {
      l.push('<!-- sem lista fechada: avaliado caso a caso -->')
    } else {
      for (const t of g.termos) l.push(`- ${t}`)
    }
    l.push('')
  }

  l.push(`## ${SECOES.status}`)
  l.push('')
  for (const s of criterios.status_risco) {
    l.push(`### ${rotuloStatus(s.chave)} (${s.chave})`)
    l.push('')
    l.push(s.descricao)
    l.push('')
  }

  return l.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

const ROTULOS_STATUS: Record<string, string> = {
  sem_risco: 'Sem risco',
  risco_especifico: 'Risco específico',
  risco_relevante: 'Risco relevante'
}
const rotuloStatus = (chave: string) => ROTULOS_STATUS[chave] ?? chave

/** Lê a versão de origem do cabeçalho. `null` = veio do fallback ou foi apagada. */
export function lerVersaoOrigem(markdown: string): number | null {
  const m = markdown.match(/<!--\s*versao-origem:\s*(\d+)\s*-->/)
  return m ? Number(m[1]) : null
}

interface Bloco {
  titulo: string
  linha: number
  corpo: string[]
  subs: Bloco[]
}

/** Quebra o arquivo em `##` e, dentro de cada um, em `###`. */
function fatiar(markdown: string): Bloco[] {
  const linhas = markdown.split(/\r?\n/)
  const secoes: Bloco[] = []
  let secao: Bloco | null = null
  let sub: Bloco | null = null

  linhas.forEach((bruta, i) => {
    const linha = bruta.trimEnd()

    // Comentários HTML são dicas para quem edita, nunca conteúdo.
    if (/^\s*<!--/.test(linha)) return

    const h2 = linha.match(/^##\s+(.*)$/)
    if (h2 && !linha.startsWith('###')) {
      secao = { titulo: h2[1].trim(), linha: i + 1, corpo: [], subs: [] }
      sub = null
      secoes.push(secao)
      return
    }

    const h3 = linha.match(/^###\s+(.*)$/)
    if (h3 && secao) {
      sub = { titulo: h3[1].trim(), linha: i + 1, corpo: [], subs: [] }
      secao.subs.push(sub)
      return
    }

    // `# ` do título e o bloco `>` de instruções ficam fora de qualquer seção.
    if (/^#\s/.test(linha) || /^>/.test(linha)) return

    const alvo = sub ?? secao
    if (alvo) alvo.corpo.push(linha)
  })

  return secoes
}

/** Junta as linhas de corpo num parágrafo, descartando o branco das pontas. */
function texto(bloco: Bloco): string {
  return bloco.corpo.join('\n').trim()
}

/** Só os itens de lista (`- ` / `* `) do corpo. */
function itens(bloco: Bloco): string[] {
  return bloco.corpo
    .map(l => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim())
    .filter((v): v is string => Boolean(v))
}

function exigirSecao(secoes: Bloco[], titulo: string): Bloco {
  // Casa pelo título normalizado: acento perdido no Word ou caixa trocada não
  // deveriam custar o arquivo inteiro à pessoa.
  const alvo = normalizar(titulo)
  const achadas = secoes.filter(s => normalizar(s.titulo) === alvo)
  if (achadas.length === 0) {
    throw new CriteriosInvalidosError(
      `não encontrei a seção "## ${titulo}". Ela precisa existir, escrita exatamente assim.`
    )
  }
  if (achadas.length > 1) {
    throw new CriteriosInvalidosError(
      `a seção "## ${titulo}" aparece ${achadas.length} vezes (linhas ${achadas
        .map(a => a.linha)
        .join(', ')}). Deixe só uma.`
    )
  }
  return achadas[0]
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Extrai a chave congelada do fim do título: `Rótulo (chave)`. */
function chaveDoTitulo(bloco: Bloco): { rotulo: string; chave: string } {
  // Word/exportadores de .docx costumam escapar parênteses em Markdown
  // (`\(chave\)`); desfazemos isso antes de validar, já que o escape não
  // muda o que a pessoa via na tela.
  const titulo = bloco.titulo.replace(/\\([()])/g, '$1')
  const m = titulo.match(/^(.*)\(([a-z_]+)\)\s*$/)
  if (!m) {
    throw new CriteriosInvalidosError(
      `linha ${bloco.linha}: "### ${bloco.titulo}" perdeu o código entre parênteses no fim ` +
        `(ex.: "### 1. Estado na chegada (chegou)"). Ele liga o item ao sistema e não pode sumir.`
    )
  }
  // O "1. " da numeração é enfeite de leitura; o rótulo real vem sem ele.
  const rotulo = m[1].replace(/^\s*\d+\.\s*/, '').trim()
  return { rotulo, chave: m[2] }
}

/**
 * Lê o .md de volta para o objeto de critérios.
 *
 * Devolve o que `parseCriterios` aprovar — ou seja, o arquivo passa pela MESMA
 * validação do editor da tela. O markdown é só outra porta de entrada; a régua
 * do que é válido é uma só.
 */
export function markdownParaCriterios(markdown: string): CriteriosAuditoria {
  if (!markdown.trim()) {
    throw new CriteriosInvalidosError('o arquivo está vazio.')
  }

  const secoes = fatiar(markdown)
  if (secoes.length === 0) {
    throw new CriteriosInvalidosError(
      'não encontrei nenhuma seção "## " no arquivo. Ele precisa ser o .md baixado desta tela.'
    )
  }

  const abertura = texto(exigirSecao(secoes, SECOES.abertura))

  const conferencia_estrutural = itens(exigirSecao(secoes, SECOES.conferencia))

  // ── Pilares: as 4 chaves congeladas, nem mais nem menos ──────────────────
  const blocoPilares = exigirSecao(secoes, SECOES.pilares)
  const pilaresLidos = blocoPilares.subs.map(sub => {
    const { rotulo, chave } = chaveDoTitulo(sub)
    if (!(CHAVES_PILARES as readonly string[]).includes(chave)) {
      throw new CriteriosInvalidosError(
        `linha ${sub.linha}: "${chave}" não é uma das quatro perguntas. ` +
          `As válidas são: ${CHAVES_PILARES.join(', ')}.`
      )
    }
    return { chave, rotulo, descricao: texto(sub) }
  })
  exigirCobertura(pilaresLidos, CHAVES_PILARES, blocoPilares, 'pergunta')

  const regras_especificas = exigirSecao(secoes, SECOES.regras).subs.map(sub => ({
    titulo: sub.titulo,
    texto: texto(sub)
  }))

  const termos_proibidos = exigirSecao(secoes, SECOES.termos).subs.map(sub => ({
    categoria: sub.titulo,
    termos: itens(sub)
  }))

  // ── Status de risco: mesmo rigor, o CHECK do banco depende disso ─────────
  const blocoStatus = exigirSecao(secoes, SECOES.status)
  const statusLidos = blocoStatus.subs.map(sub => {
    const { chave } = chaveDoTitulo(sub)
    if (!(CHAVES_STATUS_RISCO as readonly string[]).includes(chave)) {
      throw new CriteriosInvalidosError(
        `linha ${sub.linha}: "${chave}" não é um nível de risco válido. ` +
          `Os válidos são: ${CHAVES_STATUS_RISCO.join(', ')}.`
      )
    }
    return { chave, descricao: texto(sub) }
  })
  exigirCobertura(statusLidos, CHAVES_STATUS_RISCO, blocoStatus, 'nível de risco')

  return parseCriterios({
    abertura,
    conferencia_estrutural,
    pilares: pilaresLidos,
    regras_especificas,
    termos_proibidos,
    status_risco: statusLidos
  })
}

/** Cada chave congelada aparece uma vez e só uma. */
function exigirCobertura(
  lidos: { chave: string }[],
  esperadas: readonly string[],
  bloco: Bloco,
  substantivo: string
) {
  for (const chave of esperadas) {
    const quantas = lidos.filter(x => x.chave === chave).length
    if (quantas === 0) {
      throw new CriteriosInvalidosError(
        `faltou a ${substantivo} "${chave}" na seção "## ${bloco.titulo}". ` +
          `Ela não pode ser removida.`
      )
    }
    if (quantas > 1) {
      throw new CriteriosInvalidosError(
        `a ${substantivo} "${chave}" aparece ${quantas} vezes na seção "## ${bloco.titulo}". ` +
          `Deixe só uma.`
      )
    }
  }
}
