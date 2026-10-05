// ─── CONVÊNIO PELO CADASTRO DA TITA ───────────────────────────────────────────
// Fonte única do convênio de um paciente para os indicadores. `convenio_nome` de
// csv_grades_profissionais é dado do AGENDAMENTO: quando o cadastro do paciente
// troca de convênio, a agenda pode continuar com o antigo (caso real: paciente
// 22386, agenda "Particular", cadastro "LEVE SAUDE", out/2026). O cadastro vem
// de POST /integracao/csv_situacao_favorecidos (coluna "Plano de Saúde"),
// exposto em GET /api/tita/situacao-favorecidos.
//
// A contagem (sessões, CH, dia, sala) continua vindo da grade — o cadastro não
// tem nada disso. Só a CHAVE de convênio troca de fonte, e só quando o cadastro
// responde de forma inequívoca para aquele paciente; em qualquer dúvida vale o
// convênio da agenda, exatamente como antes.
//
// Hoje só o Dashboard de Pacientes usa este módulo. A Previsão de Receitas deve
// passar a usar ESTE mesmo módulo (e não uma cópia da regra) para as duas telas
// nunca discordarem do convênio de um paciente.

import { cleanTxt } from "./helpers"
import type { AgendaSalaRow } from "./salasTypes"

/** Recorte do que GET /api/tita/situacao-favorecidos devolve por paciente. */
export interface FavorecidoCadastroCliente {
  id: number | null
  nome: string
  situacao: "Ativo" | "Inativo"
  planoSaude: string
}

export type FonteConvenio = "cadastro" | "agenda"

export interface MapaConvenioCadastro {
  /** id_favorecido → plano de saúde do cadastro (texto como a TiTa escreve). */
  porPacienteId: Map<number, string>
  /**
   * IDs que apareceram mais de uma vez com planos diferentes. O parser do CSV
   * divide por quebra de linha antes de olhar aspas, então uma quebra dentro de
   * "Observações do Favorecido" poderia gerar uma linha-fantasma com ID e plano
   * trocados. Na dúvida, o paciente fica com o convênio da agenda.
   */
  conflitos: Set<number>
}

const SEM_CONVENIO = "Não informado"

function planoUtil(plano: string): string {
  const p = cleanTxt(plano)
  if (!p || p.toLowerCase() === "não informado" || p.toLowerCase() === "nao informado") return ""
  return p
}

export function montarMapaConvenioCadastro(favorecidos: FavorecidoCadastroCliente[]): MapaConvenioCadastro {
  const porPacienteId = new Map<number, string>()
  const conflitos = new Set<number>()
  for (const f of favorecidos) {
    if (f.id == null) continue
    const plano = planoUtil(f.planoSaude)
    if (!plano) continue
    const anterior = porPacienteId.get(f.id)
    if (anterior !== undefined && anterior !== plano) conflitos.add(f.id)
    else porPacienteId.set(f.id, plano)
  }
  for (const id of conflitos) porPacienteId.delete(id)
  return { porPacienteId, conflitos }
}

export interface ConvenioResolvido {
  convenio: string
  fonte: FonteConvenio
  /** Convênio como está na agenda (csv_grades_profissionais), para auditoria. */
  convenioAgenda: string
}

/**
 * Convênio de uma linha da grade. Cadastro quando há `paciente_id`, ele está no
 * mapa e não está em conflito; senão, o da agenda (`cleanTxt(convenio_nome) ||
 * "Não informado"`, a regra de sempre). Sem mapa, devolve sempre o da agenda.
 */
export function convenioDaLinha(r: AgendaSalaRow, mapa: MapaConvenioCadastro | null | undefined): ConvenioResolvido {
  const convenioAgenda = cleanTxt(r.convenio_nome) || SEM_CONVENIO
  const plano = mapa && r.paciente_id != null ? mapa.porPacienteId.get(r.paciente_id) : undefined
  if (plano) return { convenio: plano, fonte: "cadastro", convenioAgenda }
  return { convenio: convenioAgenda, fonte: "agenda", convenioAgenda }
}
