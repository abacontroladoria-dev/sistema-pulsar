"use client"

import { CalendarClock, CircleSlash, CheckCircle2, MapPin, Replace, Users } from "lucide-react"
import { aviso, selo } from "@/components/cronograma/grade/estilo"
import type { Tone } from "@/components/cronograma/ui/tones"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { DIAS_SEMANA, dataBR, paraMin, periodoBR, sessoesDaFaixa, somarDias, totaisDaSemana } from "@/lib/disponibilidadeProfissional"
import type { FaixaRascunho, RascunhoDisponibilidade, SituacaoVersao } from "@/types/disponibilidadeProfissional"
import { estiloCor } from "../pecas"

// Peças da aba Disponibilidade: linha do tempo do dia, selo de situação de
// versão e a semana em modo leitura. Design padrão (estilo.ts); cores de estado
// do DESIGN.md — emerald vale, amber espera, rose encerrou, sky substituída.

const ESCALA_INI = 6 * 60
const ESCALA_FIM = 22 * 60
const pct = (m: number) => `${((Math.min(Math.max(m, ESCALA_INI), ESCALA_FIM) - ESCALA_INI) / (ESCALA_FIM - ESCALA_INI)) * 100}%`

export const TOM_SITUACAO: Record<SituacaoVersao, Tone> = { vigente: "green", agendada: "amber", encerrada: "red", substituida: "blue" }
export const ROTULO_SITUACAO: Record<SituacaoVersao, string> = {
  vigente: "Vigente", agendada: "Agendada", encerrada: "Encerrada", substituida: "Substituída",
}
const ICONE_SITUACAO = { vigente: CheckCircle2, agendada: CalendarClock, encerrada: CircleSlash, substituida: Replace }

export function SeloSituacao({ situacao }: { situacao: SituacaoVersao; compacto?: boolean }) {
  const Icone = ICONE_SITUACAO[situacao]
  return (
    <span className={`${selo(TOM_SITUACAO[situacao])} py-0.5`}>
      <Icone className="h-3 w-3" aria-hidden />
      {ROTULO_SITUACAO[situacao]}
    </span>
  )
}

/**
 * Barra 06h–22h de um dia: cada faixa na cor da terapia (listrada quando a
 * faixa tem mais de uma), intervalo em cinza, sobreposição com borda vermelha.
 */
