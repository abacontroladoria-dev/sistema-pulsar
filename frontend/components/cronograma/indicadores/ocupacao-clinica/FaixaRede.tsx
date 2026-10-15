"use client"

// FaixaRede — o total das unidades próprias: os dois números, a barra com a
// legenda completa e três atalhos que traduzem a folga em ação.

import { SITUACOES_CADEIRA, type ContagemCadeiras } from "@/lib/cronograma/ocupacaoClinica"
import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { BarraCapacidade, LegendaCapacidade } from "./BarraCapacidade"
import { ParDeNumeros } from "./CartaoUnidade"
import { SITUACAO, fmtNum, plural } from "./visual"

interface Props {
  contagem: ContagemCadeiras
  cadeiras: number
  unidades: number
  foraDoMapa: number
}

export function FaixaRede({ contagem, cadeiras, unidades, foraDoMapa }: Props) {
  return (
    <section aria-labelledby="ocup-rede" className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="ocup-rede" className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Rede · {plural(unidades, "unidade", "unidades")}
            <InfoTooltip ariaLabel="Como a ocupação é medida" largura={340}>
              <div className="space-y-2 text-sm normal-case tracking-normal">
                <p>Cada cadeira de cada sala, em cada horário de 40 min da semana, conta uma vez. Sala Única tem 1 cadeira, Dupla 2, Múltipla 3. Salas Adm, NTI e bloqueadas ficam fora.</p>
                {SITUACOES_CADEIRA.map(s => (
                  <p key={s}><b>{SITUACAO[s].rotulo}:</b> {SITUACAO[s].descricao} {SITUACAO[s].acao}</p>
                ))}
              </div>
            </InfoTooltip>
          </h2>
          <p className="text-sm text-muted-foreground">{plural(cadeiras, "cadeira", "cadeiras")} · {plural(contagem.total, "horário", "horários")} de cadeira na semana</p>
        </div>
      </div>

      <ParDeNumeros contagem={contagem} grande casas={1} />
      <div className="flex flex-col gap-2">
        <BarraCapacidade contagem={contagem} tamanho="lg" />
        <LegendaCapacidade contagem={contagem} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Atalho valor={contagem.aberta} titulo="horários com agenda aberta" texto="Profissional na sala com horário Livre no TiTa. Dá para vender." />
        <Atalho valor={contagem.regularizar + foraDoMapa} titulo="ajustes no mapa de salas" alerta
          texto={`${plural(contagem.regularizar, "horário alocado", "horários alocados")} sem agenda + ${plural(foraDoMapa, "sessão", "sessões")} de quem não está no mapa.`} />
        <Atalho valor={contagem.vazia} titulo="horários sem profissional" texto="Cadeira vazia: espaço para alocar alguém ou contratar." />
      </div>
    </section>
  )
}

function Atalho({ valor, titulo, texto, alerta = false }: { valor: number; titulo: string; texto: string; alerta?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border p-4">
      <span className={`text-2xl font-black tabular-nums ${alerta && valor > 0 ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{fmtNum(valor)}</span>
      <span className="text-sm font-bold text-foreground">{titulo}</span>
      <span className="text-sm text-muted-foreground">{texto}</span>
    </div>
  )
}
