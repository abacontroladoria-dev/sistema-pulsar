import "server-only"

// Situação cadastral do favorecido (paciente) na clínica — "Ativo" ou "Inativo".
//
// Fonte: POST /integracao/csv_situacao_favorecidos (TiTa). Diferente das outras
// duas chamadas em client.ts, esta responde CSV, não JSON — por isso não passa
// por postTita (que faz response.json()). O parsing segue o mesmo formato já
// usado nas Edge Functions que consomem csv_grade_profissionais (ver
// supabase/functions/get-grade-csv): campos entre aspas, aspas escapadas por
// duplicação, e possível BOM no cabeçalho.
//
// Por que existe: o laudo diz o que o paciente PODE receber, não se ele ainda é
// paciente da clínica. Um cadastro inativado continua com laudo autorizado no
// relatório, então sem este cruzamento a modalidade "Criar Novo Cronograma"
// ofereceria montar agenda para quem já saiu.

const TITA_BASE_URL = process.env.TITA_API_URL || "https://apiv2.apptita.com.br/api"

export type SituacaoFavorecido = "Ativo" | "Inativo"

export interface FavorecidoSituacao {
  /** id_favorecido no TiTa — chave de cruzamento com "ID Favorecido" do laudo. */
  id: number | null
  nome: string
  situacao: SituacaoFavorecido
  planoSaude: string
  unidadeNome: string
}

/** Divide uma linha de CSV respeitando campos entre aspas (mesmo parser das Edge Functions). */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let insideQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else insideQuotes = !insideQuotes
    } else if (char === "," && !insideQuotes) {
      result.push(current.trim()); current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

/** "ID Favorecido" → "id favorecido": tolera acento, caixa e separador variados no cabeçalho. */
function normalizarCabecalho(h: string): string {
  return h
    .replace(/^﻿/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Encontra o índice da primeira coluna cujo nome normalizado bate com um dos
 * candidatos. A documentação do TiTa descreve os campos em prosa, não com o
 * nome exato da coluna do CSV, e o endpoint já mudou de schema duas vezes
 * (changelogs 2.10.0 e 2.11.0) — casar por lista de candidatos evita quebrar a
 * cada acréscimo de coluna.
 */
function acharColuna(headers: string[], candidatos: string[]): number {
  for (const c of candidatos) {
    const i = headers.indexOf(c)
    if (i >= 0) return i
  }
  // Segunda passada: aceita coluna que CONTENHA o candidato (ex.: "nome do favorecido").
  for (const c of candidatos) {
    const i = headers.findIndex(h => h.includes(c))
    if (i >= 0) return i
  }
  return -1
}

export interface ResultadoSituacao {
  ok: boolean
  favorecidos: FavorecidoSituacao[]
  erro?: string
}

/**
 * Busca a situação de todos os favorecidos. Sem filtro de situação de propósito:
 * a tela precisa distinguir "inativo" de "não existe" para poder marcar o
 * paciente como bloqueado em vez de simplesmente omiti-lo.
 */
export async function buscarSituacaoFavorecidos(): Promise<ResultadoSituacao> {
  const token = process.env.TITA_TOKEN
  if (!token) {
    console.error("[tita:situacaoFavorecidos] TITA_TOKEN não configurado")
    return { ok: false, favorecidos: [], erro: "token_nao_configurado" }
  }

  const inicio = Date.now()
  let resp: Response
  try {
    resp = await fetch(`${TITA_BASE_URL}/integracao/csv_situacao_favorecidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-INTEGRACAO-TOKEN": token },
      // Todos os filtros do endpoint são opcionais; nenhum é enviado para
      // receber a lista completa.
      body: JSON.stringify({}),
    })
  } catch (err) {
    console.error("[tita:situacaoFavorecidos] falha de rede", err instanceof Error ? err.message : String(err))
    return { ok: false, favorecidos: [], erro: "falha_de_rede" }
  }

  if (!resp.ok) {
    console.error(`[tita:situacaoFavorecidos] TiTa respondeu ${resp.status} (${Date.now() - inicio}ms)`)
    return { ok: false, favorecidos: [], erro: `tita_http_${resp.status}` }
  }

  const csv = await resp.text()
  const linhas = csv.trim().split(/\r?\n/)
  if (linhas.length < 2) {
    console.warn("[tita:situacaoFavorecidos] CSV sem linhas de dados")
    return { ok: true, favorecidos: [] }
  }

  const headers = parseCSVLine(linhas[0]).map(normalizarCabecalho)
  // Cabeçalho real logado uma vez por chamada: é o que permite conferir o schema
  // sem ter o token à mão e ajustar os candidatos abaixo se o TiTa renomear algo.
  console.log("[tita:situacaoFavorecidos] cabeçalho do CSV", JSON.stringify(headers))

  const idxId = acharColuna(headers, ["id favorecido", "id do favorecido", "favorecido id", "id"])
  const idxNome = acharColuna(headers, ["nome favorecido", "nome do favorecido", "favorecido", "nome"])
  const idxSit = acharColuna(headers, ["situacao", "situacao favorecido", "status"])
  const idxPlano = acharColuna(headers, ["plano saude", "plano de saude", "plano", "convenio"])
  const idxUnid = acharColuna(headers, ["nome unidade", "unidade nome", "unidade"])

  if (idxNome < 0 || idxSit < 0) {
    console.error(
      "[tita:situacaoFavorecidos] colunas essenciais ausentes — nome e/ou situação",
      JSON.stringify({ headers, idxNome, idxSit }),
    )
    return { ok: false, favorecidos: [], erro: "schema_inesperado" }
  }

  const favorecidos: FavorecidoSituacao[] = []
  for (let i = 1; i < linhas.length; i++) {
    const v = parseCSVLine(linhas[i])
    if (v.every(x => !x)) continue

    const nome = (v[idxNome] ?? "").trim()
    if (!nome) continue

    const idBruto = idxId >= 0 ? Number((v[idxId] ?? "").replace(/\D/g, "")) : NaN
    // Só "Inativo" explícito inativa: qualquer outro valor (inclusive vazio ou
    // um status novo que o TiTa venha a criar) é tratado como ativo, para não
    // bloquear paciente válido por causa de dado inesperado.
    const situacao: SituacaoFavorecido =
      (v[idxSit] ?? "").trim().toLowerCase().startsWith("inativ") ? "Inativo" : "Ativo"

    favorecidos.push({
      id: Number.isFinite(idBruto) && idBruto > 0 ? idBruto : null,
      nome,
      situacao,
      planoSaude: idxPlano >= 0 ? (v[idxPlano] ?? "").trim() : "",
      unidadeNome: idxUnid >= 0 ? (v[idxUnid] ?? "").trim() : "",
    })
  }

  const inativos = favorecidos.filter(f => f.situacao === "Inativo").length
  console.log(
    `[tita:situacaoFavorecidos] ${favorecidos.length} favorecidos (${inativos} inativos) em ${Date.now() - inicio}ms`,
  )
  return { ok: true, favorecidos }
}
