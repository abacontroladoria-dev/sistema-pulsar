"use client"

// BarraCapacidade — as vagas de 40 min da semana enfileiradas nas cinco
// situações. O 1º trecho é o "% com paciente"; tudo que é colorido (os quatro
// primeiros) é o "% com profissional", marcado pela chave embaixo. Assim os
// dois números ficam na mesma régua.

import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { SITUACOES_CADEIRA, comProfissional, type ContagemCadeiras, type SituacaoCadeira } from "@/lib/cronograma/ocupacaoClinica"
import { SITUACAO, fmtNum, fmtPct, porcentagensQueSomam } from "./visual"

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

/** As quatro situações em que HÁ profissional reservado no lugar da sala. */
const COM_PROFISSIONAL = SITUACOES_CADEIRA.filter(s => s !== "vazia")

/**
 * Legenda em dois grupos que não se misturam: COM profissional na sala (com
 * paciente, livre para agendar, administrativo, reservada sem agenda) e SEM
 * profissional na sala. "Livre para agendar" só existe dentro do primeiro —
 * vaga sem ninguém reservado não é vaga para agendar, é sem profissional.
 * Cada número diz que é "vagas" e quanto pesa no total.
 */
export function LegendaCapacidade({ contagem, camadaExplicacao, formato = "linha" }: {
  contagem: ContagemCadeiras
  /** Camada do balão "o que é uma vaga" — só precisa dentro do painel lateral (fica por cima do Drawer). */
  camadaExplicacao?: number
  /**
   * "linha": os dois grupos lado a lado (faixa da rede, que é larga).
   * "lista": uma situação por linha, vagas e % em colunas alinhadas (painel
   * lateral, estreito).
   */
  formato?: "linha" | "lista"
}) {
  const vagas = (n: number) => <><b className="text-foreground">{fmtNum(n)}</b> {n === 1 ? "vaga" : "vagas"}</>
  const totalCom = comProfissional(contagem)
  // Percentuais que fecham: os dois grupos somam 100% e as quatro situações
  // somam exatamente o % do grupo "com profissional" (maior resto).
  const [pctCom, pctVazia] = porcentagensQueSomam([totalCom, contagem.vazia], contagem.total)
  const pctSub = Object.fromEntries(
    porcentagensQueSomam(COM_PROFISSIONAL.map(s => contagem[s]), contagem.total, pctCom).map((v, i) => [COM_PROFISSIONAL[i], v]),
  ) as Record<SituacaoCadeira, number>
  const pct = (v: number) => (contagem.total > 0 ? `${v}%` : "—")

  if (formato === "lista") {
    const linha = "grid grid-cols-[0.75rem_minmax(0,1fr)_auto_3rem] items-center gap-3 px-3 py-2"
    return (
      <div className="flex flex-col gap-2">
        <CabecalhoLegenda contagem={contagem} camadaExplicacao={camadaExplicacao} />
        <div className="overflow-hidden rounded-xl border border-border text-sm">
          <div className={`${linha} bg-muted/50 font-bold text-foreground`}>
            <MarcaComProfissional />
            <span>Com profissional na sala</span>
            <span className="text-right tabular-nums font-normal text-muted-foreground">{vagas(totalCom)}</span>
            <span className="text-right tabular-nums">{pct(pctCom)}</span>
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {COM_PROFISSIONAL.map(s => (
              <li key={s} className={`${linha} pl-7`} title={`${SITUACAO[s].descricao} ${SITUACAO[s].acao}`}>
                <span className={`h-3 w-3 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />
                <span className="text-foreground">{s === "regularizar" ? "Reservada sem agenda (ajustar Ocupação de Salas)" : SITUACAO[s].rotulo}</span>
                <span className="text-right tabular-nums text-muted-foreground">{vagas(contagem[s])}</span>
                <span className="text-right tabular-nums text-muted-foreground">{pct(pctSub[s])}</span>
              </li>
            ))}
          </ul>
          <div className={`${linha} bg-muted/50 font-bold text-foreground`} title={`${SITUACAO.vazia.descricao} ${SITUACAO.vazia.acao}`}>
            <span className={`h-3 w-3 rounded-[3px] border border-border ${SITUACAO.vazia.cor}`} aria-hidden />
            <span>Sem profissional na sala</span>
            <span className="text-right tabular-nums font-normal text-muted-foreground">{vagas(contagem.vazia)}</span>
            <span className="text-right tabular-nums">{pct(pctVazia)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <CabecalhoLegenda contagem={contagem} camadaExplicacao={camadaExplicacao} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
            <MarcaComProfissional /> Com profissional na sala
            <span className="font-normal tabular-nums text-muted-foreground">{vagas(totalCom)} ({pct(pctCom)})</span>
          </div>
          <ul className="grid gap-x-5 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
            {COM_PROFISSIONAL.map(s => (
              <li key={s} className="inline-flex items-center gap-1.5" title={`${SITUACAO[s].descricao} ${SITUACAO[s].acao}`}>
                <span className={`h-3 w-3 shrink-0 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />
                {SITUACAO[s].rotulo}:
                <span className="tabular-nums">{vagas(contagem[s])} ({pct(pctSub[s])})</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
            <span className={`h-3 w-3 shrink-0 rounded-[3px] border border-border ${SITUACAO.vazia.cor}`} aria-hidden /> Sem profissional na sala
            <span className="font-normal tabular-nums text-muted-foreground">{vagas(contagem.vazia)} ({pct(pctVazia)})</span>
          </div>
          <p className="text-sm text-muted-foreground">{SITUACAO.vazia.descricao} {SITUACAO.vazia.acao}</p>
        </div>
      </div>
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
