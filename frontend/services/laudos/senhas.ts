import "server-only"

import { supabaseService } from "@/lib/supabase/service"
import type { AutorizacaoSenha, EspecialidadeAutorizada } from "@/lib/laudos/senhas"
import type { MesesFechadosUpload } from "@/types/laudosAcompanhamento"

// Leitura e gravação do relatório de senhas da ASSIM
// (`laudos_senhas_importacoes` / `laudos_senhas_autorizacoes`, migration
// 20260930130000).
//
// `server-only`: as duas tabelas não têm GRANT para anon/authenticated — igual
// a orbita_laudos_*. Só a service_role alcança, e a chave nunca sai daqui.

/** Teto de linhas por resposta do PostgREST — o mesmo de relatorio.ts. */
const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteSupabase = any

export interface ImportacaoSenhas {
  id: string
  arquivoNome: string
  totalLinhas: number
  totalAutorizacoes: number
  importadoPorNome: string | null
  importadoEm: string | null
}

type LinhaAutorizacao = {
  id_autorizacao: string
  id_laudo: string
  id_favorecido: number | string | null
  plano: string | null
  data_lista: string | null
  situacao_dentro: string | null
  senha_dentro: string | null
  liberacao_dentro: string | null
  validade_dentro: string | null
  situacao_fora: string | null
  senha_fora: string | null
  liberacao_fora: string | null
  validade_fora: string | null
  criado_em_origem: string | null
  atualizado_em_origem: string | null
  arquivo_autorizacao: string | null
  cronograma_convenio: string | null
  observacoes: string | null
  especialidades: EspecialidadeBanco[] | null
}

type EspecialidadeBanco = {
  especialidade?: string
  grupo?: string
  quantidade_autorizada?: string
  quantidade_solicitada?: string
  codigo_guia?: string
  descricao_guia?: string
  em_uso?: string
}

const COLUNAS_AUTORIZACAO =
  "id_autorizacao, id_laudo, id_favorecido, plano, data_lista, " +
  "situacao_dentro, senha_dentro, liberacao_dentro, validade_dentro, " +
  "situacao_fora, senha_fora, liberacao_fora, validade_fora, " +
  "criado_em_origem, atualizado_em_origem, arquivo_autorizacao, cronograma_convenio, " +
  "observacoes, especialidades"

/** `timestamp` do Postgres ("2026-09-03T08:42:00") → "2026-09-03T08:42". */
function dataHora(v: string | null): string | null {
  if (!v) return null
  return v.replace(" ", "T").slice(0, 16)
}

function paraAutorizacao(l: LinhaAutorizacao): AutorizacaoSenha {
  const fav = l.id_favorecido === null ? null : Number(l.id_favorecido)
  return {
    idAutorizacao: String(l.id_autorizacao),
    idLaudo: String(l.id_laudo),
    idFavorecido: fav !== null && Number.isFinite(fav) ? fav : null,
    plano: l.plano ?? "",
    dataLista: l.data_lista,
    situacaoDentro: l.situacao_dentro ?? "",
    senhaDentro: l.senha_dentro ?? "",
    liberacaoDentro: l.liberacao_dentro,
    validadeDentro: l.validade_dentro,
    situacaoFora: l.situacao_fora ?? "",
    senhaFora: l.senha_fora ?? "",
    liberacaoFora: l.liberacao_fora,
    validadeFora: l.validade_fora,
    criadoEmOrigem: dataHora(l.criado_em_origem),
    atualizadoEmOrigem: dataHora(l.atualizado_em_origem),
    arquivoAutorizacao: l.arquivo_autorizacao ?? "",
    cronogramaConvenio: l.cronograma_convenio ?? "",
    observacoes: l.observacoes ?? "",
    especialidades: (l.especialidades ?? []).map(
      (e): EspecialidadeAutorizada => ({
        especialidade: e.especialidade ?? "",
        grupo: e.grupo ?? "",
        quantidadeAutorizada: e.quantidade_autorizada ?? "",
        quantidadeSolicitada: e.quantidade_solicitada ?? "",
        codigoGuia: e.codigo_guia ?? "",
        descricaoGuia: e.descricao_guia ?? "",
        emUso: e.em_uso ?? "",
      }),
    ),
  }
}

