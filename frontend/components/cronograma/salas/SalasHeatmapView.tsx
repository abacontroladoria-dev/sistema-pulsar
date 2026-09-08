"use client"

// SalasHeatmapView — mapa de calor sala × dia, com Manhã empilhada acima de
// Tarde (2 linhas por sala) em vez de lado a lado. Faixas de cor 0-39/40-59/
// 60-79/80-100 — paleta própria em tons pastel (mais suave que a paleta
// saturada de corFaixaOcupacao/ocupacaoProf.ts, usada em outras telas como
// Ocupação de Profissionais).

import { useEffect, useRef } from "react"
import { AlertTriangle, Eye, EyeOff, ShieldCheck } from "lucide-react"
import { textoFaixaOcupacaoSala } from "@/lib/cronograma/salas"
import { CAPACIDADE_LABEL_CURTO } from "@/lib/cronograma/salasTypes"
import { useStatusLabels } from "@/hooks/useStatusLabels"
import { TONE_SOLID } from "@/components/cronograma/ui/tones"
import type { SalaComOcupacao, SlotOcupacaoSala } from "@/lib/cronograma/salasTypes"

/** Paleta pastel só do mapa de calor — mesmas 4 faixas de corFaixaOcupacao, tons mais suaves. */
function corFaixaOcupacaoPastel(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return "#3a3f55"
  const p = Number(pct) > 1 ? Number(pct) / 100 : Number(pct)
  if (p >= 0.8) return "#A8DDBB"
  if (p >= 0.6) return "#A6D2E8"
  if (p >= 0.4) return "#F2DD9B"
  return "#F0AFAF"
}

/** Colunas de dia padrão (Seg-Sex) — usadas quando a view não recebe `dias` explícito. Salas fora desse padrão (ver `dias_disponiveis` em Sala) são renderizadas em instâncias separadas desta mesma view, com `dias` próprio. */
const DIAS_PADRAO = [
  { dow: 1, label: "Seg" },
  { dow: 2, label: "Ter" },
  { dow: 3, label: "Qua" },
  { dow: 4, label: "Qui" },
  { dow: 5, label: "Sex" },
] as const

const TURNOS = ["Manhã", "Tarde"] as const

/** Tinta neutra por turno (usa a própria paleta de cinza do sistema, funciona em light e dark) — só pra ficar claro onde a manhã termina e a tarde começa. */
const TURNO_ROW_BG: Record<(typeof TURNOS)[number], string> = {
  "Manhã": "",
  "Tarde": "bg-slate-200/70 dark:bg-white/[0.06]",
}

interface SalasHeatmapViewProps {
  salas: SalaComOcupacao[]
  /** Alterna o modo solo: mostra só esta sala na visão atual. Clicar de novo (ou no botão "voltar para todas" acima da tabela) restaura as demais. */
  onIsolarSala: (id: string, nome: string) => void
  /** Id da sala em modo solo, se houver — usado só para trocar o ícone do botão para indicar o estado ativo. */
  salaIsoladaId: string | null
  /** Ids de sala com pelo menos uma regra em "Exclusividade de salas com terapias" — só pra exibir o selo ao lado do nome da sala. */
  salasComExclusividade: Set<string>
  /** Colunas de dia da tabela — default Seg-Sex. Usado para renderizar salas com `dias_disponiveis` fora do padrão numa instância própria desta view, com só as colunas que elas usam. */
  dias?: readonly { dow: number; label: string }[]
}

