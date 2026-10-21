"use client"

// FaixaRede — o total das unidades próprias: os dois números, a barra e os
// dois blocos (com / sem profissional na sala). Cada assunto aparece uma vez
// só: o que fazer com cada situação mora dentro do bloco dela.

import { SITUACOES_CADEIRA, type ContagemCadeiras } from "@/lib/cronograma/ocupacaoClinica"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { BarraCapacidade, LegendaCapacidade } from "./BarraCapacidade"
import { ParDeNumeros } from "./CartaoUnidade"
import { SITUACAO, plural } from "./visual"

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
          Total · {plural(unidades, "unidade", "unidades")}
          <InfoTooltip ariaLabel="Como a ocupação é medida" largura={360}>
            <div className="space-y-2 text-sm normal-case tracking-normal">
              <p>A conta é feita em vagas: cada vaga é o lugar de um profissional atendendo por 40 min numa sala. Sala individual tem 1 vaga por horário, dupla 2 e múltipla 3, porque cabem 2 ou 3 profissionais ao mesmo tempo. Uma sessão em grupo (um profissional com vários pacientes) conta como 1 vaga com paciente. Salas administrativas, de NTI e bloqueadas ficam fora, e feriados também.</p>
              {SITUACOES_CADEIRA.map(s => (
                <p key={s}><b>{SITUACAO[s].rotulo}:</b> {SITUACAO[s].descricao} {SITUACAO[s].acao}</p>
              ))}
            </div>
          </InfoTooltip>
        </h2>
        <p className="text-sm text-muted-foreground">{plural(salasOperacionais, "sala em uso", "salas em uso")} · {plural(contagem.total, "vaga", "vagas")} de 40 min na semana</p>
      </div>

      <ParDeNumeros contagem={contagem} grande casas={1} />
      <BarraCapacidade contagem={contagem} tamanho="lg" />
      <LegendaCapacidade contagem={contagem} ajusteMapa={pessoasParaAjustar} />
    </section>
  )
}
