// ─── Evolução mensal: helpers puros dos gráficos de linha 1A · 5A · Máx ─────
//
// Extraídos de EvolucaoReceitasChart (Previsão de Receitas) para serem
// reaproveitados por EvolucaoMensalChart (Ocupação Clínica e Dashboard de
// Pacientes). Mudar aqui muda os três — a Previsão não pode mudar visualmente.

/**
 * Faixas de período, estilo Google Finance — "1D"/"5D"/"1M"/"YTD" não fazem
 * sentido pra uma série mensal (o menor grão já é 1 mês), por isso só as
 * faixas que cabem nesse grão. `meses: null` = sem corte (mostra tudo).
 */
export type RangeChave = "1A" | "5A" | "MAX"
export const RANGES: { key: RangeChave; label: string; meses: number | null }[] = [
  { key: "1A", label: "1A", meses: 12 },
  { key: "5A", label: "5A", meses: 60 },
  { key: "MAX", label: "Máx", meses: null },
]

export interface AnoMes {
  ano: number
  mes: number
}

/**
 * Janela visível do gráfico — os últimos `meses` pontos da série (contando a
 * partir do último), mas nunca corta o mês selecionado de fora, mesmo que ele
 * fique mais antigo que o corte do range escolhido. Espera `pontos` em ordem
 * cronológica.
 */
export function filtrarPorRange<T extends AnoMes>(pontos: T[], range: RangeChave, mesSelecionado?: AnoMes): T[] {
  const meses = RANGES.find(r => r.key === range)?.meses ?? null
  if (meses === null || pontos.length === 0) return pontos
  const ultimo = pontos[pontos.length - 1]
  let corteChave = ultimo.ano * 12 + ultimo.mes - meses + 1
  if (mesSelecionado) corteChave = Math.min(corteChave, mesSelecionado.ano * 12 + mesSelecionado.mes)
  return pontos.filter(p => p.ano * 12 + p.mes >= corteChave)
}

/** Eixo Y abreviado — número cheio (ex.: "12069") estoura a largura reservada; acima de 1000 abrevia em "k". */
export function formatarTickEixoY(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1).replace(".", ",")}k` : String(v)
}

/** "AAAA-MM" → { ano, mes }. */
export function competenciaParaAnoMes(competencia: string): AnoMes {
  const [ano, mes] = competencia.split("-").map(Number)
  return { ano, mes }
}
