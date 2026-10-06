"use client"

import { CalendarClock, CircleSlash, CheckCircle2, MapPin, Replace } from "lucide-react"
import { tom, type Tom } from "@/components/ui/pastel/pecas"
import { COR_NEUTRA } from "@/lib/cadastros/terapias"
import { DIAS_SEMANA, dataBR, paraMin, periodoBR, sessoesDaFaixa, somarDias, totaisDaSemana } from "@/lib/disponibilidadeProfissional"
import type { FaixaRascunho, RascunhoDisponibilidade, SituacaoVersao } from "@/types/disponibilidadeProfissional"
import { estiloCor } from "../pecas"

// Peças da aba Disponibilidade: linha do tempo do dia, selo de situação de
// versão e a semana em modo leitura.

const ESCALA_INI = 6 * 60
const ESCALA_FIM = 22 * 60
const pct = (m: number) => `${((Math.min(Math.max(m, ESCALA_INI), ESCALA_FIM) - ESCALA_INI) / (ESCALA_FIM - ESCALA_INI)) * 100}%`

export const TOM_SITUACAO: Record<SituacaoVersao, Tom> = { vigente: "verde", agendada: "aco", encerrada: "vermelho", substituida: "cinza" }
export const ROTULO_SITUACAO: Record<SituacaoVersao, string> = {
  vigente: "Vigente", agendada: "Agendada", encerrada: "Encerrada", substituida: "Substituída",
}
const ICONE_SITUACAO = { vigente: CheckCircle2, agendada: CalendarClock, encerrada: CircleSlash, substituida: Replace }

