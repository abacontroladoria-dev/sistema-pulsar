import "server-only"

import { createClient } from "@/lib/supabase/server"
import { supabaseService } from "@/lib/supabase/service"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import type {
  AlteracaoPrazo,
  ImpactoPrazo,
  PainelEntradaResposta,
  PrazoVigente,
} from "@/lib/indicadores/entradaConvenio"

// Rotas de /api/indicadores/entrada-convenio. Molde: services/contratos/acesso.ts.
//
// A leitura passa pela service_role (RPC painel_entrada_convenio_atual, que só
// ela executa), então a checagem de acesso é ESTA:
//   • ver o painel e os prazos: `indicadores_entrada_convenio`;
//   • "Atualizar agora" (dispara a cópia do Doc do ClickUp): admin ou diretoria.
//     As leituras agendadas (7h55 a 9h25 e 12h55 a 13h55) já fazem isso sozinhas; o botão é para teste e para
//     depois de uma correção manual no Doc;
//   • alterar prazo de etapa: admin ou diretoria COM usuário identificado. No
//     localhost sem login (DISABLE_AUTH) não altera: o banco é o de produção e
//     toda alteração precisa de autor no histórico. A RPC confere o papel de novo.

export const PERMISSAO_PAINEL = "indicadores_entrada_convenio"

export type AcessoPainelEntrada = {
  ler: boolean
  atualizar: boolean
  alterarPrazos: boolean
  usuarioId: string | null
  /** Por que não pode alterar prazos (null quando pode). */
  motivoBloqueio: string | null
}

const BLOQUEIO_SEM_LOGIN =
  "No localhost sem login não dá para alterar prazos: toda alteração precisa de autor no histórico. Entre com o seu usuário para alterar."
const BLOQUEIO_PAPEL = "Só Direção e Admin alteram prazos."

export class AcessoNegado extends Error {
  constructor(
    readonly status: 401 | 403,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export async function lerAcessoPainelEntrada(): Promise<AcessoPainelEntrada> {
  // Desenvolvimento local, sem login (DISABLE_AUTH) — mesma convenção das rotas.
  if (process.env.DISABLE_AUTH === "true") {
    return { ler: true, atualizar: true, alterarPrazos: false, usuarioId: null, motivoBloqueio: BLOQUEIO_SEM_LOGIN }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new AcessoNegado(401, "Sessão expirada. Entre de novo.")

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle()
  if (!perfil || !perfil.ativo) throw new AcessoNegado(401, "Usuário não encontrado ou inativo.")

  const role = (perfil.role as string | null) ?? ""
  const codigos = await carregarPermissoesEfetivas(supabase)
  const direcaoOuAdmin = role === "admin" || role === "diretoria"
  return {
    ler: temPermissao(role, codigos, PERMISSAO_PAINEL),
    atualizar: direcaoOuAdmin,
    alterarPrazos: direcaoOuAdmin,
    usuarioId: user.id,
    motivoBloqueio: direcaoOuAdmin ? null : BLOQUEIO_PAPEL,
  }
}

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

/**
 * Última rodada do painel. `null` = a migration 20261013100000 ainda não foi
 * aplicada (o localhost usa o banco de produção, então a tela precisa
 * sobreviver a isso).
 */
export async function buscarPainelEntrada(): Promise<PainelEntradaResposta | null> {
  const { data, error } = await supabaseService.rpc("painel_entrada_convenio_atual")
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null
    throw new Error(error.message)
  }
  return data as PainelEntradaResposta
}

// ─── Prazos das etapas ───────────────────────────────────────────────────────

/** Migration 20261015160000 ainda não aplicada (função ou tabela ausente). */
const PRAZOS_NAO_INSTALADOS = new Set(["PGRST202", "42883", "42P01"])

/**
 * Prazos vigentes e histórico completo. `null` = a migration ainda não foi
 * aplicada: o painel segue com os prazos do calc (o localhost usa o banco de
 * produção, então a tela precisa sobreviver a isso).
 */
export async function buscarPrazos(): Promise<{ vigentes: PrazoVigente[]; historico: AlteracaoPrazo[] } | null> {
  const { data, error } = await supabaseService.rpc("painel_entrada_convenio_prazos")
  if (error) {
    if (error.code && PRAZOS_NAO_INSTALADOS.has(error.code)) return null
    throw new Error(error.message)
  }
  const d = (data ?? {}) as { vigentes?: PrazoVigente[]; historico?: AlteracaoPrazo[] }
  return { vigentes: d.vigentes ?? [], historico: d.historico ?? [] }
}

export class PrazoRecusado extends Error {
  constructor(
    readonly status: 400 | 403,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/** Altera o prazo e grava o histórico (mesma transação, na RPC). */
export async function alterarPrazo(p: {
  etapa: string
  prazo: number
  motivo: string
  usuarioId: string
  impacto: ImpactoPrazo | null
}): Promise<{ id: number; resumo: string; meta: number }> {
  const { data, error } = await supabaseService.rpc("painel_entrada_convenio_alterar_prazo", {
    p_etapa: p.etapa,
    p_prazo: p.prazo,
    p_motivo: p.motivo,
    p_usuario_id: p.usuarioId,
    p_impacto: p.impacto ?? {},
  })
  if (error) {
    if (error.code === "42501") throw new PrazoRecusado(403, error.message)
    if (error.code === "22023") throw new PrazoRecusado(400, error.message)
    if (error.code && PRAZOS_NAO_INSTALADOS.has(error.code)) {
      throw new PrazoRecusado(400, "A tabela de prazos ainda não foi instalada (migration 20261015160000 pendente).")
    }
    throw new Error(error.message)
  }
  return data as { id: number; resumo: string; meta: number }
}

/** Dispara a cópia do Doc agora e devolve o resumo da Edge Function. */
export async function atualizarPainelEntrada(): Promise<unknown> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no servidor")

  const res = await fetch(`${url}/functions/v1/painel-entrada-convenio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ origem: "manual" }),
    cache: "no-store",
  })
  const texto = await res.text()
  if (res.status === 404) throw new Error("A Edge Function painel-entrada-convenio ainda não foi publicada.")
  let corpo: unknown = texto
  try {
    corpo = JSON.parse(texto)
  } catch {
    // resposta não-JSON: devolve o texto
  }
  if (!res.ok) throw new Error(`Edge Function ${res.status}: ${texto.slice(0, 300)}`)
  return corpo
}
