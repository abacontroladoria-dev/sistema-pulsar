import "server-only"

// ─── SEM CHAMADOR desde 2026-07-17 — mantido de propósito ───────────────────
//
// Esta é a busca de laudos na API do TI (cronogramauniversoaba.com.br),
// paciente a paciente. Ela deixou de ser chamada em 17/07/2026, quando a API
// saiu do ar e o upload manual do Excel voltou a ser o fluxo principal; em
// 27/08/2026 a origem passou a ser o relatório do Órbita gravado no Supabase
// pelo robô do Coolify (services/laudos/relatorio.ts), e /api/laudos foi
// religada apontando para lá.
//
// Por que não apagar agora: é a única segunda opção pronta se o robô do Coolify
// cair de vez. O custo de manter é zero (nada importa este arquivo, ele não
// entra em bundle nenhum) e o de reescrever, alto.
//
// REAVALIAR EM 27/09/2026 — um ciclo. Se até lá a leitura do relatório estiver
// estável e ninguém tiver precisado deste caminho, apagar este arquivo e
// ./types.ts. O que NÃO se apaga junto: `desfazerMerges` e `parseXlsx` em
// CronogramaDataLayout.tsx, que são do fallback manual e continuam em uso.

import { supabaseService } from "@/lib/supabase/service"
import { buscarGrade } from "@/lib/grade/fonte"
import type { LaudoRow } from "@/types/cronograma"
import type { PacienteLaudosApi, ErroLaudosApi } from "./types"

// Confirmado com o TI: só existem "GET /laudos?paciente_id=$id" e
// "GET ?endpoint=laudos&paciente_id=$id" — não há endpoint de listagem em lote
// (testado: "all", "*", lista separada por vírgula e array[] retornam erro
// "paciente_id inválido"). Por isso a lista de pacientes vem daqui, não da API.
const LAUDOS_API_URL = process.env.LAUDOS_API_URL || "https://cronogramauniversoaba.com.br/api_laudos/"

// Quantas chamadas simultâneas à API de laudos — evita derrubar o serviço do TI
// com ~300 requisições de uma vez só (cada chamada leva ~350ms isolada).
const CONCORRENCIA = 20

function isErro(data: unknown): data is ErroLaudosApi {
  return !!data && typeof data === "object" && "erro" in data
}

async function buscarLaudosPaciente(pacienteId: number): Promise<PacienteLaudosApi | null> {
  const url = `${LAUDOS_API_URL}?endpoint=laudos&paciente_id=${pacienteId}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`[laudos:client] paciente_id=${pacienteId} falhou (status ${response.status})`)
    return null
  }
  const data = await response.json().catch(() => null)
  if (!data || isErro(data)) {
    if (isErro(data)) console.warn(`[laudos:client] paciente_id=${pacienteId}: ${data.erro}`)
    return null
  }
  return data as PacienteLaudosApi
}

/**
 * IDs de pacientes com pelo menos uma linha "Agendado" no período — mesma fonte
 * usada por resolverIdFavorecido (services/tita/mappings.ts) para mapear
 * nome → paciente_id no TiTa. Substitui o upload manual do Excel de laudos como
 * origem da lista de pacientes a consultar.
 *
 * Roda com service role, então o cliente é passado explicitamente.
 */
async function listarIdsPacientesAtivos(dataInicio: string, dataFim: string): Promise<number[]> {
  // "atendimentos" já é Agendado + unidade 280 — exatamente o recorte de antes.
  const linhas = await buscarGrade<{ paciente_id: number }>({
    campos: "paciente_id",
    de: dataInicio,
    ate: dataFim,
    refinar: q => q.not("paciente_id", "is", null),
    // Sem ordenação estável a paginação pode pular linha, e uma linha pulada é
    // um paciente inteiro sem laudo consultado. `id` basta por ser a PK.
    ordem: [{ coluna: "id" }],
    cliente: supabaseService,
  })
  return Array.from(new Set(linhas.map(r => r.paciente_id)))
}

function achatarPaciente(paciente: PacienteLaudosApi): LaudoRow[] {
  const rows: LaudoRow[] = []
  // A API retorna o histórico completo de laudos do paciente (inclusive vencidos/substituídos)
  // — "laudo_em_uso" é o único que vale hoje. Sem esse filtro, especialidades repetidas em
  // laudos antigos (com qtd_autorizada diferente) contaminam o Math.max() usado rio abaixo.
  for (const laudo of paciente.laudos.filter(l => l.laudo_em_uso)) {
    for (const esp of laudo.especialidades) {
      rows.push({
        "Paciente": paciente.nome_paciente,
        "Plano": paciente.plano ?? "",
        "Data nasc.": paciente.data_nascimento ?? "",
        "Autorizado em": laudo.autorizado_em ?? "",
        "Comp. agressivo": laudo.comportamento_agressivo ? "Sim" : "Não",
        "Especialidade": esp.especialidade,
        "Qtd autorizada": esp.qtd_autorizada,
        // Relatório da API já é "laudos em uso" — equivalente a "Vigente" no Excel antigo.
        "Situação": "Vigente",
        "Alta": esp.alta ? "Sim" : "Não",
        "ID Favorecido": paciente.paciente_id,
        "ID Laudo": laudo.id_laudo,
      })
    }
  }
  return rows
}

async function mapComConcorrencia<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length)
  let indice = 0
  async function worker() {
    while (indice < items.length) {
      const i = indice++
      resultados[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker))
  return resultados
}

/** Ponto único de entrada — busca laudos de todos os pacientes ativos no período e achata em LaudoRow[]. */
export async function buscarTodosLaudos(dataInicio: string, dataFim: string): Promise<LaudoRow[]> {
  const ids = await listarIdsPacientesAtivos(dataInicio, dataFim)
  console.log(`[laudos:client] ${ids.length} pacientes ativos no período ${dataInicio}..${dataFim}`)

  const resultados = await mapComConcorrencia(ids, CONCORRENCIA, buscarLaudosPaciente)
  const encontrados = resultados.filter((r): r is PacienteLaudosApi => r !== null)
  console.log(`[laudos:client] ${encontrados.length}/${ids.length} pacientes com laudo encontrado na API`)

  return encontrados.flatMap(achatarPaciente)
}
