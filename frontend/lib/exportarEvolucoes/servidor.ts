import "server-only"

import { NextResponse } from "next/server"
import { AcessoRecusado, exigirPermissao, type ContextoPermissao } from "@/lib/permissions/exigirPermissao"

// Peças comuns das rotas /api/exportar-evolucoes/*.
//
// As rotas rodam com a service_role (supabaseService) porque as funções do banco
// só têm EXECUTE para ela: nenhum login chama pelo REST. A porta é esta conferência
// de permissão — o proxy.ts não protege /api.

export const PERMISSAO = "exportar_evolucoes"

/** Confere a permissão; devolve o contexto ou a resposta de recusa pronta. */
export async function conferirAcesso(rota: string): Promise<ContextoPermissao | NextResponse> {
  try {
    return await exigirPermissao(PERMISSAO)
  } catch (e) {
    if (e instanceof AcessoRecusado) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error(`[api/exportar-evolucoes/${rota}] falha ao verificar o acesso`, e)
    return NextResponse.json({ error: "Não foi possível conferir o seu acesso." }, { status: 500 })
  }
}

type ErroBanco = { code?: string; message?: string } | null

/**
 * Erro do banco → resposta. O localhost usa o banco de produção: até a migration
 * 20261019200000 ser aplicada, a função não existe (42883/PGRST202) e a tela
 * mostra isso com clareza em vez de quebrar.
 */
export function respostaDeErroDoBanco(rota: string, error: ErroBanco): NextResponse {
  const code = error?.code ?? ""
  if (code === "PGRST202" || code === "42883") {
    return NextResponse.json(
      { error: "A exportação de evoluções ainda não foi ativada no banco (migration 20261019200000 pendente).", codigo: "migration_pendente" },
      { status: 503 },
    )
  }
  // Mensagens de validação escritas na própria função (período, limite de 500…).
  if (code === "22023" && error?.message) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`[api/exportar-evolucoes/${rota}]`, error)
  return NextResponse.json({ error: "Não foi possível ler as evoluções. Tente de novo." }, { status: 500 })
}

const DATA = /^\d{4}-\d{2}-\d{2}$/

export function dataValida(v: unknown): v is string {
  return typeof v === "string" && DATA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}
