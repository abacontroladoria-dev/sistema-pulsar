import "server-only"

import type { LinhaGradeTita } from "@/lib/cronograma/conferenciaTita"

// Grade do TiTa lida NA HORA — GET /integracao/grade_profissionais, o mesmo
// endpoint que sync_tita_grade copia para grade_profissionais_tita de madrugada.
// Só lê; nada é enviado ao TiTa. Por que existe: ver lib/cronograma/conferenciaTita.ts.
//
// UM DIA POR CHAMADA, em paralelo. Medido em 20/10/2026: 1 dia ~4s, 5 dias numa
// chamada só ~17s, os mesmos 5 dias em 5 chamadas paralelas ~7s. O endpoint
// ignora filtro por profissional (testado com profissional_id e
// id_profissional: devolve a unidade inteira), então não há como encolher a
// resposta — só dividi-la.
//
// TUDO OU NADA: se um dia falha, a leitura inteira falha. Meia grade seria pior
// que nenhuma — a regra C2 (gradeTitaOcupacao.ts) lê "profissional sem linha"
// como "sem grade aberta" e esconderia a agenda de quem caiu no dia que faltou.

const TITA_BASE_URL = process.env.TITA_API_URL || "https://apiv2.apptita.com.br/api"
const UNIDADE = 280
/** Teto de dias por leitura: a janela da Ocupação de Paciente tem 7. */
export const MAX_DIAS_AO_VIVO = 10
// Um dia volta em 4–7s (medido). Acima disso o TiTa está com problema, e quem
// espera é uma atendente com a tela travada: melhor cair na cópia.
const TIMEOUT_DIA_MS = 25_000

/**
 * Leituras repetidas em poucos minutos (várias atendentes abrindo a tela, ou a
 * mesma recarregando) reaproveitam a anterior. Curto de propósito: a razão de
 * ler ao vivo é não servir dado velho. A implantação nunca usa o cache.
 */
const TTL_MS = 3 * 60 * 1000
const cache = new Map<string, { em: number; leitura: Promise<ResultadoGradeAoVivo> }>()

export type ResultadoGradeAoVivo =
  | { ok: true; linhas: LinhaGradeTita[]; lidoEm: string }
  | { ok: false; erro: string }

function getTitaToken(): string {
  const token = process.env.TITA_TOKEN
  if (!token) throw new Error("Variável de ambiente TITA_TOKEN não configurada")
  return token
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Dias de `desde` a `ate`, inclusive. Aritmética em UTC: calendário, sem fuso. */
export function diasEntre(desde: string, ate: string): string[] {
  if (!ISO.test(desde) || !ISO.test(ate) || desde > ate) return []
  const dias: string[] = []
  const [a, m, d] = desde.split("-").map(Number)
  for (let i = 0; ; i++) {
    const dia = new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10)
    if (dia > ate || dias.length > MAX_DIAS_AO_VIVO) break
    dias.push(dia)
  }
  return dias
}

const toInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10)
  return Number.isFinite(n) ? n : null
}

async function lerDia(dia: string): Promise<LinhaGradeTita[]> {
  const url = new URL(`${TITA_BASE_URL}/integracao/grade_profissionais`)
  url.searchParams.set("data_inicio", dia)
  url.searchParams.set("data_fim", dia)

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-INTEGRACAO-TOKEN": getTitaToken() },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_DIA_MS),
  })
  // Corpo de erro do TiTa traz caminho interno do servidor deles: fica no log,
  // nunca sobe para quem chamou (mesma regra de client.ts).
  if (!resp.ok) {
    console.error(`[tita:gradeAoVivo] ${dia}: HTTP ${resp.status}`, (await resp.text().catch(() => "")).slice(0, 500))
    throw new Error(`TiTa respondeu ${resp.status} para ${dia}`)
  }

  const bruto = await resp.json() as unknown
  if (!Array.isArray(bruto)) throw new Error(`Resposta inesperada do TiTa para ${dia}`)

  const linhas: LinhaGradeTita[] = []
  for (const g of bruto as Record<string, unknown>[]) {
    if (toInt(g.id_unidade) !== UNIDADE) continue
    const profissionalId = toInt(g.profissional_id ?? g.id_profissional)
    const data = String(g.data ?? "").slice(0, 10)
    const hora = String(g.hora_inicial ?? "")
    if (profissionalId === null || !ISO.test(data) || !hora) continue
    linhas.push({
      profissional_id: profissionalId,
      data,
      hora_inicial: hora,
      status_agendamento: (g.status_agendamento as string | null) ?? null,
      id_sala: toInt(g.id_sala),
      sala: (g.sala as string | null) ?? null,
      grade_terapeuta_id: toInt(g.grade_terapeuta_id),
    })
  }
  return linhas
}

async function lerPeriodo(dias: string[]): Promise<ResultadoGradeAoVivo> {
  const inicio = Date.now()
  try {
    const porDia = await Promise.all(dias.map(lerDia))
    const linhas = porDia.flat()
    console.log(`[tita:gradeAoVivo] ${dias[0]}..${dias[dias.length - 1]} linhas=${linhas.length} duracaoMs=${Date.now() - inicio}`)
    return { ok: true, linhas, lidoEm: new Date().toISOString() }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    console.error(`[tita:gradeAoVivo] falhou ${dias[0]}..${dias[dias.length - 1]} duracaoMs=${Date.now() - inicio}`, erro)
    return { ok: false, erro }
  }
}

/**
 * Grade do TiTa de `desde` a `ate` (inclusive, no máximo MAX_DIAS_AO_VIVO dias),
 * com o cache curto acima. Para a OFERTA na tela; quem vai escrever no TiTa usa
 * `buscarGradeTitaAoVivoNosDias`, que nunca usa cache.
 */
export async function buscarGradeTitaAoVivo(desde: string, ate: string): Promise<ResultadoGradeAoVivo> {
  const dias = diasEntre(desde, ate)
  if (dias.length === 0) return { ok: false, erro: "periodo_invalido" }
  if (dias.length > MAX_DIAS_AO_VIVO) return { ok: false, erro: "periodo_longo_demais" }

  const chave = dias.join("|")
  const agora = Date.now()
  const guardada = cache.get(chave)
  if (guardada && agora - guardada.em < TTL_MS) return guardada.leitura

  // Guarda a PROMESSA, não o resultado: duas telas abrindo juntas dividem a
  // mesma leitura em vez de dispararem duas.
  const leitura = lerPeriodo(dias)
  cache.set(chave, { em: agora, leitura })
  const r = await leitura
  // Falha não fica no cache: a próxima tentativa tenta de novo.
  if (!r.ok && cache.get(chave)?.leitura === leitura) cache.delete(chave)
  return r
}

/**
 * Grade do TiTa só nos dias pedidos (repetidos e fora de ordem são aceitos),
 * sempre lida agora, sem cache. É o que a implantação usa logo antes de gravar:
 * as sessões de um pacote caem em poucos dias da semana, e ler o intervalo
 * inteiro entre elas seria pagar por dia que ninguém pediu.
 */
export async function buscarGradeTitaAoVivoNosDias(dias: string[]): Promise<ResultadoGradeAoVivo> {
  const distintos = [...new Set(dias.map(d => String(d ?? "").slice(0, 10)))].sort()
  if (distintos.length === 0 || distintos.some(d => !ISO.test(d))) return { ok: false, erro: "periodo_invalido" }
  if (distintos.length > MAX_DIAS_AO_VIVO) return { ok: false, erro: "periodo_longo_demais" }
  return lerPeriodo(distintos)
}
