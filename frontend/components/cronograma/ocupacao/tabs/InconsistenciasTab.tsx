"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CalendarDays, CheckCircle2, Trash2 } from "lucide-react"
import { HORAS_GRID } from "@/lib/cronograma/constants"
import { pm, fm, fmtName, getTurno } from "@/lib/cronograma/helpers"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { SegmentedTabs, type SegmentedTab } from "@/components/cronograma/ui/SegmentedTabs"
import type { IncItem, IncTipo } from "@/lib/cronograma/inconsistencias"
import type { CsvRow } from "@/types/cronograma"

const SK = "cron_excecoes_v1"

type Excecao = { obs: string; confirmedAt: number }

const TIPO_LABEL: Record<IncTipo, string> = {
  unidade_turno:      "Unidade no Turno (Pac.)",
  buraco:             "Buraco entre Sessões",
  min_sessoes:        "Menos de 2 Sessões/Dia",
  exibicao_aba:       "Exibição ABA",
  exibicao_hs:        "Exibição HS",
  exibicao_ae:        "Exibição AE / ASSIM / Gratuidade",
  prof_unidade_turno: "Unidade no Turno (Prof.)",
}

// Par tonal por tipo (dark-aware) — substitui os hex de TIPO_COLOR. Sete hues
// distintos, todos com suporte de dark mode em globals.css.
const TIPO_TONE: Record<IncTipo, { bg: string; text: string }> = {
  unidade_turno:      { bg: "bg-orange-50 dark:bg-orange-950/30", text: "text-orange-700 dark:text-orange-400" },
  buraco:             { bg: "bg-rose-50 dark:bg-rose-950/30",     text: "text-rose-700 dark:text-rose-400" },
  min_sessoes:        { bg: "bg-amber-50 dark:bg-amber-950/30",   text: "text-amber-700 dark:text-amber-400" },
  exibicao_aba:       { bg: "bg-sky-50 dark:bg-sky-950/30",       text: "text-sky-700 dark:text-sky-400" },
  exibicao_hs:        { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-400" },
  exibicao_ae:        { bg: "bg-pink-50 dark:bg-pink-950/30",     text: "text-pink-700 dark:text-pink-400" },
  prof_unidade_turno: { bg: "bg-teal-50 dark:bg-teal-950/30",     text: "text-teal-700 dark:text-teal-400" },
}

// Par tonal por unidade (usado nas células da grade do profissional).
const UNID_TONE: Record<string, { bg: string; text: string }> = {
  Realengo:       { bg: "bg-sky-50 dark:bg-sky-950/30",       text: "text-sky-700 dark:text-sky-400" },
  Fazendinha:     { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-400" },
  "Padre Miguel": { bg: "bg-amber-50 dark:bg-amber-950/30",   text: "text-amber-700 dark:text-amber-400" },
}

const DIAS_ORDER = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"]

interface Props {
  items: IncItem[]
  cRows: CsvRow[]
}

function TipoPill({ tipo, className = "" }: { tipo: IncTipo; className?: string }) {
  const t = TIPO_TONE[tipo]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${t.bg} ${t.text} ${className}`}>
      {TIPO_LABEL[tipo]}
    </span>
  )
}

// ─── Schedule ──────────────────────────────────────────────────────────────

interface SessaoView {
  dia: string
  hora: string
  terapia: string
  terapiaExib: string
  prof: string
  unidade: string
  flagged: boolean
  flagDetalhe: string
  missing?: boolean  // slot vazio injetado para representar buraco/sessão faltante
}

function buildSchedule(pac: string, cRows: CsvRow[], incItems: IncItem[]): Record<string, SessaoView[]> {
  const flagMap = new Map<string, string[]>()
  for (const i of incItems) {
    if (i.pac === pac) {
      const k = `${i.dia}|||${i.hora}|||${i.terapia}`
      const detail = i.detalhe + (i.terapiaExibAtual ? ` (atual: "${i.terapiaExibAtual}", esperado: "${i.terapiaExibEsperada}")` : "")
      flagMap.set(k, [...(flagMap.get(k) || []), detail])
    }
  }

  const byDia: Record<string, SessaoView[]> = {}
  for (const r of cRows) {
    if (String(r["Nome Favorecido"] || "").trim() !== pac) continue
    if (r["Status do Agendamento"] !== "Agendado") continue
    const dia = String(r["Dia da Semana"] || "").trim()
    const hora = String(r["HI_str"] || String(r["Hora Inicial"] || "").slice(0, 5) || "")
    const terapia = String(r["Terapia"] || "").trim()
    const terapiaExib = String(r["Terapia Exibição"] || r["Terapia Exibicao"] || "—").trim() || "—"
    const prof = String(r["Profissional"] || "").trim()
    const unidade = String((r as Record<string, unknown>)["Unidade"] || "").trim()
    const k = `${dia}|||${hora}|||${terapia}`
    const detalhe = (flagMap.get(k) || []).join(" · ")
    if (!byDia[dia]) byDia[dia] = []
    byDia[dia].push({ dia, hora, terapia, terapiaExib, prof, unidade, flagged: !!detalhe, flagDetalhe: detalhe })
  }

  for (const d of Object.keys(byDia)) {
    byDia[d].sort((a, b) => a.hora.localeCompare(b.hora))
  }

  // ── Injetar placeholders para buracos e dias com 1 sessão ─────────────────
  const existingHoras = (dia: string) => new Set((byDia[dia] ?? []).map(s => s.hora))

  function addPlaceholder(dia: string, hora: string, motivo: string) {
    if (!byDia[dia]) return
    if (existingHoras(dia).has(hora)) return
    byDia[dia].push({
      dia, hora, terapia: "", terapiaExib: "", prof: "", unidade: "",
      flagged: true, flagDetalhe: motivo, missing: true,
    })
    byDia[dia].sort((a, b) => a.hora.localeCompare(b.hora))
  }

  for (const i of incItems) {
    if (i.pac !== pac) continue

    if (i.tipo === "buraco") {
      // i.hora é a sessão B (depois do buraco); A é a sessão imediatamente anterior
      const sessoes = byDia[i.dia] ?? []
      const bIdx = sessoes.findIndex(s => s.hora === i.hora && !s.missing)
      if (bIdx > 0) {
        const aMin = pm(sessoes[bIdx - 1].hora)
        if (aMin !== null) addPlaceholder(i.dia, fm(aMin + 40), "Slot vazio — buraco no cronograma")
      }
    }

    if (i.tipo === "min_sessoes") {
      const hMin = pm(i.hora)
      if (hMin === null) continue
      const minManha = pm("08:00") ?? 480
      const existing = existingHoras(i.dia)
      const beforeHora = fm(hMin - 40)
      const afterHora  = fm(hMin + 40)
      // Prefere slot anterior; se ocupado (ex: supervisão/coord), tenta posterior
      if (hMin - 40 >= minManha && !existing.has(beforeHora)) {
        addPlaceholder(i.dia, beforeHora, "Slot vazio — falta 1 sessão no dia")
      } else if (!existing.has(afterHora)) {
        addPlaceholder(i.dia, afterHora, "Slot vazio — falta 1 sessão no dia")
      }
    }
  }

  return byDia
}

// ─── Modal: cronograma do paciente ──────────────────────────────────────────

interface CronViewModalProps {
  pac: string
  conv: string
  cRows: CsvRow[]
  items: IncItem[]
  onClose: () => void
}

function CronViewModal({ pac, conv, cRows, items, onClose }: CronViewModalProps) {
  const byDia = useMemo(() => buildSchedule(pac, cRows, items), [pac, cRows, items])
  const dias = DIAS_ORDER.filter(d => byDia[d])

  // Grade: "dia|||hora" → SessaoView[]
  const cMap: Record<string, SessaoView[]> = {}
  for (const d of dias) {
    for (const s of byDia[d]) {
      const k = `${d}|||${s.hora}`
      if (!cMap[k]) cMap[k] = []
      cMap[k].push(s)
    }
  }
  const horasGrid = HORAS_GRID.filter(h => dias.some(d => cMap[`${d}|||${h}`]?.length))

  // Notas de inconsistência para exibir abaixo da grade
  const flagNotes = dias.flatMap(d =>
    (byDia[d] ?? []).filter(s => s.flagged && s.flagDetalhe).map(s => ({
      label: `${d.replace("-feira", "")} ${s.hora}`,
      detail: s.flagDetalhe,
    }))
  )

  return (
    <ScheduleModal title={pac} subtitle={conv || undefined} maxWidth={820} onClose={onClose}>
      {dias.length === 0 ? (
        <div className="text-center text-muted-foreground text-[13px] py-6">
          Nenhuma sessão agendada encontrada no CSV.
        </div>
      ) : (
        <>
          <table className="w-full min-w-[320px] border-collapse">
            <thead>
              <tr>
                <th className="w-12 pb-1.5 pr-2 text-right text-[11px] font-normal text-muted-foreground">Hora</th>
                {dias.map(d => (
                  <th key={d} className="min-w-[120px] pb-1.5 text-center text-[13px] font-extrabold text-foreground">
                    {d.replace("-feira", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horasGrid.map(hora => (
                <tr key={hora} className="border-t border-border">
                  <td className="pr-2 pt-1.5 text-right align-top font-mono text-[13px] font-extrabold text-foreground tabular-nums">{hora}</td>
                  {dias.map(d => {
                    const cells = cMap[`${d}|||${hora}`] || []
                    return (
                      <td key={d} className="p-0.5 align-top">
                        {cells.map((s, ci) => (
                          s.missing ? (
                            <div key={ci} className="mb-0.5 flex min-h-[48px] items-center justify-center rounded-lg border border-dashed border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-2 py-1.5">
                              <span className="text-[10px] italic text-rose-600 dark:text-rose-400">slot vazio</span>
                            </div>
                          ) : (
                            <div key={ci} className={`mb-0.5 flex min-h-[58px] flex-col gap-0.5 rounded-lg border px-2 py-1.5 ${s.flagged ? "border-amber-400 dark:border-amber-700 bg-amber-100/70 dark:bg-amber-950/40" : "border-border bg-muted"}`}>
                              <div className="text-[11px] font-bold leading-tight text-foreground">{s.terapia}</div>
                              {s.terapiaExib && s.terapiaExib !== "—" && s.terapiaExib !== s.terapia && (
                                <div className={`text-[10px] leading-tight ${s.flagged ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>({s.terapiaExib})</div>
                              )}
                              <div className="text-[10px] text-muted-foreground">{fmtName(s.prof)}</div>
                              {s.flagged && <AlertTriangle size={11} className="mt-auto text-amber-600 dark:text-amber-400" />}
                            </div>
                          )
                        ))}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Notas de inconsistência */}
          {flagNotes.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {flagNotes.map((n, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={12} className="mt-px shrink-0" /> <span>{n.label} — {n.detail}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ScheduleModal>
  )
}

// ─── Modal: cronograma do profissional ──────────────────────────────────────

interface ProfViewModalProps {
  prof: string
  cRows: CsvRow[]
  onClose: () => void
}

function ProfViewModal({ prof, cRows, onClose }: ProfViewModalProps) {
  // Todos os slots do profissional (agendado + livre)
  const sessoes = useMemo(() => {
    return cRows
      .filter(r => String(r["Profissional"] || "").trim() === prof)
      .map(r => {
        const rawStatus = String(r["Status do Agendamento"] || "").trim().toLowerCase()
        return {
          dia:       String(r["Dia da Semana"] || "").trim(),
          hora:      String(r["HI_str"] || String(r["Hora Inicial"] || "").slice(0, 5) || "").trim(),
          pac:       String(r["Nome Favorecido"] || "").trim(),
          terapia:   String(r["Terapia"] || "").trim(),
          unidade:   String((r as Record<string, unknown>)["Unidade"] || "").trim(),
          livre:     rawStatus === "livre",
          agendado:  rawStatus === "agendado",
        }
      })
      .filter(s => s.livre || s.agendado)
  }, [prof, cRows])

  // Maioria de unidade por dia+turno (sobre todos os slots, inclusive livres)
  const mainUnidade = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const s of sessoes) {
      if (!s.unidade) continue
      const k = `${s.dia}|||${getTurno(s.hora)}`
      if (!map[k]) map[k] = {}
      map[k][s.unidade] = (map[k][s.unidade] || 0) + 1
    }
    const result: Record<string, string> = {}
    for (const [k, cnt] of Object.entries(map)) {
      result[k] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
    }
    return result
  }, [sessoes])

  const dias  = DIAS_ORDER.filter(d => sessoes.some(s => s.dia === d))
  const horas = HORAS_GRID.filter(h => sessoes.some(s => s.hora === h))

  const cMap = useMemo(() => {
    const m: Record<string, typeof sessoes> = {}
    for (const s of sessoes) {
      const k = `${s.dia}|||${s.hora}`
      if (!m[k]) m[k] = []
      m[k].push(s)
    }
    return m
  }, [sessoes])

  // Erros: qualquer slot (agendado ou livre) na unidade errada
  const erros = useMemo(() => {
    const out: { dia: string; hora: string; unidade: string; mainU: string; livre: boolean }[] = []
    for (const s of sessoes) {
      const mainU = mainUnidade[`${s.dia}|||${getTurno(s.hora)}`] ?? ""
      if (mainU && s.unidade && s.unidade !== mainU) {
        out.push({ dia: s.dia, hora: s.hora, unidade: s.unidade, mainU, livre: s.livre })
      }
    }
    return out
  }, [sessoes, mainUnidade])

  return (
    <ScheduleModal
      title={fmtName(prof)}
      subtitle="Agenda semanal completa"
      warning={erros.length > 0
        ? <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> {erros.length} {erros.length === 1 ? "slot fora" : "slots fora"} da unidade do turno (agendados e livres) — marcados em vermelho</span>
        : undefined}
      maxWidth={900}
      onClose={onClose}
    >
      {sessoes.length === 0 ? (
        <div className="text-center text-muted-foreground text-[13px] py-6">
          Nenhum slot encontrado no CSV para este profissional.
        </div>
      ) : (
        <>
          <table className="w-full min-w-[420px] border-collapse">
            <thead>
              <tr>
                <th className="w-[52px] pb-1.5 pr-2.5 text-right text-[11px] font-normal text-muted-foreground">Hora</th>
                {dias.map(d => (
                  <th key={d} className="min-w-[140px] pb-1.5 text-center text-[13px] font-extrabold text-foreground">
                    {d.replace("-feira", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horas.map(hora => (
                <tr key={hora} className="border-t border-border">
                  <td className="pr-2.5 pt-1.5 text-right align-top font-mono text-[13px] font-extrabold text-foreground tabular-nums">{hora}</td>
                  {dias.map(d => {
                    const cells = cMap[`${d}|||${hora}`] || []
                    return (
                      <td key={d} className="p-0.5 align-top">
                        {cells.map((s, ci) => {
                          const mainU = mainUnidade[`${s.dia}|||${getTurno(s.hora)}`] ?? ""
                          const flagged = !!mainU && !!s.unidade && s.unidade !== mainU
                          const badge = UNID_TONE[s.unidade]
                          if (s.livre) {
                            return (
                              <div key={ci} className={`mb-0.5 flex min-h-[52px] flex-col gap-0.5 rounded-lg border border-dashed px-2 py-1.5 ${flagged ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30" : "border-border bg-muted"}`}>
                                <div className={`text-[10px] font-semibold italic ${flagged ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>Livre</div>
                                <div className={`mt-auto flex items-center gap-1 text-[10px] font-bold ${flagged ? "text-rose-600 dark:text-rose-400" : (badge?.text ?? "text-muted-foreground")}`}>
                                  {flagged && <AlertTriangle size={10} />}
                                  {s.unidade || "—"}
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={ci} className={`mb-0.5 flex min-h-[60px] flex-col gap-0.5 rounded-lg border px-2 py-1.5 ${flagged ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30" : `border-border ${badge?.bg ?? "bg-muted"}`}`}>
                              <div className="text-[11px] font-bold leading-tight text-foreground">{fmtName(s.pac)}</div>
                              <div className="text-[10px] leading-tight text-muted-foreground">{s.terapia}</div>
                              <div className={`mt-auto flex items-center gap-1 text-[10px] font-bold ${flagged ? "text-rose-600 dark:text-rose-400" : (badge?.text ?? "text-muted-foreground")}`}>
                                {flagged && <AlertTriangle size={10} />}
                                {s.unidade}
                              </div>
                            </div>
                          )
                        })}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Resumo das violações */}
          {erros.length > 0 && (
            <div className="mt-3.5 flex flex-col gap-1">
              {erros.map((e, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                  <AlertTriangle size={12} className="mt-px shrink-0" />
                  <span>{e.dia.replace("-feira", "")} {e.hora} ({e.livre ? "livre" : "agendado"}) — unidade <strong>{e.unidade}</strong>, mas maioria do turno está em <strong>{e.mainU}</strong></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ScheduleModal>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

const INPUT_CLS = "flex-1 min-w-[220px] rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
const SELECT_CLS = "rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"

export function InconsistenciasTab({ items, cRows }: Props) {
  const [subTab, setSubTab] = useState<"inc" | "exc">("inc")
  const [excecoes, setExcecoes] = useState<Record<string, Excecao>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draftObs, setDraftObs] = useState("")
  const [busca, setBusca] = useState("")
  const [filtroTipo, setFiltroTipo] = useState<IncTipo | "">("")
  const [viewItem, setViewItem] = useState<IncItem | null>(null)
  const [viewProfItem, setViewProfItem] = useState<IncItem | null>(null)

  useEffect(() => {
    try {
      const s = localStorage.getItem(SK)
      if (s) setExcecoes(JSON.parse(s))
    } catch {}
  }, [])

  function persistExcecoes(next: Record<string, Excecao>) {
    setExcecoes(next)
    try { localStorage.setItem(SK, JSON.stringify(next)) } catch {}
  }

  function promoverExcecao(id: string) {
    if (!draftObs.trim()) return
    persistExcecoes({ ...excecoes, [id]: { obs: draftObs.trim(), confirmedAt: Date.now() } })
    setExpandedId(null)
    setDraftObs("")
  }

  function removerExcecao(id: string) {
    const next = { ...excecoes }
    delete next[id]
    persistExcecoes(next)
  }

  const inconsistencias = useMemo(() => items.filter(i => !excecoes[i.id]), [items, excecoes])
  const excList = useMemo(
    () => items.filter(i => excecoes[i.id]).map(i => ({ item: i, exc: excecoes[i.id] })),
    [items, excecoes],
  )

  const filtered = useMemo(() => {
    let list = inconsistencias
    if (busca.trim()) {
      const b = busca.toLowerCase()
      list = list.filter(i => i.pac.toLowerCase().includes(b) || i.prof.toLowerCase().includes(b))
    }
    if (filtroTipo) list = list.filter(i => i.tipo === filtroTipo)
    return [...list].sort((a, b) => {
      const da = DIAS_ORDER.indexOf(a.dia) + 1 || 99
      const db = DIAS_ORDER.indexOf(b.dia) + 1 || 99
      return da - db || a.hora.localeCompare(b.hora) || a.pac.localeCompare(b.pac)
    })
  }, [inconsistencias, busca, filtroTipo])

  function abrevNome(nome: string) {
    const parts = nome.split(" ").filter(Boolean)
    if (parts.length <= 2) return nome
    return `${parts[0]} ${parts.slice(1).filter(p => p.length > 2).map(p => p[0] + ".").join(" ")} ${parts[parts.length - 1]}`
  }

  const subTabs: SegmentedTab<"inc" | "exc">[] = [
    { value: "inc", label: <><AlertTriangle size={12} /> Regras feridas</>, count: inconsistencias.length },
    { value: "exc", label: <><CheckCircle2 size={12} /> Exceções</>, count: excList.length },
  ]

  return (
    <div className="space-y-3">
      {/* Sub-abas */}
      <SegmentedTabs value={subTab} onChange={setSubTab} tabs={subTabs} ariaLabel="Regras ou exceções" />

      {/* ── Aba Regras feridas ─────────────────────────────────────── */}
      {subTab === "inc" && (
        <>
          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar paciente ou profissional…"
              aria-label="Buscar paciente ou profissional"
              className={INPUT_CLS}
            />
            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value as IncTipo | "")}
              aria-label="Filtrar por tipo"
              className={SELECT_CLS}
            >
              <option value="">Todos os tipos</option>
              {(Object.keys(TIPO_LABEL) as IncTipo[]).map(t => (
                <option key={t} value={t}>{TIPO_LABEL[t]}</option>
              ))}
            </select>
          </div>

          {/* Resumo por tipo */}
          {inconsistencias.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TIPO_LABEL) as IncTipo[]).map(t => {
                const cnt = inconsistencias.filter(i => i.tipo === t).length
                if (!cnt) return null
                const c = TIPO_TONE[t]
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFiltroTipo(filtroTipo === t ? "" : t)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-opacity ${c.bg} ${c.text} ${filtroTipo && filtroTipo !== t ? "opacity-45" : ""}`}
                  >
                    {TIPO_LABEL[t]} · {cnt}
                  </button>
                )
              })}
            </div>
          )}

          {/* Lista */}
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card py-10 text-center text-[13px] text-muted-foreground">
              {inconsistencias.length === 0
                ? "Nenhuma regra ferida detectada. Carregue CSV e laudos para analisar."
                : "Nenhum resultado para o filtro selecionado."}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map(item => {
                const isExpanded = expandedId === item.id
                return (
                  <div key={item.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    {/* Linha principal */}
                    <div className="flex flex-wrap items-start gap-2.5 px-3.5 py-2.5">
                      <TipoPill tipo={item.tipo} className="self-center" />

                      {/* Info */}
                      <div className="flex-[1_1_160px]">
                        <div className="text-[13px] font-bold text-foreground">{abrevNome(item.pac)}</div>
                        <div className="mt-px text-[11px] text-muted-foreground">
                          {item.dia} {item.hora} · {item.terapia}
                        </div>
                        {item.conv && <div className="text-[10px] text-muted-foreground">{item.conv}</div>}
                      </div>

                      {/* Detalhe */}
                      <div className="flex-[2_1_200px] self-center text-xs text-foreground">
                        {item.detalhe}
                        {item.terapiaExibAtual && (
                          <div className="mt-0.5 text-[11px]">
                            <span className="text-rose-600 dark:text-rose-400">Atual: &quot;{item.terapiaExibAtual}&quot;</span>
                            {" → "}
                            <span className="text-[var(--status-ok)]">Esperado: &quot;{item.terapiaExibEsperada}&quot;</span>
                          </div>
                        )}
                      </div>

                      {/* Botões */}
                      <div className="flex flex-wrap gap-1.5 self-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.tipo === "prof_unidade_turno") setViewProfItem(item)
                            else setViewItem(item)
                          }}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/50 transition-colors"
                        >
                          <CalendarDays size={12} /> Ver
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedId(isExpanded ? null : item.id)
                            if (!isExpanded) setDraftObs("")
                          }}
                          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors ${isExpanded ? "bg-muted" : "bg-card hover:bg-muted/50"}`}
                        >
                          {isExpanded ? "Cancelar" : "→ Exceção"}
                        </button>
                      </div>
                    </div>

                    {/* Formulário de exceção inline */}
                    {isExpanded && (
                      <div className="flex items-end gap-2 border-t border-border bg-muted/40 px-3.5 py-2.5">
                        <textarea
                          value={draftObs}
                          onChange={e => setDraftObs(e.target.value)}
                          placeholder="Justificativa para a exceção…"
                          rows={2}
                          className="flex-1 resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={() => promoverExcecao(item.id)}
                          disabled={!draftObs.trim()}
                          className="whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Confirmar
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Aba Exceções ──────────────────────────────────────────────── */}
      {subTab === "exc" && (
        <>
          {excList.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card py-10 text-center text-[13px] text-muted-foreground">
              Nenhuma exceção registrada ainda.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {excList.map(({ item, exc }) => (
                <div key={item.id} className="flex flex-wrap items-start gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-2.5">
                  <TipoPill tipo={item.tipo} className="self-center" />

                  <div className="flex-[1_1_160px]">
                    <div className="text-[13px] font-bold text-foreground">{abrevNome(item.pac)}</div>
                    <div className="mt-px text-[11px] text-muted-foreground">
                      {item.dia} {item.hora} · {item.terapia}
                    </div>
                  </div>

                  <div className="flex-[2_1_200px]">
                    <div className="text-xs italic text-foreground">&quot;{exc.obs}&quot;</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(exc.confirmedAt).toLocaleDateString("pt-BR")}
                    </div>
                  </div>

                  <div className="flex gap-1.5 self-center">
                    <button
                      type="button"
                      onClick={() => setViewItem(item)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <CalendarDays size={12} /> Ver
                    </button>
                    <button
                      type="button"
                      onClick={() => removerExcecao(item.id)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                    >
                      <Trash2 size={12} /> Remover Exceção
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Modal Ver Cronograma ──────────────────────────────────────── */}
      {viewItem && (
        <CronViewModal
          pac={viewItem.pac}
          conv={viewItem.conv}
          cRows={cRows}
          items={items}
          onClose={() => setViewItem(null)}
        />
      )}

      {/* ── Modal Ver Cronograma do Profissional ─────────────────────── */}
      {viewProfItem && (
        <ProfViewModal
          prof={viewProfItem.prof}
          cRows={cRows}
          onClose={() => setViewProfItem(null)}
        />
      )}
    </div>
  )
}