export function LinhaDoTempo({
  faixas,
  corDaTerapia,
  conflitantes = new Set<string>(),
  apagada = false,
}: {
  faixas: FaixaRascunho[]
  corDaTerapia: (id: number) => string
  conflitantes?: Set<string>
  apagada?: boolean
}) {
  return (
    <div className={apagada ? "opacity-40" : undefined}>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="img"
        aria-label={faixas.length ? faixas.map(f => `${f.inicio} a ${f.fim}`).join(", ") : "Sem horário"}>
        {faixas.map(f => {
          const cores = f.terapias.length ? f.terapias.map(corDaTerapia) : [COR_NEUTRA]
          const fundo = cores.length === 1
            ? cores[0]
            : `repeating-linear-gradient(135deg, ${cores.map((c, i) => `${c} ${i * 8}px ${(i + 1) * 8}px`).join(", ")})`
          return (
            <span key={f.chave}>
              <span
                className={`absolute inset-y-0 rounded-full ${conflitantes.has(f.chave) ? "ring-2 ring-rose-500" : ""}`}
                style={{ left: pct(paraMin(f.inicio)), right: `calc(100% - ${pct(paraMin(f.fim))})`, background: fundo }}
              />
              {f.intervaloAtivo && (
                <span
                  className="absolute inset-y-0 bg-muted-foreground/40"
                  style={{ left: pct(paraMin(f.intervaloInicio)), right: `calc(100% - ${pct(paraMin(f.intervaloFim))})` }}
                />
              )}
            </span>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground" aria-hidden>
        {["06h", "10h", "14h", "18h", "22h"].map(h => <span key={h}>{h}</span>)}
      </div>
    </div>
  )
}

/** Semana em modo leitura (versão gravada). */
export function SemanaLeitura({
  rascunho,
  corDaTerapia,
  nomeTerapia,
}: {
  rascunho: RascunhoDisponibilidade
  corDaTerapia: (id: number) => string
  nomeTerapia: (id: number) => string
}) {
  const totais = totaisDaSemana(rascunho)
  const ativos = new Set(rascunho.diasAtivos)
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {DIAS_SEMANA.map(d => {
        const faixas = rascunho.faixas.filter(f => f.dia === d.n).sort((a, b) => paraMin(a.inicio) - paraMin(b.inicio))
        const ligado = ativos.has(d.n) && faixas.length > 0
        // Dia sem horário: uma linha só, sem régua nem lista vazia.
        if (!ligado) {
          return (
            <li key={d.n} className="px-4 py-2.5 text-sm text-muted-foreground">
              {d.nome} indisponível
            </li>
          )
        }
        return (
          <li key={d.n} className="grid gap-3 px-4 py-3 md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
            <div className="flex items-center justify-between gap-2 md:block">
              <p className="text-md font-semibold text-foreground">{d.nome}</p>
              <p className="text-xs text-muted-foreground">{totais.porDia.get(d.n) ?? 0} sessões</p>
            </div>
            <LinhaDoTempo faixas={faixas} corDaTerapia={corDaTerapia} />
            <ul className="space-y-1.5">
              {faixas.map(f => (
                <li key={f.chave} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold tabular-nums text-foreground">{f.inicio}–{f.fim}</span>
                  {f.intervaloAtivo && <span className="text-xs text-muted-foreground">intervalo {f.intervaloInicio}–{f.intervaloFim}</span>}
                  <span className="text-xs text-muted-foreground">· {sessoesDaFaixa(f).length}×{f.duracao} min</span>
                  {f.capacidade > 1 && (
                    <span className={`${selo("slate")} py-0.5`} title={`${f.capacidade} pacientes por horário`}>
                      <Users className="h-3 w-3" aria-hidden />×{f.capacidade}
                      <span className="sr-only"> pacientes por horário</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" aria-hidden />{f.localNome ?? "—"}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {f.terapias.map(t => (
                      <span key={t} style={estiloCor(corDaTerapia(t))} className="inline-flex items-center gap-1 rounded-full bg-[var(--t-suave)] px-2 py-0.5 text-[11px] font-semibold text-[var(--t-tinta)] dark:text-[var(--t-tinta-escuro)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--t-cor)]" aria-hidden />{nomeTerapia(t)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

/** Linha "Grade inativa desde …" / "Começa a valer em …" acima da semana. */
export function FaixaSituacao({
  situacao, de, ate, substituidaPor,
}: { situacao: SituacaoVersao; de: string; ate: string | null; substituidaPor?: number | null }) {
  if (situacao === "substituida") {
    return (
      <p className={aviso("blue")}>
        <Replace className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Substituída{substituidaPor ? ` pela versão nº ${substituidaPor}` : ""} — não vale mais. Era para valer {periodoBR(de, ate)}.
      </p>
    )
  }
  if (situacao === "vigente") {
    return (
      <p className={aviso("green")}>
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Valendo · {periodoBR(de, ate)}
      </p>
    )
  }
  if (situacao === "agendada") {
    return (
      <p className={aviso("amber")}>
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Começa a valer em {dataBR(de)}{ate ? ` e vai até ${dataBR(ate)}` : " — prazo indeterminado"}
      </p>
    )
  }
  return (
    <p className={`${aviso("red")} font-semibold`}>
      <CircleSlash className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Grade inativa desde {ate ? dataBR(somarDias(ate, 1)) : "—"} · valeu de {dataBR(de)} a {ate ? dataBR(ate) : "—"}
    </p>
  )
}

/** Selo da situação da GRADE do profissional hoje (cabeçalho da ficha). */
export function SeloGrade({
  situacao,
  vigenteDesde,
  proximaDe,
  encerradaEm,
}: {
  situacao: "vigente" | "agendada" | "inativa" | "sem_grade"
  vigenteDesde?: string | null
  proximaDe?: string | null
  encerradaEm?: string | null
  pequeno?: boolean
}) {
  const cfg = {
    vigente: { t: "green" as Tone, Icone: CheckCircle2, texto: `Grade vigente${vigenteDesde ? ` desde ${dataBR(vigenteDesde)}` : ""}` },
    agendada: { t: "amber" as Tone, Icone: CalendarClock, texto: `Sem grade hoje · começa em ${dataBR(proximaDe)}` },
    inativa: { t: "red" as Tone, Icone: CircleSlash, texto: `Grade inativa${encerradaEm ? ` desde ${dataBR(somarDias(encerradaEm, 1))}` : ""}` },
    sem_grade: { t: "amber" as Tone, Icone: CalendarClock, texto: "Sem disponibilidade cadastrada" },
  }[situacao]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.t === "green" ? "bg-emerald-500/10 text-[var(--status-ok)]" : cfg.t === "red" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-[var(--status-atencao)]"}`}>
      <cfg.Icone className="h-3 w-3" aria-hidden />
      {cfg.texto}
    </span>
  )
}
