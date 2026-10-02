"use client"

// Antes/depois visual de um remanejamento (Tarefa 5) — mostra exatamente qual
// sessão sai do lugar, para onde vai, e onde entra a sessão hipotética de quem
// vai ocupar o horário liberado (um novo profissional a contratar, ou um
// profissional já existente ganhando capacidade — ver `profissionalHipotetico`).
// Existe porque descrever isso só em texto não deixa claro o suficiente qual
// sessão específica está sendo movida.

import { useMemo } from "react"
import { Fragment } from "react"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { Button } from "@/components/ui/button"
import { DIAS_UTIL, estiloUnidade, unidadeExibicao } from "@/lib/cronograma/constants"
import { diaCurto, fmtName } from "@/lib/cronograma/helpers"
import type { CsvRow } from "@/types/cronograma"
import type { RemanejamentoDetalhe } from "@/lib/cronograma/sugestaoContratacaoTypes"

interface Props {
  paciente: string
  terapiaHipotetica: string
  /** Quem passa a ocupar o horário liberado — "Novo profissional" (contratação) por padrão, ou o nome de um profissional já existente (disponibilidade interna). */
  profissionalHipotetico?: string
  remanejamento: RemanejamentoDetalhe
  cRows: CsvRow[]
  onClose: () => void
}

type Tag = "existente" | "sai" | "movida" | "hipotetica"

interface Celula { terapia: string; prof: string; tag: Tag; unidade: string }

function hiStr(r: CsvRow): string { return String(r.HI_str || "") }

const ESTILO_CELULA: Record<Tag, string> = {
  existente: "border-[var(--pp-border)] bg-[var(--pp-muted)] text-[var(--pp-ink)]",
  sai: "border-[var(--pp-border)] pp-tom pp-t-vermelho bg-[var(--c-suave)] text-[var(--c-tinta)]",
  movida: "border-[var(--pp-border)] pp-tom pp-t-azul bg-[var(--c-suave)] text-[var(--c-tinta)]",
  hipotetica: "border-[var(--pp-border)] pp-tom pp-t-verde bg-[var(--c-suave)] text-[var(--c-tinta)]",
}

const ROTULO_CELULA: Record<Tag, string> = {
  existente: "", sai: "Realocar", movida: "Sessão Realocada", hipotetica: "Sessão hipotética",
}

// Manhã: 08:00-12:00 · Tarde: 12:30-17:40 — mesmo corte de AgendaProfissional
// (DisponibilidadeInternaView.tsx), reaproveitado aqui pra mostrar 1 selo de
// unidade dominante por turno em vez de repetir a unidade em cada sessão.
// Corte em "12:30" — pedido do usuário 2026-08-17: 12:30 conta como Tarde.
const CORTE_TARDE = "12:30"

