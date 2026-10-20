// Leitura do banco para as regras de Coordenador de Caso (coordenadorCaso.ts).
//
// A carteira é lida da grade das próximas semanas, não só da semana que a
// Ocupação · Paciente carrega: um paciente cuja sessão de coordenação caiu num
// feriado daquela semana sumiria da contagem e o profissional passaria do teto.

import { buscarGrade, fixMojibake } from "@/lib/grade/fonte"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getParametrosGerais } from "@/services/parametrosGerais.service"
import {
  COORDENADOR_CASO, LIMITE_PACIENTES_CC_PADRAO, montarCarteira, type CarteiraCC,
} from "./coordenadorCaso"

/** Dias mínimos de grade lidos para montar a carteira. */
const DIAS_CARTEIRA = 28

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

async function buscarIdsFicticios(): Promise<Set<string>> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("pacientes")
      .select("tita_paciente_id")
      .eq("ficticio", true)
    if (error) return new Set()
    return new Set(
      ((data ?? []) as { tita_paciente_id: number | string | null }[])
        .filter(r => r.tita_paciente_id !== null && r.tita_paciente_id !== undefined)
        .map(r => String(r.tita_paciente_id)),
    )
  } catch {
    return new Set()
  }
}

/**
 * Lê a carteira dos Coordenadores de Caso: linhas Agendado da unidade 280
 * (fonte "atendimentos"), de hoje até o fim da janela da Ocupação — no mínimo
 * DIAS_CARTEIRA dias.
 */
export async function buscarCarteiraCoordenadorCaso(fimJanela: string, hoje = new Date()): Promise<CarteiraCC> {
  const de = isoLocal(hoje)
  const minimo = new Date(hoje)
  minimo.setDate(minimo.getDate() + DIAS_CARTEIRA)
  const ate = fimJanela > isoLocal(minimo) ? fimJanela : isoLocal(minimo)

  const [linhas, idsFicticios] = await Promise.all([
    buscarGrade<{ profissional_nome: string | null; paciente_id: number | null; paciente_nome: string | null }>({
      campos: "id, profissional_nome, paciente_id, paciente_nome",
      fonte: "atendimentos",
      de,
      ate,
      refinar: q => q.eq("terapia_nome", COORDENADOR_CASO),
      ordem: [{ coluna: "data" }, { coluna: "id" }],
    }),
    buscarIdsFicticios(),
  ])

  return montarCarteira(
    linhas.map(r => ({
      profissional: fixMojibake(r.profissional_nome),
      pacienteId: r.paciente_id,
      pacienteNome: fixMojibake(r.paciente_nome),
    })),
    idsFicticios,
  )
}

/** cc_lim_default, ou o padrão quando não há acesso ao parâmetro. */
export async function buscarLimiteCoordenadorCaso(): Promise<number> {
  try {
    const { data } = await getParametrosGerais()
    const v = Number(data?.cc_lim_default)
    return Number.isFinite(v) && v > 0 ? v : LIMITE_PACIENTES_CC_PADRAO
  } catch {
    return LIMITE_PACIENTES_CC_PADRAO
  }
}
