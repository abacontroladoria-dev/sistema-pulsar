// ─── CONSTANTES: MÓDULO OCUPAÇÃO DE PROFISSIONAIS ────────────────────────────

import type { OcupFaixa, OcupSort, OcupCompareSlot } from "@/types/ocupacaoProf"

export const DOW_PT: Record<number, string> = {
  1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb",
}

export const OCUP_FAIXAS: OcupFaixa[] = [
  { k: "todos",   l: "Todos os níveis", min: null, max: null      },
  { k: "80_100",  l: "80% a 100%",      min: 0.80, max: 1.000001  },
  { k: "60_80",   l: "60% a 80%",       min: 0.60, max: 0.80      },
  { k: "40_60",   l: "40% a 60%",       min: 0.40, max: 0.60      },
  { k: "0_40",    l: "0% a 40%",        min: 0.00, max: 0.40      },
]

export const OCUP_SORTS: OcupSort[] = [
  { k: "ocup_desc",  l: "Maior ocupação"   },
  { k: "ocios_desc", l: "Maior ociosidade" },
  { k: "alpha",      l: "A–Z"              },
]

export const OCUP_COMPARE_OPCOES: string[] = [
  "Todos os dias",
  "Comparecem segunda-feira",  "Não comparecem segunda-feira",
  "Comparecem terça-feira",    "Não comparecem terça-feira",
  "Comparecem quarta-feira",   "Não comparecem quarta-feira",
  "Comparecem quinta-feira",   "Não comparecem quinta-feira",
  "Comparecem sexta-feira",    "Não comparecem sexta-feira",
]

export const OCUP_COMPARE_SLOTS: OcupCompareSlot[] = [1, 2, 3, 4, 5].flatMap(dow => [
  { key: `${dow}-Manhã`, dow, turno: "Manhã", label: `${DOW_PT[dow]} - M`, row: "Manhã" },
  { key: `${dow}-Tarde`, dow, turno: "Tarde", label: `${DOW_PT[dow]} - T`, row: "Tarde" },
])
