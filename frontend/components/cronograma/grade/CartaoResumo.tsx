"use client"

import type { ReactNode } from "react"
import { AvatarProfissional } from "@/components/cadastros/profissionais/pecas"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import { dataBR } from "@/lib/disponibilidadeProfissional"
import type { ProfissionalGrade } from "@/types/grade"
import { cartao } from "./estilo"
import { Amostra, TOM_ESTADO, type FiltroEstados } from "./pecas"

// Painel único acima da grade: quem é (à esquerda) e os números do período (à
// direita). Os números de estado SÃO o filtro da grade — clicar esconde ou
// mostra (antes havia o resumo e, embaixo, uma legenda repetindo os mesmos
// números; decisão do usuário, 08/10/2026). Números que não filtram
// (ocupação, profissionais…) ficam depois de um divisor, só leitura.

export type EstadoFiltro = keyof typeof TOM_ESTADO
export type FiltroResumo = { k: EstadoFiltro; valor: number; rotulo: string }
export type NumeroResumo = { valor: ReactNode; rotulo: string; destaque?: boolean }

export function PainelResumo({
  esquerda, filtros, numeros = [], ocultos, onAlternar, acao,
}: {
  /** Botão discreto no fim da linha (ex.: expandir a grade em tela cheia). */
  acao?: ReactNode
  esquerda: ReactNode
  filtros: FiltroResumo[]
  numeros?: NumeroResumo[]
  ocultos: FiltroEstados
  /** Ausente (Mês): os números aparecem, mas não filtram. */
  onAlternar?: (k: EstadoFiltro) => void
}) {
  return (
    <section className={`${cartao} flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between`} aria-label="Resumo do período">
      <div className="flex min-w-0 items-center gap-3 px-1">{esquerda}</div>
      <div className="flex flex-wrap items-stretch gap-1">
        <div className="flex flex-wrap gap-1" role={onAlternar ? "group" : undefined}
          aria-label={onAlternar ? "Mostrar na grade — clique para esconder ou mostrar" : undefined}>
          {filtros.map(f => {
            const visivel = !ocultos.has(f.k)
            const alerta = (f.k === "inativo" || f.k === "fora_da_grade") && f.valor > 0
            const miolo = (
              <>
                <span className="flex items-center gap-1.5">
                  <Amostra k={f.k} />
                  <span className={`text-xl font-bold leading-6 tabular-nums ${
                    alerta ? (f.k === "inativo" ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400") : "text-foreground"}`}>
                    {f.valor}
                  </span>
                </span>
                <span className={`text-xs text-muted-foreground ${visivel ? "" : "line-through"}`}>{f.rotulo}</span>
              </>
            )
            return onAlternar ? (
              <button key={f.k} type="button" aria-pressed={visivel} onClick={() => onAlternar(f.k)}
                title={visivel ? `Esconder da grade: ${f.rotulo}` : `Mostrar na grade: ${f.rotulo}`}
                className={`flex min-h-11 min-w-[5.5rem] flex-col items-start justify-center rounded-md px-3 py-1 text-left transition-colors hover:bg-muted ${visivel ? "" : "opacity-50"} ${foco}`}>
                {miolo}
              </button>
            ) : (
              <div key={f.k} className="flex min-w-[5.5rem] flex-col items-start justify-center px-3 py-1">{miolo}</div>
            )
          })}
        </div>
        {numeros.length > 0 && (
          <div className="flex flex-wrap gap-1 border-l border-border pl-1">
            {numeros.map(n => (
              <div key={n.rotulo} className="flex min-w-[5.5rem] flex-col items-start justify-center px-3 py-1">
                <span className={`text-xl font-bold leading-6 tabular-nums ${n.destaque ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{n.valor}</span>
                <span className="text-xs text-muted-foreground">{n.rotulo}</span>
              </div>
            ))}
          </div>
        )}
        {acao && <div className="flex items-center gap-0.5 border-l border-border pl-2">{acao}</div>}
      </div>
    </section>
  )
}

/** Lado esquerdo do painel na visão do profissional. */
export function QuemProfissional({ p, cor, icone }: { p: ProfissionalGrade; cor: string | null; icone: string | null }) {
  return (
    <>
      <AvatarProfissional icone={icone} cor={cor} fotoPath={p.foto_path} tamanho="sm" inativo={!p.ativo} />
      <div className="min-w-0">
        <h2 className="truncate text-base font-bold text-foreground">{p.nome}</h2>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${p.ativo ? "bg-emerald-500" : "bg-rose-500"}`} aria-hidden />
          {p.ativo ? "Ativo" : `Saiu em ${dataBR(p.data_saida)}`}
        </p>
      </div>
    </>
  )
}

/** Lado esquerdo do painel na visão do paciente. */
export function QuemPaciente({ nome, convenio, semDisponibilidade }: { nome: string; convenio: string | null; semDisponibilidade: boolean }) {
  return (
    <div className="min-w-0">
      <h2 className="truncate text-base font-bold text-foreground">{nome}</h2>
      <p className="text-xs text-muted-foreground">
        {convenio ?? "Convênio não informado"}
        {semDisponibilidade && " · disponibilidade da família não informada"}
      </p>
    </div>
  )
}
