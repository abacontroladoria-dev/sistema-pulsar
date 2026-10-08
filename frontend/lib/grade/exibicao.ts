import { ABA_EXIB_PSICO_IDS, EXIB_ID } from "@/lib/cronograma/constants"
import type { CadastroTerapia } from "@/types/terapia"

// Terapia de exibição sugerida para um agendamento novo da Grade. Mesma regra
// fixa do fluxo de implantação (services/tita/mappings.ts →
// terapiaExibicaoIdPorRegraFixa), sem depender do TiTa:
//   - as terapias do grupo ABA (ABA_EXIB_PSICO_IDS, ids do TiTa) exibem como
//     "Psicologia ABA";
//   - todas as outras exibem como elas mesmas.
// Aplicador ABA (AE/HS) depende de laudo + convênio: aqui fica a própria
// terapia e quem agenda escolhe outra se precisar (o campo é editável).

export function exibicaoSugerida(terapia: Pick<CadastroTerapia, "id" | "tita_terapia_id">, catalogo: Pick<CadastroTerapia, "id" | "tita_terapia_id">[]): number {
  if (terapia.tita_terapia_id != null && ABA_EXIB_PSICO_IDS.has(terapia.tita_terapia_id)) {
    const psicoAba = catalogo.find(t => t.tita_terapia_id === EXIB_ID.PSICOLOGIA_ABA)
    if (psicoAba) return psicoAba.id
  }
  return terapia.id
}
