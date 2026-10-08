import "server-only"

import { createClient } from "@/lib/supabase/server"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"

// Quem pode o quê nas rotas de contrato do paciente (/api/status-contratos).
// Molde: services/laudos/acesso.ts.
//
// A rota lê com service_role (a Status Contratos cruza a grade do TiTa, que só
// a service_role lê), então a RLS não protege nada ali: a checagem é ESTA.
// SEM PDF neste tema (pedido do usuário, 09/10/2026): não há rota de arquivo.
//
//   • editar (criar contrato, marcar assinado, cancelar, e — fase 3 —
//     enviar/reenviar/cancelar na D4Sign): `cadastros_pacientes`. Mesma regra
//     das RPCs contratos_* no banco.
//   • ler a Status Contratos: `status_contratos` OU `cadastros_pacientes`. A
//     tela é só leitura.

export const PERMISSAO_CADASTRO = "cadastros_pacientes"
export const PERMISSAO_STATUS = "status_contratos"

export type AcessoContratos = {
  id: string | null
  nome: string
  editar: boolean
  ler: boolean
}

export class AcessoNegado extends Error {
  constructor(
    readonly status: 401 | 403,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/** O usuário da requisição e o que ele pode. Sem sessão: `AcessoNegado(401)`. */
export async function lerAcessoContratos(): Promise<AcessoContratos> {
  // Desenvolvimento local, sem login (DISABLE_AUTH) — mesma convenção das rotas.
  if (process.env.DISABLE_AUTH === "true") {
    return { id: null, nome: "Desenvolvimento local", editar: true, ler: true }
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
  const editar = temPermissao(role, codigos, PERMISSAO_CADASTRO)
  const ler = editar || temPermissao(role, codigos, PERMISSAO_STATUS)

  return {
    id: user.id,
    nome: (perfil.nome as string | null) ?? user.email ?? "Usuário",
    editar,
    ler,
  }
}

/** Resposta JSON padronizada para a recusa. `mensagem` vai para a tela. */
export function respostaDeAcesso(e: unknown): { status: number; corpo: { ok: false; error: string; mensagem: string } } {
  if (e instanceof AcessoNegado) {
    return { status: e.status, corpo: { ok: false, error: "not_authenticated", mensagem: e.message } }
  }
  return {
    status: 500,
    corpo: { ok: false, error: "falha_ao_verificar_acesso", mensagem: "Não foi possível verificar o seu acesso." },
  }
}

export const SEM_PERMISSAO = {
  ok: false as const,
  error: "sem_permissao",
  mensagem: "Você não tem permissão para esta ação.",
}