function Grade({ mapa, titulo, dias, horas }: { mapa: Record<string, Celula>; titulo: string; dias: string[]; horas: string[] }) {
  const horasManha = horas.filter(h => h < CORTE_TARDE)
  const horasTarde = horas.filter(h => h >= CORTE_TARDE)

  function unidadeDominante(horasTurno: string[], dia: string): string | null {
    const contagem = new Map<string, number>()
    for (const hora of horasTurno) {
      const c = mapa[`${dia}|||${hora}`]
      if (!c) continue
      contagem.set(c.unidade, (contagem.get(c.unidade) ?? 0) + 1)
    }
    let dominante: string | null = null
    let max = 0
    for (const [unidade, qtd] of contagem) {
      if (qtd > max) { dominante = unidade; max = qtd }
    }
    return dominante
  }

  return (
    <div>
      <div className="mb-2 text-sm font-extrabold text-foreground">{titulo}</div>
      {/* table-fixed + colgroup: a largura de cada coluna de dia é fixa
          (128px), independente de o paciente ter ou não sessão naquele dia —
          pedido do usuário pra as 5 colunas (Segunda a Sexta) nunca mudarem
          de largura entre si. Mesmo esquema em PacienteAgendaHipoteticaModal
          (oportunidade direta), pra manter layout/tamanho idênticos entre os
          dois modais. */}
      <table className="table-fixed border-collapse text-[11px]" style={{ width: `${56 + dias.length * 128}px` }}>
        <colgroup>
          <col style={{ width: 56 }} />
          {dias.map(d => <col key={d} style={{ width: 128 }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="w-14" />
            {dias.map(d => (
              <th key={d} className="pb-1.5 text-center text-[11px] font-bold uppercase text-foreground">{diaCurto(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {([
            { label: "Manhã", horasTurno: horasManha },
            { label: "Tarde", horasTurno: horasTarde },
          ] as const).map(turno => turno.horasTurno.length === 0 ? null : (
            <Fragment key={turno.label}>
              <tr className="border-t border-border bg-muted/40">
                <td className="py-1.5 pr-2 text-right text-[11px] font-black uppercase tracking-widest text-foreground/70">{turno.label}</td>
                {dias.map(dia => {
                  const u = unidadeDominante(turno.horasTurno, dia)
                  return (
                    <td key={dia} className="px-0.5 py-0">
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
                    <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[13px] font-bold tabular-nums text-foreground">{hora}</span>
                  </td>
                  {dias.map(dia => {
                    const c = mapa[`${dia}|||${hora}`]
                    if (!c) return <td key={dia} className="px-0.5 py-0" />
                    const dominante = unidadeDominante(turno.horasTurno, dia)
                    const combinaComDominante = c.unidade === dominante
                    return (
                      <td key={dia} className="px-0.5 py-0">
                        <div className={`flex h-[64px] flex-col justify-center overflow-hidden rounded-lg border px-2 py-1.5 ${ESTILO_CELULA[c.tag]}`}>
                          <div className="flex min-w-0 items-center justify-between gap-1">
                            <span className="min-w-0 truncate text-[11px] font-bold leading-tight inherit">{c.terapia}</span>
                            {!combinaComDominante && (
                              <span className={`shrink-0 rounded px-1 text-[9px] font-black leading-tight ${estiloUnidade(c.unidade).bg} ${estiloUnidade(c.unidade).text}`}>
                                {unidadeExibicao(c.unidade)}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] opacity-80">{fmtName(c.prof)}</div>
                          {!!ROTULO_CELULA[c.tag] && (
                            <div className="mt-0.5 text-[10px] font-bold opacity-90">{ROTULO_CELULA[c.tag]}</div>
                          )}
                        </div>
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
  )
}

export function RemanejamentoDetalheModal({
  paciente, terapiaHipotetica, profissionalHipotetico = "Novo profissional", remanejamento: r, cRows, onClose,
}: Props) {
  const convenio = useMemo(
    () => cRows.find(row => row["Nome Favorecido"] === paciente && row["Convênio"])?.["Convênio"] as string | undefined,
    [cRows, paciente],
  )

  // Semana COMPLETA do paciente, não só os dias envolvidos no remanejamento —
  // pedido explícito pra dar contexto total do cronograma, antes e depois.
  const sessoesAtuais = useMemo(() => {
    const vistos = new Set<string>()
    const res: { dia: string; hora: string; terapia: string; prof: string; unidade: string }[] = []
    for (const row of cRows) {
      if (row["Nome Favorecido"] !== paciente || row["Status do Agendamento"] !== "Agendado") continue
      const k = `${row["Dia da Semana"]}|||${hiStr(row)}`
      if (vistos.has(k)) continue
      vistos.add(k)
      res.push({ dia: row["Dia da Semana"], hora: hiStr(row), terapia: row.Terapia, prof: row.Profissional, unidade: String(row.Unidade || "Desconhecida") })
    }
    return res
  }, [cRows, paciente])

  // Segunda a sexta sempre, mesmo em dias sem nenhuma sessão do paciente —
  // pedido do usuário pra dar visão da semana inteira, não só dos dias
  // envolvidos no remanejamento.
  const dias = [...DIAS_UTIL]

  function montarMapa(fase: "antes" | "depois"): Record<string, Celula> {
    const mapa: Record<string, Celula> = {}
    // Unidade do próprio profissional remanejado (a sessão "movida" fica na
    // unidade onde ele já atua, não necessariamente na unidade-alvo `r.unidade`
    // da vaga que a sessão hipotética vai ocupar).
    let unidadeConflito = "Desconhecida"
    for (const s of sessoesAtuais) {
      const ehConflito = s.dia === r.de.dia && s.hora === r.de.hora
      if (ehConflito) {
        unidadeConflito = s.unidade
        if (fase === "antes") mapa[`${s.dia}|||${s.hora}`] = { terapia: s.terapia, prof: s.prof, tag: "sai", unidade: s.unidade }
        continue // no "depois" essa posição vira a sessão hipotética, tratada abaixo
      }
      mapa[`${s.dia}|||${s.hora}`] = { terapia: s.terapia, prof: s.prof, tag: "existente", unidade: s.unidade }
    }
    if (fase === "depois") {
      mapa[`${r.para.dia}|||${r.para.hora}`] = { terapia: r.terapiaRemanejada, prof: r.profissionalMantido, tag: "movida", unidade: unidadeConflito }
      mapa[`${r.de.dia}|||${r.de.hora}`] = { terapia: terapiaHipotetica, prof: profissionalHipotetico, tag: "hipotetica", unidade: r.unidade }
    }
    return mapa
  }

  const mapaAntes = montarMapa("antes")
  const mapaDepois = montarMapa("depois")
  const horas = [...new Set([...Object.keys(mapaAntes), ...Object.keys(mapaDepois)].map(k => k.split("|||")[1]))].sort()

  return (
    <ScheduleModal
      title={paciente}
      maxWidth={820}
      onClose={onClose}
      subtitle={convenio ? <span className="text-[13px] font-semibold">Convênio: {convenio}</span> : undefined}
      footer={<Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>}
    >
      <div className="mb-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30" /> Sai do lugar</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30" /> Entra no novo horário</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30" /> Sessão hipotética</span>
      </div>
      <div className="flex flex-col gap-6">
        <div className="overflow-x-auto"><Grade mapa={mapaAntes} titulo="Antes" dias={dias} horas={horas} /></div>
        <div className="overflow-x-auto"><Grade mapa={mapaDepois} titulo="Depois" dias={dias} horas={horas} /></div>
      </div>
    </ScheduleModal>
  )
}
