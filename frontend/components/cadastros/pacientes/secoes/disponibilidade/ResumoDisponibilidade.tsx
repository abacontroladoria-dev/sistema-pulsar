"use client"

import { GraduationCap, TriangleAlert } from "lucide-react"
import {
  DIAS,
  FINS_SESSAO,
  INICIOS_SESSAO,
  calcularTotais,
  conflitoComEscola,
  formatarHoras,
  sessoesNaJanela,
  type Disponibilidade,
} from "@/lib/disponibilidadePaciente"

// Leitura da disponibilidade: escola + os cinco dias (Seg–Sex) + totais. Usado na versão
// atual e no detalhe de cada versão do histórico — as duas precisam ser lidas
// do mesmo jeito para a comparação de olho funcionar.
//
// Celular primeiro: a atendente abre isto no telefone. Abaixo de `sm` cada dia
// é uma linha (dia · janela · sessões); a partir de `sm` vira uma grade de cinco
// colunas, que é como a equipe pensa a semana.
//
// Cores do dia: verde = pode vir; AMARELO = pode vir, mas a janela cruza o
// horário da escola (Seg–Sex) — a equipe precisa confirmar com a família antes
// de marcar sessão ali; cinza = não vem.

export function ResumoDisponibilidade({ disponibilidade }: { disponibilidade: Disponibilidade }) {
  const totais = calcularTotais(disponibilidade)
  const foraDaGrade = (h: string, lista: readonly string[]) => !lista.includes(h)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Escola:</span>
        <span className="font-medium text-foreground">
          {disponibilidade.frequenta_escola === false
            ? "não frequenta"
            : disponibilidade.escola
              ? `${disponibilidade.escola.inicio} às ${disponibilidade.escola.fim}`
              : "não informado"}
        </span>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {DIAS.map((dia) => {
          const j = disponibilidade.dias[dia.chave]
          const sessoes = sessoesNaJanela(j)
          const conflito = conflitoComEscola(disponibilidade, dia.chave)
          return (
            <li key={dia.chave} className="min-w-0">
              <div
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:flex-col sm:items-start sm:justify-start sm:gap-1 ${
                  conflito
                    ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                    : j
                      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30"
                      : "border-border bg-muted/30"
                }`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{dia.curto}</span>
                {j ? (
                  <span className="text-right sm:text-left">
                    <span className="block text-sm font-semibold tabular-nums text-foreground">
                      {j.inicio}–{j.fim}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {sessoes} {sessoes === 1 ? "sessão" : "sessões"}
                      {(foraDaGrade(j.inicio, INICIOS_SESSAO) || foraDaGrade(j.fim, FINS_SESSAO)) && (
                        <span
                          className="ml-1 text-amber-700 dark:text-amber-400"
                          title="Horário fora da grade de sessões (veio da importação). Ao editar, ajuste para a grade."
                        >
                          · fora da grade
                        </span>
                      )}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              {/* Fora do cartão: o cartão diz o horário, o aviso fica embaixo. */}
              {conflito && (
                <p className="mt-1 flex items-center gap-1 px-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                  <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Conflito com a escola
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-sm text-foreground">
        <span className="font-semibold tabular-nums">{formatarHoras(totais.minutosSemana)}</span>
        <span className="text-muted-foreground"> por semana · </span>
        <span className="font-semibold tabular-nums">{totais.sessoes40}</span>
        <span className="text-muted-foreground"> {totais.sessoes40 === 1 ? "sessão" : "sessões"} de 40 min · </span>
        <span className="font-semibold tabular-nums">{totais.diasDisponiveis}</span>
        <span className="text-muted-foreground"> {totais.diasDisponiveis === 1 ? "dia" : "dias"}</span>
      </p>
    </div>
  )
}
