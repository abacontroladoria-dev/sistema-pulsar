import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { temPermissao } from "@/lib/permissions/resolver"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import { agruparLaudos, hojeBrasiliaISO } from "@/lib/laudos/acompanhamento"
import {
  juntarComSenhas,
  parsearRelatorioSenhas,
  RelatorioSenhasInvalidoError,
} from "@/lib/laudos/senhas"
import { buscarLaudosDoRelatorio } from "@/services/laudos/relatorio"
import { gravarImportacaoSenhas } from "@/services/laudos/senhas"
import type { RespostaUploadSenhas } from "@/types/laudosAcompanhamento"

// POST /api/acompanhamento-laudos/senhas/  (multipart, campo `arquivo`)
//
// Recebe o `relatorio_autorizacoes_assim_*.csv`, valida pelo CABEÇALHO (o nome
// do arquivo muda a cada download), agrupa por autorização, descarta nome e CPF
// e grava pela RPC `laudos_senhas_importar` com service_role. Devolve o resumo
// do cruzamento com os laudos do Órbita, para a tela mostrar o que casou.
//
// Nenhuma linha do arquivo vai para o log: ele tem nome e CPF de paciente.
export const dynamic = "force-dynamic"

const PERMISSAO = "acompanhamento_laudos"
const TAMANHO_MAXIMO = 5 * 1024 * 1024

type Ator = { id: string | null; nome: string }

class AcessoNegado extends Error {
  constructor(
    readonly status: 401 | 403,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

/**
 * Quem sobe o arquivo: a MESMA regra de quem grava o aviso na tela — a RLS de
 * `laudos_acompanhamento` (20260828150000): permissão `acompanhamento_laudos`
 * OU papel admin/diretoria/recepção. Decisão do usuário (28/09/2026).
 *
 * A checagem mora na rota porque o `proxy.ts` não protege `/api`, e a gravação
 * é com service_role — sem isto, qualquer usuário logado trocaria as senhas.
 */
async function exigirAtor(): Promise<Ator> {
  // Desenvolvimento local, sem login — mesma convenção da rota de leitura.
  if (process.env.DISABLE_AUTH === "true") return { id: null, nome: "Desenvolvimento local" }

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
  const pode =
    temPermissao(role, codigos, PERMISSAO) || role === "diretoria" || role === "recepcao"
  if (!pode) throw new AcessoNegado(403, "Você não tem permissão para atualizar as senhas.")

  return { id: user.id, nome: (perfil.nome as string | null) ?? user.email ?? "Usuário" }
}

/**
 * UTF-8 é o formato do relatório (com BOM). Se alguém abrir no Excel e salvar
 * de novo, pode virar Windows-1252 — decodificar esse arquivo como UTF-8
 * estragaria os acentos do cabeçalho e ele seria recusado sem motivo claro.
 */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder("windows-1252").decode(bytes)
  }
}

function erro(status: number, mensagem: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: mensagem, ...extra }, { status })
}

export async function POST(request: NextRequest) {
  let ator: Ator
  try {
    ator = await exigirAtor()
  } catch (e) {
    if (e instanceof AcessoNegado) return erro(e.status, e.message)
    console.error("[api/acompanhamento-laudos/senhas] falha ao identificar o usuário", e)
    return erro(500, "Não foi possível verificar sua permissão.")
  }

  let arquivo: File
  try {
    const form = await request.formData()
    const campo = form.get("arquivo")
    if (!(campo instanceof File)) return erro(400, "Nenhum arquivo enviado.")
    arquivo = campo
  } catch {
    return erro(400, "Envio inválido.")
  }

  if (!/\.csv$/i.test(arquivo.name)) return erro(415, "Envie o arquivo .csv do relatório de autorizações.")
  if (arquivo.size === 0) return erro(400, "O arquivo está vazio.")
  if (arquivo.size > TAMANHO_MAXIMO) return erro(413, "O arquivo passa de 5 MB — não parece ser o relatório.")

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const sha256 = createHash("sha256").update(bytes).digest("hex")

  let parse: ReturnType<typeof parsearRelatorioSenhas>
  try {
    parse = parsearRelatorioSenhas(decodificar(bytes))
  } catch (e) {
    if (e instanceof RelatorioSenhasInvalidoError) {
      return erro(422, e.message, { colunasFaltando: e.colunasFaltando })
    }
    console.error("[api/acompanhamento-laudos/senhas] falha ao ler o CSV", e)
    return erro(422, "Não foi possível ler o arquivo como CSV.")
  }

  // O cruzamento é calculado sobre ESTE arquivo (inclusive quando é duplicado),
  // contra os laudos do Órbita de hoje. Lido ANTES de gravar: se o Órbita não
  // responder, nada é gravado e a mensagem diz o que de fato falhou.
  let resumo: ReturnType<typeof juntarComSenhas>["resumo"]
  try {
    const hoje = hojeBrasiliaISO()
    const { rows } = await buscarLaudosDoRelatorio()
    const { laudos } = agruparLaudos(rows, hoje)
    resumo = juntarComSenhas(laudos, parse.autorizacoes, hoje).resumo
  } catch (e) {
    console.error(
      "[api/acompanhamento-laudos/senhas] falha ao ler os laudos do Órbita",
      e instanceof Error ? e.message : e,
    )
    return erro(503, "Não foi possível ler os laudos do Órbita para o cruzamento. Nada foi gravado.")
  }

  if (parse.autorizacoesDivergentes.length > 0 || parse.datasInvalidas.length > 0) {
    console.warn(
      `[api/acompanhamento-laudos/senhas] ${parse.autorizacoesDivergentes.length} autorização(ões) com campos divergentes e ${parse.datasInvalidas.length} data(s) inválida(s) em ${arquivo.name}.`,
    )
  }

  try {
    const gravacao = await gravarImportacaoSenhas({
      arquivoNome: arquivo.name,
      sha256,
      totalLinhas: parse.totalLinhas,
      importadoPor: ator.id,
      importadoPorNome: ator.nome,
      autorizacoes: parse.autorizacoes,
    })

    const corpo: RespostaUploadSenhas = {
      ok: true,
      duplicado: gravacao.duplicado,
      importadoEm: gravacao.duplicado ? gravacao.importadoEm : null,
      importadoPorNome: gravacao.duplicado ? gravacao.importadoPorNome : ator.nome,
      resumo: {
        linhas: parse.totalLinhas,
        linhasDescartadas: parse.linhasDescartadas,
        autorizacoes: parse.autorizacoes.length,
        laudosCasados: resumo.laudosCasados,
        laudosOrfaos: resumo.laudosOrfaos,
        laudosDivergentes: [...new Set(resumo.laudosDivergentes.map((d) => d.idLaudo))],
        autorizacoesDivergentes: parse.autorizacoesDivergentes,
        datasInvalidas: parse.datasInvalidas.length,
      },
    }
    return NextResponse.json(corpo)
  } catch (e) {
    console.error(
      "[api/acompanhamento-laudos/senhas] falha ao gravar",
      e instanceof Error ? e.message : e,
    )
    return erro(500, "Não foi possível gravar o relatório de senhas. Tente de novo.")
  }
}
