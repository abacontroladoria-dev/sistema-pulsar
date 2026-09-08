"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabaseClient } from "@/lib/supabase/client"
import { useHeader } from "@/contexts/HeaderContext"
import { FaltasSemanaPanel } from "./FaltasSemanaPanel"
import { VisaoGeralPanel } from "./VisaoGeralPanel"

// ─── Week helpers ─────────────────────────────────────────────────────────────

function semanaAtual(): string {
  const d = new Date()
  const day = d.getDay() // 0=Dom, 1=Seg…
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

function fmtSemana(inicio: string): string {
  const d = new Date(`${inicio}T12:00:00`)
  const fim = new Date(d)
  fim.setDate(fim.getDate() + 4)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} – ${p(fim.getDate())}/${p(fim.getMonth() + 1)}/${fim.getFullYear()}`
}

// ─── Patient search ───────────────────────────────────────────────────────────

interface Paciente { id: string; nome: string }

function usePacienteSearch(query: string): { results: Paciente[]; loading: boolean } {
  const [results, setResults] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (query.trim().length < 2) { setResults([]); return }

    timer.current = setTimeout(async () => {
      setLoading(true)
      const sb = getSupabaseClient()
      const { data } = await sb
        .from("fila_autorizacoes")
        .select("paciente_id, paciente_nome")
        .eq("status", "falta")
        // Dia de clínica fechada (feriado, ponto facultativo, falta de energia)
        // não torna o paciente candidato a reposição — ele não faltou. `or` com
        // `is.null` porque tipo_falta é NULL nas faltas antigas, e um `neq`
        // sozinho descartaria todas elas.
        .or("tipo_falta.is.null,tipo_falta.neq.unidade")
        .ilike("paciente_nome", `%${query.trim()}%`)
        .limit(10)

      if (data) {
        const seen = new Set<string>()
        setResults(
          data
            .filter((r: any) => r.paciente_id && r.paciente_nome)
            .filter((r: any) => {
              if (seen.has(r.paciente_id)) return false
              seen.add(r.paciente_id)
              return true
            })
            .map((r: any) => ({ id: r.paciente_id, nome: r.paciente_nome })),
        )
      }
      setLoading(false)
    }, 300)

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  return { results, loading }
}

// ─── Busca input ──────────────────────────────────────────────────────────────

function PacienteSearch({
  onSelect,
}: {
  onSelect: (p: Paciente) => void
}) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const { results, loading } = usePacienteSearch(query)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOut)
    return () => document.removeEventListener("mousedown", onClickOut)
  }, [])

  function handleSelect(p: Paciente) {
    setQuery(p.nome)
    setOpen(false)
    onSelect(p)
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", maxWidth: 380 }}>
      <input
        type="text"
        placeholder="Buscar paciente..."
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => query.trim().length >= 2 && setOpen(true)}
        style={{
          width: "100%",
          padding: "9px 14px",
          fontSize: 13,
          borderRadius: 10,
          border: "1.5px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {open && (loading || results.length > 0) && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,.10)",
            overflow: "hidden",
          }}
        >
          {loading ? (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted-foreground)" }}>
              Buscando…
            </div>
          ) : (
            results.map(p => (
              <button
                key={p.id}
                onMouseDown={() => handleSelect(p)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 14px",
                  fontSize: 13,
                  color: "var(--foreground)",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                {p.nome}
                <span style={{ color: "var(--muted-foreground)", fontWeight: 700 }}> (id {p.id})</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Week nav ─────────────────────────────────────────────────────────────────

function WeekNav({
  semana,
  onChange,
  bloquearAnterior,
}: {
  semana: string
  onChange: (s: string) => void
  bloquearAnterior: boolean
}) {
  const atual = semanaAtual()

  const NavBtn = ({ dir }: { dir: -1 | 1 }) => {
    const disabled = dir === -1 && bloquearAnterior
    return (
      <button
        onClick={() => !disabled && onChange(addWeeks(semana, dir))}
        disabled={disabled}
        title={disabled ? "Reposição só cobre a semana atual em diante" : undefined}
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
        >
          {dir === -1
            ? <polyline points="15 18 9 12 15 6" />
            : <polyline points="9 18 15 12 9 6" />}
        </svg>
      </button>
    )
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <NavBtn dir={-1} />
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", minWidth: 140, textAlign: "center" }}>
        {fmtSemana(semana)}
      </span>
      <NavBtn dir={1} />
      {semana !== atual && (
        <button
          onClick={() => onChange(atual)}
          style={{
            fontSize: 11,
            color: "var(--muted-foreground)",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          Semana atual
        </button>
      )}
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

// ─── Mode toggle pills ────────────────────────────────────────────────────────

type Modo = "paciente" | "geral"

function ModeToggle({ modo, onChange }: { modo: Modo; onChange: (m: Modo) => void }) {
  const pill = (m: Modo, label: string) => (
    <button
      onClick={() => onChange(m)}
      style={{
        padding: "5px 14px",
        borderRadius: "999px",
        border: "none",
        background: modo === m ? "var(--foreground)" : "transparent",
        color: modo === m ? "var(--background)" : "var(--muted-foreground)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  )
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--border)",
        borderRadius: "999px",
        padding: 2,
        gap: 2,
      }}
    >
      {pill("paciente", "Por paciente")}
      {pill("geral", "Visão geral")}
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function ReposicaoShell() {
  const { setHeader, setRightContent } = useHeader()
  const [paciente, setPaciente] = useState<Paciente | null>(null)
  const [semana, setSemana] = useState(semanaAtual)
  const [modo, setModo] = useState<Modo>("paciente")

  useEffect(() => {
    setHeader("Reposição de Faltas", "Sugestão de reposição para faltas da semana")
    setRightContent(null)
    return () => {
      setHeader("", "")
      setRightContent(null)
    }
  }, [setHeader, setRightContent])

  const handleSelect = useCallback((p: Paciente) => {
    setPaciente(p)
  }, [])

  const handleSelectFromGeral = useCallback((p: { id: string; nome: string }) => {
    setPaciente(p)
    setModo("paciente")
  }, [])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Controls ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--card)",
        }}
      >
        <ModeToggle modo={modo} onChange={setModo} />
        {modo === "paciente" && (
          <>
            <div style={{ width: 1, height: 28, background: "var(--border)", flexShrink: 0 }} />
            <PacienteSearch onSelect={handleSelect} />
          </>
        )}
        <div style={{ marginLeft: "auto" }}>
          {/* Modo "paciente" não permite semanas antes de hoje: csv_grades_profissionais
              (fonte primária da grade) só cobre "hoje em diante". A Visão geral não tem essa
              restrição — ela só depende de fila_autorizacoes, que é histórico completo. */}
          <WeekNav
            semana={semana}
            onChange={setSemana}
            bloquearAnterior={modo === "paciente" && semana <= semanaAtual()}
          />
        </div>
      </div>

      {/* ── Results ── */}
      {modo === "geral" ? (
        <VisaoGeralPanel semanaInicio={semana} onSelectPaciente={handleSelectFromGeral} />
      ) : paciente ? (
        <div>
          {/* Nome do paciente agora é mostrado dentro de VisaoComparativa, junto do
              botão "Sugestão automática" — evita duplicar o cabeçalho aqui. */}
          <FaltasSemanaPanel
            pacienteId={paciente.id}
            pacienteNome={paciente.nome}
            semanaInicio={semana}
          />
        </div>
      ) : (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            borderRadius: 12,
            border: "1px dashed var(--border)",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>
            Selecione um paciente
          </p>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
            Busque pelo nome para ver as faltas elegíveis para reposição, ou use a Visão geral.
          </p>
        </div>
      )}
    </div>
  )
}
