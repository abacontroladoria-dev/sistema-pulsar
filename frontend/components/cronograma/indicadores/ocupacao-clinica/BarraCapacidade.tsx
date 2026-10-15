"use client"

// BarraCapacidade — as vagas de 40 min da semana enfileiradas nas cinco
// situações. O 1º trecho é o "% com paciente"; tudo que é colorido (os quatro
// primeiros) é o "% com profissional", marcado pela chave embaixo. Assim os
// dois números ficam na mesma régua.

import { SITUACOES_CADEIRA, comProfissional, type ContagemCadeiras } from "@/lib/cronograma/ocupacaoClinica"
import { SITUACAO, fmtNum, fmtPct } from "./visual"

interface Props {
  contagem: ContagemCadeiras
  tamanho?: "md" | "lg"
  /** Chave "com profissional" sob o trecho colorido. */
  chave?: boolean
}

export function BarraCapacidade({ contagem, tamanho = "md", chave = true }: Props) {
  const { total } = contagem
  const pctProf = total > 0 ? comProfissional(contagem) / total : 0
  const resumo = SITUACOES_CADEIRA.map(s => `${SITUACAO[s].rotulo}: ${fmtNum(contagem[s])}`).join(", ")

  return (
    <div className="flex flex-col gap-1">
      <div
        role="img"
        aria-label={resumo}
        className={`flex w-full gap-0.5 overflow-hidden rounded-md ${SITUACAO.vazia.cor} ${tamanho === "lg" ? "h-6" : "h-4"}`}
      >
        {total > 0 && SITUACOES_CADEIRA.filter(s => s !== "vazia" && contagem[s] > 0).map(s => (
          <span
            key={s}
            className={`h-full min-w-[3px] ${SITUACAO[s].cor}`}
            style={{ width: `${(contagem[s] / total) * 100}%` }}
            title={`${SITUACAO[s].rotulo}: ${fmtNum(contagem[s])} vagas (${fmtPct(contagem[s] / total)})`}
          />
        ))}
      </div>
      {chave && total > 0 && pctProf > 0 && (
        <div className="relative h-6 text-xs font-semibold text-muted-foreground" aria-hidden>
          <span
            className="absolute left-0 top-0 h-1.5 rounded-b border-x-[1.5px] border-b-[1.5px] border-muted-foreground/50"
            style={{ width: `${pctProf * 100}%` }}
          />
          <span
            className="absolute top-2 whitespace-nowrap"
            style={pctProf > 0.6 ? { right: `${(1 - pctProf) * 100}%` } : { left: 0 }}
          >
            com profissional
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Legenda das cinco situações. Diz o que é uma vaga e, em cada item, quantas
 * vagas e quanto pesam no total — número solto ao lado do rótulo não dizia
 * 1.512 de quê.
 */
export function LegendaCapacidade({ contagem }: { contagem: ContagemCadeiras }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">
        Cada vaga é um atendimento de 40 min que cabe numa sala. Das <b className="text-foreground">{fmtNum(contagem.total)}</b> vagas da semana:
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
        {SITUACOES_CADEIRA.map(s => (
          <li key={s} className="inline-flex items-center gap-1.5" title={`${SITUACAO[s].descricao} ${SITUACAO[s].acao}`}>
            <span className={`h-3 w-3 shrink-0 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />
            {SITUACAO[s].rotulo}:
            <span className="tabular-nums">
              <b className="text-foreground">{fmtNum(contagem[s])}</b> {contagem[s] === 1 ? "vaga" : "vagas"}
              {contagem.total > 0 && <> ({fmtPct(contagem[s] / contagem.total)})</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Bolinha "com profissional": as três intensidades de azul juntas. */
export function MarcaComProfissional() {
  return (
    <span className="inline-flex h-3 w-3 shrink-0 overflow-hidden rounded-[3px]" aria-hidden>
      <span className={`h-full w-[40%] ${SITUACAO.paciente.cor}`} />
      <span className={`h-full w-[30%] ${SITUACAO.aberta.cor}`} />
      <span className={`h-full w-[30%] ${SITUACAO.administrativo.cor}`} />
    </span>
  )
}
