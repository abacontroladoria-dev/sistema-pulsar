import { Fragment, type ReactNode } from 'react'

// ============================================================================
// O texto de uma mensagem do Chat da equipe: link clicável e a formatação que
// todo mundo já digita no WhatsApp — *negrito*, _itálico_, ~riscado~ e
// `código`. Sem HTML do usuário: tudo vira nó de React, nada de innerHTML.
// ============================================================================

const FIM_LINK = `[^\\s<.,;:!?)\\]'"]`
const PADRAO = new RegExp(
  [
    `(?<link>(?:https?:\\/\\/|www\\.)[^\\s<]*${FIM_LINK})`,
    '(?<codigo>`[^`\\n]+`)',
    // O marcador só vale colado ao texto e fora de palavra: "2*3*4" e
    // "nome_do_arquivo" continuam como estão.
    '(?<negrito>(?<![\\p{L}\\p{N}*])\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*(?![\\p{L}\\p{N}*]))',
    '(?<italico>(?<![\\p{L}\\p{N}_])_(?!\\s)[^_\\n]+?(?<!\\s)_(?![\\p{L}\\p{N}_]))',
    '(?<riscado>(?<![\\p{L}\\p{N}~])~(?!\\s)[^~\\n]+?(?<!\\s)~(?![\\p{L}\\p{N}~]))',
  ].join('|'),
  'gu',
)

export function TextoMensagem({ corpo, minha }: { corpo: string; minha: boolean }) {
  const partes: ReactNode[] = []
  let ultimo = 0
  for (const m of corpo.matchAll(PADRAO)) {
    const i = m.index ?? 0
    if (i > ultimo) partes.push(corpo.slice(ultimo, i))
    const g = m.groups ?? {}
    const k = `${i}`
    if (g.link) {
      const href = g.link.startsWith('www.') ? `https://${g.link}` : g.link
      partes.push(
        <a
          key={k}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 break-all ${minha ? 'text-white decoration-white/60' : 'text-cyan-700 decoration-cyan-700/40 dark:text-cyan-300'}`}
        >
          {g.link}
        </a>,
      )
    } else if (g.codigo) {
      partes.push(
        <code key={k} className={`rounded px-1 py-px font-mono text-[0.85em] ${minha ? 'bg-white/20' : 'bg-foreground/10'}`}>
          {g.codigo.slice(1, -1)}
        </code>,
      )
    } else if (g.negrito) {
      partes.push(<strong key={k} className="font-semibold">{g.negrito.slice(1, -1)}</strong>)
    } else if (g.italico) {
      partes.push(<em key={k}>{g.italico.slice(1, -1)}</em>)
    } else if (g.riscado) {
      partes.push(<s key={k}>{g.riscado.slice(1, -1)}</s>)
    }
    ultimo = i + m[0].length
  }
  if (ultimo < corpo.length) partes.push(corpo.slice(ultimo))
  return <>{partes.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>
}

/**
 * Mensagem que é só emoji (até 3) aparece grande, sem balão — como em todo
 * mensageiro. Dígitos e # contam como "Emoji_Component" no Unicode; por isso a
 * conferência de que há pelo menos um pictograma e nenhum dígito.
 */
export function soEmojis(corpo: string): boolean {
  const t = corpo.trim()
  if (!t || t.length > 32 || /[0-9#*]/.test(t)) return false
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(t)) return false
  if (!/\p{Extended_Pictographic}/u.test(t)) return false
  const graf = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(t.replace(/\s/g, ''))].length
    : 1
  return graf <= 3
}

/** O texto sem os marcadores — para a citação, a faixa "Respondendo a" e a prévia da lista. */
export function semFormatacao(corpo: string): string {
  return corpo.replace(PADRAO, (...args) => {
    const g = args.at(-1) as Record<string, string | undefined>
    if (g.link) return g.link
    return (g.codigo ?? g.negrito ?? g.italico ?? g.riscado ?? '').slice(1, -1)
  })
}