export function SeloSituacao({ situacao, compacto = false }: { situacao: SituacaoVersao; compacto?: boolean }) {
  const Icone = ICONE_SITUACAO[situacao]
  return (
    <span className={`${tom(TOM_SITUACAO[situacao])} pp-pilula ${compacto ? "h-7 pl-1 text-[12px]" : "h-8 pl-1.5 text-[12px]"}`}>
      <span className="pp-pilula-bola size-5"><Icone className="h-3 w-3" aria-hidden /></span>
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
      <div className="relative h-3.5 overflow-hidden rounded-full bg-[var(--pp-muted)]" role="img"
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
                  className="absolute inset-y-0 bg-[var(--pp-border-strong)]"
                  style={{ left: pct(paraMin(f.intervaloInicio)), right: `calc(100% - ${pct(paraMin(f.intervaloFim))})` }}
                />
              )}
            </span>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold tabular-nums text-[var(--pp-ink-muted)]" aria-hidden>
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
    <div className="space-y-3">
      {DIAS_SEMANA.map(d => {
        const faixas = rascunho.faixas.filter(f => f.dia === d.n).sort((a, b) => paraMin(a.inicio) - paraMin(b.inicio))
        const ligado = ativos.has(d.n) && faixas.length > 0
        // Dia sem horário: uma linha só, sem régua nem lista vazia.
        if (!ligado) {
          return (
            <p key={d.n} className="rounded-[16px] bg-[var(--pp-muted)] px-4 py-2.5 text-[14px] font-bold text-[var(--pp-ink-muted)]">
              {d.nome} indisponível
            </p>
          )
        }
        return (
          <div key={d.n} className="rounded-[20px] bg-[var(--pp-surface)] p-4 shadow-[inset_0_0_0_1px_var(--pp-border)]">
            <div className="grid gap-3 @3xl:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1.4fr)] @3xl:items-center">
              <div className="flex items-center justify-between gap-2 @3xl:block">
                <p className="text-[15px] font-extrabold">{d.nome}</p>
                <p className="text-xs font-semibold text-[var(--pp-ink-muted)]">{totais.porDia.get(d.n) ?? 0} sessões</p>
              </div>
              <LinhaDoTempo faixas={faixas} corDaTerapia={corDaTerapia} />
              <ul className="space-y-1.5">
                {faixas.map(f => (
                  <li key={f.chave} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="font-extrabold tabular-nums">{f.inicio}–{f.fim}</span>
                    {f.intervaloAtivo && <span className="text-xs font-semibold text-[var(--pp-ink-muted)]">intervalo {f.intervaloInicio}–{f.intervaloFim}</span>}
                    <span className="text-xs font-semibold text-[var(--pp-ink-muted)]">· {sessoesDaFaixa(f).length}×{f.duracao} min</span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--pp-ink-muted)]">
                      <MapPin className="h-3 w-3" aria-hidden />{f.localNome ?? "—"}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {f.terapias.map(t => (
                        <span key={t} style={estiloCor(corDaTerapia(t))} className="inline-flex items-center gap-1 rounded-full bg-[var(--t-suave)] px-2 py-0.5 text-[11px] font-bold text-[var(--t-tinta)] dark:text-[var(--t-tinta-escuro)]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--t-cor)]" aria-hidden />{nomeTerapia(t)}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Linha "Grade inativa desde …" / "Começa a valer em …" acima da semana. */
export function FaixaSituacao({
  situacao, de, ate, substituidaPor,
}: { situacao: SituacaoVersao; de: string; ate: string | null; substituidaPor?: number | null }) {
  if (situacao === "substituida") {
    return (
      <p className={`${tom("cinza")} flex items-center gap-2 rounded-[16px] bg-[var(--c-suave)] px-4 py-3 text-sm font-bold text-[var(--c-tinta)]`}>
        <Replace className="h-4 w-4 shrink-0" aria-hidden />
        Substituída{substituidaPor ? ` pela versão nº ${substituidaPor}` : ""} — não vale mais. Era para valer {periodoBR(de, ate)}.
      </p>
    )
  }
  if (situacao === "vigente") {
    return (
      <p className={`${tom("verde")} flex items-center gap-2 rounded-[16px] bg-[var(--c-suave)] px-4 py-3 text-sm font-bold text-[var(--c-tinta)]`}>
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> Valendo · {periodoBR(de, ate)}
      </p>
    )
  }
  if (situacao === "agendada") {
    return (
      <p className={`${tom("aco")} flex items-center gap-2 rounded-[16px] bg-[var(--c-suave)] px-4 py-3 text-sm font-bold text-[var(--c-tinta)]`}>
        <CalendarClock className="h-4 w-4 shrink-0" aria-hidden /> Começa a valer em {dataBR(de)}{ate ? ` e vai até ${dataBR(ate)}` : " — prazo indeterminado"}
      </p>
    )
  }
  return (
    <p className={`${tom("vermelho")} flex items-center gap-2 rounded-[16px] bg-[var(--c-suave)] px-4 py-3 text-sm font-extrabold text-[var(--c-tinta)] shadow-[inset_0_0_0_2px_var(--c-linha)]`}>
      <CircleSlash className="h-4 w-4 shrink-0" aria-hidden /> Grade inativa desde {ate ? dataBR(somarDias(ate, 1)) : "—"} · valeu de {dataBR(de)} a {ate ? dataBR(ate) : "—"}
    </p>
  )
}

/**
 * Selo da situação da GRADE do profissional hoje (hero e card da lista).
 * Inativa é o caso que mais precisa saltar aos olhos: vermelho, ícone e data.
 */
export function SeloGrade({
  situacao,
  vigenteDesde,
  proximaDe,
  encerradaEm,
  pequeno = false,
}: {
  situacao: "vigente" | "agendada" | "inativa" | "sem_grade"
  vigenteDesde?: string | null
  proximaDe?: string | null
  encerradaEm?: string | null
  pequeno?: boolean
}) {
  const cfg = {
    vigente: { t: "verde" as Tom, Icone: CheckCircle2, texto: `Grade vigente${vigenteDesde ? ` desde ${dataBR(vigenteDesde)}` : ""}` },
    agendada: { t: "aco" as Tom, Icone: CalendarClock, texto: `Sem grade hoje · começa em ${dataBR(proximaDe)}` },
    inativa: { t: "vermelho" as Tom, Icone: CircleSlash, texto: `Grade inativa${encerradaEm ? ` desde ${dataBR(somarDias(encerradaEm, 1))}` : ""}` },
    sem_grade: { t: "cinza" as Tom, Icone: CalendarClock, texto: "Sem disponibilidade cadastrada" },
  }[situacao]
  return (
    <span className={`${tom(cfg.t)} pp-pilula ${pequeno ? "h-7 pl-1 pr-2.5 text-[11px]" : "h-8 pl-1.5 text-[12px]"} ${situacao === "inativa" ? "bg-[var(--c-suave)] text-[var(--c-tinta)] shadow-[inset_0_0_0_1.5px_var(--c-medio)]" : ""}`}>
      <span className={`pp-pilula-bola ${pequeno ? "size-5" : "size-5"}`}><cfg.Icone className="h-3 w-3" aria-hidden /></span>
      {cfg.texto}
    </span>
  )
}
