"use client"

// BarraCapacidade — as vagas de 40 min da semana enfileiradas nas cinco
// situações. O 1º trecho é o "% com paciente"; tudo que é colorido (os quatro
// primeiros) é o "% com profissional", marcado pela chave embaixo. Assim os
// dois números ficam na mesma régua.

import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
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
export function LegendaCapacidade({ contagem, camadaExplicacao, formato = "linha" }: {
  contagem: ContagemCadeiras
  /** Camada do balão "o que é uma vaga" — só precisa dentro do painel lateral (fica por cima do Drawer). */
  camadaExplicacao?: number
  /**
   * "linha": itens lado a lado (faixa da rede, que é larga).
   * "lista": uma situação por linha com vagas e % em colunas alinhadas — no
   * painel lateral, estreito, os itens lado a lado quebravam em lugares
   * diferentes e os números ficavam desalinhados.
   */
  formato?: "linha" | "lista"
}) {
  if (formato === "lista") {
    return (
      <div className="flex flex-col gap-2">
        <CabecalhoLegenda contagem={contagem} camadaExplicacao={camadaExplicacao} />
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border text-sm">
          {SITUACOES_CADEIRA.map(s => (
            <li key={s} className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto_3rem] items-center gap-3 px-3 py-2" title={`${SITUACAO[s].descricao} ${SITUACAO[s].acao}`}>
              <span className={`h-3 w-3 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />
              <span className="text-foreground">{SITUACAO[s].rotulo}</span>
              <span className="text-right tabular-nums text-muted-foreground">
                <b className="text-foreground">{fmtNum(contagem[s])}</b> {contagem[s] === 1 ? "vaga" : "vagas"}
              </span>
              <span className="text-right font-semibold tabular-nums text-foreground">
                {contagem.total > 0 ? fmtPct(contagem[s] / contagem.total) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <CabecalhoLegenda contagem={contagem} camadaExplicacao={camadaExplicacao} />
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

/** "Das N vagas da semana" + balão explicando o que é uma vaga. */
function CabecalhoLegenda({ contagem, camadaExplicacao }: { contagem: ContagemCadeiras; camadaExplicacao?: number }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <span>Das <b className="text-foreground">{fmtNum(contagem.total)}</b> vagas da semana</span>
      <InfoTooltip ariaLabel="O que é uma vaga" zIndex={camadaExplicacao} largura={320}>
        <span className="block text-sm leading-relaxed">
          Cada vaga é o lugar de um profissional atendendo por 40 min. Sala individual tem 1 vaga por horário, dupla 2 e múltipla 3. Sessão em grupo conta como 1 vaga.
        </span>
      </InfoTooltip>
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
