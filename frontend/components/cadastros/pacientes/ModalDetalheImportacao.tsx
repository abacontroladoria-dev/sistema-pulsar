"use client"

import { useMemo } from "react"
import { rodadaDePacientes } from "@/components/tita/adaptadoresRelatorio"
import { RelatorioSincronizacaoTita } from "@/components/tita/RelatorioSincronizacaoTita"
import type { PacienteImportacaoLog } from "@/types/pacienteImportacao"

interface ModalDetalheImportacaoProps {
  log: PacienteImportacaoLog | null
  historico?: PacienteImportacaoLog[]
  onClose: () => void
}

// Relatório "Sincronização do TiTa" dos pacientes. O desenho mora no
// componente comum (também usado por profissionais e disponibilidade).
export function ModalDetalheImportacao({ log, historico = [], onClose }: ModalDetalheImportacaoProps) {
  const rodadas = useMemo(() => {
    const lista = log && !historico.some(h => h.id === log.id) ? [log, ...historico] : historico.length ? historico : log ? [log] : []
    // A de abertura é a `log` (a última execução), mesmo se não for a primeira da lista.
    const ordenada = log ? [lista.find(h => h.id === log.id)!, ...lista.filter(h => h.id !== log.id)] : lista
    return ordenada.map(rodadaDePacientes)
  }, [log, historico])

  return (
    <RelatorioSincronizacaoTita
      rodadas={rodadas}
      vazio={'A importação é executada automaticamente todos os dias às 04:00 ou pode ser disparada pelo botão "Atualizar (import. do TiTa)".'}
      onClose={onClose}
    />
  )
}
