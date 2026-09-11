"use client"

import { AlertOctagon, CircleCheck, ClockAlert, Hourglass } from "lucide-react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import type { ItemPdi } from "@/lib/pdi/filtros"
import type { StatusPdi } from "@/lib/pdi/status"

// Modal de detalhe do "PDI - Painel por Analista": ao clicar num `CardAnalista`
// (em PainelAnalistaShell.tsx), lista os pacientes daquele Coordenador de
// Caso, agrupados por status — pedido do usuário (05/09/2026): "poderei ver o
// nome dos pacientes e quem está em cada categoria". Clicar num nome abre o
// `PdiDetalheModal` de verdade (edição), reaproveitando o mesmo componente da
// tela de Controle de Prazos — ver `onAbrirPaciente` no chamador.

const GRUPOS: { status: StatusPdi; rotulo: string; icone: typeof AlertOctagon; tom: string }[] = [
  { status: "Atrasado", rotulo: "Atrasados", icone: AlertOctagon, tom: "text-rose-600 dark:text-rose-400" },
  { status: "Próximo do prazo", rotulo: "Próximo do prazo", icone: ClockAlert, tom: "text-amber-600 dark:text-amber-400" },
  {
    status: "Aguardando Implementação",
    rotulo: "Aguardando Implementação",
    icone: Hourglass,
    tom: "text-sky-600 dark:text-sky-400",
  },
  { status: "Dentro do prazo", rotulo: "Dentro do prazo", icone: CircleCheck, tom: "text-emerald-600 dark:text-emerald-400" },
]

/**
 * O que a linha do paciente mostra à direita. Era `ID {pacienteId}` — o campo
 * menos acionável disponível: ninguém cobra um PDI por id interno. Aqui vale a
 * MAGNITUDE, que é o que decide quem é chamado primeiro: dias de atraso quando
 * atrasado, dias restantes quando o prazo se aproxima, e a data de fechamento
 * nos demais. `diasRestantes` e `prazoFechamento` já vêm prontos no ItemPdi.
 */
function prazoDoItem(item: ItemPdi): string {
  const dias = item.diasRestantes
  if (dias !== null) {
    if (dias < 0) return `${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"} de atraso`
    if (dias === 0) return "vence hoje"
    if (dias <= 15) return `faltam ${dias} ${dias === 1 ? "dia" : "dias"}`
  }
  if (!item.prazoFechamento) return "sem prazo"
  const [ano, mes, dia] = item.prazoFechamento.slice(0, 10).split("-")
  return ano && mes && dia ? `vence ${dia}/${mes}` : "sem prazo"
}

export function AnalistaDetalheModal({
  analistaNome,
  itens,
  onFechar,
  onAbrirPaciente,
}: {
  analistaNome: string
  /** Já filtrados pelo chamador — os pacientes deste analista (ou "Sem Coordenador de Caso"). */
  itens: ItemPdi[]
  onFechar: () => void
  onAbrirPaciente: (item: ItemPdi) => void
}) {
  return (
    <ScheduleModal
      title={analistaNome}
      subtitle={`${itens.length} ${itens.length === 1 ? "paciente" : "pacientes"}`}
      maxWidth={520}
      onClose={onFechar}
    >
      <div className="space-y-5">
        {GRUPOS.map((grupo) => {
          // Por URGÊNCIA, não por nome: dentro de "Atrasados" o que interessa
          // é quem está atrasado há mais tempo, não quem começa com A. Quem
          // não tem `diasRestantes` (Aguardando Implementação) cai no fim, em
          // ordem alfabética.
          const doGrupo = itens
            .filter((i) => i.status === grupo.status)
            .sort((a, b) => {
              if (a.diasRestantes === null && b.diasRestantes === null) {
                return a.nome.localeCompare(b.nome, "pt-BR")
              }
              if (a.diasRestantes === null) return 1
              if (b.diasRestantes === null) return -1
              if (a.diasRestantes !== b.diasRestantes) return a.diasRestantes - b.diasRestantes
              return a.nome.localeCompare(b.nome, "pt-BR")
            })
          if (doGrupo.length === 0) return null
          const Icone = grupo.icone
          return (
            <div key={grupo.status}>
              <h3 className={`mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${grupo.tom}`}>
                <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {grupo.rotulo} ({doGrupo.length})
              </h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {doGrupo.map((item) => (
                  <li key={item.pacienteId}>
                    <button
                      type="button"
                      onClick={() => onAbrirPaciente(item)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span className="truncate text-foreground">{item.nome}</span>
                      <span className={`shrink-0 text-xs font-semibold tabular-nums ${grupo.tom}`}>
                        {prazoDoItem(item)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {itens.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum paciente neste analista.</p>
        )}
      </div>
    </ScheduleModal>
  )
}
