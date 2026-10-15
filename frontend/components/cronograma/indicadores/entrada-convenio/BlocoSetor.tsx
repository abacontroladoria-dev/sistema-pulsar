"use client"

// Bloco de um setor no "Quem precisa agir". Cabeçalho: o setor, QUEM responde
// (com o rótulo "Responsável", para não precisar deduzir) e o resumo do bloco.
// Corpo: os pacientes agrupados sob títulos — Atrasados, Vencem hoje, No prazo —
// em vez de uma pílula repetida em cada linha. Quem está no prazo fica
// recolhido quando o bloco tem urgência, para o olho cair primeiro no atraso.

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { TONE_SOFT } from "@/components/cronograma/ui/tones"
import type { BlocoSetor as DadosBloco, DisponibilidadePainel, PacienteEmAndamento } from "@/lib/indicadores/entradaConvenio"
import { LinhaPaciente } from "./LinhaPaciente"

type TomGrupo = "red" | "amber" | "green" | "slate"

const PONTO: Record<TomGrupo, string> = {
  red: "bg-rose-500",
  amber: "bg-amber-400",
  green: "bg-emerald-500",
  slate: "bg-slate-400",
}

function TituloGrupo({ tom, rotulo, n, id }: { tom: TomGrupo; rotulo: string; n: number; id?: string }) {
  return (
    <h4 id={id} className={`flex items-center gap-2 border-y border-border/60 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide sm:px-4 ${TONE_SOFT[tom].bg} ${TONE_SOFT[tom].text}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${PONTO[tom]}`} />
      {rotulo}
      <span className="tabular-nums">· {n}</span>
    </h4>
  )
}

function Resumo({ bloco }: { bloco: DadosBloco }) {
  const a = bloco.atrasados.length
  const h = bloco.venceHoje.length
  const pilula = "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
  if (bloco.familia) {
    return <span className={`${pilula} ${TONE_SOFT.slate.bg} ${TONE_SOFT.slate.text}`}>{bloco.total} {bloco.total === 1 ? "paciente" : "pacientes"}</span>
  }
  if (a > 0) return <span className={`${pilula} ${TONE_SOFT.red.bg} ${TONE_SOFT.red.text}`}>{a} {a === 1 ? "atrasado" : "atrasados"}</span>
  if (h > 0) return <span className={`${pilula} ${TONE_SOFT.amber.bg} ${TONE_SOFT.amber.text}`}>{h} {h === 1 ? "vence hoje" : "vencem hoje"}</span>
  return <span className={`${pilula} ${TONE_SOFT.green.bg} ${TONE_SOFT.green.text}`}>Tudo em dia</span>
}

export function BlocoSetor({ bloco, disp, onAbrir }: {
  bloco: DadosBloco
  disp: Map<string, DisponibilidadePainel>
  onAbrir: (p: PacienteEmAndamento) => void
}) {
  const [verDemais, setVerDemais] = useState(false)
  const urgentes = bloco.atrasados.length + bloco.venceHoje.length > 0
  const recolher = urgentes && bloco.demais.length > 0
  const idTitulo = `setor-${bloco.slug}-titulo`
  const idDemais = `setor-${bloco.slug}-demais`
  const soNoPrazo = bloco.demais.every(p => p.atual.status === "no prazo")
  const rotuloDemais = soNoPrazo ? "No prazo" : "No prazo e sem data"

  const moldura = bloco.familia
    ? "border-border"
    : bloco.atrasados.length
      ? "border-rose-300 dark:border-rose-900"
      : bloco.venceHoje.length
        ? "border-amber-300 dark:border-amber-900"
        : "border-border"

  const lista = (ps: PacienteEmAndamento[], id?: string) => (
    <ul id={id} className="divide-y divide-border/60">
      {ps.map((p, i) => <LinhaPaciente key={`${p.paciente}-${i}`} p={p} disp={disp.get(p.paciente)} onAbrir={onAbrir} />)}
    </ul>
  )

  return (
    <section
      id={`setor-${bloco.slug}`}
      aria-labelledby={idTitulo}
      className={`flex scroll-mt-4 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ${moldura}`}
    >
      <header className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h3 id={idTitulo} className="text-lg font-black leading-tight text-foreground">
            {bloco.familia ? "Aguardando a família" : bloco.setor}
          </h3>
          {bloco.familia ? (
            <p className="text-sm text-muted-foreground">Não depende da equipe: acompanhar o retorno do responsável.</p>
          ) : (
            <>
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Responsável: </span>
                <b>{bloco.responsavel.pessoas || "—"}</b>
              </p>
              {bloco.responsavel.faz && <p className="text-xs text-muted-foreground">{bloco.responsavel.faz}</p>}
            </>
          )}
        </div>
        <Resumo bloco={bloco} />
      </header>

      {bloco.atrasados.length > 0 && (
        <>
          <TituloGrupo tom="red" rotulo="Atrasados" n={bloco.atrasados.length} />
          {lista(bloco.atrasados)}
        </>
      )}
      {bloco.venceHoje.length > 0 && (
        <>
          <TituloGrupo tom="amber" rotulo="Vencem hoje" n={bloco.venceHoje.length} />
          {lista(bloco.venceHoje)}
        </>
      )}
      {bloco.demais.length > 0 && (
        recolher ? (
          <>
            <button
              type="button"
              onClick={() => setVerDemais(v => !v)}
              aria-expanded={verDemais}
              aria-controls={idDemais}
              className={`flex min-h-11 w-full items-center gap-2 border-t border-border/60 px-3 text-left text-[11px] font-bold uppercase tracking-wide transition-colors hover:bg-muted/40 sm:min-h-9 sm:px-4 ${TONE_SOFT.green.text}`}
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${PONTO.green}`} />
              {rotuloDemais}
              <span className="tabular-nums">· {bloco.demais.length}</span>
              <span className="ml-auto inline-flex items-center gap-1 font-semibold normal-case tracking-normal text-muted-foreground">
                {verDemais ? "Esconder" : "Mostrar"}
                <ChevronDown size={14} className={`transition-transform ${verDemais ? "rotate-180" : ""}`} aria-hidden />
              </span>
            </button>
            {verDemais && lista(bloco.demais, idDemais)}
          </>
        ) : (
          <>
            <TituloGrupo tom={bloco.familia ? "slate" : "green"} rotulo={bloco.familia ? "Pacientes" : rotuloDemais} n={bloco.demais.length} />
            {lista(bloco.demais)}
          </>
        )
      )}
    </section>
  )
}
