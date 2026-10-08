"use client"

import type { ReactNode } from "react"
import { AlertTriangle, CalendarCheck2, CircleSlash, Gauge, Lock, Plus, UserRoundX, Users } from "lucide-react"
import { AvatarProfissional } from "@/components/cadastros/profissionais/pecas"
import { NumeroPastel, tom } from "@/components/ui/pastel/pecas"
import { estiloTons } from "@/lib/cadastros/tonsTerapia"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import type { ProfissionalGrade, ResumoGrade } from "@/types/grade"

// Topo da área principal — mesmo desenho do topo da ficha do profissional:
// faixa fina na cor da terapia, nome em destaque e os números do período.

function Moldura({ cor, children }: { cor: string | null; children: ReactNode }) {
  return (
    <section style={estiloTons(cor)} className="ua-tons pp @container relative overflow-hidden rounded-2xl border border-[var(--pp-border)] bg-[var(--pp-surface)] p-4 shadow-[var(--pp-sombra)] sm:p-5">
      <span className="absolute inset-x-0 top-0 h-1.5 bg-[var(--t-500)]" aria-hidden />
      {children}
    </section>
  )
}

export function ResumoProfissional({
  p, cor, icone, resumo, periodo,
}: {
  p: ProfissionalGrade
  cor: string | null
  icone: string | null
  resumo: ResumoGrade
  /** "na semana" / "no dia" / "no mês" */
  periodo: string
}) {
  return (
    <Moldura cor={cor}>
      <div className="flex flex-wrap items-center gap-4">
        <AvatarProfissional icone={icone} cor={cor} fotoPath={p.foto_path} tamanho="lg" inativo={!p.ativo} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[22px] font-extrabold leading-7">{p.nome}</h2>
          <p className="mt-1 flex flex-wrap gap-2">
            {p.ativo
              ? <span className={`${tom("verde")} pp-pilula h-7 pl-1.5 text-xs`}><span className="pp-pilula-bola size-5"><CalendarCheck2 className="h-3 w-3" aria-hidden /></span>Ativo</span>
              : <span className={`${tom("vermelho")} pp-pilula h-7 pl-1.5 text-xs`}><span className="pp-pilula-bola size-5"><CircleSlash className="h-3 w-3" aria-hidden /></span>Saiu em {dataBR(p.data_saida)}</span>}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
        <NumeroPastel compacto t="teal" Icone={Plus} valor={resumo.disponiveis} rotulo={`vagas livres ${periodo}`} apagado={!resumo.disponiveis} />
        <NumeroPastel compacto t="aco" Icone={CalendarCheck2} valor={resumo.agendados} rotulo={`agendados ${periodo}`} apagado={!resumo.agendados} />
        <NumeroPastel compacto t="cinza" Icone={Lock} valor={resumo.bloqueados} rotulo="horários bloqueados" apagado={!resumo.bloqueados} />
        {resumo.reposicao > 0
          ? <NumeroPastel compacto t="vermelho" Icone={UserRoundX} valor={resumo.reposicao} rotulo="precisam de reposição" />
          : <NumeroPastel compacto t="verde" Icone={Gauge} valor={resumo.ocupacao == null ? "—" : `${Math.round(resumo.ocupacao * 100)}%`} rotulo="ocupação da grade" apagado={resumo.ocupacao == null} />}
      </div>
    </Moldura>
  )
}

export function ResumoPaciente({
  nome, convenio, sessoes, profissionais, reposicao, foraDaJanela, periodo, semDisponibilidade,
}: {
  nome: string
  convenio: string | null
  sessoes: number
  profissionais: number
  reposicao: number
  foraDaJanela: number
  periodo: string
  /** A família ainda não informou a disponibilidade. */
  semDisponibilidade: boolean
}) {
  return (
    <Moldura cor={null}>
      <h2 className="truncate text-[22px] font-extrabold leading-7">{nome}</h2>
      <p className="mt-1 text-sm font-semibold text-[var(--pp-ink-muted)]">
        {convenio ?? "Convênio não informado"}
        {semDisponibilidade && " · disponibilidade da família não informada"}
      </p>
      <div className="mt-4 grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-4">
        <NumeroPastel compacto t="aco" Icone={CalendarCheck2} valor={sessoes} rotulo={`sessões ${periodo}`} apagado={!sessoes} />
        <NumeroPastel compacto t="azul" Icone={Users} valor={profissionais} rotulo="profissionais" apagado={!profissionais} />
        <NumeroPastel compacto t="vermelho" Icone={UserRoundX} valor={reposicao} rotulo="precisam de reposição" apagado={!reposicao} />
        <NumeroPastel compacto t="amber" Icone={AlertTriangle} valor={foraDaJanela} rotulo="fora da disponibilidade da família" apagado={!foraDaJanela} />
      </div>
    </Moldura>
  )
}
