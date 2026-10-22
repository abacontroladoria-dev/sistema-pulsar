// ============================================================================
// PONTO ÚNICO DE TROCA — LIGADO
// ============================================================================
//
// O cadastro de planos de saúde (public.convenios / public.planos_saude,
// migration 20260826110000) já existe. Este arquivo continua sendo o único
// lugar que sabe de onde o dado vem — a tela de Ficha Médica
// (components/cadastros/pacientes/secoes/PlanoSaude.tsx) só conhece este
// contrato, nunca o service de Convênios diretamente.
//
// A FK de pacientes_ficha_medica.plano_saude_id -> planos_saude.id já foi
// fechada em 20260826110100.
// ============================================================================

import { getPlanosSaudeAtivos, getPlanosSaudePorIds } from "@/services/convenios.service"

export type PlanoSaude = {
  id: number
  nome: string
  ativo: boolean
  /** Nome do convênio dono do plano (ex.: "Unimed"), para desambiguar planos homônimos entre convênios. */
  convenio_nome: string
}

/** Só planos ativos (e de convênios ativos), ordenados por nome. */
export async function getPlanosSaude(): Promise<{
  data: PlanoSaude[]
  error: string | null
}> {
  try {
    const planos = await getPlanosSaudeAtivos()
    return {
      data: planos.map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo, convenio_nome: p.convenio_nome })),
      error: null,
    }
  } catch (e: any) {
    return { data: [], error: String(e?.message ?? e) }
  }
}

/**
 * Como o plano aparece na tela (select da Ficha financeira e histórico).
 *
 * O rótulo traz o convênio junto ("Unimed — Nacional") porque planos homônimos
 * entre convênios são comuns e o nome sozinho não desambigua. "Padrão" é o nome
 * que todo convênio recebe quando não tem produto próprio cadastrado (carga
 * inicial, APLICAR_3_convenios) — repeti-lo transformaria a lista em dezessete
 * linhas terminadas na mesma palavra. Nesse caso o convênio sozinho já é a
 * resposta. Quando o plano tem nome de verdade ("Nacional", "Volta Redonda"), o
 * convênio continua na frente: aí os dois pedaços carregam informação.
 */
export function rotuloPlano(plano: Pick<PlanoSaude, "nome" | "convenio_nome">): string {
  if (!plano.convenio_nome) return plano.nome
  const generico = plano.nome.trim().toLowerCase() === "padrão"
  return generico ? plano.convenio_nome : `${plano.convenio_nome} — ${plano.nome}`
}

/** id → rótulo (rotuloPlano), inclusive de planos já desativados. */
export async function getRotulosPlanosSaude(ids: number[]): Promise<Record<string, string>> {
  const planos = await getPlanosSaudePorIds(ids)
  return Object.fromEntries(planos.map((p) => [String(p.id), rotuloPlano(p)]))
}

/** `true` quando a integração real já está ligada — a tela usa para escolher a mensagem. */
export const PLANOS_SAUDE_DISPONIVEL = true
