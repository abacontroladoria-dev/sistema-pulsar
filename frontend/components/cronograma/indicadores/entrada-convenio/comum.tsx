"use client"

// Peças compartilhadas do Painel de Entrada de Pacientes: pílula de prazo (em
// linguagem de gente), selo de disponibilidade, seção recolhível e o botão de
// copiar mensagem.

import toast from "react-hot-toast"
import { Copy } from "lucide-react"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import type { Tone } from "@/components/cronograma/ui/tones"
import { mensagemFormularioDisponibilidade } from "@/lib/disponibilidadePaciente"
import {
  AVISO_INICIO_DO_NOME,
  ROTULO_DISPONIBILIDADE,
  textoPrazo,
  type DisponibilidadePainel,
  type EstadoDisponibilidade,
  type EtapaAtual,
} from "@/lib/indicadores/entradaConvenio"

// Cor da disponibilidade não disputa com a do prazo: âmbar = alguém precisa
// agir, verde = resolvido, cinza = ainda não dá para agir (sem cadastro).
export const TOM_DISPONIBILIDADE: Record<EstadoDisponibilidade, Tone> = {
  preenchida_familia: "green",
  preenchida_equipe: "green",
  nao_preenchida: "amber",
  sem_cpf: "amber",
  sem_cadastro: "slate",
  nome_ambiguo: "amber",
}

/** "5 dias além do prazo", "Vence hoje", "Faltam 2 dias"; a dica traz os dias úteis. */
export function PilulaPrazo({ prazo, dense = true }: {
  prazo: Pick<EtapaAtual, "status" | "dias" | "prazo">
  dense?: boolean
}) {
  const t = textoPrazo(prazo)
  return (
    <StatusPill tone={t.tom} dense={dense} title={t.dica}>
      {t.texto}
    </StatusPill>
  )
}

export function SeloDisponibilidade({ disp, dense = true }: { disp: DisponibilidadePainel | undefined; dense?: boolean }) {
  if (!disp) return <span className="text-muted-foreground">—</span>
  const r = ROTULO_DISPONIBILIDADE[disp.estado]
  const conferir = disp.casamento === "inicio_do_nome"
  return (
    <StatusPill
      tone={conferir ? "amber" : TOM_DISPONIBILIDADE[disp.estado]}
      dense={dense}
      title={conferir ? `${r.dica} ${AVISO_INICIO_DO_NOME}` : r.dica}
    >
      {r.rotulo}{conferir ? " (conferir)" : ""}
    </StatusPill>
  )
}

/** Seção recolhida por padrão, para o que é consulta e não cobrança. */
export function Recolhivel({ titulo, apoio, children }: { titulo: React.ReactNode; apoio?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border bg-card px-4 py-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 sm:min-h-0 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-foreground">{titulo}</span>
          {apoio && <span className="block text-xs text-muted-foreground">{apoio}</span>}
        </span>
        <span aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
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
        void copiarTexto(mensagemFormularioDisponibilidade(pacienteNome), "Mensagem copiada.")
      }
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
    >
      <Copy size={13} aria-hidden />
      {rotulo}
    </button>
  )
}
