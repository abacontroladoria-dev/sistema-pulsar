"use client"

// FaixaRede — o total das unidades próprias: os dois números, a barra com a
// legenda completa e três atalhos que traduzem a folga em ação.

import Link from "next/link"
import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { SITUACOES_CADEIRA, type ContagemCadeiras } from "@/lib/cronograma/ocupacaoClinica"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { BarraCapacidade, LegendaCapacidade } from "./BarraCapacidade"
import { ParDeNumeros } from "./CartaoUnidade"
import { LINK_REGULARIZACOES, SITUACAO, fmtNum, plural } from "./visual"

interface Props {
  contagem: ContagemCadeiras
  salasOperacionais: number
  unidades: number
  pessoasParaAjustar: number
}

export function FaixaRede({ contagem, salasOperacionais, unidades, pessoasParaAjustar }: Props) {
  return (
    <section aria-labelledby="ocup-rede" className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div>
        <h2 id="ocup-rede" className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Rede · {plural(unidades, "unidade", "unidades")}
          <InfoTooltip ariaLabel="Como a ocupação é medida" largura={360}>
            <div className="space-y-2 text-sm normal-case tracking-normal">
              <p>A conta é feita em vagas de 40 min: cada atendimento que cabe numa sala em cada horário da semana. Sala individual tem 1 vaga por horário, dupla 2, múltipla 3. Salas administrativas, de NTI e bloqueadas ficam fora, e feriados também.</p>
              {SITUACOES_CADEIRA.map(s => (
                <p key={s}><b>{SITUACAO[s].rotulo}:</b> {SITUACAO[s].descricao} {SITUACAO[s].acao}</p>
              ))}
            </div>
          </InfoTooltip>
        </h2>
        <p className="text-sm text-muted-foreground">{plural(salasOperacionais, "sala em uso", "salas em uso")} · {plural(contagem.total, "vaga", "vagas")} de 40 min na semana</p>
      </div>

      <ParDeNumeros contagem={contagem} grande casas={1} />
      <div className="flex flex-col gap-2">
        <BarraCapacidade contagem={contagem} tamanho="lg" />
        <LegendaCapacidade contagem={contagem} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Atalho valor={fmtNum(contagem.aberta)} titulo={contagem.aberta === 1 ? "vaga livre para agendar" : "vagas livres para agendar"}
          texto="O profissional já está na sala com horário livre no TiTa. Dá para agendar paciente novo." />
        <Atalho valor={fmtNum(pessoasParaAjustar)} titulo={pessoasParaAjustar === 1 ? "pessoa para ajustar no mapa de salas" : "pessoas para ajustar no mapa de salas"} alerta={pessoasParaAjustar > 0}
          texto="Reservadas numa sala sem agenda no turno, ou atendendo sem sala definida. Enquanto não ajustar, a ocupação fica errada.">
          {pessoasParaAjustar > 0 && (
            <Link href={LINK_REGULARIZACOES} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-flex w-fit items-center gap-1 text-sm font-bold text-sky-700 hover:underline dark:text-sky-400">
              Ajustar em Regularizações <ExternalLink size={13} aria-hidden /><span className="sr-only">(abre em outra guia)</span>
            </Link>
          )}
        </Atalho>
        <Atalho valor={fmtNum(contagem.vazia)} titulo={contagem.vazia === 1 ? "vaga sem profissional" : "vagas sem profissional"}
          texto="Ninguém reservado na sala. Espaço para colocar um profissional ou contratar." />
      </div>
    </section>
  )
}

function Atalho({ valor, titulo, texto, alerta = false, children }: { valor: string; titulo: string; texto: string; alerta?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border p-4">
      <span className={`text-2xl font-black tabular-nums ${alerta ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{valor}</span>
      <span className="text-sm font-bold text-foreground">{titulo}</span>
      <span className="text-sm text-muted-foreground">{texto}</span>
      {children}
    </div>
  )
}
