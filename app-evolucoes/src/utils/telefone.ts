/**
 * Celular brasileiro digitado de qualquer jeito → E.164 (`+5511987654321`),
 * o formato que o Supabase Phone Auth guarda. `null` se não for celular válido.
 *
 * Aceita com ou sem 55, com ou sem o 0 de operadora/DDD, com máscara.
 */
export function celularParaE164(digitado: string): string | null {
  let digitos = digitado.replace(/\D/g, '');
  if (digitos.startsWith('0')) digitos = digitos.replace(/^0+/, '');
  if (digitos.length === 11) digitos = `55${digitos}`;

  // 55 + DDD (2) + 9 + 8 dígitos. Fixo (8 dígitos sem o 9) não recebe SMS/WhatsApp.
  if (!/^55[1-9][0-9]9[0-9]{8}$/.test(digitos)) return null;
  return `+${digitos}`;
}

/** `+5511987654321` → `(11) 98765-4321`, para mostrar na tela. */
export function formatarCelular(e164: string): string {
  const m = e164.match(/^\+55(\d{2})(\d{5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
