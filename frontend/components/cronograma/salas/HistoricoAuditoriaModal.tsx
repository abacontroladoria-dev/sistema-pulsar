"use client"

// HistoricoAuditoriaModal — trilha de auditoria da tela de Ocupação de Salas
// (sala/alocação/núcleo/status_label). Mesma ideia da trilha do PEP
// (pepAuditoria.service.ts), só que aqui já ganha uma UI de leitura — o PEP
// tinha a função de leitura pronta mas nunca ganhou tela.
//
// O corpo mora em HistoricoAuditoriaConteudo desde que a aba "Histórico" do
// detalhe da sala passou a mostrar a mesma trilha filtrada por sala. Este
// arquivo é só a casca de modal.

import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { HistoricoAuditoriaConteudo } from "./HistoricoAuditoriaConteudo"

interface Props {
  onClose: () => void
}

export function HistoricoAuditoriaModal({ onClose }: Props) {
  return (
    <ScheduleModal
      title="Histórico de alterações"
      subtitle="Criações, edições e exclusões de salas, alocações, núcleos e status — mais recentes primeiro."
      maxWidth={720}
      onClose={onClose}
    >
      <HistoricoAuditoriaConteudo />
    </ScheduleModal>
  )
}