/**
 * A importação de senhas em uso (a mais recente) e as autorizações dela.
 * `null` quando nunca houve upload.
 *
 * Lança se a leitura falhar ou vier incompleta — quem chama decide degradar
 * (a lista de laudos não pode cair porque as senhas não vieram).
 */
export async function buscarSenhasAtuais(
  cliente?: ClienteSupabase,
): Promise<{ importacao: ImportacaoSenhas; autorizacoes: AutorizacaoSenha[] } | null> {
  const sb: ClienteSupabase = cliente ?? supabaseService

  const { data: imp, error: erroImp } = await sb
    .from("laudos_senhas_importacoes")
    .select(
      "id, arquivo_nome, total_linhas, total_autorizacoes, importado_por_nome, importado_em_brasilia",
    )
    .order("importado_em", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (erroImp) throw new Error(`falha ao ler laudos_senhas_importacoes: ${erroImp.message}`)
  if (!imp) return null

  const linhas: LinhaAutorizacao[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("laudos_senhas_autorizacoes")
      .select(COLUNAS_AUTORIZACAO)
      .eq("importacao_id", imp.id)
      // Ordem estável: sem ela o laço pula linha entre páginas.
      .order("id_autorizacao", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`falha ao ler laudos_senhas_autorizacoes: ${error.message}`)
    const pagina = (data ?? []) as LinhaAutorizacao[]
    linhas.push(...pagina)
    if (pagina.length < PAGE) break
  }

  // O PostgREST corta em silêncio (HTTP 200) — conferir contra o cabeçalho é o
  // que transforma "metade das senhas sumiu" em erro visível.
  if (linhas.length !== imp.total_autorizacoes) {
    throw new Error(
      `importação de senhas ${imp.id} incompleta: ${linhas.length} de ${imp.total_autorizacoes} autorizações lidas`,
    )
  }

  return {
    importacao: {
      id: imp.id,
      arquivoNome: imp.arquivo_nome,
      totalLinhas: imp.total_linhas,
      totalAutorizacoes: imp.total_autorizacoes,
      importadoPorNome: imp.importado_por_nome,
      importadoEm: imp.importado_em_brasilia,
    },
    autorizacoes: linhas.map(paraAutorizacao),
  }
}

export type ResultadoGravacaoSenhas =
  | {
      duplicado: false
      importacaoId: string
      /**
       * `null` = a função do banco ainda é a anterior à regra de meses fechados
       * (migration 20261001100000 não aplicada): o upload substituiu TODOS os
       * meses. A tela avisa em vez de dizer que eles estão protegidos.
       */
      mesesFechados: MesesFechadosUpload | null
    }
  | {
      duplicado: true
      importacaoId: string
      importadoEm: string | null
      importadoPorNome: string | null
    }

/**
 * Grava uma importação pela RPC `laudos_senhas_importar` (uma transação só).
 * Mesmo conteúdo (sha256) já importado devolve `duplicado`.
 *
 * A regra de meses fechados mora INTEIRA no banco (migration 20261001100000):
 * o mês corrente vem do relógio do banco em Brasília, e o que é de mês fechado
 * é copiado da importação anterior, não deste payload. Daqui só sai o arquivo
 * como veio — nenhum filtro de mês aqui, para não haver duas regras.
 */
export async function gravarImportacaoSenhas(
  entrada: {
    arquivoNome: string
    sha256: string
    totalLinhas: number
    importadoPor: string | null
    importadoPorNome: string
    autorizacoes: AutorizacaoSenha[]
  },
  cliente?: ClienteSupabase,
): Promise<ResultadoGravacaoSenhas> {
  const sb: ClienteSupabase = cliente ?? supabaseService

  // snake_case exatamente como o `jsonb_to_recordset` da função declara. Nada de
  // nome ou CPF: `AutorizacaoSenha` não os tem.
  const payload = entrada.autorizacoes.map((a) => ({
    id_autorizacao: a.idAutorizacao,
    id_laudo: a.idLaudo,
    id_favorecido: a.idFavorecido,
    plano: a.plano || null,
    data_lista: a.dataLista,
    situacao_dentro: a.situacaoDentro || null,
    senha_dentro: a.senhaDentro || null,
    liberacao_dentro: a.liberacaoDentro,
    validade_dentro: a.validadeDentro,
    situacao_fora: a.situacaoFora || null,
    senha_fora: a.senhaFora || null,
    liberacao_fora: a.liberacaoFora,
    validade_fora: a.validadeFora,
    criado_em_origem: a.criadoEmOrigem,
    atualizado_em_origem: a.atualizadoEmOrigem,
    arquivo_autorizacao: a.arquivoAutorizacao || null,
    cronograma_convenio: a.cronogramaConvenio || null,
    observacoes: a.observacoes || null,
    especialidades: a.especialidades.map((e) => ({
      especialidade: e.especialidade,
      grupo: e.grupo,
      quantidade_autorizada: e.quantidadeAutorizada,
      quantidade_solicitada: e.quantidadeSolicitada,
      codigo_guia: e.codigoGuia,
      descricao_guia: e.descricaoGuia,
      em_uso: e.emUso,
    })),
  }))

  const { data, error } = await sb.rpc("laudos_senhas_importar", {
    p_arquivo_nome: entrada.arquivoNome,
    p_arquivo_sha256: entrada.sha256,
    p_total_linhas: entrada.totalLinhas,
    p_importado_por: entrada.importadoPor,
    p_importado_por_nome: entrada.importadoPorNome,
    p_autorizacoes: payload,
  })
  if (error) throw new Error(`falha ao gravar a importação de senhas: ${error.message}`)

  const r = data as {
    duplicado: boolean
    importacao_id: string
    importado_em_brasilia?: string | null
    importado_por_nome?: string | null
    mes_corte?: string
    primeira_importacao?: boolean
    autorizacoes_arquivo?: number
    aplicadas_do_arquivo?: number
    ignoradas_mes_fechado?: number
    mantidas_da_base?: number
    removidas_mes_aberto?: number
  }
  if (r.duplicado) {
    return {
      duplicado: true,
      importacaoId: r.importacao_id,
      importadoEm: r.importado_em_brasilia ?? null,
      importadoPorNome: r.importado_por_nome ?? null,
    }
  }
  // Sem estes campos, a função do banco é a versão ANTERIOR à regra de meses
  // fechados (migration não aplicada) — e ela substituiu tudo, jan–ago
  // inclusive. A gravação já aconteceu: erro aqui diria "falhou" sobre algo que
  // gravou. Devolve `null` e a tela diz a verdade.
  if (r.mes_corte === undefined || r.aplicadas_do_arquivo === undefined) {
    console.warn(
      "[laudos:senhas] laudos_senhas_importar sem a regra de meses fechados — migration 20261001100000 pendente",
    )
    return { duplicado: false, importacaoId: r.importacao_id, mesesFechados: null }
  }
  return {
    duplicado: false,
    importacaoId: r.importacao_id,
    mesesFechados: {
      mesCorte: r.mes_corte,
      primeiraImportacao: r.primeira_importacao ?? false,
      autorizacoesArquivo: r.autorizacoes_arquivo ?? 0,
      aplicadas: r.aplicadas_do_arquivo,
      ignoradas: r.ignoradas_mes_fechado ?? 0,
      mantidas: r.mantidas_da_base ?? 0,
      removidas: r.removidas_mes_aberto ?? 0,
    },
  }
}
