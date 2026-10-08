"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Lock } from "lucide-react"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { DIAS_CURTOS, diaDaSemana } from "@/lib/grade/motor"
import { seletorOpcao, seletorTrilha } from "./estilo"
import { ColunaHorarios, EixoHoras, GradeGrandeProvider, LinhasEscala, SoExibicaoProvider, useGradeGrande, type Escala, type ItemColuna } from "./pecas"

// As três visões da Grade, no design padrão (receitas da Agenda do Connect).
// Semana (dias em colunas) e Dia (profissionais em colunas) usam a mesma grade
// de colunas no tempo; no celular ela vira abas, uma coluna por vez. Mês é um
// calendário com os números de cada dia.

export type ColunaGrade = {
  chave: string
  /** Cabeçalho da coluna (dia ou profissional). */
  cabecalho: ReactNode
  /** Rótulo curto da aba no celular. */
  aba: string
  itens: ItemColuna[]
  fundo?: { ini: number; fim: number; rotulo: string }[]
  /** Fim de semana sem nada: coluna estreita, avisada uma vez no cabeçalho. */
  estreita?: boolean
  /** Linha extra no cabeçalho (feriado). */
  aviso?: ReactNode
  /**
   * Dia útil sem grade nem sessão: o aviso fica no topo da própria coluna, não
   * no cabeçalho (que assim não cresce). Fim de semana não ganha aviso.
   */
  textoVazio?: string
  destaque?: boolean
}

