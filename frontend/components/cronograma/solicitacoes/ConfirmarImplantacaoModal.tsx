"use client"

import { useEffect, useRef } from "react"
import { B } from "@/lib/cronograma/constants"
import { fmtName } from "@/lib/cronograma/helpers"
import type { AceiteSessao } from "@/types/acompanhamento"

const DIA_ABR: Record<string, string> = {
  "Segunda-feira": "Segunda", "Terça-feira": "Terça", "Quarta-feira": "Quarta",
  "Quinta-feira": "Quinta", "Sexta-feira": "Sexta", "Sábado": "Sábado",
}

/** Terapia que ficará com 3+ profissionais diferentes após a implantação. */
export interface AvisoMultiProf { tP: string; profs: string[] }

interface Props {
  pac: string
  sessoesAtuais: number
  sessoes: AceiteSessao[]
  /** Avisos de 3+ profissionais por terapia — NÃO bloqueiam a implantação, só alertam em vermelho. */
  avisoMultiProf?: AvisoMultiProf[]
  /** true enquanto a chamada à API da TiTa está em andamento — desabilita as ações do modal. */
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmarImplantacaoModal({ pac, sessoesAtuais, sessoes, avisoMultiProf = [], confirming = false, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirming) onCancel() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onCancel, confirming])

  const adicionadas = sessoes.length
  const depois = sessoesAtuais + adicionadas
  // Aviso, nunca bloqueio: a implantação segue permitida — só fica vermelha e explicada.
  const temAviso = avisoMultiProf.length > 0
  const terapiasAvisadas = new Set(avisoMultiProf.map(a => a.tP))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirmar-implantacao-title"
      style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,.55)", padding: "16px" }}
      onClick={e => { if (e.target === e.currentTarget && !confirming) onCancel() }}
    >
      <div style={{ background: "var(--card)", borderRadius: "18px", boxShadow: "0 24px 70px rgba(0,0,0,.3)", maxWidth: "460px", width: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column" }}>

        {/* Cabeçalho */}
        <div style={{ padding: "20px 22px 16px", borderBottom: "1px solid var(--border)" }}>
          <div id="confirmar-implantacao-title" style={{ fontWeight: 900, fontSize: "17px", color: B.navy }}>
            🔒 Confirmar implantação
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginTop: "4px" }}>
            Paciente <strong style={{ color: "var(--card-foreground)" }}>{pac}</strong>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Antes / Depois */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "12px 16px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.04em" }}>SESSÕES ATUAIS</div>
              <div style={{ fontSize: "24px", fontWeight: 900, color: "var(--muted-foreground)" }}>{sessoesAtuais}</div>
            </div>
            <div style={{ fontSize: "18px", fontWeight: 900, color: "#16a34a" }}>→</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#15803d", letterSpacing: "0.04em" }}>APÓS IMPLANTAÇÃO</div>
              <div style={{ fontSize: "24px", fontWeight: 900, color: "#16a34a" }}>{depois}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: "0.04em" }}>ADICIONADAS</div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#16a34a" }}>+{adicionadas}</div>
            </div>
          </div>

          {/* Lista de sessões */}
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted-foreground)", marginBottom: "6px", letterSpacing: "0.03em" }}>
              SESSÕES SELECIONADAS ({adicionadas})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: "220px", overflowY: "auto" }}>
              {sessoes.map((s, i) => {
                const avisada = terapiasAvisadas.has(s.tP)
                return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", background: avisada ? "#fff1f2" : "var(--muted)", border: `1px solid ${avisada ? "#fca5a5" : "transparent"}`, borderRadius: "8px", padding: "7px 10px" }}>
                  <span style={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums", fontSize: "12px", fontWeight: 800, color: avisada ? "#dc2626" : B.navy, flexShrink: 0 }}>
                    {(DIA_ABR[s.dia] ?? s.dia.replace("-feira", ""))} {s.hora}
                  </span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: avisada ? "#dc2626" : "var(--card-foreground)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.tP}
                  </span>
                  <span style={{ fontSize: "11px", color: avisada ? "#dc2626" : "var(--muted-foreground)", flexShrink: 0 }}>{fmtName(s.prof)}</span>
                </div>
                )
              })}
            </div>
          </div>

          {/* Aviso de 3+ profissionais na mesma terapia — não impede confirmar */}
          {temAviso && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ fontSize: "15px", lineHeight: 1 }}>⚠️</span>
                <div style={{ fontSize: "11.5px", color: "#dc2626", lineHeight: 1.4 }}>
                  Após esta implantação, {avisoMultiProf.length === 1 ? "uma terapia ficará" : "estas terapias ficarão"} com{" "}
                  <strong>3 ou mais profissionais diferentes</strong>. O ideal é no máximo 2 por terapia — você pode confirmar mesmo assim, mas revise antes.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {avisoMultiProf.map(a => (
                  <div key={a.tP} style={{ background: "rgba(255,255,255,0.55)", border: "1px solid #fca5a5", borderRadius: "6px", padding: "6px 8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 800, color: "#991b1b", marginBottom: "4px" }}>{a.tP}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {a.profs.map(p => (
                        <span key={p} style={{ fontSize: "10.5px", fontWeight: 600, color: "#7f1d1d", background: "var(--card)", border: "1px solid #fecaca", borderRadius: "4px", padding: "1px 6px", whiteSpace: "nowrap" }}>
                          {fmtName(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Aviso */}
          <div style={{ display: "flex", gap: "8px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "10px 12px" }}>
            <span style={{ fontSize: "15px", lineHeight: 1 }}>✅</span>
            <span style={{ fontSize: "11.5px", color: "#15803d", lineHeight: 1.4 }}>
              As sessões serão implantadas <strong>imediatamente</strong> na TiTa. Após a confirmação, a ocupação será atualizada automaticamente.
            </span>
          </div>
        </div>

        {/* Ações */}
        <div style={{ display: "flex", gap: "8px", padding: "16px 22px", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onCancel}
            disabled={confirming}
            style={{ flex: 1, padding: "10px 16px", borderRadius: "10px", background: "var(--muted)", color: "var(--card-foreground)", border: "1px solid var(--border)", cursor: confirming ? "not-allowed" : "pointer", opacity: confirming ? 0.6 : 1, fontFamily: "inherit", fontWeight: 600, fontSize: "13px" }}
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={confirming}
            style={{ flex: 2, padding: "10px 16px", borderRadius: "10px", background: temAviso ? "#dc2626" : "#16a34a", color: "white", border: "none", cursor: confirming ? "not-allowed" : "pointer", opacity: confirming ? 0.75 : 1, fontFamily: "inherit", fontWeight: 800, fontSize: "13px", boxShadow: temAviso ? "0 2px 10px rgba(220,38,38,.3)" : "0 2px 10px rgba(22,163,74,.3)" }}
          >
            {confirming ? "⏳ Implantando sessões na TiTa…" : temAviso ? "⚠ Confirmar mesmo assim" : "🔒 Confirmar implantação"}
          </button>
        </div>
      </div>
    </div>
  )
}
