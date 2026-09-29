import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { agruparLaudos, hojeBrasiliaISO } from "@/lib/laudos/acompanhamento"
import {
  juntarComSenhas,
  parsearRelatorioSenhas,
  RelatorioSenhasInvalidoError,
} from "@/lib/laudos/senhas"
import { buscarLaudosDoRelatorio } from "@/services/laudos/relatorio"
import { buscarSenhasAtuais, gravarImportacaoSenhas } from "@/services/laudos/senhas"
import { AcessoNegado, lerAcessoLaudos, type AcessoLaudos } from "@/services/laudos/acesso"
import type { RespostaUploadSenhas } from "@/types/laudosAcompanhamento"

// POST /api/acompanhamento-laudos/senhas/  (multipart, campo `arquivo`)
//
// Recebe o `relatorio_autorizacoes_assim_*.csv`, valida pelo CABEÇALHO (o nome
// do arquivo muda a cada download), agrupa por autorização, descarta nome e CPF
// e grava pela RPC `laudos_senhas_importar` com service_role. Devolve o resumo
// do cruzamento com os laudos do Órbita, para a tela mostrar o que casou.
//
// Meses FECHADOS (migration 20261001100000): o banco só aplica do mês corrente
// em diante; o que o arquivo trouxer de mês anterior é ignorado, e o que já
// estava gravado desses meses é copiado intocado. A regra mora toda no banco.
//
// Quem pode subir: services/laudos/acesso.ts (`senhas`). A checagem mora na
// rota porque o `proxy.ts` não protege `/api` e a gravação é com service_role.
//
// Nenhuma linha do arquivo vai para o log: ele tem nome e CPF de paciente.
export const dynamic = "force-dynamic"

const TAMANHO_MAXIMO = 5 * 1024 * 1024

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
  let ator: AcessoLaudos
  try {
    ator = await lerAcessoLaudos()
  } catch (e) {
    if (e instanceof AcessoNegado) return erro(e.status, e.message)
    console.error("[api/acompanhamento-laudos/senhas] falha ao identificar o usuário", e)
    return erro(500, "Não foi possível verificar sua permissão.")
  }
  if (!ator.senhas) return erro(403, "Você não tem permissão para atualizar as senhas.")

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
  let laudos: ReturnType<typeof agruparLaudos>["laudos"]
  const hoje = hojeBrasiliaISO()
  try {
    const { rows } = await buscarLaudosDoRelatorio()
    laudos = agruparLaudos(rows, hoje).laudos
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

    // O cruzamento que a tela vai mostrar é o da foto GRAVADA (meses fechados da
    // importação anterior + mês aberto do arquivo), não o do arquivo cru: com
    // meses fechados, os dois diferem. Falhando a releitura, fica o do arquivo —
    // a gravação já aconteceu e não pode virar erro.
    if (!gravacao.duplicado) {
      try {
        const atuais = await buscarSenhasAtuais()
        if (atuais) resumo = juntarComSenhas(laudos, atuais.autorizacoes, hoje).resumo
      } catch (e) {
        console.error(
          "[api/acompanhamento-laudos/senhas] gravado, mas a releitura para o resumo falhou",
          e instanceof Error ? e.message : e,
        )
      }
    }

    const corpo: RespostaUploadSenhas = {
      ok: true,
      duplicado: gravacao.duplicado,
      importadoEm: gravacao.duplicado ? gravacao.importadoEm : null,
      importadoPorNome: gravacao.duplicado ? gravacao.importadoPorNome : ator.nome,
      mesesFechados: gravacao.duplicado ? null : gravacao.mesesFechados,
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
