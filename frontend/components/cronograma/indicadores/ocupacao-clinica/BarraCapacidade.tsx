"use client"

// BarraCapacidade — as vagas de 40 min da semana enfileiradas nas cinco
// situações. O 1º trecho é o "% com paciente"; tudo que é colorido (os quatro
// primeiros) é o "% com profissional", marcado pela chave embaixo. Assim os
// dois números ficam na mesma régua.

import Link from "next/link"
import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { SITUACOES_CADEIRA, comProfissional, type ContagemCadeiras, type SituacaoCadeira } from "@/lib/cronograma/ocupacaoClinica"
import { LINK_REGULARIZACOES, SITUACAO, fmtNum, fmtPct, porcentagensQueSomam } from "./visual"

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

/** O que fazer, em uma frase curta, ao lado de cada situação. */
const DICA: Partial<Record<SituacaoCadeira, string>> = {
  aberta: "Dá para agendar paciente novo.",
  administrativo: "Conferir se precisa ocupar a sala.",
  regularizar: "Ajustar na Ocupação de Salas.",
}

/**
 * As vagas da semana em DOIS BLOCOS que não se misturam — é o tema da tela:
 *  "Com profissional na sala": com paciente, livre para agendar,
 *    administrativo e reservada sem agenda, cada uma com o que fazer;
 *  "Sem profissional na sala": não dá para agendar ali.
 * "Livre para agendar" só existe no primeiro bloco: vaga sem ninguém
 * reservado é sem profissional. Cada bloco é a ÚNICA explicação do seu
 * assunto (antes legenda e cartões de atalho diziam a mesma coisa duas vezes).
 * Percentuais por maior resto: os blocos somam 100% e as situações somam o
 * % do bloco.
 */
export function LegendaCapacidade({ contagem, camadaExplicacao, formato = "lado-a-lado", ajusteMapa }: {
  contagem: ContagemCadeiras
  /** Camada do balão "o que é uma vaga" — só precisa dentro do painel lateral (fica por cima do Drawer). */
  camadaExplicacao?: number
  /** "lado-a-lado": faixa da rede (larga). "empilhado": painel lateral (estreito). */
  formato?: "lado-a-lado" | "empilhado"
  /** Pessoas a ajustar no mapa de salas — rodapé do bloco "com profissional" com link para Regularizações. */
  ajusteMapa?: number
}) {
  const totalCom = comProfissional(contagem)
  const [pctCom, pctVazia] = porcentagensQueSomam([totalCom, contagem.vazia], contagem.total)
  const pctSub = Object.fromEntries(
    porcentagensQueSomam(COM_PROFISSIONAL.map(s => contagem[s]), contagem.total, pctCom).map((v, i) => [COM_PROFISSIONAL[i], v]),
  ) as Record<SituacaoCadeira, number>
  const pct = (v: number) => (contagem.total > 0 ? `${v}%` : "—")
  const empilhado = formato === "empilhado"

  return (
    <div className="flex flex-col gap-2">
      <CabecalhoLegenda contagem={contagem} camadaExplicacao={camadaExplicacao} />
      <div className={`grid gap-3 ${empilhado ? "" : "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"}`}>
        <BlocoGrupo
          titulo="Com profissional na sala"
          marca={<MarcaComProfissional grande />}
          vagas={totalCom}
          pct={pct(pctCom)}
          tom="border-[#1F4E79] bg-[#1F4E79]/[0.07] dark:border-[#9CC7E6] dark:bg-[#9CC7E6]/10"
        >
          <ul className="divide-y divide-border">
            {COM_PROFISSIONAL.map(s => {
              const rotulo = empilhado && s === "regularizar" ? "Reservada sem agenda (ajustar Ocupação de Salas)" : SITUACAO[s].rotulo
              const dica = empilhado && s === "regularizar" ? undefined : DICA[s]
              return (
                <li key={s} className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto_2.75rem] items-center gap-3 px-4 py-2.5 text-sm" title={`${SITUACAO[s].descricao} ${SITUACAO[s].acao}`}>
                  <span className={`h-3 w-3 rounded-[3px] ${SITUACAO[s].cor}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-semibold text-foreground">{rotulo}</span>
                    {dica && <span className="block text-muted-foreground">{dica}</span>}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    <b className="text-foreground">{fmtNum(contagem[s])}</b> {contagem[s] === 1 ? "vaga" : "vagas"}
                  </span>
                  <span className="text-right font-semibold tabular-nums text-foreground">{pct(pctSub[s])}</span>
                </li>
              )
            })}
          </ul>
          {!!ajusteMapa && ajusteMapa > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <span>Mapa de salas: <b>{fmtNum(ajusteMapa)} {ajusteMapa === 1 ? "pessoa" : "pessoas"}</b> para ajustar (reservadas sem agenda no turno ou atendendo sem sala definida).</span>
              <Link href={LINK_REGULARIZACOES} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-sky-700 hover:underline dark:text-sky-400">
                Ajustar em Regularizações <ExternalLink size={13} aria-hidden /><span className="sr-only">(abre em outra guia)</span>
              </Link>
            </div>
          )}
        </BlocoGrupo>

        <BlocoGrupo
          titulo="Sem profissional na sala"
          marca={<span className={`h-4 w-4 shrink-0 rounded-[4px] border border-border ${SITUACAO.vazia.cor}`} aria-hidden />}
          vagas={contagem.vazia}
          pct={pct(pctVazia)}
          tom="border-slate-400 bg-slate-100 dark:border-slate-500 dark:bg-slate-800/60"
        >
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Ninguém reservado na sala nesse horário: <b className="text-foreground">não dá para agendar aqui</b>. Primeiro é preciso colocar um profissional (ou contratar).
          </p>
        </BlocoGrupo>
      </div>
    </div>
  )
}

/** Um tema: cabeçalho forte (nome, total de vagas e %) + o conteúdo do tema. */
function BlocoGrupo({ titulo, marca, vagas, pct, tom, children }: {
  titulo: string
  marca: ReactNode
  vagas: number
  pct: string
  tom: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-l-4 border-b-border px-4 py-3 ${tom}`}>
        <h3 className="inline-flex items-center gap-2 text-base font-black text-foreground">{marca}{titulo}</h3>
        <span className="tabular-nums text-muted-foreground">
          <b className="text-xl font-black text-foreground">{fmtNum(vagas)}</b> {vagas === 1 ? "vaga" : "vagas"} · <b className="text-xl font-black text-foreground">{pct}</b>
        </span>
      </header>
      {children}
    </section>
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
export function MarcaComProfissional({ grande = false }: { grande?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 overflow-hidden ${grande ? "h-4 w-4 rounded-[4px]" : "h-3 w-3 rounded-[3px]"}`} aria-hidden>
      <span className={`h-full w-[40%] ${SITUACAO.paciente.cor}`} />
      <span className={`h-full w-[30%] ${SITUACAO.aberta.cor}`} />
      <span className={`h-full w-[30%] ${SITUACAO.administrativo.cor}`} />
    </span>
  )
}
