// ─── Ponto único de leitura da grade ────────────────────────────────────────
//
// Toda leitura da grade sincronizada da TiTa passa por aqui. Antes eram 14
// consultas em 8 arquivos, cada uma reescrevendo o mesmo laço de paginação e
// repetindo — ou esquecendo — os mesmos filtros. O que se ganha concentrando:
//
//   • `ativo = true` deixa de ser responsabilidade de quem escreve a consulta.
//     Esquecê-lo conta uma sessão remarcada duas vezes; em remuneração, paga
//     em dobro. Já estava ausente em convenioValores.service.ts.
//   • `profissional_cpf` some de toda leitura da aplicação, porque a view não
//     projeta a coluna. Não fecha o pendente de SECURITY_CHECKLIST.md — as
//     views são security_invoker e a tabela continua legível direto — mas é o
//     passo que torna possível revogar aquele acesso sem quebrar tela.
//   • O laço `while (true) { … range(from, from + PAGE - 1) }`, hoje copiado em
//     seis arquivos com pequenas variações de ordenação, existe uma vez só.
//
// A separação entre as duas fontes é deliberada e não deve ser desfeita:
//
//   "atendimentos" (vw_grade_atendimentos) — Agendado + unidade 280. O que
//       quase todo mundo quer dizer por "a grade". Padrão.
//   "base"         (vw_grade_base)         — sem recorte de unidade ou status.
//       Necessária para dois casos legítimos: o Comparativo de Sessões, que
//       precisa de TODAS as unidades, e a busca de reposição, que consulta
//       exclusivamente slots 'Livre'.
//
// Leituras que continuam fora daqui, de propósito:
//   • buscarGradePorId / agendamento-terapia-tita — buscam UMA linha por UUID
//     para montar o payload da TiTa e precisam de `sala_id`, que a view não
//     projeta. Continuam na tabela.
//   • sync-grade-csv — é o escritor.

import { getSupabaseClient } from "@/lib/supabase/client"
import { decodeEntidadesHtml } from "@/lib/cronograma/constants"

/** Nome da view por trás de cada fonte. Único lugar do frontend que os conhece. */
export const VIEW_POR_FONTE = {
  atendimentos: "vw_grade_atendimentos",
  base: "vw_grade_base",
} as const

export type FonteGrade = keyof typeof VIEW_POR_FONTE

/** View de valores distintos para os selects de cadastro — ver buscarOpcoesGrade(). */
export const VIEW_OPCOES = "vw_grade_opcoes"

/**
 * View do que as outras escondem — ver `medirSaudeGrade()`.
 *
 * Fora de `VIEW_POR_FONTE` de propósito: a projeção é enxuta e NÃO é
 * intercambiável com as outras duas. `buscarGrade` promete que trocar `fonte`
 * troca o recorte sem mudar as colunas disponíveis, e essa promessa vale mais do
 * que reaproveitar o laço de paginação.
 */
export const VIEW_INATIVAS = "vw_grade_inativas"

/** Tabela crua — só para as leituras por UUID citadas no cabeçalho. */
export const TABELA_GRADE = "csv_grades_profissionais"

const PAGE = 1000

// Padrão de dupla codificação UTF-8 (mojibake): byte líder C2/C3 seguido de byte
// de continuação (80–BF). Ex.: "Araújo" gravado como "AraÃºjo".
const MOJIBAKE_RE = /[Â-Ã][-¿]/

/**
 * Repara texto com dupla codificação UTF-8. Só atua quando o padrão está
 * presente, para não corromper texto já correto.
 *
 * Hoje é efetivamente no-op: medido contra produção, zero assinaturas de
 * mojibake nos cinco campos de texto, contra 3.495 linhas com "ã" correto e
 * 2.492 com "ç" correto. Mantido porque o custo é um teste de regex e a
 * garantia de que a API nunca mais devolverá texto malformado não existe.
 */
function fixMojibakeSemEntidades(s: string | null | undefined): string {
  const str = s ?? ""
  if (!str || !MOJIBAKE_RE.test(str)) return str
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(
      Uint8Array.from(str, c => c.charCodeAt(0) & 0xff),
    )
  } catch {
    return str
  }
}

