"use client"

// CartaoUnidade — o "quadrado" de cada unidade: % com profissional e % com
// paciente lado a lado, a barra que contém os dois, o mapa da semana e os
// atalhos do que fazer com a folga. Clique abre o PainelUnidade.

import type { KeyboardEvent } from "react"
import { ChevronRight } from "lucide-react"
import { pctAproveitamento, pctComPaciente, pctComProfissional, type ContagemCadeiras, type OcupacaoClinicaUnidade } from "@/lib/cronograma/ocupacaoClinica"
import { BarraCapacidade, MarcaComProfissional } from "./BarraCapacidade"
import { MapaSemana } from "./MapaSemana"
import { COR_ALERTA, SITUACAO, fmtNum, fmtPct, plural } from "./visual"

/** Os dois números grandes, sempre na mesma ordem e com a mesma marca da barra. */
export function ParDeNumeros({ contagem, grande = false, casas = 0 }: { contagem: ContagemCadeiras; grande?: boolean; casas?: number }) {
  const valor = grande ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
      <div>
        <div className={`${valor} font-black leading-none tracking-tight text-foreground`}>{fmtPct(pctComProfissional(contagem), casas)}</div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"><MarcaComProfissional />Com profissional</div>
      </div>
      <div>
        <div className={`${valor} font-black leading-none tracking-tight text-foreground`}>{fmtPct(pctComPaciente(contagem), casas)}</div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <span className={`h-3 w-3 rounded-[3px] ${SITUACAO.paciente.cor}`} aria-hidden />Com paciente
        </div>
      </div>
      {pctAproveitamento(contagem) !== null && (
        <p className="pb-1 text-sm text-muted-foreground">
          <b className="text-foreground">{fmtPct(pctAproveitamento(contagem))}</b> do tempo com profissional vira atendimento
        </p>
      )}
    </div>
  )
}

/** Cartão inteiro clicável sem virar <button> (que não aceita título/blocos dentro). */
function clicavel(onAbrir: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onAbrir,
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir() }
    },
  }
}

interface Props {
  unidade: OcupacaoClinicaUnidade
  onAbrir: () => void
}

export function CartaoUnidade({ unidade: u, onAbrir }: Props) {
  return (
    <div
      {...clicavel(onAbrir)}
      aria-label={`${u.unidade}: ${fmtPct(pctComProfissional(u.contagem))} com profissional, ${fmtPct(pctComPaciente(u.contagem))} com paciente. Abrir detalhes`}
      className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black text-foreground">{u.unidade}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {plural(u.salasOperacionais, "sala em uso", "salas em uso")} · {plural(u.cadeiras, "cadeira", "cadeiras")} · {plural(u.profissionaisAlocados, "profissional", "profissionais")} · {plural(u.pacientes, "paciente", "pacientes")}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 pt-1 text-sm font-bold text-sky-700 group-hover:underline dark:text-sky-400">
          Detalhes <ChevronRight size={16} aria-hidden />
        </span>
      </div>

      <ParDeNumeros contagem={u.contagem} />
      <div className="w-full"><BarraCapacidade contagem={u.contagem} /></div>
      <div className="w-full"><MapaSemana unidade={u} /></div>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-sm font-semibold text-foreground">
          <span className={`h-2.5 w-2.5 rounded-sm ${SITUACAO.aberta.cor}`} aria-hidden />
          <b className="tabular-nums">{fmtNum(u.contagem.aberta)}</b> com agenda aberta
        </span>
        {u.contagem.regularizar > 0 && (
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${COR_ALERTA}`}>
            <b className="tabular-nums">{fmtNum(u.contagem.regularizar)}</b> a regularizar
          </span>
        )}
        {u.foraDoMapa.sessoes > 0 && (
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${COR_ALERTA}`}>
            <b className="tabular-nums">{fmtNum(u.foraDoMapa.sessoes)}</b> {u.foraDoMapa.sessoes === 1 ? "sessão" : "sessões"} fora do mapa
          </span>
        )}
        {u.inconsistencias > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <b className="tabular-nums">{fmtNum(u.inconsistencias)}</b> {u.inconsistencias === 1 ? "conflito" : "conflitos"} de sala
          </span>
        )}
      </div>
    </div>
  )
}

/** Unidade parceira: uma linha compacta no fim, fora do total da rede. */
export function LinhaTerceirizada({ unidade: u, onAbrir }: Props) {
  return (
    <div
      {...clicavel(onAbrir)}
      className="flex cursor-pointer flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl border border-border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0">
        <div className="font-black text-foreground">{u.unidade}</div>
        <div className="text-sm text-muted-foreground">
          {plural(u.salasOperacionais, "sala", "salas")} · fora do total da rede
        </div>
      </div>
      <div className="text-sm text-muted-foreground">
        <b className="text-foreground">{fmtPct(pctComProfissional(u.contagem))}</b> com profissional · <b className="text-foreground">{fmtPct(pctComPaciente(u.contagem))}</b> com paciente · {plural(u.contagem.total, "horário", "horários")}
      </div>
      <span className="inline-flex items-center gap-0.5 text-sm font-bold text-sky-700 dark:text-sky-400">Detalhes <ChevronRight size={16} aria-hidden /></span>
    </div>
  )
}
