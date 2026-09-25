"use client"

// HistoricoReceitasShell — índice mensal da Previsão de Receitas (Etapa 4,
// complemento). Diferente da aba "Previsão de Receitas" (drilldown detalhado
// de UM mês por vez, Convênio → Paciente → Sessão), esta tela é uma visão
// rápida de TODOS os meses de uma vez, só com o número final de cada um.
//
// Status por mês:
//   - futuro: mês ainda não chegou (sem snapshot nenhum ainda).
//   - em_desenvolvimento: é o mês corrente — mostra o que já foi construído
//     até agora pelo snapshot diário, com uma tag deixando claro que ainda
//     não é o número final (segue mudando até o mês fechar).
//   - aguardando_fechamento: mês já passou, mas o job de fechamento (dia 5 do
//     mês seguinte) ainda não rodou — mostra o último parcial disponível,
//     com uma tag indicando que ainda não é definitivo.
//   - fechado: número final, gravado pelo job de fechamento.
//   - sem_historico: mês passado sem NENHUM snapshot (ex.: antes da
//     implantação do histórico, ou sem dados sincronizados suficientes).

import { useEffect, useMemo, useRef, useState } from "react"
import { CalendarClock, CalendarX2, Clock, Info, Loader2, TrendingUp } from "lucide-react"
import { type PrevisaoReceitasResumoMes } from "@/services/previsaoReceitasHistoricoResumo.service"
import { labelMesAno } from "@/lib/cronograma/helpers"
import { useResumoHistoricoReceitasComEfetivado } from "@/hooks/useResumoHistoricoReceitasComEfetivado"
import { METRICAS_RECEITAS, formatarMetrica, type MetricaReceitaKey } from "@/lib/cronograma/previsaoReceitasMetricas"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import {
  MES_INICIO_HISTORICO,
  listaChavesMes,
  classificarStatusMes,
  type StatusMes,
} from "@/lib/cronograma/previsaoReceitasHistoricoStatus"

interface LinhaHistorico {
  ano: number
  mes: number
  label: string
  status: StatusMes
  resumo: PrevisaoReceitasResumoMes | null
}

function ExplicacaoStatus({ status }: { status: StatusMes }) {
  if (status === "sem_historico") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Sem histórico disponível — mês anterior à implantação do histórico de receitas (sem dados sincronizados suficientes pra calcular).
      </p>
    )
  }
  if (status === "futuro") {
    return <p className="text-[11px] text-muted-foreground">Mês futuro — sem histórico ainda.</p>
  }
  return null
}

const ICONE_CLASSE_POR_STATUS: Record<StatusMes, string> = {
  fechado: "text-emerald-600 dark:text-emerald-400",
  aguardando_fechamento: "text-amber-600 dark:text-amber-400",
  em_desenvolvimento: "text-blue-600 dark:text-blue-400",
  futuro: "text-muted-foreground",
  sem_historico: "text-muted-foreground",
}


/** Tag ao lado do mês pros status que NÃO são o número final — deixa claro que o que está sendo mostrado ainda pode mudar. */
const TAG_POR_STATUS: Partial<Record<StatusMes, { texto: string; classe: string }>> = {
  em_desenvolvimento: {
    texto: "Mês em desenvolvimento — histórico ainda não fechado",
    classe: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  aguardando_fechamento: {
    texto: "Aguardando fechamento (dia 5)",
    classe: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
}

/** Jan-Jun/2026: faltas vêm do backfill do relatório do Órbita, não da sincronização diária da TiTa (ver faltas_historico_csv). */
function usaFonteHistoricaOrbita(ano: number, mes: number): boolean {
  return ano === 2026 && mes >= 1 && mes <= 6
}

const NOTA_FONTE_ORBITA = "Potencial perdido por falta calculado a partir do relatório \"relatorio_faltas_detalhado\" do Órbita, importado manualmente — este mês não passou pela sincronização diária da TiTa."

/** Colunas numéricas da tabela, nesta ordem — mesma equação de sempre: Projetado = Pago + Potencial perdido + Indefinido, seguido de Sessões. */
const COLUNAS_METRICA: MetricaReceitaKey[] = ["receitaSemDeducao", "efetivadoReal", "deducaoFalta", "indefinido", "sessoesMes"]

/** Ícone "i" que abre uma nota explicativa ao clique — usado tanto pro aviso de status (mês ainda não fechado) quanto pra fonte de dados (Órbita), pra não empurrar texto fixo pra dentro da linha da tabela. */
function NotaTooltip({ texto, ariaLabel }: { texto: string; ariaLabel: string }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!aberto) return
    function aoClicarFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener("mousedown", aoClicarFora)
    return () => document.removeEventListener("mousedown", aoClicarFora)
  }, [aberto])

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        className="rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
        title={texto}
        aria-label={ariaLabel}
        aria-expanded={aberto}
      >
        <Info size={14} />
      </button>
      {aberto && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-md border border-border bg-card p-2.5 text-left text-[11px] text-muted-foreground shadow-lg"
        >
          {texto}
        </div>
      )}
    </span>
  )
}

