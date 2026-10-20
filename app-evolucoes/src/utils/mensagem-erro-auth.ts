import { isAuthError } from '@supabase/supabase-js';

/** Erro do Supabase Auth → frase para quem está tentando entrar. */
export function mensagemErroAuth(erro: unknown): string {
  if (!isAuthError(erro)) return 'Não foi possível entrar. Verifique a internet e tente de novo.';

  switch (erro.code) {
    case 'invalid_credentials':
      return 'Usuário, e-mail ou senha incorretos.';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'Código incorreto ou vencido. Digite o código que está aparecendo agora no app autenticador.';
    case 'mfa_factor_not_found':
      return 'O app autenticador desta conta não foi encontrado. Fale com o administrador.';
    case 'otp_expired':
      return 'Código incorreto ou vencido. Peça um novo código.';
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    // Celular sem conta: o app não cria conta sozinho (shouldCreateUser: false).
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found':
      return 'Este celular não está liberado para o app. Fale com a recepção da clínica.';
    case 'phone_provider_disabled':
    case 'sms_send_failed':
      return 'O envio de código ainda não está disponível. Tente mais tarde.';
    case 'user_banned':
      return 'Este acesso está bloqueado. Fale com a clínica.';
    default:
      return 'Não foi possível entrar. Tente de novo.';
  }
}
