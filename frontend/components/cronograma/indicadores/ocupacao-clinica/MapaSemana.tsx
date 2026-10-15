"use client"

// MapaSemana — dia da semana × turno de uma unidade, cada célula pintada pelo
// % do horário com paciente. No cartão mostra só esse número; no painel
// (`detalhado`) mostra também o % com profissional embaixo.

import { DOW_PT } from "@/lib/cronograma/ocupacaoConst"
import { contagemVazia, pctComPaciente, pctComProfissional, type OcupacaoClinicaUnidade, type TurnoClinica } from "@/lib/cronograma/ocupacaoClinica"
import { CLASSE_ESCALA_MAPA, fmtPct, fundoMapa } from "./visual"

const TURNOS: TurnoClinica[] = ["Manhã", "Tarde"]

interface Props {
  unidade: Pick<OcupacaoClinicaUnidade, "porDiaTurno" | "dias">
  detalhado?: boolean
}

export function MapaSemana({ unidade, detalhado = false }: Props) {
  const dias = unidade.dias.length ? unidade.dias : [1, 2, 3, 4, 5]

  return (
    <div className={`flex flex-col gap-1.5 ${CLASSE_ESCALA_MAPA}`}>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `3.25rem repeat(${dias.length}, minmax(0, 1fr))` }}
      >
        <span />
        {dias.map(d => (
          <span key={d} className="text-center text-xs font-bold text-muted-foreground">{DOW_PT[d]}</span>
        ))}
        {TURNOS.map(turno => (
          <Linha key={turno} turno={turno} dias={dias} unidade={unidade} detalhado={detalhado} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>% do horário com paciente{detalhado ? " (embaixo: com profissional)" : ""}</span>
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          0%
          <span className="block h-2 w-16 rounded" style={{ background: "linear-gradient(90deg, var(--mapa-baixo), var(--mapa-alto))" }} />
          80%+
        </span>
      </div>
    </div>
  )
}

function Linha({ turno, dias, unidade, detalhado }: { turno: TurnoClinica; dias: number[]; unidade: Props["unidade"]; detalhado: boolean }) {
  return (
    <>
      <span className="flex items-center text-xs font-bold text-muted-foreground">{turno}</span>
      {dias.map(d => {
        const c = unidade.porDiaTurno[`${d}|${turno}`] ?? contagemVazia()
        if (c.total === 0) {
          return (
            <span key={d} className="flex min-h-10 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground" aria-label={`${DOW_PT[d]} ${turno}: sala fechada`}>
              —
            </span>
          )
        }
        const pac = pctComPaciente(c) ?? 0
        const prof = pctComProfissional(c) ?? 0
        const { background, escuro } = fundoMapa(pac)
        const texto = `${DOW_PT[d]} · ${turno}: ${fmtPct(pac)} com paciente, ${fmtPct(prof)} com profissional — ${c.aberta} com agenda aberta, ${c.regularizar} a regularizar`
        return (
          <span
            key={d}
            title={texto}
            aria-label={texto}
            role="img"
            className={`flex min-h-10 flex-col items-center justify-center rounded-md leading-tight tabular-nums ${escuro ? "text-white dark:text-slate-900" : "text-foreground"} ${detalhado ? "min-h-12" : ""}`}
            style={{ background }}
          >
            <span className="text-sm font-bold">{fmtPct(pac)}</span>
            {detalhado && <span className="text-[11px] font-semibold opacity-80">{fmtPct(prof)}</span>}
          </span>
        )
      })}
    </>
  )
}