export function GradeColunas({
  colunas, escala, larguraMin = 128, rotuloAbas, abaInicial, onAlturaLivre, soExibicao = false,
}: {
  /** Cartões mostram só a terapia de exibição (olho fechado). */
  soExibicao?: boolean
  /** Tela cheia: a grade ocupa a altura do pai e informa quanto sobra para a régua (px). */
  onAlturaLivre?: (px: number) => void
  colunas: ColunaGrade[]
  escala: Escala
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

  const rolagem = useRef<HTMLDivElement>(null)
  const cabecalho = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rolagem.current
    if (!onAlturaLivre || !el) return
    const medir = () => {
      // 16 = py-2 da área das colunas; 2 = folga para não aparecer barra de rolagem por arredondamento.
      const livre = el.clientHeight - (cabecalho.current?.offsetHeight ?? 0) - 18
      if (el.clientHeight > 0 && livre > 0) onAlturaLivre(livre)
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    if (cabecalho.current) ro.observe(cabecalho.current)
    return () => ro.disconnect()
  }, [onAlturaLivre])

  const grande = !!onAlturaLivre
  const template = `${grande ? 80 : 56}px ${colunas.map(c => (c.estreita ? "72px" : `minmax(${larguraMin}px, 1fr)`)).join(" ")}`

  return (
    <GradeGrandeProvider value={grande}>
    <SoExibicaoProvider value={soExibicao}>
    <div className={grande ? "h-full" : undefined}>
      {/* Celular: abas, uma coluna por vez */}
      <div className="md:hidden">
        <div className="overflow-x-auto border-b border-border p-2">
          <div role="tablist" aria-label={rotuloAbas} className={`${seletorTrilha} w-max`}>
            {visiveisNoCelular.map(c => (
              <button key={c.chave} type="button" role="tab" aria-selected={c.chave === selecionada?.chave}
                onClick={() => setAba(c.chave)} className={`${seletorOpcao(c.chave === selecionada?.chave)} min-h-11`}>
                {c.aba}
              </button>
            ))}
          </div>
        </div>
        {selecionada && (
          <div>
            <div className="border-b border-border px-3 py-2">{selecionada.cabecalho}{selecionada.aviso}</div>
            <div className="flex py-2 pr-2">
              <EixoHoras escala={escala} />
              <div className="min-w-0 flex-1 border-l border-border">
                <ColunaHorarios itens={selecionada.itens} escala={escala} fundo={selecionada.fundo} vazio={<Vazio texto={selecionada.textoVazio} />} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tela larga: todas as colunas. Um só contêiner rola nos dois sentidos,
          para o cabeçalho grudar no topo (sticky não funciona dentro de um
          overflow-x separado). */}
      <div ref={rolagem} className={`hidden overflow-auto md:block ${onAlturaLivre ? "h-full" : "max-h-[calc(100vh-17rem)] min-h-80"}`}>
        <div className="min-w-fit">
          <div ref={cabecalho} className="sticky top-0 z-10 grid border-b border-border bg-card" style={{ gridTemplateColumns: template }}>
            <div aria-hidden />
            {colunas.map(c => (
              <div key={c.chave} className={`min-w-0 border-l border-border px-1.5 py-1 ${c.destaque ? "bg-muted/30" : ""}`}>
                {c.cabecalho}
                {c.aviso}
              </div>
            ))}
          </div>
          <div className="grid py-2" style={{ gridTemplateColumns: template }}>
            <EixoHoras escala={escala} />
            {colunas.map(c => (
              <div key={c.chave} className={`relative min-w-0 border-l border-border ${c.destaque ? "bg-muted/30" : ""}`}>
                {c.estreita
                  ? <div style={{ height: escala.altura }} className="relative opacity-40" aria-hidden><LinhasEscala escala={escala} /></div>
                  : <ColunaHorarios itens={c.itens} escala={escala} fundo={c.fundo}
                      vazio={c.textoVazio ? <p className={`absolute inset-x-1 top-2 text-center text-muted-foreground ${grande ? "text-[13px]" : "text-[11px]"}`}>{c.textoVazio}</p> : undefined} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </SoExibicaoProvider>
    </GradeGrandeProvider>
  )
}

function Vazio({ texto }: { texto?: string }) {
  return (
    <p className="absolute inset-x-2 top-6 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
      {texto ?? "Nada neste dia."}
    </p>
  )
}

/** Cabeçalho de um dia, numa linha só: "SEG" e o número num círculo (hoje preenchido). */
export function CabecalhoDia({ data, hoje, extra }: {
  data: string
  hoje: string
  extra?: ReactNode
}) {
  const ehHoje = data === hoje
  const grande = useGradeGrande()
  return (
    <div className="flex items-center justify-center gap-1.5 text-center">
      <span className={`font-medium uppercase ${grande ? "text-sm" : "text-[11px]"} ${ehHoje ? "text-foreground" : "text-muted-foreground"}`}>
        {DIAS_CURTOS[diaDaSemana(data)]}
      </span>
      <span className={`flex items-center justify-center rounded-full tabular-nums ${grande ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm"} ${
        ehHoje ? "bg-primary font-semibold text-primary-foreground" : "text-foreground"}`}
        aria-label={ehHoje ? "hoje" : undefined}>
        {Number(data.slice(8, 10))}
      </span>
      {extra}
    </div>
  )
}

/** Linha de feriado no cabeçalho da coluna. */
export function AvisoFeriado({ nome }: { nome: string }) {
  const grande = useGradeGrande()
  return (
    <p className={`mt-1 flex items-center justify-center gap-1 truncate font-medium text-muted-foreground ${grande ? "text-[13px]" : "text-[11px]"}`} title={`Feriado: ${nome}`}>
      <Lock className={`${grande ? "h-4 w-4" : "h-3 w-3"} shrink-0`} aria-hidden /><span className="truncate">{nome}</span>
    </p>
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
      <div className="grid grid-cols-7 border-b border-border" aria-hidden>
        {DIAS_CURTOS.map(d => (
          <span key={d} className="px-2 py-2 text-center text-[11px] font-medium uppercase text-muted-foreground">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {semanas.flat().map(data => {
          const n = numeros.get(data)
          const fora = !data.startsWith(mes)
          const ehHoje = data === hoje
          const rotulo = `${data.split("-").reverse().join("/")}: ${n?.agendados ?? 0} agendados, ${n?.livres ?? 0} livres${n?.feriado ? `, feriado ${n.feriado}` : ""}. Abrir a semana`
          return (
            <button key={data} type="button" onClick={() => onAbrirDia(data)} aria-label={rotulo}
              className={`flex min-h-24 flex-col gap-0.5 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-muted/50 md:min-h-28 ${
                fora ? "bg-muted/30 text-muted-foreground" : ""} ${foco}`}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums ${
                ehHoje ? "bg-primary font-semibold text-primary-foreground" : ""}`}>
                {Number(data.slice(8, 10))}
              </span>
              {n?.feriado && (
                <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{n.feriado}</span>
                </span>
              )}
              {n && (
                <span className="mt-auto space-y-0.5">
                  {n.agendados > 0 && <Linha cor="bg-sky-500" valor={n.agendados} rotulo="agendados" />}
                  {n.livres > 0 && <Linha cor="border border-dashed border-muted-foreground/60" valor={n.livres} rotulo="livres" />}
                  {n.bloqueados > 0 && <Linha cor="bg-muted-foreground/40" valor={n.bloqueados} rotulo="bloq." />}
                  {n.reposicao > 0 && <Linha cor="bg-rose-500" valor={n.reposicao} rotulo="reposição" destaque />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Linha({ cor, valor, rotulo, destaque = false }: { cor: string; valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <span className={`flex items-center gap-1 text-[11px] leading-4 ${destaque ? "font-semibold text-rose-700 dark:text-rose-400" : "text-muted-foreground"}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${cor}`} aria-hidden />
      <span className="tabular-nums">{valor}</span>
      <span className="hidden truncate sm:inline">{rotulo}</span>
    </span>
  )
}