/**
 * Repara texto vindo da sincronização da grade: dupla codificação UTF-8
 * (mojibake, ver fixMojibakeSemEntidades acima) E entidades HTML cruas (ex.:
 * "D&#039;avila" — ver decodeEntidadesHtml em lib/cronograma/constants.ts).
 * São dois problemas independentes que podem aparecer juntos no mesmo nome.
 */
export function fixMojibake(s: string | null | undefined): string {
  return decodeEntidadesHtml(fixMojibakeSemEntidades(s))
}

/** Coluna a ordenar; `desc` inverte. Sem isto a paginação pode pular ou repetir linhas. */
export interface OrdemGrade {
  coluna: string
  desc?: boolean
}

// O builder do PostgREST não tem um tipo público estável que sobreviva a
// `.eq().gte().order()` encadeados; o projeto já usa `any` nesses pontos (ver
// gradeService.ts). Isolado aqui, some dos chamadores.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryGrade = any

export interface BuscaGrade {
  /** Lista de colunas do PostgREST. Peça só o que for usar. */
  campos: string
  /** Padrão: "atendimentos" (Agendado + unidade 280). */
  fonte?: FonteGrade
  /** Recorte de data, inclusivo nas duas pontas. */
  de?: string
  ate?: string
  /**
   * Só na fonte "base": restringe a unidade. `undefined` = todas as unidades.
   * Na fonte "atendimentos" a unidade 280 já vem da view.
   */
  unidade?: number
  /** Só na fonte "base": 'Livre', 'Agendado', ou uma lista. */
  status?: string | readonly string[]
  /** Ordenação. Sempre termine por uma coluna única (`id`) quando paginar. */
  ordem?: readonly OrdemGrade[]
  /** Filtros que não cabem nos campos acima (ilike, not, gt…). */
  refinar?: (q: QueryGrade) => QueryGrade
  /**
   * Cliente Supabase. Padrão: o cliente de browser. Passe explicitamente em
   * código de servidor ou quando precisar da service role.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cliente?: any
  /**
   * Teto de linhas. Sem isto a busca pagina até o fim — que é o certo para
   * consulta com recorte de data, e perigoso para consulta sem.
   */
  limite?: number
}

/**
 * Busca linhas da grade, paginando até o fim (ou até `limite`).
 *
 * Pagina porque o PostgREST corta em 1.000 linhas por resposta e a tabela tem
 * ~148 mil: uma consulta de mês inteiro sem paginação devolve resultado
 * silenciosamente truncado, que foi o defeito original de
 * buscarTerapiasDoProfissional.
 */
export async function buscarGrade<T>(cfg: BuscaGrade): Promise<T[]> {
  const sb = cfg.cliente ?? getSupabaseClient()
  const view = VIEW_POR_FONTE[cfg.fonte ?? "atendimentos"]
  const todas: T[] = []

  let from = 0
  while (true) {
    const tamanho = cfg.limite ? Math.min(PAGE, cfg.limite - todas.length) : PAGE
    if (tamanho <= 0) break

    let q: QueryGrade = sb.from(view).select(cfg.campos)

    if (cfg.de) q = q.gte("data", cfg.de)
    if (cfg.ate) q = q.lte("data", cfg.ate)
    if (cfg.unidade !== undefined) q = q.eq("unidade_id", cfg.unidade)
    if (typeof cfg.status === "string") q = q.eq("status_agendamento", cfg.status)
    else if (Array.isArray(cfg.status)) q = q.in("status_agendamento", cfg.status)
    if (cfg.refinar) q = cfg.refinar(q)

    for (const o of cfg.ordem ?? []) q = q.order(o.coluna, { ascending: !o.desc })

    const { data, error } = await q.range(from, from + tamanho - 1)
    if (error) throw new Error(error.message)

    const linhas = (data ?? []) as T[]
    todas.push(...linhas)
    if (linhas.length < tamanho) break
    from += tamanho
  }

  return todas
}

