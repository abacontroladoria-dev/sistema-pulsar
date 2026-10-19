// Mensagens do Supabase Auth (MFA) em português, para a tela de login e a
// Segurança da conta. O texto original vem em inglês e técnico.
export function mensagemDoSegundoFator(e: unknown): string {
  const m = (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : '') || ''
  if (/invalid totp|invalid code|code.*(invalid|expired)/i.test(m)) {
    return 'Código incorreto ou vencido. Confira o app e digite o código que está aparecendo agora.'
  }
  if (/enroll.*disabled|mfa.*(disabled|not enabled)|totp.*disabled/i.test(m)) {
    return 'O app autenticador ainda não foi ligado no sistema. Avise o administrador.'
  }
  if (/too many|rate limit/i.test(m)) {
    return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
  }
  if (/aal2|assurance/i.test(m)) {
    return 'Confirme primeiro o código do app para fazer esta alteração.'
  }
  return m ? `Não foi possível concluir: ${m}` : 'Não foi possível concluir. Tente de novo.'
}
