// ─── Suspensão Temporária bloqueia oferta em Ocupação de Paciente ────────────
//
// Mesmo princípio de gradeTitaOcupacao.ts (Regra C): uma restrição clínica do
// paciente, gravada em outra tabela, precisa vencer a sugestão de vaga — só
// que aqui a chave é (paciente, especialidade), não (profissional, slot).
//
// A ponte de ID é obrigatória: a grade identifica paciente por
// `CsvRow.PacienteId`, que é o `tita_paciente_id` (id externo do TiTa,
// espelhado em `csv_grades_profissionais.paciente_id`) — NÃO é
// `id_paciente_pulsar`, que é o que `cadastros_pacientes_suspensoes_temporarias`
// usa. Ver o comentário de `tita_paciente_id` em
// supabase/migrations/20260817190000_pacientes_canonica.sql.
//
// Especialidade não precisa de ponte: `especialidade_suspensao` já é gravada
// com as chaves de ESP_CLINICO (AbaAltasIndividualidades.tsx), o mesmo domínio
// de texto que toda a Ocupação de Paciente usa — comparação direta, sem
// conversão para TERAPIA_ID (essa camada é só para grade/sala/faturamento).

import { getPacientesPorTitaIds } from "@/services/pacientes.service"
import { getSuspensoesVigentesPorPacientes } from "@/services/pacienteSuspensaoTemporaria.service"
import type { CsvRow } from "@/types/cronograma"

/** `${nomeFavorecido}|||${especialidade}` — mesmo formato de chave do altaSet já usado para "Alta". */
export type ChaveSuspensao = string

/** Para linkar de volta ao registro exato na ficha do paciente. */
export interface SuspensaoLinkInfo {
  idPacientePulsar: number
  idSuspensao: number
}

export interface SuspensaoTemporariaCruzamento {
  /** Usado nos pontos que hoje excluem por "Alta" — mesmo Set, mesmo formato de chave. */
  set: Set<ChaveSuspensao>
  /** Mesma chave -> paciente/suspensão de origem, para a UI oferecer "ver na ficha do paciente". */
  info: Map<ChaveSuspensao, SuspensaoLinkInfo>
}

/**
 * A partir das linhas da grade, monta o cruzamento de suspensão temporária
 * vigente — para os mesmos pontos que hoje só excluem por "Alta"
 * (`isLaudoComAlta`) também excluírem por suspensão, sem duplicar a consulta
 * por modalidade (Aumentar Cronograma / Criar Novo Cronograma compartilham
 * este único resultado).
 */
export async function construirSuspensaoTemporaria(cRows: CsvRow[]): Promise<SuspensaoTemporariaCruzamento> {
  const vazio: SuspensaoTemporariaCruzamento = { set: new Set(), info: new Map() }

  const titaIdPorNome = new Map<number, string>()
  for (const r of cRows) {
    const id = r.PacienteId
    const nome = r["Nome Favorecido"]
    if (typeof id === "number" && nome) titaIdPorNome.set(id, nome)
  }
  if (titaIdPorNome.size === 0) return vazio

  const idsPulsarPorTita = await getPacientesPorTitaIds([...titaIdPorNome.keys()])
  if (idsPulsarPorTita.size === 0) return vazio

  const suspensoesPorPulsarId = await getSuspensoesVigentesPorPacientes([...idsPulsarPorTita.values()])
  if (suspensoesPorPulsarId.size === 0) return vazio

  const set = new Set<ChaveSuspensao>()
  const info = new Map<ChaveSuspensao, SuspensaoLinkInfo>()
  for (const [titaId, nome] of titaIdPorNome) {
    const idPulsar = idsPulsarPorTita.get(titaId)
    if (idPulsar == null) continue
    const suspensoes = suspensoesPorPulsarId.get(idPulsar)
    if (!suspensoes) continue
    for (const s of suspensoes) {
      const chave = `${nome}|||${s.especialidade}`
      set.add(chave)
      info.set(chave, { idPacientePulsar: idPulsar, idSuspensao: s.idSuspensao })
    }
  }

  return { set, info }
}
