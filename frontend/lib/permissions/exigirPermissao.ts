import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"

// Porta única das rotas /api que exigem permissão de tela.
//
// O `proxy.ts` protege página, não API (o matcher exclui `/api`): rota que só
// confere `getUser()` serve o dado a QUALQUER login — foi o caso de /api/laudos,
// /api/tita/situacao-favorecidos e /api/pdi-controle-prazos até 19/10/2026.
//
// Mesma resolução do proxy e do menu: grupos + ajustes individuais pelo banco
// (permissoes_efetivas) + padrão por papel (temPermissao). Molde:
// exigirPermissaoAuditoria (lib/auditoria/auth.ts).

export type ContextoPermissao = {
  supabase: SupabaseClient
  /** `null` só no desenvolvimento local sem login (DISABLE_AUTH). */
  usuarioId: string | null
  usuarioNome: string
  role: string
}

export class AcessoRecusado extends Error {
  constructor(
    readonly status: 401 | 403,
    mensagem: string,
  ) {
    super(mensagem)
    this.name = "AcessoRecusado"
  }
}

/**
 * Usuário da sessão, ativo e com PELO MENOS UMA das permissões. Lança
 * `AcessoRecusado` (401 sem sessão/inativo, 403 sem permissão).
 *
 * `DISABLE_AUTH=true` (localhost sem login) libera, como nas demais rotas.
 */
export async function exigirPermissao(codigos: string | readonly string[]): Promise<ContextoPermissao> {
  const supabase = await createClient()

  if (process.env.DISABLE_AUTH === "true") {
    return { supabase, usuarioId: null, usuarioNome: "Desenvolvimento local", role: "admin" }
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new AcessoRecusado(401, "Sessão expirada. Entre de novo.")

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("role, nome, ativo")
    .eq("id", user.id)
    .maybeSingle()
  if (!perfil || !perfil.ativo) throw new AcessoRecusado(401, "Usuário não encontrado ou inativo.")

  const role = (perfil.role as string | null) ?? ""
  const efetivas = await carregarPermissoesEfetivas(supabase)
  const lista = typeof codigos === "string" ? [codigos] : codigos
  if (!lista.some(c => temPermissao(role, efetivas, c))) {
    throw new AcessoRecusado(403, "Você não tem permissão para estes dados.")
  }

  return {
    supabase,
    usuarioId: user.id,
    usuarioNome: (perfil.nome as string | null) ?? user.email ?? "Usuário",
    role,
  }
}

/** Resposta HTTP do `AcessoRecusado`; `null` para qualquer outro erro (a rota trata). */
export function respostaDeAcessoRecusado(e: unknown): NextResponse | null {
  if (e instanceof AcessoRecusado) return NextResponse.json({ error: e.message }, { status: e.status })
  return null
}
