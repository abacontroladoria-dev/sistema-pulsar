"use client"

// Tooltip da coluna "PEP apurada" (Entregas PEP, tela do analista): o valor
// "R$ 86,67 / R$ 133,34" vira o gatilho, e o painel diz de onde vem cada
// centavo — item a item — e o que falta para chegar aos 100%.
//
// Não calcula nada: tudo vem de explicarPepPaciente (lib/remuneracao/
// explicacaoPep.ts), que só traduz a linha já gravada em pep_apuracao_mensal.
// Abre por clique/toque (InfoTooltip), porque esta tela é usada no celular.
//
// Layout em DUAS COLUNAS FIXAS em todo o painel — texto à esquerda (uma linha,
// cortada com reticências e o nome inteiro no title), valor à direita sem
// quebra — para os valores ficarem alinhados um embaixo do outro e nenhum
// "R$" se separar do número.

import { InfoTooltip } from "@/components/cronograma/ui/InfoTooltip"
import { explicarPepPaciente, type LinhaExplicacaoPep } from "@/lib/remuneracao/explicacaoPep"
import type { PepApuracaoMensal, PepCatalogoItem } from "@/types/pep"

/** Espaço não separável entre "R$" e o número: o valor nunca quebra no meio. */
const money = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`
const pct = (p: number) => `${(p * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`

const LARGURA = 340

function nota(l: LinhaExplicacaoPep): string {
  if (l.tipo === "recorrente") {
    const conta = l.faltantes !== undefined && l.esperadas !== undefined
      ? `${l.esperadas - l.faltantes} de ${l.esperadas} ${l.esperadas === 1 ? "entregue" : "entregues"}`
      : "entrega incompleta"
    return l.geral ? `${conta} · item geral, vale para todos os pacientes` : conta
  }
  if (l.tipo === "semestral") return `semestral vencido · ${pct(l.percentual ?? 0)} do potencial`
  if (l.tipo === "saldoAnterior") return "desconto que não coube em meses anteriores"
  return "semestral entregue depois do prazo"
}

function acao(l: LinhaExplicacaoPep): string {
  if (l.tipo === "recorrente" && l.faltantes !== undefined) return `Entregar ${l.faltantes} ${l.sigla}`
  return `Entregar ${l.sigla}`
}

export function ExplicacaoPepTooltip({ apuracao, catalogo, semanasCalendario }: {
  apuracao: PepApuracaoMensal
  catalogo: PepCatalogoItem[]
  semanasCalendario: number
}) {
  const e = explicarPepPaciente(apuracao, catalogo, semanasCalendario)
  const descontos = e.linhas.filter(l => l.tipo !== "devolucao")
  const devolucoes = e.linhas.filter(l => l.tipo === "devolucao")
  const recuperaveis = e.linhas.filter(l => l.tipo === "recorrente" || l.tipo === "semestral")
  // Os valores por item só valem como "quanto volta" quando o piso zero não
  // engoliu nada; senão, só o total recuperável é honesto.
  const porItemExato = Math.abs(recuperaveis.reduce((s, l) => s + l.valor, 0) - e.recuperavelComEntregas) < 0.005
  const naoRecuperavel = Math.max(0, e.faltaPara100 - e.recuperavelComEntregas)
  const mostraFalta = !e.modoTeste && e.faltaPara100 > 0.005

  return (
    <InfoTooltip
      largura={LARGURA}
      ariaLabel={`Como chegamos em ${money(e.liquido)} de ${money(e.potencial)}`}
      trigger={
        <span className="whitespace-nowrap font-semibold text-foreground">
          {money(e.liquido)}<span className="font-normal text-muted-foreground"> / {money(e.potencial)}</span>
        </span>
      }
    >
      <div className="space-y-3 text-left">
        <p className="text-[13px] font-bold text-foreground">Como chegamos em {money(e.liquido)}</p>

        {/* ── A conta ── */}
        <div className="space-y-2">
          <Linha rotulo="Potencial do paciente" valor={money(e.potencial)} />
          {descontos.map((l, i) => (
            <Linha key={`d${i}`} sigla={l.sigla} rotulo={l.nome} nota={nota(l)}
              valor={`− ${money(l.valor)}`} tom="text-rose-600 dark:text-rose-400" />
          ))}
          {devolucoes.map((l, i) => (
            <Linha key={`v${i}`} rotulo={l.nome} nota={nota(l)}
              valor={`+ ${money(l.valor)}`} tom="text-emerald-600 dark:text-emerald-400" />
          ))}
          <div className="border-t border-border pt-2">
            <Linha rotulo="PEP apurada" valor={money(e.liquido)} forte />
          </div>
          {e.saldoParaProximoMes > 0.005 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              O desconto passou do potencial: {money(e.saldoParaProximoMes)} ficam para descontar no mês seguinte.
            </p>
          )}
        </div>

        {e.modoTeste && (
          <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            Mês de teste: os descontos aparecem só para demonstração — paga-se 100% do potencial.
          </p>
        )}

        {!e.modoTeste && e.faltaPara100 <= 0.005 && (
          <p className="text-[11px] leading-snug text-emerald-700 dark:text-emerald-400">Todos os itens em dia: 100% do potencial.</p>
        )}

        {/* ── O que falta para 100% ── mesma grade de duas colunas da conta. */}
        {mostraFalta && (
          <div className="space-y-1.5 rounded-md bg-muted/60 px-2.5 py-2">
            <Linha rotulo="Falta para 100%" valor={money(e.faltaPara100)} forte />
            {e.recuperavelComEntregas > 0.005 && (porItemExato
              ? recuperaveis.map((l, i) => (
                  <Linha key={`a${i}`} rotulo={acao(l)} valor={`+ ${money(l.valor)}`} tom="text-emerald-600 dark:text-emerald-400" suave />
                ))
              : <Linha rotulo="Entregando todos os itens" valor={`+ ${money(e.recuperavelComEntregas)}`} tom="text-emerald-600 dark:text-emerald-400" suave />
            )}
            {naoRecuperavel > 0.005 && (
              <Linha rotulo="Saldo de meses anteriores" nota="não volta com entregas deste mês" valor={money(naoRecuperavel)} suave />
            )}
          </div>
        )}

        {e.liberado && (
          <p className="text-[11px] leading-snug text-muted-foreground">Faturamento liberado: este valor está congelado.</p>
        )}
      </div>
    </InfoTooltip>
  )
}

/**
 * Uma linha da grade: texto à esquerda numa linha só (reticências + title com
 * o nome inteiro), nota opcional embaixo, e o valor à direita sem quebra e em
 * algarismos tabulares — é o que mantém os valores alinhados na vertical.
 */
function Linha({ sigla, rotulo, nota, valor, tom, forte = false, suave = false }: {
  sigla?: string; rotulo: string; nota?: string; valor: string; tom?: string; forte?: boolean; suave?: boolean
}) {
  const titulo = sigla ? `${sigla} · ${rotulo}` : rotulo
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
      <p className={`truncate text-xs ${forte ? "font-bold text-foreground" : suave ? "text-muted-foreground" : "text-foreground/90"}`} title={titulo}>
        {sigla && <span className="mr-1.5 font-bold text-foreground">{sigla}</span>}
        {rotulo}
      </p>
      <p className={`whitespace-nowrap text-right text-xs tabular-nums ${forte ? "font-bold" : "font-semibold"} ${tom ?? "text-foreground"}`}>
        {valor}
      </p>
      {nota && <p className="col-span-2 -mt-0.5 truncate text-[11px] text-muted-foreground" title={nota}>{nota}</p>}
    </div>
  )
}
