"use client"

// PacienteAgendaHipotetica — semana completa do paciente com 1 sessão
// hipotética destacada (verde) num dia/hora específico. Extraído do
// DetalheModal de SimulacaoNovoPrestadorTab.tsx (que só cobria o caso "novo
// profissional") pra ser reaproveitado também em DisponibilidadeInternaView
// (cobertura "direta" — profissional já contratado, sem remanejamento).

import { Fragment, useMemo } from "react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { Button } from "@/components/ui/button"
import { DIAS_UTIL, ESP_CLINICO, EXCLUIR_OCUP, estiloUnidade, unidadeExibicao } from "@/lib/cronograma/constants"
import { diaCurto, fmtName } from "@/lib/cronograma/helpers"
import type { Turno } from "@/lib/cronograma/simulacaoNovoPrestador"
import type { CsvRow } from "@/types/cronograma"

function hiStr(r: CsvRow): string { return String(r.HI_str || "") }

interface SlotHipotetico { dia: string; turno: Turno; hora: string; unidade: string }

interface Props {
  paciente: string
  slot: SlotHipotetico
  especialidade: string
  /** Quem passa a atender essa sessão hipotética — "Novo profissional" (contratação) por padrão, ou o nome de um profissional já existente (disponibilidade interna). */
  profissionalHipotetico?: string
  cRows: CsvRow[]
  onClose: () => void
}

