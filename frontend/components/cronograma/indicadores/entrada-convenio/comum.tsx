"use client"

// Peças compartilhadas do Painel de Entrada de Pacientes: pílula de prazo, selo
// de disponibilidade e o botão de copiar mensagem.

import toast from "react-hot-toast"
import { Copy } from "lucide-react"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import type { Tone } from "@/components/cronograma/ui/tones"
import { mensagemFormularioDisponibilidade } from "@/lib/disponibilidadePaciente"
import {
  ROTULO_DISPONIBILIDADE,
  type DisponibilidadePainel,
  type EstadoDisponibilidade,
  type StatusPrazo,
} from "@/lib/indicadores/entradaConvenio"

export const TOM_STATUS: Record<StatusPrazo, Tone> = {
  "atrasado": "red",
  "vence hoje": "amber",
  "no prazo": "green",
  "sem dado": "slate",
  "fora de ordem": "purple",
}

export const TOM_DISPONIBILIDADE: Record<EstadoDisponibilidade, Tone> = {
  preenchida_familia: "green",
  preenchida_equipe: "blue",
  nao_preenchida: "amber",
  sem_cpf: "amber",
  sem_cadastro: "slate",
  nome_ambiguo: "purple",
}

export function PilulaPrazo({ status, dense = true }: { status: StatusPrazo; dense?: boolean }) {
  return (
    <StatusPill tone={TOM_STATUS[status] ?? "slate"} dense={dense}>
      {status}
    </StatusPill>
  )
}

export function SeloDisponibilidade({ disp, dense = true }: { disp: DisponibilidadePainel | undefined; dense?: boolean }) {
  if (!disp) return <span className="text-muted-foreground">—</span>
  const r = ROTULO_DISPONIBILIDADE[disp.estado]
  return (
    <StatusPill tone={TOM_DISPONIBILIDADE[disp.estado]} dense={dense} title={r.dica}>
      {r.rotulo}
    </StatusPill>
  )
}

export async function copiarTexto(texto: string, sucesso: string) {
  try {
    await navigator.clipboard.writeText(texto)
    toast.success(sucesso)
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie à mão.")
  }
}

export function BotaoCopiarMensagem({ pacienteNome, rotulo = "Copiar mensagem de disponibilidade" }: {
  pacienteNome?: string
  rotulo?: string
}) {
  return (
    <button
      type="button"
      onClick={() =>
        void copiarTexto(mensagemFormularioDisponibilidade(window.location.origin, pacienteNome), "Mensagem copiada.")
      }
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
    >
      <Copy size={13} aria-hidden />
      {rotulo}
    </button>
  )
}
