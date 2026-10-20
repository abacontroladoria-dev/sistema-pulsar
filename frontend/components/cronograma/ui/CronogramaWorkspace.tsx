"use client"

import { useState, type ReactNode } from "react"
import { B, DIAS_LIST, DIAS_ORD, HORAS_GRID } from "@/lib/cronograma/constants"
import { buildCronoUnitMeta, fmtName, pm } from "@/lib/cronograma/helpers"
import { UnitHeaderBadges } from "./UnitBadges"
import { EspBloqueadaLinha } from "./EspBloqueadaLinha"
import type { EspBloqueada } from "@/lib/cronograma/suspensaoTemporaria"
import type { ProfAlt, EspAltManual } from "@/lib/cronograma/novoCronograma"

// Workspace de cronograma — réplica da moldura do Modo 1 ("Aumentar Cronograma",
// OcupPacMode.tsx): um único cartão de altura fixa dividido em grade semanal
// (esquerda) + painel "Quantidade de Sessões" (direita, 200px).
//
// Usado por "Criar Novo Cronograma" e "Orçamento". O Modo 1 mantém a sua própria
// implementação (que é a fonte de onde estes valores foram medidos) e não é
// alterado: ali a grade carrega interação que estes dois modos não têm (seleção,
// profissionais alternativos, recusas, wizard de terapia), então extrair de lá
// seria arriscado. Aqui fica só o que os dois modos novos precisam, com os mesmos
// números exatos.

export interface WorkspaceSessao {
  dia: string
  hora: string
  /** Terapia (nome exibido em destaque no card). */
  tP: string
  esp: string
  prof: string
  unidade: string
  /** Especialidade de exibição quando difere da terapia — vira "(...)" em itálico. */
  tE?: string
  /** Terapia original da sugestão (índice 0 do accordion) */
  origTp?: string
  /** Profissional original da sugestão (índice 0 do accordion) */
  origProf?: string
  /** ID da sugestão de origem — necessário para modo interativo. */
  sugestaoId?: string
}

export interface WorkspaceEspResumo {
  esp: string
  of: number
  aut: number
}

// ── Props do modo interativo (opt-in) ──────────────────────────────────────

interface InterativoProps {
  interativo: true
  selectedIds: Set<string>
  onToggle: (id: string) => void
  profAltsMap: Record<string, ProfAlt[]>
  espAltsMap: Record<string, EspAltManual[]>
  profSelIdx: Record<string, number>
  espSelIdx: Record<string, number>
  onChangeProf: (id: string, idx: number) => void
  onChangeEsp: (id: string, idx: number) => void
  excessoEsps: Set<string>
  /** Texto da etiqueta vermelha por especialidade em excesso; ausente = "Acima do limite". */
  rotuloExcessoEsp?: Record<string, string>
  multiProfTerapias: Set<string>
  /** Dias com unidade já travada pela seleção — cards de outra unidade ficam apagados. */
  diaUnidadeTravada: Record<string, string>
}

interface EstaticoProps {
  interativo?: false
}

type Props = {
  sessoes: WorkspaceSessao[]
  espResumo: WorkspaceEspResumo[]
  /** Especialidades bloqueadas no cadastro/laudo — cadeado + motivo, abaixo das contagens. */
  espBloqueadas?: EspBloqueada[]
  /** Sessões que o paciente já tinha antes (0 nos modos de cronograma novo/orçamento). */
  antes: number
  /** Caixas de aviso ao pé do painel lateral. */
  avisos?: string[]
  /** Barra de ação no rodapé da grade (ex.: confirmar implantação). Ausente = sem commit. */
  actionBar?: ReactNode
  /** Mensagem quando não há nenhuma sessão posicionada. */
  vazioMsg?: string
} & (InterativoProps | EstaticoProps)

