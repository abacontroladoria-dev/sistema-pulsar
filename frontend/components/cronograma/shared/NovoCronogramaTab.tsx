"use client"

import { useMemo, useState } from "react"
import { B, DIAS_LIST, HORAS_GRID, REGRAS_NOVO_CRON } from "@/lib/cronograma/constants"
import { buildNewCronograma, type NovoCronogramaResult, type EspEntry } from "@/lib/cronograma/novoCronograma"
import { construirProfissionaisOcupados, fm, fmtName, pm, profissionalEstaOcupado } from "@/lib/cronograma/helpers"
import type { CsvRow, DispRow, LaudoRow } from "@/types/cronograma"

interface Props {
  cRows: CsvRow[]
  lRows: LaudoRow[]
  dispRows: DispRow[]
}

const ESP_ORD_T = [
  "Fonoaudiologia", "Terapia Ocupacional", "Psicologia ABA", "Musicoterapia",
  "Psicopedagogia", "Psicomotricidade", "Terapia Alimentar", "Fisioterapia",
  "Fisioterapia Aquática", "Equoterapia", "Arteterapia", "Psicologia", "Habilidades Sociais",
]

// Acento por especialidade — um único hex, do qual derivamos fundo e borda com alpha.
// Tinta translúcida sobre var(--card) funciona nos dois temas (claro e escuro); o nome da
// terapia usa var(--card-foreground) (legível sempre) e o acento fica só em detalhes.
function espAccent(esp: string): string {
  if (esp === "Psicologia ABA") return B.blue
  if (esp === "Fonoaudiologia") return B.pink
  if (esp === "Terapia Ocupacional") return B.orange
  if (esp === "Musicoterapia") return B.purple
  return B.green
}

const ALERTA_SEV = { error: 0, warn: 1, info: 2 } as const

