"use client"

import { useState, type ReactNode } from "react"
import { CalendarX2, Lock, UserRoundX } from "lucide-react"
import { tom } from "@/components/ui/pastel/pecas"
import { DIAS_CURTOS, diaDaSemana } from "@/lib/grade/motor"
import { ColunaHorarios, EixoHoras, PX_POR_MIN, type ItemColuna } from "./pecas"

// As três visões da Grade. Semana (dias em colunas) e Hoje (profissionais em
// colunas) usam a mesma grade de colunas no tempo; no celular ela vira abas,
// uma coluna por vez. Mês é um calendário com os números de cada dia.

export type ColunaGrade = {
  chave: string
  /** Cabeçalho da coluna (dia ou profissional). */
  cabecalho: ReactNode
  /** Rótulo curto da aba no celular. */
  aba: string
  itens: ItemColuna[]
  fundo?: { ini: number; fim: number; rotulo: string }[]
  /** Fim de semana sem nada: coluna estreita e esmaecida. */
  estreita?: boolean
  /** Faixa no topo (feriado). */
  aviso?: ReactNode
  destaque?: boolean
}

export function GradeColunas({
  colunas, janela, larguraMin = 128, rotuloAbas, abaInicial,
}: {
  colunas: ColunaGrade[]
  janela: { de: number; ate: number }
  larguraMin?: number
  rotuloAbas: string
  /** Aba que abre no celular (ex.: hoje). */
  abaInicial?: string
}) {
  const visiveisNoCelular = colunas.filter(c => !c.estreita)
  const [aba, setAba] = useState<string | null>(null)
  const selecionada = visiveisNoCelular.find(c => c.chave === aba)
    ?? visiveisNoCelular.find(c => c.chave === abaInicial)
    ?? visiveisNoCelular[0]

  const template = colunas.map(c => (c.estreita ? "56px" : `minmax(${larguraMin}px, 1fr)`)).join(" ")

  return (
    <div>
      {/* Celular: abas, uma coluna por vez */}
      <div className="md:hidden">
        <div role="tablist" aria-label={rotuloAbas} className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {visiveisNoCelular.map(c => (
            <button key={c.chave} type="button" role="tab" aria-selected={c.chave === selecionada?.chave}
              onClick={() => setAba(c.chave)}
              className={`${tom(c.destaque ? "aco" : "cinza")} pp-pilula min-h-11 shrink-0 px-4 ${c.chave === selecionada?.chave ? "!bg-[var(--c)] !text-[var(--c-sobre)]" : ""}`}>
              {c.aba}
            </button>
          ))}
        </div>
        {selecionada && (
          <div className="rounded-2xl bg-[var(--pp-surface)] p-2 shadow-[inset_0_0_0_1px_var(--pp-border)]">
            <div className="mb-2 px-1">{selecionada.cabecalho}</div>
            {selecionada.aviso}
            <div className="flex">
              <EixoHoras de={janela.de} ate={janela.ate} />
              <div className="min-w-0 flex-1">
                <ColunaHorarios itens={selecionada.itens} de={janela.de} ate={janela.ate} fundo={selecionada.fundo} vazio={<Vazio />} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tela larga: todas as colunas */}
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-fit">
          <div className="sticky top-0 z-10 flex bg-[var(--pp-surface)] pb-2">
            <div className="w-12 shrink-0" />
            <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: template }}>
              {colunas.map(c => (
                <div key={c.chave} className={`min-w-0 ${c.estreita ? "opacity-60" : ""}`}>{c.cabecalho}</div>
              ))}
            </div>
          </div>
          <div className="flex">
            <EixoHoras de={janela.de} ate={janela.ate} />
            <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: template }}>
              {colunas.map(c => (
                <div key={c.chave}
                  className={`relative min-w-0 rounded-[14px] ${c.destaque ? `${tom("aco")} bg-[var(--c-suave)]` : "bg-[var(--pp-muted)]/40"} ${c.estreita ? "opacity-50" : ""}`}>
                  {c.aviso && <div className="absolute inset-x-1 top-1 z-[1]">{c.aviso}</div>}
                  {c.estreita
                    ? <div style={{ height: (janela.ate - janela.de) * PX_POR_MIN }} className="flex items-center justify-center" aria-hidden>
                        <span className="rotate-180 text-[11px] font-bold text-[var(--pp-ink-muted)] [writing-mode:vertical-rl]">sem atendimento</span>
                      </div>
                    : <ColunaHorarios itens={c.itens} de={janela.de} ate={janela.ate} fundo={c.fundo} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Vazio() {
  return (
    <p className="absolute inset-x-2 top-6 rounded-xl bg-[var(--pp-muted)] px-3 py-4 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">
      Nada neste dia.
    </p>
  )
}

/** Cabeçalho de um dia: "Seg 12" com hoje em destaque. */
export function CabecalhoDia({ data, hoje, extra }: { data: string; hoje: string; extra?: ReactNode }) {
  const ehHoje = data === hoje
  return (
    <div className={`flex items-baseline justify-between gap-1 rounded-xl px-2 py-1.5 ${ehHoje ? `${tom("aco")} bg-[var(--c)] text-[var(--c-sobre)]` : ""}`}>
      <span className="text-sm font-extrabold">
        {DIAS_CURTOS[diaDaSemana(data)]} <span className="tabular-nums">{Number(data.slice(8, 10))}</span>
      </span>
      {extra}
    </div>
  )
}

// ── Mês ───────────────────────────────────────────────────────────────────────

export type NumerosDia = { agendados: number; livres: number; bloqueados: number; reposicao: number; feriado: string | null }

export function GradeMes({
  semanas, mes, hoje, numeros, onAbrirDia,
}: {
  semanas: string[][]
  /** "AAAA-MM" do mês exibido. */
  mes: string
  hoje: string
  numeros: Map<string, NumerosDia>
  onAbrirDia: (data: string) => void
}) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 pb-1.5" aria-hidden>
        {DIAS_CURTOS.map(d => <span key={d} className="px-1 text-xs font-extrabold text-[var(--pp-ink-muted)]">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {semanas.flat().map(data => {
          const n = numeros.get(data)
          const fora = !data.startsWith(mes)
          const ehHoje = data === hoje
          const fimDeSemana = [0, 6].includes(diaDaSemana(data))
          const vazio = !n || (!n.agendados && !n.livres && !n.bloqueados && !n.reposicao)
          return (
            <button key={data} type="button" onClick={() => onAbrirDia(data)}
              aria-label={`${data.split("-").reverse().join("/")}: ${n?.agendados ?? 0} agendados, ${n?.livres ?? 0} livres${n?.feriado ? `, feriado ${n.feriado}` : ""}. Abrir a semana`}
              className={`flex min-h-24 flex-col gap-1 rounded-[14px] p-1.5 text-left transition-shadow hover:shadow-[inset_0_0_0_2px_var(--pp-foco)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pp-foco)] md:min-h-28 md:p-2 ${
                ehHoje ? `${tom("aco")} bg-[var(--c-suave)] shadow-[inset_0_0_0_2px_var(--c-medio)]`
                : fora || (fimDeSemana && vazio) ? "bg-[var(--pp-muted)]/50 opacity-60" : "bg-[var(--pp-surface)] shadow-[inset_0_0_0_1px_var(--pp-border)]"}`}>
              <span className="text-sm font-extrabold tabular-nums">{Number(data.slice(8, 10))}</span>
              {n?.feriado && (
                <span className="flex items-center gap-1 truncate text-[11px] font-bold text-[var(--pp-ink-muted)]">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{n.feriado}</span>
                </span>
              )}
              {n && !vazio && (
                <span className="mt-auto flex flex-wrap gap-1">
                  {n.agendados > 0 && <Chip t="aco" Icone={CalendarX2} valor={n.agendados} rotulo="agendados" />}
                  {n.livres > 0 && <Chip t="teal" valor={n.livres} rotulo="livres" />}
                  {n.bloqueados > 0 && <Chip t="cinza" Icone={Lock} valor={n.bloqueados} rotulo="bloqueados" />}
                  {n.reposicao > 0 && <Chip t="vermelho" Icone={UserRoundX} valor={n.reposicao} rotulo="reposição" />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ t, Icone, valor, rotulo }: { t: Parameters<typeof tom>[0]; Icone?: typeof Lock; valor: number; rotulo: string }) {
  return (
    <span className={`${tom(t)} inline-flex items-center gap-0.5 rounded-full bg-[var(--c-suave)] px-1.5 text-[11px] font-extrabold leading-5 text-[var(--c-tinta)]`} title={`${valor} ${rotulo}`}>
      {Icone ? <Icone className="h-3 w-3" aria-hidden /> : <span aria-hidden>+</span>}
      <span className="tabular-nums">{valor}</span>
      <span className="sr-only"> {rotulo}</span>
    </span>
  )
}