export function PacienteAgendaHipoteticaModal({
  paciente, slot, especialidade, profissionalHipotetico = "Novo profissional", cRows, onClose,
}: Props) {
  const terapiaProposta = (ESP_CLINICO[especialidade] || [especialidade]).filter(t => !EXCLUIR_OCUP.has(t))[0] || especialidade

  const convenio = useMemo(
    () => cRows.find(r => r["Nome Favorecido"] === paciente && r["Convênio"])?.["Convênio"] as string | undefined,
    [cRows, paciente],
  )

  const sessoesPaciente = useMemo(() => {
    const vistos = new Set<string>()
    const res: { dia: string; hora: string; terapia: string; prof: string; unidade: string }[] = []
    for (const r of cRows) {
      if (r["Nome Favorecido"] !== paciente || r["Status do Agendamento"] !== "Agendado") continue
      const k = `${r["Dia da Semana"]}|||${hiStr(r)}|||${r.Terapia}|||${r.Profissional}`
      if (vistos.has(k)) continue
      vistos.add(k)
      res.push({ dia: r["Dia da Semana"], hora: hiStr(r), terapia: r.Terapia, prof: r.Profissional, unidade: String(r.Unidade || "Desconhecida") })
    }
    return res
  }, [paciente, cRows])

  type CelulaInfo = { terapia: string; prof: string; proposta: boolean; unidade: string }
  const mapaCelulas: Record<string, CelulaInfo[]> = {}
  for (const s of sessoesPaciente) {
    const k = `${s.dia}|||${s.hora}`
    ;(mapaCelulas[k] ??= []).push({ terapia: s.terapia, prof: s.prof, proposta: false, unidade: s.unidade })
  }
  const kProposta = `${slot.dia}|||${slot.hora}`
  ;(mapaCelulas[kProposta] ??= []).push({ terapia: terapiaProposta, prof: profissionalHipotetico, proposta: true, unidade: slot.unidade })

  // Segunda a sexta sempre, mesmo em dias sem nenhuma sessão do paciente —
  // pedido do usuário pra dar visão da semana inteira, não só dos dias com
  // sessão (que mudava a quantidade de colunas dependendo do paciente).
  const diasComSessao = DIAS_UTIL
  const horasGrid = [...new Set(Object.keys(mapaCelulas).map(k => k.split("|||")[1]))].sort()

  // Manhã: 08:00-12:00 · Tarde: 12:30-17:40 — mesmo corte de AgendaProfissional/
  // RemanejamentoDetalheModal, reaproveitado aqui pra mostrar 1 selo de unidade
  // dominante por turno (sempre visível, mesmo quando a semana toda é 1 unidade
  // só — pedido do usuário pra deixar isso claro sem precisar caçar a
  // informação célula por célula). Corte em "12:30" — pedido do usuário
  // 2026-08-17: 12:30 conta como Tarde, não Manhã.
  const CORTE_TARDE = "12:30"
  const horasManha = horasGrid.filter(h => h < CORTE_TARDE)
  const horasTarde = horasGrid.filter(h => h >= CORTE_TARDE)

  function unidadeDominante(horasTurno: string[], dia: string): string | null {
    const contagem = new Map<string, number>()
    for (const hora of horasTurno) {
      for (const c of mapaCelulas[`${dia}|||${hora}`] || []) {
        contagem.set(c.unidade, (contagem.get(c.unidade) ?? 0) + 1)
      }
    }
    let dominante: string | null = null
    let max = 0
    for (const [unidade, qtd] of contagem) {
      if (qtd > max) { dominante = unidade; max = qtd }
    }
    return dominante
  }

  return (
    <ScheduleModal
      title={paciente}
      maxWidth={860}
      onClose={onClose}
      subtitle={convenio ? <span className="text-[13px] font-semibold">Convênio: {convenio}</span> : undefined}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" /> Sessão hipotética</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-border bg-muted" /> Sessão existente</span>
      </div>
      {!horasGrid.length ? (
        <div className="py-8 text-center text-muted-foreground">Nenhuma sessão encontrada.</div>
      ) : (
        // table-fixed + colgroup, mesmo esquema de RemanejamentoDetalheModal
        // (56px hora + 128px por dia, sempre) — pedido do usuário pra os dois
        // modais (direto e remanejamento) terem layout/tamanho idênticos, e
        // as 5 colunas de dia nunca mudarem de largura entre si.
        <div className="overflow-x-auto">
        <table className="table-fixed border-collapse text-[11px]" style={{ width: `${56 + diasComSessao.length * 128}px` }}>
          <colgroup>
            <col style={{ width: 56 }} />
            {diasComSessao.map(d => <col key={d} style={{ width: 128 }} />)}
          </colgroup>
          <thead><tr>
            <th className="w-14" />
            {diasComSessao.map(d => (
              <th key={d} className={`pb-1.5 text-center text-[11px] font-bold ${d === slot.dia ? "text-violet-700 dark:text-violet-400" : "text-foreground"}`}>
                <span className="uppercase">{diaCurto(d)}</span> {d === slot.dia && <span className="ml-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 px-1 py-px text-[10px] text-emerald-700 dark:text-emerald-400">hipótese</span>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {([
              { label: "Manhã", horasTurno: horasManha },
              { label: "Tarde", horasTurno: horasTarde },
            ] as const).map(turno => turno.horasTurno.length === 0 ? null : (
              <Fragment key={turno.label}>
                <tr className="border-t border-border bg-muted/40">
                  <td className="py-1.5 pr-2.5 text-right text-[11px] font-black uppercase tracking-widest text-foreground/70">{turno.label}</td>
                  {diasComSessao.map(d => {
                    const u = unidadeDominante(turno.horasTurno, d)
                    return (
                      <td key={d} className="px-0.5 py-0">
                        {u && (
                          <div className={`rounded-md py-1 text-center text-[10px] font-black uppercase tracking-wide text-white ${estiloUnidade(u).bar}`}>
                            {unidadeExibicao(u)}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
                {turno.horasTurno.map(hora => (
                  <tr key={hora} className="border-t border-border">
                    <td className="py-1 pr-2 text-right">
                      <span className={`inline-block rounded-md px-1.5 py-0.5 text-[13px] font-bold tabular-nums ${hora === slot.hora ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400" : "bg-muted text-foreground"}`}>{hora}</span>
                    </td>
                    {diasComSessao.map(d => {
                      const celulas = mapaCelulas[`${d}|||${hora}`] || []
                      const dominante = unidadeDominante(turno.horasTurno, d)
                      return (
                        <td key={d} className="px-0.5 py-0">
                          {celulas.map((c, ci) => {
                            const combinaComDominante = c.unidade === dominante
                            return (
                              <div key={ci} className={`mb-0.5 flex h-[64px] flex-col justify-center overflow-hidden rounded-lg border px-2 py-1.5 ${c.proposta ? "border-[var(--pp-border)] pp-tom pp-t-verde bg-[var(--c-suave)] text-[var(--c-tinta)]" : "border-[var(--pp-border)] bg-[var(--pp-muted)] text-[var(--pp-ink)]"}`}>
                                <div className="flex min-w-0 items-center justify-between gap-1">
                                  <span className="min-w-0 truncate text-[11px] font-bold leading-tight inherit">{c.terapia}</span>
                                  {!combinaComDominante && c.unidade && c.unidade !== "Desconhecida" && (
                                    <span className={`shrink-0 rounded px-1 text-[9px] font-black leading-tight ${estiloUnidade(c.unidade).bg} ${estiloUnidade(c.unidade).text}`}>
                                      {unidadeExibicao(c.unidade)}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] opacity-80">{fmtName(c.prof)}</div>
                                {c.proposta && <div className="mt-0.5 text-[10px] font-bold opacity-90">Sessão hipotética</div>}
                              </div>
                            )
                          })}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </ScheduleModal>
  )
}