export function CronogramaWorkspace(props: Props) {
  const {
    sessoes, espResumo, espBloqueadas = [], antes, avisos = [], actionBar,
    vazioMsg = "Nenhuma sessão encontrada.",
  } = props

  const interativo = props.interativo === true
  const iProps = interativo ? props as InterativoProps : null

  const dias = [...DIAS_LIST.slice(0, 5)].sort((a, b) => (DIAS_ORD[a] ?? 9) - (DIAS_ORD[b] ?? 9))

  // Mapa dia|||hora → sessões, base de todo o resto (mesma chave do Modo 1).
  const cMap: Record<string, WorkspaceSessao[]> = {}
  for (const s of sessoes) {
    const k = `${s.dia}|||${s.hora}`
    if (!cMap[k]) cMap[k] = []
    cMap[k].push(s)
  }

  // Eixo de tempo contínuo: dentro da faixa ocupada (por turno), inclui TODOS os
  // tempos da grade — inclusive os sem sessão — para que apareçam como linhas em
  // branco, sem vãos. Mesma derivação do Modo 1.
  const horasComConteudo = HORAS_GRID.filter(h => dias.some(d => cMap[`${d}|||${h}`]?.length))
  const horas = (() => {
    if (horasComConteudo.length === 0) return [] as string[]
    const manha = horasComConteudo.filter(h => (pm(h) ?? 0) < 720)
    const tarde = horasComConteudo.filter(h => (pm(h) ?? 0) >= 720)
    const ranges: Array<[number, number]> = []
    if (manha.length) ranges.push([pm(manha[0])!, pm(manha[manha.length - 1])!])
    if (tarde.length) ranges.push([pm(tarde[0])!, pm(tarde[tarde.length - 1])!])
    return HORAS_GRID.filter(h => { const m = pm(h) ?? -1; return ranges.some(([lo, hi]) => m >= lo && m <= hi) })
  })()

  const unitMeta = buildCronoUnitMeta(dias, cMap)

  // Eixo em ticks de 20 min; linhas de sessão recebem rowSpan=2 (2 × 38px = 76px).
  const sessionStartSet = new Set(horas)
  const allSlots = (() => {
    if (horas.length === 0) return [] as string[]
    const toMin = (h: string) => { const [hr, mn] = h.split(":").map(Number); return hr * 60 + mn }
    const toHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    const slots: string[] = []
    const morningH = horas.filter(h => toMin(h) < 720)
    const afternoonH = horas.filter(h => toMin(h) >= 720)
    if (morningH.length > 0) {
      for (let m = toMin(morningH[0]); m < toMin(morningH[morningH.length - 1]) + 40; m += 20) slots.push(toHora(m))
    }
    if (afternoonH.length > 0) {
      for (let m = toMin(afternoonH[0]); m < toMin(afternoonH[afternoonH.length - 1]) + 40; m += 20) slots.push(toHora(m))
    }
    return slots
  })()
  const firstAfternoonSlot = allSlots.find(s => parseInt(s.replace(":", "")) >= 1300)

  // No modo interativo as sessões são SUGESTÕES: só entram no "Depois" as
  // marcadas. Sem seleção, Depois = Antes.
  const adicionadas = iProps
    ? sessoes.filter(s => s.sugestaoId && iProps.selectedIds.has(s.sugestaoId)).length
    : sessoes.length
  const depois = antes + adicionadas

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--card)", overflow: "hidden", height: "calc(100vh - 280px)", minHeight: "480px", marginBottom: "16px" }}>

      {/* ── Grade ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>
        <div style={{ flex: 1, overflowX: "auto", overflowY: "auto", padding: "6px 16px 16px" }}>
          {!horas.length ? (
            <div style={{ textAlign: "center", color: "var(--muted-foreground)", padding: "20px" }}>{vazioMsg}</div>
          ) : (
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: `${46 + dias.length * 110}px`, width: "100%" }}>
              <colgroup>
                <col style={{ width: "44px" }} />
                {dias.map(d => <col key={d} style={{ width: "110px" }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ paddingBottom: "8px", textAlign: "right", paddingRight: "4px", fontSize: "11px", color: "var(--muted-foreground)", fontWeight: 400 }}>Hora</th>
                  {dias.map(d => (
                    <th key={d} style={{ paddingBottom: "8px", textAlign: "center", fontSize: "12px", color: B.navy, fontWeight: 800 }}>
                      <div>{d.replace("-feira", "")}</div>
                      <UnitHeaderBadges dayMeta={unitMeta.byDay[d]} globalUnit={unitMeta.globalUnit} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allSlots.map(slot => {
                  const isSession = sessionStartSet.has(slot)
                  const isFirstAfternoon = slot === firstAfternoonSlot
                  return (
                    <tr key={slot} style={{ height: "38px", borderTop: isFirstAfternoon ? "2px solid var(--border)" : isSession ? "1px solid var(--border)" : "none" }}>
                      <td style={{ textAlign: "right", paddingRight: "4px", verticalAlign: "top", paddingTop: "5px", fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "12px", fontWeight: 800, color: B.navy, whiteSpace: "nowrap" }}>
                        {isSession ? slot : null}
                      </td>
                      {isSession && dias.map(d => {
                        const cells = cMap[`${d}|||${slot}`] || []
                        return (
                          <td key={d} style={{ position: "relative" }} rowSpan={2}>
                            <div style={{ position: "absolute", inset: "2px", display: "flex", flexDirection: "column", gap: "2px", overflow: "visible" }}>
                              {cells.map((c, ci) => (
                                <SessionCard
                                  key={ci}
                                  sessao={c}
                                  interativo={interativo}
                                  iProps={iProps}
                                />
                              ))}
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
        </div>

        {actionBar && (
          <div
            className="animate-in slide-in-from-bottom-4 fade-in duration-300"
            style={{
              flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--card)",
              boxShadow: "0 -10px 28px rgba(15,23,42,0.07)",
              display: "flex", alignItems: "stretch", gap: "14px", padding: "11px 16px",
            }}
          >
            {actionBar}
          </div>
        )}
      </div>

      {/* ── Painel: Quantidade de Sessões ─────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "8px 14px", flexShrink: 0, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--card-foreground)", letterSpacing: "0.03em" }}>Quantidade de Sessões</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 14px", overflowY: "auto", gap: "0" }}>

          <div style={{ marginBottom: "14px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.03em" }}>Antes</div>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.03em" }}>Depois</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "22px", fontWeight: 900, color: "var(--muted-foreground)", lineHeight: 1 }}>{antes}</div>
              <div style={{ fontSize: "20px", fontWeight: 900, color: adicionadas > 0 ? "#16a34a" : "var(--border)", transition: "color 200ms ease", flexShrink: 0 }}>→</div>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <div style={{ fontSize: "28px", fontWeight: 900, color: adicionadas > 0 ? "#16a34a" : "var(--muted-foreground)", lineHeight: 1, transition: "color 200ms ease" }}>
                  {depois}
                </div>
                {adicionadas > 0 && (
                  <span style={{ fontSize: "10px", fontWeight: 800, background: "#dcfce7", color: "#15803d", border: "1px solid #86efac", borderRadius: "5px", padding: "1px 6px", whiteSpace: "nowrap" }}>
                    +{adicionadas}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: "1px", background: "var(--border)", margin: "12px 0 0" }} />
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
            {espResumo.length === 0 && espBloqueadas.length === 0 && (
              <div style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>Sem autorização registrada.</div>
            )}
            {espResumo.map(g => {
              const excesso = g.of > g.aut
              const completo = g.of === g.aut
              const parcial = !excesso && !completo && g.of > 0
              const cor = excesso ? "#dc2626" : completo ? "#16a34a" : parcial ? "#d97706" : B.navy
              return (
                <div key={g.esp}>
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--card-foreground)", marginBottom: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.esp}>{g.esp}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "15px", fontWeight: 900, color: cor, transition: "color 180ms ease", display: "inline-flex", alignItems: "baseline", gap: "3px" }}>
                      <span>{g.of}</span>
                      <span>/{g.aut}</span>
                    </span>
                    {excesso && <span style={{ fontSize: "11px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>acima</span>}
                    {completo && <span style={{ fontSize: "11px", background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>✓</span>}
                    {parcial && <span style={{ fontSize: "11px", background: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d", borderRadius: "4px", padding: "0 4px", fontWeight: 700 }}>+{g.of}</span>}
                  </div>
                  <div style={{ height: "4px", background: "var(--muted)", borderRadius: "2px", marginTop: "4px", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: "2px", width: "100%", background: cor, transform: `scaleX(${g.aut > 0 ? Math.min(1, g.of / g.aut) : 0})`, transformOrigin: "left", transition: "transform 220ms cubic-bezier(0.22,1,0.36,1)" }} />
                  </div>
                </div>
              )
            })}
            {espBloqueadas.map(item => <EspBloqueadaLinha key={`bloq|||${item.esp}`} item={item} />)}
          </div>

          {avisos.map((msg, i) => (
            <div key={i} style={{ marginTop: "12px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "8px 10px", fontSize: "10px", color: "#dc2626", fontWeight: 700, flexShrink: 0 }}>
              {msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Card de sessão individual ─────────────────────────────────────────────────

function SessionCard({
  sessao: c,
  interativo,
  iProps,
}: {
  sessao: WorkspaceSessao
  interativo: boolean
  iProps: InterativoProps | null
}) {
  const [profExpanded, setProfExpanded] = useState(false)
  const [espExpanded, setEspExpanded] = useState(false)

  if (!interativo || !iProps || !c.sugestaoId) {
    // Modo estático — visual original, sem interação.
    return (
      <div
        style={{
          background: B.blueLt,
          border: `1px solid ${B.blue}`,
          borderRadius: "8px", padding: "5px 7px",
          flex: "1",
          boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2px",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2px" }}>
          <span style={{ fontSize: "10px", fontWeight: 600, color: "#111827", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.tP}</span>
          <span style={{ fontSize: "8px", color: "#9ca3af", flexShrink: 0, whiteSpace: "nowrap" }}>📍 {c.unidade}</span>
        </div>
        {c.tE && (
          <div style={{ fontSize: "8px", fontStyle: "italic", color: "#9ca3af", lineHeight: "1", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>({c.tE})</div>
        )}
        <div style={{ fontSize: "11px", color: "#6b7280", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(c.prof)}</div>
      </div>
    )
  }

  // Modo interativo.
  const id = c.sugestaoId
  const selected = iProps.selectedIds.has(id)
  const isExcesso = selected && iProps.excessoEsps.has(c.esp)
  const isMultiProf = selected && iProps.multiProfTerapias.has(c.tP)
  const profAlts = iProps.profAltsMap[id] || []
  const espAlts = iProps.espAltsMap[id] || []
  const curProfIdx = iProps.profSelIdx[id] || 0
  const curEspIdx = iProps.espSelIdx[id] || 0
  const hasProfAlts = profAlts.length > 0
  const hasEspAlts = espAlts.length > 0

  // Unidade travada neste dia — card de outra unidade fica apagado e não selecionável.
  const travadaUnid = iProps.diaUnidadeTravada[c.dia]
  const bloqueadoPorUnidade = !!travadaUnid && travadaUnid !== c.unidade

  // Cores do card — mesmas tríades exatas do Modo 1.
  let bg: string = B.blueLt
  let border: string = B.blue
  if (bloqueadoPorUnidade) {
    bg = "var(--muted)"
    border = "var(--border)"
  } else if (selected) {
    if (isExcesso) {
      bg = "#fff1f2"
      border = "#fca5a5"
    } else {
      bg = "#dcfce7"
      border = "#16a34a"
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (bloqueadoPorUnidade) return
        setEspExpanded(false)
        setProfExpanded(false)
        iProps.onToggle(id)
      }}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!bloqueadoPorUnidade) iProps.onToggle(id) } }}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "8px", padding: "5px 7px",
        flex: (profExpanded || espExpanded) ? "none" : "1",
        boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "2px",
        position: "relative",
        cursor: bloqueadoPorUnidade ? "not-allowed" : "pointer",
        opacity: bloqueadoPorUnidade ? 0.4 : 1,
        zIndex: (profExpanded || espExpanded) ? 20 : "auto",
        boxShadow: (profExpanded || espExpanded) ? "0 6px 24px rgba(0,0,0,.13)" : "none",
        transition: "background 120ms ease, border-color 120ms ease, opacity 120ms ease, box-shadow 180ms ease",
      }}
    >
      {/* Linha superior: Terapia + Unidade + ✓ */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, color: "#111827", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{c.tP}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
          <span style={{ fontSize: "8px", color: "#9ca3af", whiteSpace: "nowrap" }}>📍 {c.unidade}</span>
          {selected && !isExcesso && (
            <span style={{ fontSize: "9px", color: "#16a34a", fontWeight: 900, lineHeight: 1 }}>✓</span>
          )}
        </div>
      </div>

      {/* Profissional (Oculto quando o accordion de profissionais está aberto, igual ao Modo 1) */}
      {!profExpanded && !espExpanded && (
        <div style={{ fontSize: "11px", color: "#6b7280", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtName(c.prof)}</div>
      )}

      {/* Accordion de Profissionais (Inline, como no Modo 1) */}
      {hasProfAlts && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            overflow: "hidden",
            maxHeight: profExpanded ? `${(profAlts.length + 1) * 26 + 8}px` : "0px",
            opacity: profExpanded ? 1 : 0,
            transition: "max-height 200ms ease-out, opacity 150ms ease-out",
            display: "flex", flexDirection: "column", gap: "1px",
            marginTop: profExpanded ? "3px" : "0"
          }}
        >
          {/* Opção Original */}
          <button
            type="button"
            onClick={() => { iProps.onChangeProf(id, 0); setProfExpanded(false) }}
            style={{
              display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none",
              background: curProfIdx === 0 ? "rgba(22,163,74,0.1)" : "transparent",
              cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
              fontWeight: curProfIdx === 0 ? 600 : 400, color: curProfIdx === 0 ? "#166534" : "#374151",
              textAlign: "left", width: "100%", transition: "background 100ms ease"
            }}
          >
            <span style={{ fontSize: "8px", color: curProfIdx === 0 ? "#16a34a" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>
              {curProfIdx === 0 ? "●" : "○"}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fmtName(c.origProf || c.prof)}
            </span>
          </button>
          
          {/* Alternativas */}
          {profAlts.map((pa, idx) => {
            const isCurr = curProfIdx === idx + 1
            return (
              <button
                key={idx}
                type="button"
                onClick={() => { iProps.onChangeProf(id, idx + 1); setProfExpanded(false) }}
                style={{
                  display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none",
                  background: isCurr ? "rgba(22,163,74,0.1)" : "transparent",
                  cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
                  fontWeight: isCurr ? 600 : 400, color: isCurr ? "#166534" : "#374151",
                  textAlign: "left", width: "100%", transition: "background 100ms ease"
                }}
              >
                <span style={{ fontSize: "8px", color: isCurr ? "#16a34a" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>
                  {isCurr ? "●" : "○"}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmtName(pa.prof)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Accordion de Terapias (Inline, como o Wizard do Modo 1) */}
      {hasEspAlts && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            overflow: "hidden",
            maxHeight: espExpanded ? `${(espAlts.length + 1) * 26 + 20}px` : "0px",
            opacity: espExpanded ? 1 : 0,
            transition: "max-height 200ms ease-out, opacity 150ms ease-out",
            display: "flex", flexDirection: "column", gap: "1px",
            marginTop: espExpanded ? "3px" : "0"
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: 800, color: "#374151", marginBottom: "1px" }}>Escolha uma terapia</div>
          {/* Opção Original */}
          <button
            type="button"
            onClick={() => { iProps.onChangeEsp(id, 0); setEspExpanded(false) }}
            style={{
              display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none",
              background: curEspIdx === 0 ? "rgba(126,34,206,0.08)" : "transparent",
              cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
              fontWeight: curEspIdx === 0 ? 600 : 400, color: curEspIdx === 0 ? "#6b21a8" : "#374151",
              textAlign: "left", width: "100%", transition: "background 100ms ease"
            }}
          >
            <span style={{ fontSize: "8px", color: curEspIdx === 0 ? "#7e22ce" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>
              {curEspIdx === 0 ? "●" : "○"}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.origTp || c.tP}
            </span>
          </button>
          
          {/* Alternativas */}
          {espAlts.map((ea, idx) => {
            const isCurr = curEspIdx === idx + 1
            return (
              <button
                key={idx}
                type="button"
                onClick={() => { iProps.onChangeEsp(id, idx + 1); setEspExpanded(false) }}
                style={{
                  display: "flex", alignItems: "center", gap: "5px", padding: "3px 5px", borderRadius: "5px", border: "none",
                  background: isCurr ? "rgba(126,34,206,0.08)" : "transparent",
                  cursor: "pointer", fontFamily: "inherit", fontSize: "11px",
                  fontWeight: isCurr ? 600 : 400, color: isCurr ? "#6b21a8" : "#374151",
                  textAlign: "left", width: "100%", transition: "background 100ms ease"
                }}
              >
                <span style={{ fontSize: "8px", color: isCurr ? "#7e22ce" : "#9ca3af", flexShrink: 0, lineHeight: 1 }}>
                  {isCurr ? "●" : "○"}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ea.tP}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Linha inferior com badges e botões (alinhada à base do card) */}
      <div style={{ fontSize: "10px", fontWeight: 700, marginTop: "auto", display: "flex", alignItems: "center", gap: "3px", flexWrap: "wrap", paddingTop: (profExpanded || espExpanded) ? "6px" : "0" }}>
        
        {/* Badges de alerta (mutuamente exclusivos para poupar espaço vertical, como no Modo 1) */}
        {isExcesso ? (
          <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>
            {iProps.rotuloExcessoEsp?.[c.esp] ?? "Acima do limite"}
          </span>
        ) : isMultiProf ? (
          <span style={{ fontSize: "9px", fontWeight: 800, color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "4px", padding: "0 5px", lineHeight: "1.6" }}>
            3+ profissionais
          </span>
        ) : null}

        {/* Botão de alternativa — profissional */}
        {hasProfAlts && !hasEspAlts && !bloqueadoPorUnidade && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setProfExpanded(v => !v); setEspExpanded(false) }}
            style={{
              display: "flex", alignItems: "center", gap: "2px", flexShrink: 0,
              fontSize: "10px", fontWeight: 700, color: "#0369a1", background: "none",
              border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", lineHeight: "1.4"
            }}
          >
            <span style={{ fontSize: "7px", display: "inline-block", transform: profExpanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>▼</span>
            <span>{profAlts.length + 1} profs.</span>
          </button>
        )}

        {/* Botão de alternativa — terapia (com o estilo purple de botão pill do Modo 1) */}
        {hasEspAlts && !bloqueadoPorUnidade && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setEspExpanded(v => !v); setProfExpanded(false) }}
            style={{
              fontSize: "9px", fontWeight: 700, color: "#7e22ce", background: "rgba(126,34,206,0.05)",
              border: "1px solid rgba(126,34,206,0.2)", borderRadius: "4px", padding: "1px 5px",
              cursor: "pointer", fontFamily: "inherit", lineHeight: "1.4"
            }}
          >
            Alterar terapia
          </button>
        )}
      </div>
    </div>
  )
}

/** Estado vazio — réplica do card mostrado pelo Modo 1 quando nenhum paciente está selecionado. */
export function WorkspaceEmptyState({ emoji, titulo, subtitulo }: { emoji: string; titulo: string; subtitulo: string }) {
  return (
    <div style={{ background: "var(--card)", borderRadius: "14px", border: "1px solid var(--border)", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "32px", marginBottom: "10px" }}>{emoji}</div>
      <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--card-foreground)", marginBottom: "4px" }}>{titulo}</div>
      <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{subtitulo}</div>
    </div>
  )
}

/** Conteúdo padrão da action bar — mesma anatomia da barra de "Aceitar alterações" do Modo 1. */
export function WorkspaceActionBar({
  titulo, subtitulo, children,
}: {
  titulo: string; subtitulo: string; children: ReactNode
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", width: "220px", flexShrink: 0 }}>
        <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: "#dcfce7", border: "1px solid #86efac", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#16a34a", fontSize: "17px", fontWeight: 900, lineHeight: 1 }}>✓</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 800, color: B.navy, lineHeight: 1.25 }}>{titulo}</div>
          <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "2px", lineHeight: 1.35 }}>{subtitulo}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", borderLeft: "1px solid var(--border)", padding: "0 14px" }}>
        {children}
      </div>
    </>
  )
}
