"use client"

import type { ReactNode } from "react"
import { AvatarProfissional } from "@/components/cadastros/profissionais/pecas"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import type { ProfissionalGrade, ResumoGrade } from "@/types/grade"
import { cartao } from "./estilo"

// Resumo do período, numa linha: quem é (à esquerda) e os números (à direita),
// no padrão do sistema — sem moldura colorida nem cartões grandes de número.

function Numero({ valor, rotulo, destaque }: { valor: ReactNode; rotulo: string; destaque?: "red" }) {
  return (
    <div className="min-w-[5.5rem] px-4 first:pl-0 sm:first:pl-4">
      <p className={`text-xl font-bold leading-6 tabular-nums ${destaque === "red" ? "text-rose-700 dark:text-rose-400" : "text-foreground"}`}>{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  )
}

function Moldura({ esquerda, numeros }: { esquerda: ReactNode; numeros: ReactNode }) {
  return (
    <section className={`${cartao} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div className="flex min-w-0 items-center gap-3">{esquerda}</div>
      <div className="flex flex-wrap gap-y-2 divide-x divide-border">{numeros}</div>
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
    <Moldura
      esquerda={<>
        <AvatarProfissional icone={icone} cor={cor} fotoPath={p.foto_path} tamanho="sm" inativo={!p.ativo} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-foreground">{p.nome}</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-1.5 w-1.5 rounded-full ${p.ativo ? "bg-emerald-500" : "bg-rose-500"}`} aria-hidden />
            {p.ativo ? "Ativo" : `Saiu em ${dataBR(p.data_saida)}`}
          </p>
        </div>
      </>}
      numeros={<>
        <Numero valor={resumo.disponiveis} rotulo={`livres ${periodo}`} />
        <Numero valor={resumo.agendados} rotulo={`agendados ${periodo}`} />
        <Numero valor={resumo.bloqueados} rotulo="bloqueados" />
        {resumo.reposicao > 0
          ? <Numero valor={resumo.reposicao} rotulo="reposição" destaque="red" />
          : <Numero valor={resumo.ocupacao == null ? "—" : `${Math.round(resumo.ocupacao * 100)}%`} rotulo="ocupação" />}
      </>}
    />
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
    <Moldura
      esquerda={
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-foreground">{nome}</h2>
          <p className="text-xs text-muted-foreground">
            {convenio ?? "Convênio não informado"}
            {semDisponibilidade && " · disponibilidade da família não informada"}
          </p>
        </div>
      }
      numeros={<>
        <Numero valor={sessoes} rotulo={`sessões ${periodo}`} />
        <Numero valor={profissionais} rotulo="profissionais" />
        <Numero valor={reposicao} rotulo="reposição" destaque={reposicao > 0 ? "red" : undefined} />
        <Numero valor={foraDaJanela} rotulo="fora da janela" />
      </>}
    />
  )
}
