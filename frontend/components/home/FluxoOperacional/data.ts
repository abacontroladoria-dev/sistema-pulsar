// 13 slots de 40 min: 08:00–11:20 (manha) e 13:00–17:00 (tarde, última sessão termina 17:40)
export const TIME_SLOTS = [
  "08:00", "08:40", "09:20", "10:00", "10:40", "11:20",
  "13:00", "13:40", "14:20", "15:00", "15:40", "16:20", "17:00",
] as const

export interface FluxoSlotPoint {
  slot: string
  realengo: number
  fazendinha: number
  padreMiguel: number
}

export interface FluxoUnitCount {
  realengo: number | null
  fazendinha: number | null
  padreMiguel: number | null
  total: number | null
}

// Encaixa as linhas de get_fluxo_slots() nos 13 slots do gráfico.
//
// A grade tem horarios FORA da malha de 40 min (vistos em 14/09: 09:00, 11:00,
// 14:00 e 16:00, todos de Padre Miguel). Descartá-los faria as barras somarem
// menos que o KPI "Total de atendimentos" na mesma tela, entao cada horario e'
// somado ao slot iniciado mais recentemente — nada se perde.
export function fitToTimeSlots(
  rows: { slot: string; realengo: number; fazendinha: number; padreMiguel: number }[],
): FluxoSlotPoint[] {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number)
    return h * 60 + m
  }
  const slotMins = TIME_SLOTS.map(toMin)

  const acc: Record<string, FluxoSlotPoint> = {}
  for (const slot of TIME_SLOTS) {
    acc[slot] = { slot, realengo: 0, fazendinha: 0, padreMiguel: 0 }
  }

  for (const row of rows) {
    const min = toMin(row.slot)
    // Último slot cujo início já passou; antes do primeiro, cai no primeiro.
    let idx = 0
    for (let i = 0; i < slotMins.length; i++) {
      if (slotMins[i] <= min) idx = i
    }
    acc[TIME_SLOTS[idx]].realengo += row.realengo
    acc[TIME_SLOTS[idx]].fazendinha += row.fazendinha
    acc[TIME_SLOTS[idx]].padreMiguel += row.padreMiguel
  }

  return TIME_SLOTS.map((slot) => acc[slot])
}

export const UNIT_COLORS = {
  realengo: "#3B82F6",
  fazendinha: "#8B5CF6",
  padreMiguel: "#10B981",
  media: "#94A3B8",
} as const

export function getMostActiveUnit(atendimentos: FluxoUnitCount | null): { label: string; total: number } {
  if (!atendimentos) return { label: "—", total: 0 }
  const entries: [string, number][] = [
    ["Realengo", atendimentos.realengo ?? 0],
    ["Fazendinha", atendimentos.fazendinha ?? 0],
    ["Padre Miguel", atendimentos.padreMiguel ?? 0],
  ]
  const [label, total] = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
  return { label, total }
}

export function getPeakSlot(data: FluxoSlotPoint[]): { slot: string; total: number } {
  return data.reduce(
    (peak, d) => {
      const total = d.realengo + d.fazendinha + d.padreMiguel
      return total > peak.total ? { slot: d.slot, total } : peak
    },
    { slot: "", total: 0 },
  )
}

export function getDailyAverage(data: FluxoSlotPoint[]): number {
  const allValues = data.flatMap((d) => [d.realengo, d.fazendinha, d.padreMiguel])
  if (!allValues.length) return 0
  return Math.round(allValues.reduce((s, v) => s + v, 0) / allValues.length)
}

// ─── Current slot ─────────────────────────────────────────────────────────────

export function getCurrentSlotKey(): string | null {
  const now = new Date()
  const h = now.getHours()
  const m = now.getMinutes()
  const totalMin = h * 60 + m

  const slotMins = [
    8 * 60, 8 * 60 + 40, 9 * 60 + 20, 10 * 60, 10 * 60 + 40, 11 * 60 + 20,
    13 * 60, 13 * 60 + 40, 14 * 60 + 20, 15 * 60, 15 * 60 + 40, 16 * 60 + 20, 17 * 60,
  ]

  for (let i = 0; i < slotMins.length; i++) {
    const start = slotMins[i]
    const end = i + 1 < slotMins.length ? slotMins[i + 1] : 17 * 60 + 40
    if (totalMin >= start && totalMin < end) {
      const sh = Math.floor(start / 60)
      const sm = start % 60
      return `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`
    }
  }
  return null
}
