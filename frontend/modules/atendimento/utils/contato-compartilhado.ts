// ============================================================================
// Contato compartilhado (cartão do WhatsApp) → corpo legível
//
// O cartão traz o que interessa — nome e telefone — e a atendente (e a Maia)
// precisa ler isso na conversa. Gravar só "[contato compartilhado]" deixava a
// bolha sem o número que a pessoa mandou justamente para ser usado (visto em
// 22/10 com 5521920043824: "tentei contato nesse número" + o cartão).
//
// A Meta entrega o cartão já estruturado; a Evolution entrega o vCard cru.
// Os dois convergem em ContatoCompartilhado e saem pelo mesmo formatador.
// ============================================================================

export interface ContatoCompartilhado {
  nome:      string | null
  telefones: string[]
}

// O texto fica no corpo porque é ele que a Maia lê, que vai para a prévia da
// lista e que a busca alcança. A tela desenha o cartão lendo esse mesmo texto
// de volta (lerCorpoDeContatos), e por isso o formato é fixo:
//   [contato compartilhado: Nome · +55 21 99999-9999]
//   [contatos compartilhados: Ana · +55 ...; Bia · +55 ...]
export function corpoDeContatos(contatos: ContatoCompartilhado[]): string {
  const partes = contatos
    .map(c => [c.nome, ...c.telefones].filter(Boolean).join(' · '))
    .filter(Boolean)
  if (partes.length === 0) return '[contato compartilhado]'
  return partes.length === 1
    ? `[contato compartilhado: ${partes[0]}]`
    : `[contatos compartilhados: ${partes.join('; ')}]`
}

const CORPO = /^\[contatos? compartilhados?(?::\s*([\s\S]*))?\]$/
const TELEFONE = /^\+?[\d\s().-]{8,}$/

// O inverso de corpoDeContatos. Null quando o corpo não é de cartão. Um nome
// com " · " dentro não se perde: o que não tem cara de telefone volta a ser nome.
export function lerCorpoDeContatos(corpo: string | null | undefined): ContatoCompartilhado[] | null {
  const m = CORPO.exec(corpo?.trim() ?? '')
  if (!m) return null
  if (!m[1]?.trim()) return []
  return m[1].split('; ').map(parte => {
    const pedacos = parte.split(' · ').map(p => p.trim()).filter(Boolean)
    return {
      nome:      pedacos.filter(p => !TELEFONE.test(p)).join(' · ') || null,
      telefones: pedacos.filter(p => TELEFONE.test(p)),
    }
  })
}

// O que a lista de conversas mostra no lugar do corpo entre colchetes.
export function previaDeContatos(contatos: ContatoCompartilhado[]): string {
  if (contatos.length > 1) return `${contatos.length} contatos compartilhados`
  const c = contatos[0]
  return `Contato: ${c?.nome ?? c?.telefones[0] ?? 'compartilhado'}`
}

// vCard 3.0 como o WhatsApp gera:
//   FN:Fulano
//   TEL;type=CELL;type=VOICE;waid=5521999999999:+55 21 99999-9999
// Linha dobrada (continuação começa com espaço) é desdobrada antes. O telefone
// é o valor exibido; sem ele, o waid.
export function lerVcard(vcard: string, nomeExibido?: string | null): ContatoCompartilhado {
  const linhas = vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  let nome: string | null = null
  const telefones: string[] = []

  for (const linha of linhas) {
    const doisPontos = linha.indexOf(':')
    if (doisPontos < 0) continue
    // "item1.TEL;..." — prefixo de grupo que o iPhone põe em alguns campos.
    const chave = linha.slice(0, doisPontos).replace(/^[\w-]+\./, '').toUpperCase()
    const valor = linha.slice(doisPontos + 1).replace(/\\([,;\\])/g, '$1').trim()

    if (chave === 'FN' && valor) nome = valor
    else if (chave === 'TEL' || chave.startsWith('TEL;')) {
      const waid = /waid=(\d+)/i.exec(chave)?.[1]
      const tel = valor || (waid ? `+${waid}` : '')
      if (tel && !telefones.includes(tel)) telefones.push(tel)
    }
  }

  return { nome: nomeExibido?.trim() || nome, telefones }
}