export function NovoCronogramaTab({ cRows, lRows, dispRows }: Props) {
  const [paciente, setPaciente] = useState("")
  const [unidade, setUnidade] = useState("Realengo")
  const [result, setResult] = useState<NovoCronogramaResult | null>(null)

  const pacsAtivos = useMemo(() => {
    const s = new Set(
      lRows
        .filter(r => String(r["Situação"] || "").toLowerCase() === "vigente")
        .map(r => String(r["Paciente"] || "").trim())
        .filter(Boolean),
    )
    return [...s].sort()
  }, [lRows])

  const livreSlots = useMemo(() => {
    // Vaga "Livre" gêmea de um horário já agendado do mesmo profissional (ver
    // construirProfissionaisOcupados em helpers.ts) — a TiTa mantém uma linha
    // por terapia ofertada, então preencher um horário não apaga as outras
    // linhas "Livre" do mesmo profissional nesse dia/hora.
    const profOcupado = construirProfissionaisOcupados(cRows.filter(r => r["Status do Agendamento"] === "Agendado"))
    return cRows.filter(r =>
      r["Status do Agendamento"] === "Livre"
      && !profissionalEstaOcupado(profOcupado, r["Profissional"], r["Dia da Semana"], String(r.HI_str || "")),
    )
  }, [cRows])

  function handleGerar() {
    if (!paciente || lRows.length === 0 || cRows.length === 0) return
    setResult(buildNewCronograma(paciente, unidade, dispRows, lRows, livreSlots))
  }

  const diasResult = result
    ? DIAS_LIST.filter(d => result.availWindows[d] || result.schedule[d])
    : []

  const totalSess = result
    ? Object.values(result.schedule).reduce((a, ds) => a + Object.keys(ds).length, 0)
    : 0

  const espRows = result
    ? [...ESP_ORD_T.filter(e => result.espTable[e]), ...Object.keys(result.espTable).filter(e => !ESP_ORD_T.includes(e))]
    : []

  const alertasOrdenadas = result
    ? [...result.alertas].sort((a, b) => ALERTA_SEV[a.tipo] - ALERTA_SEV[b.tipo])
    : []

  const canGerar = !!paciente && lRows.length > 0 && cRows.length > 0

  // Pendências de dados (carregados pelos badges no topo da página).
  const faltando: string[] = []
  if (lRows.length === 0) faltando.push("Laudos")
  if (dispRows.length === 0) faltando.push("Disponibilidade")

  return (
    <div className="flex flex-col gap-3">
      {/* Geração */}
      <section className="rounded-[14px] border border-border bg-card shadow-sm p-4">
        <h2 className="font-extrabold mb-3 text-[14px]" style={{ color: B.navy }}>Novo cronograma do zero</h2>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label htmlFor="nc-paciente" className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Paciente</label>
            <select
              id="nc-paciente"
              value={paciente}
              onChange={e => { setPaciente(e.target.value); setResult(null) }}
              disabled={pacsAtivos.length === 0}
              className="w-full border border-input rounded-[10px] px-3 text-[13px] bg-background font-sans disabled:opacity-60"
              style={{ height: "44px" }}
            >
              <option value="">Selecionar paciente...</option>
              {pacsAtivos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <span className="block text-[12px] font-semibold text-muted-foreground mb-1.5">Unidade</span>
            <div className="flex gap-1.5" role="group" aria-label="Unidade">
              {(["Realengo", "Fazendinha", "Padre Miguel"] as const).map(u => {
                const active = unidade === u
                return (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setUnidade(u)}
                    className="flex-1 px-1 rounded-[10px] border text-[12px] font-sans transition-colors"
                    style={{
                      height: "44px",
                      border: `1px solid ${active ? B.blue : "var(--border)"}`,
                      background: active ? B.blueLt : "transparent",
                      color: active ? B.blue : "var(--card-foreground)",
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {u}
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGerar}
            disabled={!canGerar}
            className="rounded-[10px] text-white text-[13px] font-extrabold font-sans border-none transition-opacity"
            style={{ height: "44px", padding: "0 22px", background: canGerar ? B.navy : `${B.navy}55`, cursor: canGerar ? "pointer" : "not-allowed" }}
          >
            Gerar cronograma
          </button>
        </div>

        {faltando.length > 0 && (
          <p className="text-[12px] text-muted-foreground mt-3 mb-0">
            Carregue <strong style={{ color: "var(--card-foreground)" }}>{faltando.join(" e ")}</strong> nos badges no topo da página para gerar o cronograma.
          </p>
        )}
      </section>

      {result && (
        <>
          {/* Observações — alertas organizados por severidade, uma por linha */}
          {alertasOrdenadas.length > 0 && (
            <section className="rounded-[14px] border border-border bg-card p-4">
              <h3 className="font-extrabold text-[13px] mb-2" style={{ color: B.navy }}>Observações</h3>
              <ul className="flex flex-col divide-y divide-border">
                {alertasOrdenadas.map((a, i) => {
                  const cor = a.tipo === "error" ? B.red : a.tipo === "warn" ? B.amber : B.blue
                  return (
                    <li key={i} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0 text-[12px]">
                      <span aria-hidden="true" className="shrink-0" style={{ color: cor }}>
                        {a.tipo === "error" ? "❌" : a.tipo === "warn" ? "⚠️" : "ℹ️"}
                      </span>
                      <span style={{ color: "var(--card-foreground)", lineHeight: 1.45 }}>{a.msg}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* Workspace: grade (esquerda) + resumo fixo (direita) num só contêiner */}
          <div className="rounded-[14px] border border-border bg-card overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_248px]">
            <div className="min-w-0 overflow-x-auto p-4 lg:border-r border-border">
              <GradeView diasResult={diasResult} result={result} />
            </div>
            <SummaryPanel paciente={paciente} unidade={unidade} result={result} totalSess={totalSess} espRows={espRows} />
          </div>

          {/* Detalhamento do laudo */}
          <LaudoTable espRows={espRows} result={result} />

          {/* Regras — referência secundária, recolhível */}
          <details className="rounded-[14px] border border-border bg-card">
            <summary className="cursor-pointer select-none px-4 py-3 font-extrabold text-[14px] list-none" style={{ color: B.navy }}>
              📐 Regras aplicadas neste cronograma
            </summary>
            <div className="px-4 pb-4 flex flex-col gap-1.5">
              {REGRAS_NOVO_CRON.map((r, i) => (
                <div key={i} className="flex gap-3 p-2.5 rounded-[10px] text-[12px]" style={{ background: "var(--muted)" }}>
                  <span className="text-base shrink-0" aria-hidden="true">{r.icon}</span>
                  <div>
                    <div className="font-bold mb-0.5" style={{ color: B.navy }}>{r.title}</div>
                    <div className="text-muted-foreground leading-relaxed">{r.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

// ─── SUB-COMPONENTES ──────────────────────────────────────────────────────────

function SummaryPanel({
  paciente, unidade, result, totalSess, espRows,
}: {
  paciente: string; unidade: string; result: NovoCronogramaResult; totalSess: number; espRows: string[]
}) {
  const totalEsps = Object.values(result.espTable).filter((e: EspEntry) => e.vigente && e.aut > 0).length
  const alocEsps = Object.values(result.espTable).filter((e: EspEntry) => e.of > 0).length
  const barras = espRows.filter(e => (result.espTable[e]?.aut ?? 0) > 0)

  return (
    <aside className="p-4 border-t lg:border-t-0 border-border self-start lg:sticky lg:top-4">
      <div className="text-[15px] font-extrabold leading-tight" style={{ color: B.navy }}>{paciente}</div>
      <div className="text-[12px] text-muted-foreground mb-3">{unidade}</div>

      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-[28px] font-extrabold leading-none" style={{ color: B.navy }}>{totalSess}</span>
        <span className="text-[12px] text-muted-foreground">sessões alocadas</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3.5">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: B.purpleLt, color: B.purple }}>
          {alocEsps}/{totalEsps} especialidades
        </span>
        {result.turnoClinico && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: B.orangeLt, color: B.amber }}>
            🕐 {result.turnoClinico === "manha" ? "Clínica de manhã" : "Clínica à tarde"}
          </span>
        )}
      </div>

      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Ofertado / Autorizado</div>
      <div className="flex flex-col gap-2">
        {barras.length === 0 && <div className="text-[11px] text-muted-foreground">Sem especialidades autorizadas.</div>}
        {barras.map(esp => {
          const e = result.espTable[esp]
          const aut = e.aut, of = e.of
          const ok = of >= aut, none = of === 0
          const cor = ok ? B.green : none ? B.red : B.amber
          const pct = aut > 0 ? Math.min(100, Math.round((of / aut) * 100)) : (of > 0 ? 100 : 0)
          return (
            <div key={esp}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] font-semibold truncate" style={{ color: "var(--card-foreground)" }} title={esp}>{esp}</span>
                <span className="text-[11px] font-bold shrink-0" style={{ color: cor }}>{of}/{aut}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor, transition: "width 220ms cubic-bezier(0.22,1,0.36,1)" }} />
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function GradeView({ diasResult, result }: { diasResult: string[]; result: NovoCronogramaResult }) {
  return (
    <>
      <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
        <h3 className="font-extrabold text-[14px]" style={{ color: B.navy }}>📅 Grade sugerida</h3>
        <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: "var(--muted)", border: "1px dashed var(--border)" }} />
            Disponível, não preenchido
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: `${B.green}22`, border: `1px solid ${B.green}66` }} />
            Sessão alocada
          </span>
        </div>
      </div>

      {diasResult.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-[13px]">Nenhuma disponibilidade encontrada para este paciente.</div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "520px", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "52px" }} />
            {diasResult.map(d => <col key={d} style={{ width: `${Math.floor(100 / diasResult.length)}%` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: "right", paddingRight: "12px", paddingBottom: "10px", fontSize: "11px", color: "var(--muted-foreground)", fontWeight: 500 }}>Hora</th>
              {diasResult.map(d => (
                <th key={d} style={{ paddingBottom: "10px", textAlign: "center", fontSize: "13px", color: B.navy, fontWeight: 800 }}>
                  <div>{d.replace("-feira", "")}</div>
                  {result.availWindows[d] && (
                    <div style={{ fontSize: "10px", fontWeight: 500, color: "var(--muted-foreground)", marginTop: "2px" }}>
                      {fm(result.availWindows[d].inicio)}–{fm(result.availWindows[d].fim)}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HORAS_GRID.map(hora => {
              const rowData = diasResult.map(d => {
                const hi = pm(hora)
                const w = result.availWindows[d]
                const inWin = !!w && hi !== null && hi >= w.inicio && hi < w.fim
                return { inWin, sess: result.schedule[d]?.[hora] }
              })
              if (!rowData.some(c => c.inWin || c.sess)) return null
              return (
                <tr key={hora} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ textAlign: "right", paddingRight: "12px", verticalAlign: "middle", fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "13px", fontWeight: 800, color: B.navy }}>
                    {hora}
                  </td>
                  {diasResult.map((d, di) => {
                    const { inWin, sess } = rowData[di]
                    const a = sess ? espAccent(sess.esp) : null
                    return (
                      <td key={d} style={{ padding: "3px" }}>
                        <div
                          style={{
                            minHeight: "68px",
                            borderRadius: "10px",
                            background: sess ? `${a}22` : inWin ? "var(--muted)" : "transparent",
                            border: sess ? `1px solid ${a}66` : inWin ? "1px dashed var(--border)" : "none",
                            padding: sess || inWin ? "8px 10px" : "0",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                          }}
                        >
                          {sess && (
                            <>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--card-foreground)", lineHeight: 1.3 }}>{sess.tP}</div>
                              {sess.esp !== sess.tP && (
                                <div style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>({sess.esp})</div>
                              )}
                              <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "3px" }}>{fmtName(sess.prof)}</div>
                              <div style={{ fontSize: "10px", fontWeight: 800, color: a!, marginTop: "auto", paddingTop: "4px" }}>✦ Novo</div>
                            </>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function LaudoTable({ espRows, result }: { espRows: string[]; result: NovoCronogramaResult }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4 overflow-x-auto">
      <h3 className="font-extrabold mb-3 text-[14px]" style={{ color: B.navy }}>
        📋 Laudo: solicitado × autorizado × ofertado
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "480px" }}>
        <thead>
          <tr style={{ background: "var(--muted)" }}>
            {["Especialidade", "Solicitado", "Autorizado", "Ofertado"].map(h => (
              <th
                key={h}
                style={{
                  textAlign: h === "Especialidade" ? "left" : "center",
                  padding: "8px 12px",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--muted-foreground)",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {espRows.map(esp => {
            const entry = result.espTable[esp]
            if (!entry) return null
            const { sol, aut, of: of_, vigente } = entry
            const ok = aut > 0 && of_ >= aut
            const partial = of_ > 0 && of_ < aut
            const none = aut > 0 && of_ === 0
            const ofC = ok ? "#4a6e20" : partial ? B.amber : none ? B.red : "var(--muted-foreground)"
            const ofBg = ok ? B.limeLt : partial ? B.orangeLt : "var(--muted)"
            return (
              <tr key={esp} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ background: B.blueLt, color: B.blue, borderRadius: "999px", padding: "2px 8px", fontSize: "11px", fontWeight: 600 }}>
                    {esp}
                  </span>
                  {!vigente && <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--muted-foreground)" }}>vencido</span>}
                </td>
                <td style={{ padding: "9px 12px", color: "var(--muted-foreground)", textAlign: "center" }}>{sol || "—"}</td>
                <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 700, color: B.navy }}>{aut || "—"}</td>
                <td style={{ padding: "9px 12px", textAlign: "center" }}>
                  <span style={{ fontWeight: 800, color: ofC, background: ofBg, borderRadius: "999px", padding: "3px 12px" }}>
                    {of_}{aut > 0 ? ` / ${aut}` : ""}{ok ? " ✓" : partial ? " ▲" : none ? " ✗" : ""}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
