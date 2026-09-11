"use client"

import { Lightbulb, Users } from "lucide-react"
import type { ResumoExecutivoPdi } from "@/lib/pdi/painelAnalista"

// A coluna lateral: onde foram parar os dois números que saíram da fileira de
// cards do topo. "Dentro do prazo" e "Ativos com Autorização ABA" são
// CONTEXTO — não decidem ação nenhuma — e disputavam tamanho com "atrasados",
// que decide. Aqui eles continuam à vista e legíveis, no peso que têm.
//
// As barras são proporcionais ao total, o que os cinco números soltos não
// mostravam: 27 atrasados num universo de 208 é uma frase diferente de 27 num
// universo de 40.
//
// As três fatias somam o total? Não necessariamente: "Dentro do prazo" e
// "Aguardando implementação" são status distintos, e um paciente pode estar em
// qualquer um dos quatro (`StatusPdi`). "Próximos do prazo" fica de fora daqui
// porque já tem card próprio no topo. Por isso os percentuais são de cada fatia
// SOBRE o total, e não uma barra empilhada de 100%.

const FATIAS = [
  {
    chave: "atrasados",
    rotulo: "Atrasados",
    barra: "bg-rose-500",
  },
  {
    chave: "emAndamento",
    rotulo: "Dentro do prazo",
    barra: "bg-emerald-500",
  },
  {
    chave: "aguardandoImplementacao",
    rotulo: "Aguardando implementação",
    barra: "bg-sky-500",
  },
] as const

export function DistribuicaoGeral({
  resumo,
  semNumeros,
}: {
  resumo: ResumoExecutivoPdi
  /** Carregando ou em erro: nenhum número vale. */
  semNumeros: boolean
}) {
  const total = resumo.totalPacientes

  return (
    <div className="space-y-3">
      <section aria-label="Distribuição geral" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-base font-bold text-foreground">Distribuição geral</h2>
        <ul className="space-y-3">
          {FATIAS.map((fatia) => {
            const valor = resumo[fatia.chave]
            // Guarda de divisão por zero: sem pacientes não há proporção a
            // mostrar, e 0/0 renderizaria "NaN%" na tela.
            const pct = total > 0 ? Math.round((valor / total) * 100) : 0
            return (
              <li key={fatia.chave}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-foreground">{fatia.rotulo}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                    {semNumeros ? "—" : valor}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/60">
                    {!semNumeros && (
                      <div
                        className={`h-full rounded-full ${fatia.barra} transition-[width] duration-500 motion-reduce:transition-none`}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {semNumeros ? "—" : `${pct}%`}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* O "Total de Pacientes" da planilha original. O rótulo diz de onde o
          número vem — ver filtrarAtivosComAutorizacaoAba: é quem tem terapia de
          ABA agendada na 1ª semana do mês seguinte, a população de TODOS os
          números desta tela. */}
      <section
        aria-label="Ativos com autorização ABA"
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-2xl font-extrabold leading-none tabular-nums text-foreground">
            {semNumeros ? "—" : total}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">ativos com autorização ABA</p>
        </div>
      </section>

      <section
        aria-label="Dica"
        className="flex gap-2.5 rounded-2xl border border-border bg-muted/30 p-4"
      >
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">Dica</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Comece pelos analistas do topo da lista: eles têm mais PDI atrasados e, em caso de empate, o atraso mais
            antigo.
          </p>
        </div>
      </section>
    </div>
  )
}
