// ============================================================================
// Telefone brasileiro no WhatsApp: o 9º dígito
//
// O WhatsApp identifica muitos celulares brasileiros SEM o nono dígito
// (5511 8765-4321 em vez de 5511 9 8765-4321), porque a conta foi criada antes
// da mudança de numeração. A Meta e a Evolution devolvem esse identificador
// interno como veio, e o mesmo contato pode aparecer das duas formas conforme o
// canal. Buscar só pela forma recebida duplicaria o contato que já conversou
// com a Maia.
//
// Por isso não se "corrige" o número guardado — ele é a identidade que o
// WhatsApp usa e o que o envio aceita. Na BUSCA, as duas variantes são tentadas.
// ============================================================================

// "5511987654321@s.whatsapp.net" e "5511987654321:12@s.whatsapp.net" (sufixo de
// dispositivo) viram "5511987654321".
export function digitosDoJid(jid: string): string {
  return jid.split('@')[0]!.split(':')[0]!.replace(/\D/g, '')
}

// As formas pelas quais o mesmo celular brasileiro pode estar gravado. Para
// número que não é brasileiro, ou fixo, devolve só ele mesmo.
export function variantesBr(digitos: string): string[] {
  if (!digitos.startsWith('55')) return [digitos]

  // 55 + DDD(2) + 8 dígitos começando em 6-9 (celular sem o 9)
  if (digitos.length === 12 && /[6-9]/.test(digitos[4]!)) {
    return [digitos, `${digitos.slice(0, 4)}9${digitos.slice(4)}`]
  }

  // 55 + DDD(2) + 9 + 8 dígitos (celular com o 9)
  if (digitos.length === 13 && digitos[4] === '9') {
    return [digitos, `${digitos.slice(0, 4)}${digitos.slice(5)}`]
  }

  return [digitos]
}