/** O que falta na grade de um período. Ver `medirSaudeGrade()`. */
export interface SaudeGrade {
  /** Linhas fora da grade, sem versão ativa no lugar e sem ausência confirmada. */
  inativas: number
  /**
   * Destas, as que eram atendimento ('Agendado'). Slot 'Livre' perdido não custa
   * nada; sessão agendada perdida é folha a menos. Em julho/2026: 38 de 38.
   */
  inativasAgendadas: number
}

/**
 * Quantas sessões do período sumiram da grade por inativação.
 *
 * Existe porque toda guarda de qualidade que tínhamos media a grade por dentro —
 * contava `status_execucao` nulo entre as linhas que existem. Uma linha
 * inativada não é uma linha com campo vazio: ela simplesmente não está lá, e
 * nenhuma contagem interna a enxerga. Julho/2026 passou com 98,9% de cobertura e
 * R$ 490,00 a menos na folha, porque 25 sessões realizadas estavam escondidas
 * atrás de `ativo = false`.
 *
 * Três recortes, e cada um existe porque um alarme falso já apareceu sem ele:
 *
 *   `tem_substituta_ativa = false` — inativa com gêmea ativa é o versionamento
 *     funcionando, a sessão continua na grade. Sem isto, as 5 versionadas de
 *     julho manteriam o alarme aceso para sempre.
 *
 *   `ausencia_confirmada_em is null` — a reconciliação diária pergunta à TiTa e
 *     carimba o que ela confirma não ter mais. Alta de paciente retira dezenas
 *     de sessões de uma vez, legitimamente: em agosto/2026 um único paciente
 *     respondeu por 59 delas. Contá-las travaria o mês para sempre.
 *
 *   `data <= hoje` — sessão futura cancelada não é perda, é agenda mudando.
 *     Não há o que pagar nela. Mesmo critério de CoberturaGrade.agendados.
 *
 * O que sobra é a pergunta certa: sessão que já aconteceu, sumiu da grade e
 * ninguém conferiu contra a TiTa. Em regime normal isso é zero em até 24h.
 *
 * Duas requisições HEAD com `count=exact`: não traz linha nenhuma, só o número.
 */
