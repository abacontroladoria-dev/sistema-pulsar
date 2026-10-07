import React from 'react'

// ============================================================================
// Texto da bolha como o WhatsApp mostra
//
// *negrito*, _itálico_, ~riscado~, `mono` e links clicáveis. Sem
// dangerouslySetInnerHTML: o texto vem do contato, e montar nós React a partir
// de pedaços é o que impede uma mensagem de virar HTML na tela da atendente.
//
// O marcador só vale colado em palavra (`*oi*`, não `2 * 3 * 4`), a mesma regra
// do WhatsApp — sem ela, conta de multiplicação viraria negrito.
// ============================================================================

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g
const MARCA_RE = /(\*[^\s*](?:[^*\n]*[^\s*])?\*|_[^\s_](?:[^_\n]*[^\s_])?_|~[^\s~](?:[^~\n]*[^\s~])?~|`[^`\n]+`)/g

function marcas(texto: string, chave: string, claro: boolean): React.ReactNode[] {
  const partes = texto.split(MARCA_RE)
  return partes.map((p, i) => {
    const k = `${chave}-${i}`
    if (i % 2 === 0) return p
    const miolo = p.slice(1, -1)
    switch (p[0]) {
      case '*': return <strong key={k}>{marcas(miolo, k, claro)}</strong>
      case '_': return <em key={k}>{marcas(miolo, k, claro)}</em>
      case '~': return <s key={k}>{marcas(miolo, k, claro)}</s>
      default:
        return (
          <code key={k} className={`rounded px-1 font-mono text-[0.85em] ${claro ? 'bg-white/15' : 'bg-background/70'}`}>
            {miolo}
          </code>
        )
    }
  })
}

export function textoWhatsApp(texto: string, claro: boolean): React.ReactNode[] {
  const pedacos = texto.split(URL_RE)
  return pedacos.map((p, i) => {
    if (i % 2 === 1) {
      return (
        <a
          key={`u-${i}`}
          href={p}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline underline-offset-2 break-all ${claro ? 'text-white' : 'text-cyan-600 dark:text-cyan-400'}`}
        >
          {p}
        </a>
      )
    }
    return <React.Fragment key={`t-${i}`}>{marcas(p, `t-${i}`, claro)}</React.Fragment>
  })
}

// "Hoje", "Ontem", dia da semana nesta semana, senão a data.
export function rotuloDia(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const zero = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((zero(hoje) - zero(d)) / 86_400_000)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias > 1 && dias < 7) {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'long' })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function mesmoDia(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}
