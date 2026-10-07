"use client"

// RegularizacoesView — audita, por profissional_id (não por nome — nome pode
// mudar no TiTa), quantos turnos ele tem de fato na agenda real (csv_grades_
// profissionais) contra quantos estão cadastrados em cronograma_salas_
// alocacoes. Só lista quem tem alguma divergência; 100% regularizado não
// aparece. Não edita nada aqui — o botão "Ver na grade" só filtra a aba Grade
// pelo nome do profissional, pra o cadastro real acontecer no fluxo normal
// (precisa escolher a sala).

import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react"
import { StatusPill } from "@/components/cronograma/ui/StatusPill"
import { calcularRegularizacoes, labelTurno } from "@/lib/cronograma/regularizacoes"
import type { AgendaSalaRow, AlocacaoSala } from "@/lib/cronograma/salasTypes"

interface RegularizacoesViewProps {
  alocacoes: AlocacaoSala[]
  linhas: AgendaSalaRow[]
  turnosBloqueioAdmin?: AgendaSalaRow[]
  onVerNaGrade: (profissionalNome: string) => void
}

export function RegularizacoesView({ alocacoes, linhas, turnosBloqueioAdmin = [], onVerNaGrade }: RegularizacoesViewProps) {
  const regularizacoes = calcularRegularizacoes(alocacoes, linhas, turnosBloqueioAdmin)

  if (regularizacoes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
        <CheckCircle2 size={28} className="text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm font-semibold text-foreground">Tudo regularizado</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Nenhum profissional com sessão real sem cadastro, nem alocação cadastrada sem sessão real, nesta semana.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2">Profissional</th>
            <th className="px-3 py-2">Cadastrado</th>
            <th className="px-3 py-2">Está no TiTa, mas não está no Ocupação de Salas</th>
            <th className="px-3 py-2">Está na Ocupação de Salas, mas não está no TiTa</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {regularizacoes.map(r => (
            <tr key={r.profissionalId ?? r.profissionalNome} className="border-b border-border last:border-0">
              <td className="px-3 py-2.5 align-top">
                <div className="font-medium text-foreground">{r.profissionalNome}</div>
                {r.profissionalId == null && (
                  <div className="mt-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">sem profissional_id — revisar cadastro</div>
                )}
              </td>
              <td className="px-3 py-2.5 align-top text-xs text-muted-foreground">
                {r.turnosCadastrados.length}/{r.turnosAgenda.length} turnos
              </td>
              <td className="px-3 py-2.5 align-top">
                {r.turnosFaltantes.length === 0
                  ? <span className="text-xs text-muted-foreground">—</span>
                  : (
                    <div className="flex flex-wrap gap-1">
                      {r.turnosFaltantes.map(t => (
                        <StatusPill key={labelTurno(t)} tone="red" dense>
                          <AlertTriangle size={10} /> {labelTurno(t)}
                        </StatusPill>
                      ))}
                    </div>
                  )}
              </td>
              <td className="px-3 py-2.5 align-top">
                {r.turnosExtras.length === 0
                  ? <span className="text-xs text-muted-foreground">—</span>
                  : (
                    <div className="flex flex-wrap gap-1">
                      {r.turnosExtras.map(t => (
                        <StatusPill key={labelTurno(t)} tone="amber" dense>{labelTurno(t)}</StatusPill>
                      ))}
                    </div>
                  )}
              </td>
              <td className="px-3 py-2.5 align-top text-right">
                <button
                  type="button"
                  onClick={() => onVerNaGrade(r.profissionalNome)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/50"
                >
                  Ver na grade <ArrowRight size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