function LinhaMesRow({ linha }: { linha: LinhaHistorico }) {
  const Icone = linha.status === "fechado" ? TrendingUp
    : linha.status === "aguardando_fechamento" ? Clock
    : linha.status === "futuro" ? CalendarX2
    : CalendarClock

  const tag = TAG_POR_STATUS[linha.status]

  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3 pl-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Icone size={14} className={`shrink-0 ${ICONE_CLASSE_POR_STATUS[linha.status]}`} />
          <span className="text-xs font-bold text-foreground">{linha.label}</span>
          {tag && <NotaTooltip texto={tag.texto} ariaLabel="Detalhes do status deste mês" />}
          {usaFonteHistoricaOrbita(linha.ano, linha.mes) && (
            <NotaTooltip texto={NOTA_FONTE_ORBITA} ariaLabel="Fonte da dedução por falta deste mês" />
          )}
        </div>
      </td>

      {linha.resumo ? (
        <>
          {COLUNAS_METRICA.map(key => {
            const config = METRICAS_RECEITAS[key]
            return (
              <td key={key} style={{ textAlign: "right" }} className={`py-2 px-3 tabular-nums font-bold ${TONE_SOFT[config.tone].text}`}>
                {formatarMetrica(config, config.acessor(linha.resumo!))}
              </td>
            )
          })}
          <td style={{ textAlign: "right" }} className="py-2 px-3 tabular-nums text-foreground">
            {linha.resumo.faltasMes}
          </td>
          <td style={{ textAlign: "right" }} className="py-2 pl-3 pr-3 tabular-nums text-foreground">
            {linha.resumo.pacientesUnicos}
          </td>
        </>
      ) : (
        <td colSpan={COLUNAS_METRICA.length + 2} className="py-2 px-3">
          <ExplicacaoStatus status={linha.status} />
        </td>
      )}
    </tr>
  )
}

export function HistoricoReceitasShell() {
  const { resumos, loading, error } = useResumoHistoricoReceitasComEfetivado()

  const linhas = useMemo<LinhaHistorico[]>(() => {
    const hoje = new Date()
    const mesAtual = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 }
    const mesFuturo = { ano: mesAtual.mes === 12 ? mesAtual.ano + 1 : mesAtual.ano, mes: mesAtual.mes === 12 ? 1 : mesAtual.mes + 1 }

    const resumoPorCompetencia = new Map(resumos.map(r => [r.competencia, r]))

    return listaChavesMes(MES_INICIO_HISTORICO, mesFuturo).map(({ ano, mes }) => {
      const competencia = `${ano}-${String(mes).padStart(2, "0")}`
      const resumo = resumoPorCompetencia.get(competencia) ?? null
      const status = classificarStatusMes(ano, mes, resumo)
      return { ano, mes, label: labelMesAno(ano, mes), status, resumo }
    }).reverse() // mais recente primeiro
  }, [resumos])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Carregando histórico...
      </div>
    )
  }
  if (error) return <div className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</div>

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        Índice mensal — pra ver o detalhamento por convênio/paciente/sessão de um mês específico, use o seletor de mês na aba "Previsão de Receitas". Jan-Jun/2026 usam a dedução por falta do relatório do Órbita, não a sincronização diária da TiTa — clique no ícone de informação ao lado do mês pra ver.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-muted-foreground">
              <th style={{ textAlign: "left" }} className="py-2 pr-3 pl-3 font-semibold">Mês</th>
              {COLUNAS_METRICA.map(key => (
                <th key={key} title={METRICAS_RECEITAS[key].label} style={{ textAlign: "right" }} className="py-2 px-3 font-semibold">
                  {METRICAS_RECEITAS[key].labelCurto}
                </th>
              ))}
              <th style={{ textAlign: "right" }} className="py-2 px-3 font-semibold">Faltas</th>
              <th style={{ textAlign: "right" }} className="py-2 pl-3 pr-3 font-semibold">Pacientes</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(linha => <LinhaMesRow key={`${linha.ano}-${linha.mes}`} linha={linha} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