export function SalasHeatmapView({ salas, onIsolarSala, salaIsoladaId, salasComExclusividade, dias = DIAS_PADRAO }: SalasHeatmapViewProps) {
  const salaRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  /** Sala isolada mais recente — guardado à parte porque `salaIsoladaId` já
      vira null no MESMO clique que dispara o efeito abaixo (precisamos saber
      pra qual sala rolar de volta). */
  const lastIsoladaIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (salaIsoladaId) {
      lastIsoladaIdRef.current = salaIsoladaId
      return
    }
    // `salaIsoladaId` acabou de virar null (voltou a mostrar todas) — rola de
    // volta pra onde a sala isolada estava, em vez de deixar o scroll "preso"
    // no topo da lista completa.
    const alvo = lastIsoladaIdRef.current
    if (!alvo) return
    salaRowRefs.current.get(alvo)?.scrollIntoView({ block: "center" })
    lastIsoladaIdRef.current = null
  }, [salaIsoladaId])

  if (!salas.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nenhuma sala cadastrada para os filtros selecionados.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left text-xs font-bold uppercase text-muted-foreground">Sala</th>
              <th className="w-10 border-l border-border bg-muted/40 px-1 py-2 text-center text-[10px] font-bold uppercase text-muted-foreground">Turno</th>
              {dias.map(d => (
                <th key={d.dow} className="border-l border-border px-2 py-2 text-center text-xs font-bold uppercase text-muted-foreground">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {salas.map(({ sala, slots }) => (
              TURNOS.map((turno, turnoIdx) => (
                <tr
                  key={`${sala.id}-${turno}`}
                  ref={turnoIdx === 0 ? (el => {
                    if (el) salaRowRefs.current.set(sala.id, el)
                    else salaRowRefs.current.delete(sala.id)
                  }) : undefined}
                  className={TURNO_ROW_BG[turno]}
                >
                  {turnoIdx === 0 && (
                    <td rowSpan={2} className="sticky left-0 z-10 w-[200px] max-w-[200px] border-t border-border bg-card px-3 py-2 align-top">
                      <div className="flex items-start gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate font-semibold text-foreground" title={sala.nome_exibicao}>{sala.nome_exibicao}</span>
                            {salasComExclusividade.has(sala.id) && (
                              <span title="Sala com exclusividade cadastrada (Exclusividade de salas com terapias)">
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" strokeWidth={2.5} />
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground" title={sala.unidade_nome}>{sala.unidade_nome}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onIsolarSala(sala.id, sala.nome_exibicao)}
                          aria-label={salaIsoladaId === sala.id ? `Voltar a mostrar todas as salas` : `Mostrar só ${sala.nome_exibicao}`}
                          title={salaIsoladaId === sala.id ? "Voltar a mostrar todas as salas" : "Mostrar só esta sala"}
                          className={`mt-0.5 shrink-0 rounded-md p-1 hover:bg-muted hover:text-foreground ${salaIsoladaId === sala.id ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`}
                        >
                          {salaIsoladaId === sala.id ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <div className="mt-1 flex flex-nowrap items-center gap-1 overflow-hidden">
                        <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                          {CAPACIDADE_LABEL_CURTO[sala.capacidade]}
                        </span>
                        {sala.nucleo && (
                          <span className="min-w-0 flex-1 truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title={sala.nucleo}>
                            {sala.nucleo}
                          </span>
                        )}
                        {sala.andar && (
                          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {sala.andar}º andar
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  <td className={`w-10 border-l border-border px-1 py-2 text-center text-[10px] font-semibold text-muted-foreground ${turnoIdx === 0 ? "border-t" : ""}`}>
                    {turno === "Manhã" ? "M" : "T"}
                  </td>
                  {dias.map(d => (
                    <HeatCell
                      key={`${sala.id}-${d.dow}-${turno}`}
                      slot={slots.find(s => s.dow === d.dow && s.turno === turno)}
                      salaStatus={sala.status}
                      bordaTopo={turnoIdx === 0}
                    />
                  ))}
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-semibold">Legenda:</span>
        {[0.2, 0.5, 0.7, 0.9].map(p => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: corFaixaOcupacaoPastel(p) }} />
            {textoFaixaOcupacaoSala(p)}
          </span>
        ))}
      </div>
    </div>
  )
}

function HeatCell({ slot, salaStatus, bordaTopo }: { slot: SlotOcupacaoSala | undefined; salaStatus: string; bordaTopo: boolean }) {
  const { labels: statusLabels, loading: statusLabelsLoading } = useStatusLabels()
  const bordaCls = bordaTopo ? "border-t" : ""

  // Slot ausente = a sala não atende esse dia/turno (ex.: sábado só de manhã)
  // — distinto de "bloqueado"/"inativo" (status da sala), que tem célula própria abaixo.
  if (!slot) {
    return <td className={`border-l border-border bg-muted/30 px-1 py-2 text-center text-[10px] text-muted-foreground ${bordaCls}`}>—</td>
  }
  if (slot.status === "bloqueado" || slot.status === "inativo") {
    const labelReal = statusLabels[salaStatus]
    // Mesmo cuidado do SlotCell em SalasGridView.tsx: sem isso, um status
    // configurado como vermelho (ex. "bloqueada") piscava cinza por um
    // instante antes dos rótulos reais chegarem do banco.
    if (!labelReal && statusLabelsLoading) {
      return (
        <td className={`border-l border-border px-1 py-2 text-center ${bordaCls}`}>
          <span className="inline-block h-3 w-full animate-pulse rounded bg-muted" />
        </td>
      )
    }
    const l = labelReal ?? { label_curto: salaStatus, tone: "slate" as const }
    const tone = TONE_SOLID[l.tone]
    return <td className={`border-l border-border px-1 py-2 text-center text-[10px] font-semibold ${tone.bg} ${tone.text} ${bordaCls}`}>{l.label_curto}</td>
  }
  if (!slot.alocacoes.length) {
    return <td className={`border-l border-border px-1 py-2 text-center text-[10px] text-muted-foreground ${bordaCls}`}>—</td>
  }
  const sessoesTotal = slot.alocacoes.reduce((s, a) => s + a.sessoesReais, 0)
  const capacidadeTotal = slot.alocacoes.reduce((s, a) => s + a.sessoesCapacidadeTurno, 0)
  const pct = capacidadeTotal > 0 ? sessoesTotal / capacidadeTotal : null
  const cor = corFaixaOcupacaoPastel(pct)
  const inconsistente = slot.inconsistente || slot.violaExclusividade
  return (
    <td
      className={`relative border-l border-border px-1 py-2 text-center text-[10px] font-semibold ${bordaCls} ${inconsistente ? "ring-2 ring-inset ring-red-500" : ""}`}
      style={{ background: cor, color: "#222847" }}
      title={`${slot.alocacoes.length} alocação(ões) · ${sessoesTotal} sessão(ões) de ${capacidadeTotal} no turno${slot.inconsistente ? " · ⚠️ EXCEDE CAPACIDADE DE PROF. POR SALA" : ""}${slot.violaExclusividade ? " · ⚠️ FERE EXCLUSIVIDADE" : ""}`}
    >
      {inconsistente && (
        <AlertTriangle
          className="absolute right-0.5 top-0.5 h-3 w-3 text-red-600 drop-shadow-sm"
          strokeWidth={2.5}
          fill="white"
        />
      )}
      {pct !== null ? `${Math.round(pct * 100)}%` : "—"}
    </td>
  )
}
