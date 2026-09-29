import "server-only"

import { createClient } from "@/lib/supabase/server"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"

// Quem pode o quê nas rotas de /api/acompanhamento-laudos.
//
// As duas rotas leem e gravam com service_role (as tabelas de senha não têm
// GRANT para anon/authenticated), então a RLS não protege nada ali: a checagem
// é ESTA. Um lugar só, para a leitura e o upload nunca discordarem.
//
//   • senhas (ler e subir o relatório): permissão `acompanhamento_laudos` OU
//     papel admin/diretoria/recepção — a mesma regra da RLS de
//     `laudos_acompanhamento` (20260828150000), decisão do usuário (28/09/2026).
//   • laudos sem senha: também quem tem `cronograma_ocupacao_paciente` — a
//     Ocupação Paciente mostra a situação do laudo e nunca a senha.
//
// Até 29/09/2026 a leitura exigia só estar logado: qualquer usuário do sistema
// lia o relatório de senhas inteiro chamando a rota direto.

export const PERMISSAO_LAUDOS = "acompanhamento_laudos"
export const PERMISSAO_OCUPACAO_PACIENTE = "cronograma_ocupacao_paciente"

export type AcessoLaudos = {
  id: string | null
  nome: string
  /** Lê as senhas e sobe o relatório. */
  senhas: boolean
  /** Lê a lista de laudos (sem senha, se `senhas` for falso). */
  laudos: boolean
}

export class AcessoNegado extends Error {
  constructor(
    readonly status: 401 | 403,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/**
 * O usuário da requisição e o que ele pode. Lança `AcessoNegado(401)` sem
 * sessão ou com usuário inativo; nunca 403 — cada rota decide o que recusar.
 */
export async function lerAcessoLaudos(): Promise<AcessoLaudos> {
  // Desenvolvimento local, sem login (DISABLE_AUTH) — mesma convenção das rotas.
  if (process.env.DISABLE_AUTH === "true") {
    return { id: null, nome: "Desenvolvimento local", senhas: true, laudos: true }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new AcessoNegado(401, "Sessão expirada. Entre de novo.")

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("role, nome, ativo")
    .eq("id", user.id)
    .maybeSingle()
  if (!perfil || !perfil.ativo) throw new AcessoNegado(401, "Usuário não encontrado ou inativo.")

  const role = (perfil.role as string | null) ?? ""
  const codigos = await carregarPermissoesEfetivas(supabase)
  const senhas =
    temPermissao(role, codigos, PERMISSAO_LAUDOS) || role === "diretoria" || role === "recepcao"
  const laudos = senhas || temPermissao(role, codigos, PERMISSAO_OCUPACAO_PACIENTE)

  return {
    id: user.id,
    nome: (perfil.nome as string | null) ?? user.email ?? "Usuário",
    senhas,
    laudos,
  }
}
