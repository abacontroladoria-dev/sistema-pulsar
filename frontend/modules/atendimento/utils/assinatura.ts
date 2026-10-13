// ============================================================================
// Assinatura da atendente no WhatsApp
//
// Um número pode ser atendido por várias pessoas (membros do canal), e do lado
// do contato todas são "a clínica". A mensagem humana sai com o nome de quem
// está logado na primeira linha, em negrito — `*Nome*` é negrito no WhatsApp:
//
//   *Stefani França*
//   valeu
//
// A assinatura vai SÓ para o WhatsApp. `central.messages.body` guarda o texto
// sem ela: a prévia da lista, a citação e o lápis de editar trabalham sobre o
// que a atendente escreveu, e quem escreveu já está em `sent_by_user_id`.
//
// Consequência que precisa ser lembrada: o eco da Evolution (fromMe) chega COM
// a assinatura, e é casado com a linha pendente pelo corpo — por isso
// `semAssinatura` existe e a ingestão compara as duas formas.
// ============================================================================

// Asterisco, sublinhado, til e crase são marcação no WhatsApp; dentro do nome
// quebrariam o negrito. Quebra de linha jogaria parte do nome no corpo.
function nomeLimpo(nome: string): string {
  return nome.replace(/[*_~`\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function assinar(nome: string | null | undefined, texto: string): string {
  const n = nome ? nomeLimpo(nome) : ''
  if (!n) return texto
  return texto ? `*${n}*\n${texto}` : `*${n}*`
}

// A primeira linha `*...*` sozinha. Mensagem sem assinatura volta igual.
const ASSINATURA = /^\*[^*\n]+\*(?:\n|$)/

export function semAssinatura(texto: string): string {
  return texto.replace(ASSINATURA, '')
}