export async function medirSaudeGrade(
  de: string, ate: string, unidade?: number, cliente?: unknown, hoje = new Date(),
): Promise<SaudeGrade> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = cliente ?? getSupabaseClient()

  const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`
  const limite = ate < iso ? ate : iso
  if (limite < de) return { inativas: 0, inativasAgendadas: 0 }

  const contar = async (soAgendadas: boolean) => {
    let q = sb.from(VIEW_INATIVAS).select("id", { count: "exact", head: true })
      .gte("data", de)
      .lte("data", limite)
      .eq("tem_substituta_ativa", false)
      .is("ausencia_confirmada_em", null)
    if (unidade !== undefined) q = q.eq("unidade_id", unidade)
    if (soAgendadas) q = q.eq("status_agendamento", "Agendado")
    const { count, error } = await q
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  const [inativas, inativasAgendadas] = await Promise.all([contar(false), contar(true)])
  return { inativas, inativasAgendadas }
}

/** Quão recente é a captura da grade de um período FUTURO. Ver `medirFrescorGrade()`. */
export interface FrescorGrade {
  /**
   * Instante em que a TiTa confirmou pela última vez alguma linha do período
   * (o `visto_em` mais recente). `null` quando o período não tem nenhuma linha.
   */
  visto: string | null
  /** Horas decorridas desde `visto`. `null` junto com ele. */
  horas: number | null
  /**
   * `true` quando a captura passou de `horasLimite`. É o sinal de "a tela está
   * mostrando um retrato velho" — nunca "a agenda está parada".
   */
  desatualizado: boolean
}

/** Acima disto a captura é velha o bastante para a tela avisar. Ver `medirFrescorGrade()`. */
export const HORAS_FRESCOR_GRADE = 48

/**
 * Há quanto tempo a grade de um período futuro não é reconfirmada pela TiTa.
 *
 * É o espelho de `medirSaudeGrade()`, que por desenho só olha o passado
 * (`data <= hoje`): mede o que sumiu de datas já ocorridas. Nenhuma das duas
 * enxergava a falha de 10/09/2026 — o sync da grade rodava todo dia, pedia ~60
 * dias de uma vez, morria por falta de compute e não escrevia nada no futuro. O
 * cron descarta a resposta HTTP, então a falha foi diária e silenciosa por 9
 * dias, com `csv_grades_profissionais` congelado em 01/09 para toda data futura.
 *
 * O que isso custou, medido na janela que a Ocupação de Paciente usa (01–07/10):
 * 134 sessões reais invisíveis (57 pacientes) e 169 horários oferecidos que já
 * não existiam. A tela não tinha como saber — e é isso que esta função conserta.
 *
 * Lê `visto_em` da TABELA, não das views: nenhuma das duas projeta a coluna, e
 * `visto_em` é justamente "a última vez que a TiTa confirmou esta linha" (ver o
 * cabeçalho de sync-grade-csv). Uma requisição, uma linha, ordenada desc.
 *
 * NÃO é alarme de agenda vazia: período sem nenhuma linha devolve
 * `desatualizado: false`, porque aí não há o que reconfirmar e o silêncio é
 * legítimo. O alarme é só para "existe grade, e ela está velha".
 */
export async function medirFrescorGrade(
  de: string, ate: string, unidade?: number, cliente?: unknown,
  agora = new Date(), horasLimite = HORAS_FRESCOR_GRADE,
): Promise<FrescorGrade> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = cliente ?? getSupabaseClient()

  let q = sb.from(TABELA_GRADE)
    .select("visto_em")
    .gte("data", de)
    .lte("data", ate)
    .eq("ativo", true)
    .order("visto_em", { ascending: false })
    .limit(1)
  if (unidade !== undefined) q = q.eq("unidade_id", unidade)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const visto = (data ?? [])[0]?.visto_em ?? null
  if (!visto) return { visto: null, horas: null, desatualizado: false }

  const horas = (agora.getTime() - new Date(visto).getTime()) / 3_600_000
  return { visto, horas, desatualizado: horas > horasLimite }
}

/** Uma opção de formulário vinda da agenda real. `id` é null para convênio (a fonte só tem nome). */
export interface OpcaoGrade {
  id: number | null
  nome: string
}

export interface OpcoesGrade {
  convenios: OpcaoGrade[]
  terapias: OpcaoGrade[]
  pacientes: OpcaoGrade[]
}

/**
 * Convênios, terapias e pacientes distintos vistos na agenda real — as opções
 * dos formulários de cadastro de valores, que nunca aceitam texto livre.
 *
 * UMA requisição a `vw_grade_opcoes`, que já vem deduplicada do banco. Antes
 * isto era a paginação da grade inteira, três vezes (uma por lista): em
 * produção ~444 requisições, cada uma refazendo um seq scan completo de ~148
 * mil linhas, porque OFFSET não pula leitura. São ~500 linhas no total — o
 * trabalho estava todo em transportar duplicata.
 *
 * NÃO filtra paciente fictício: `isFakePatient` casa por prefixo e vive em
 * lib/remuneracao/pacientes, compartilhado com o cálculo de remuneração. Quem
 * chama aplica.
 */
export async function buscarOpcoesGrade(cliente?: unknown): Promise<OpcoesGrade> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = cliente ?? getSupabaseClient()
  const { data, error } = await sb
    .from(VIEW_OPCOES)
    .select("tipo, id, nome")
  if (error) throw new Error(error.message)

  const out: OpcoesGrade = { convenios: [], terapias: [], pacientes: [] }
  const destino = { convenio: out.convenios, terapia: out.terapias, paciente: out.pacientes }

  for (const r of (data ?? []) as { tipo: string; id: number | null; nome: string | null }[]) {
    const lista = destino[r.tipo as keyof typeof destino]
    const nome = fixMojibake(r.nome).trim()
    if (!lista || !nome) continue
    lista.push({ id: r.id ?? null, nome })
  }

  for (const lista of Object.values(destino)) {
    lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  }
  return out
}
