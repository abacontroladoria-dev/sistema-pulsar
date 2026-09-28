import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import { NaoAutenticadoError, SemEmpresaError, SemPermissaoError } from "./erros"

/**
 * Código de permissão do módulo. Acesso definido pelo usuário em 2026-08-18:
 * setor `faturamento`, mais `admin` e `diretoria`. Desde 29/09/2026 quem dá o
 * código são os grupos de permissão (ver lib/permissions/carregar.ts).
 *
 * Atenção ao nome: o `role` no banco é **`faturamento`**, não "financeiro" — o
 * CHECK de `usuarios.role` não tem esse valor.
 */
export const PERMISSAO_INSUMOS = "insumos"

// ----------------------------------------------------------------------------
// Ator — quem está agindo e em nome de qual empresa.
//
// No AXIUM a "unidade ativa" vinha dentro do JWT e o PrismaService a injetava em
// `set_config('app.current_empresa')` por transação. No Pulsar não existe esse
// claim, e o PostgREST não tem transação por request onde colocá-lo. Então:
//
//   - QUEM: auth.uid(), validado contra o servidor Supabase Auth.
//   - QUAL EMPRESA: resolvida aqui e usada só para ESCRITA (é o valor gravado em
//     `empresa_id`). A LEITURA não depende disto — a RLS de 20260817200000 já
//     limita todo SELECT às empresas vinculadas ao usuário.
//
// Essa separação importa: mesmo que alguém mande um `x-empresa-id` de outra
// empresa, a policy de INSERT (`WITH CHECK empresa_id IN (…)`) recusa. A
// validação abaixo existe para dar erro claro, não como fronteira de segurança
// — a fronteira é o banco.
// ----------------------------------------------------------------------------

export type Ator = {
  usuarioId: string
  empresaId: string
  role: string
  ip: string | null
}

export type ContextoInsumos = {
  ator: Ator
  supabase: SupabaseClient
}

export const HEADER_EMPRESA = "x-empresa-id"

function ipDe(request?: NextRequest): string | null {
  if (!request) return null
  // Atrás do Coolify/proxy o IP real vem no x-forwarded-for (primeiro da lista).
  const encaminhado = request.headers.get("x-forwarded-for")
  if (encaminhado) return encaminhado.split(",")[0]?.trim() ?? null
  return request.headers.get("x-real-ip")
}

/**
 * Resolve o usuário autenticado, checa a permissão do módulo e devolve a empresa
 * em que ele está agindo.
 *
 * A CHECAGEM DE PERMISSÃO VIVE AQUI DE PROPÓSITO. O `proxy.ts` protege página,
 * não API — o matcher dele exclui `/api` explicitamente. Se cada route handler
 * tivesse de lembrar de chamar a checagem, bastaria um esquecimento para abrir um
 * endpoint. Como toda rota do módulo precisa do contexto, e o contexto só sai
 * daqui, a rota que esquecer a permissão não compila: não tem `supabase`.
 *
 * A empresa sai, nesta ordem: o header `x-empresa-id` (quando o usuário tem
 * vínculo com ela), depois a marcada como `empresa_padrao`, depois a única que
 * ele tiver. Sem nenhum vínculo, `SemEmpresaError` — vale inclusive para admin:
 * a RLS exige o vínculo para escrever, então não haveria como agir mesmo.
 */
export async function extrairAtor(request?: NextRequest): Promise<ContextoInsumos> {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new NaoAutenticadoError()

  const { data: perfil, error: erroPerfil } = await supabase
    .from("usuarios")
    .select("role, ativo")
    .eq("id", user.id)
    .maybeSingle()

  if (erroPerfil || !perfil) throw new NaoAutenticadoError("Usuário não encontrado")
  if (!perfil.ativo) throw new NaoAutenticadoError("Usuário inativo")

  const role = (perfil.role as string | null) ?? ""

  // Mesma resolução do proxy.ts: grupos + ajustes individuais, pelo banco.
  const codigos = await carregarPermissoesEfetivas(supabase)
  if (!temPermissao(role, codigos, PERMISSAO_INSUMOS)) throw new SemPermissaoError()

  // Sob RLS este SELECT já devolve só os vínculos do próprio usuário.
  const { data: vinculos, error: erroVinculos } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, empresa_padrao")
    .eq("usuario_id", user.id)
    .eq("ativo", true)

  if (erroVinculos) throw new SemEmpresaError(erroVinculos.message)
  if (!vinculos || vinculos.length === 0) throw new SemEmpresaError()

  const pedida = request?.headers.get(HEADER_EMPRESA)
  const escolhida = pedida
    ? vinculos.find((v) => v.empresa_id === pedida)
    : (vinculos.find((v) => v.empresa_padrao) ?? vinculos[0])

  if (!escolhida) {
    throw new SemEmpresaError("Usuário sem vínculo com a empresa informada.")
  }

  return {
    ator: { usuarioId: user.id, empresaId: escolhida.empresa_id, role, ip: ipDe(request) },
    supabase,
  }
}

/**
 * Grava na trilha de auditoria. Nunca lança: uma falha de auditoria não pode
 * derrubar a operação que já foi efetivada — mas vai para o log do servidor,
 * senão o buraco na trilha fica invisível.
 */
export async function registrarAuditoria(
  supabase: SupabaseClient,
  ator: Ator,
  entrada: {
    entidade: string
    entidadeId?: string | null
    acao: "criar" | "editar" | "excluir" | "visualizar"
    dadosAntes?: unknown
    dadosDepois?: unknown
  }
): Promise<void> {
  const { error } = await supabase.from("log_auditoria_insumos").insert({
    empresa_id: ator.empresaId,
    usuario_id: ator.usuarioId,
    entidade: entrada.entidade,
    entidade_id: entrada.entidadeId ?? null,
    acao: entrada.acao,
    dados_antes: entrada.dadosAntes ?? null,
    dados_depois: entrada.dadosDepois ?? null,
    ip: ator.ip,
  })

  if (error) {
    console.error("[Insumos API] falha ao registrar auditoria", {
      entidade: entrada.entidade,
      entidadeId: entrada.entidadeId,
      acao: entrada.acao,
      erro: error.message,
    })
  }
}
