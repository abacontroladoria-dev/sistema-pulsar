import type { Factor, Session } from '@supabase/supabase-js';

/**
 * Fator TOTP (app autenticador) já confirmado da conta, se houver. É o mesmo
 * segundo fator que o Pulsar web pede no login (Minha conta → Segurança).
 */
export function fatorTotp(session: Session): Factor | undefined {
  return session.user.factors?.find((f) => f.factor_type === 'totp' && f.status === 'verified');
}

/**
 * Conta com app autenticador e sessão ainda sem o código (aal1): o login só
 * vale por inteiro depois do código, igual ao web. Calculado do próprio token,
 * sem rede. Token ilegível conta como "falta o código" (falha fechada).
 */
export function precisaSegundoFator(session: Session): boolean {
  if (!fatorTotp(session)) return false;
  return nivelDaSessao(session.access_token) !== 'aal2';
}

function nivelDaSessao(jwt: string): string | null {
  try {
    const parte = jwt.split('.')[1];
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64)) as { aal?: unknown };
    return typeof payload.aal === 'string' ? payload.aal : null;
  } catch {
    return null;
  }
}
