// Segundo fator (app autenticador, TOTP) — a regra de quem precisa e desde quando.
//
// Módulo puro: o proxy.ts (servidor), a tela de login e a Segurança da conta
// (navegador) leem a mesma regra.
//
// A EXIGÊNCIA LIGA POR DATA, não por deploy: NEXT_PUBLIC_MFA_OBRIGATORIO_DESDE
// (AAAA-MM-DD) no Coolify. Sem a variável, ninguém é obrigado (cada um pode
// cadastrar o app quando quiser). Nos 7 dias antes da data, admin e diretoria
// sem o app veem o aviso; a partir da data, o proxy só os deixa entrar na
// Segurança da conta até cadastrarem. Ninguém fica trancado de surpresa.
//
// Plano B (perdeu o celular): no Supabase → Authentication → Users → a pessoa
// → "MFA factors" → apagar o fator. Ela entra só com a senha e cadastra de novo.
// Passo a passo em docs/SEGURANCA_DADOS_AGENDA.md (P7).

/** Papéis que precisam do segundo fator (veem o sistema inteiro). */
export const PAPEIS_COM_SEGUNDO_FATOR = ['admin', 'diretoria'] as const

/** Rota da tela onde se cadastra e se confirma o app. */
export const ROTA_SEGURANCA_CONTA = '/conta/seguranca'

const DIAS_DE_AVISO = 7

export type SituacaoExigencia =
  | { tipo: 'desligada' }
  | { tipo: 'futura'; desde: string }
  | { tipo: 'aviso'; desde: string; dias: number }
  | { tipo: 'obrigatoria'; desde: string }

/** Data de hoje em Brasília, AAAA-MM-DD. */
function hojeEmBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000)
}

/**
 * A partir de quando o segundo fator é obrigatório. `desde` explícito serve aos
 * testes; o padrão é a variável de ambiente.
 */
export function situacaoExigencia(
  agora = new Date(),
  desde: string | undefined = process.env.NEXT_PUBLIC_MFA_OBRIGATORIO_DESDE,
): SituacaoExigencia {
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { tipo: 'desligada' }
  const hoje = hojeEmBrasilia(agora)
  if (hoje >= desde) return { tipo: 'obrigatoria', desde }
  const dias = diasEntre(hoje, desde)
  return dias <= DIAS_DE_AVISO ? { tipo: 'aviso', desde, dias } : { tipo: 'futura', desde }
}

export function papelPrecisaDeSegundoFator(role: string | null | undefined): boolean {
  return (PAPEIS_COM_SEGUNDO_FATOR as readonly string[]).includes(role ?? '')
}

/** "03/11/2026" */
export function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}
