"use client"

import { Users } from "lucide-react"
import type { LinhaAnalista } from "@/lib/pdi/painelAnalista"
import { ItemPrioridade } from "./ItemPrioridade"

// A seção "Prioridade de atendimento" — o corpo da tela. Era uma grade de
// cartões grandes em `xl:grid-cols-4`; virou uma lista operacional em duas
// colunas, mais densa e com a hierarquia certa dentro de cada linha (ver
// ItemPrioridade.tsx).
//
// SEM paginação e sem "Ver todos os analistas", ao contrário da referência
// visual: esta tela existe para que nenhum coordenador com atraso passe batido,
// e esconder parte da lista atrás de um clique contraria exatamente isso. O
// rodapé diz quantos estão à vista.
//
// Os quatro estados vazios continuam distintos — cada um leva a uma saída
// diferente, e colapsá-los num "nada aqui" genérico faria a tela mentir sobre
// o que está acontecendo.

export function ListaPrioridade({
  linhas,
  visiveis,
  piorAtrasoPorAnalista,
  carregando,
  erro,
  comDoisCoordenadores,
  onAbrir,
}: {
  /** Todas as linhas, antes do filtro — distingue "não há dados" de "o filtro não achou". */
  linhas: LinhaAnalista[]
  visiveis: LinhaAnalista[]
  piorAtrasoPorAnalista: Map<number, number>
  carregando: boolean
  erro: string | null
  /** Quantos pacientes têm mais de um Coordenador de Caso — 0 esconde a nota. */
  comDoisCoordenadores: number
  onAbrir: (profissionalId: number) => void
}) {
  return (
    <section aria-label="Prioridade de atendimento" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2.5">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-bold text-foreground">Prioridade de atendimento</h2>
          {/* O texto anterior dizia só "maior volume de PDI atrasados" e ficava
              incompleto: gravidade é o desempate (ver a ordenação em
              PainelAnalistaShell.tsx). Quem visse 2 atrasados à frente de 6
              concluiria que a ordem estava errada. */}
          <p className="text-xs text-muted-foreground">
            Mais PDI atrasados primeiro; em caso de empate, o atraso mais antigo
          </p>
        </div>
      </div>

      {carregando ? (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {/* Tantos quanto a última carga trouxe — com 8 fixos a página pulava
              de altura a cada Atualizar, já que o estado real são ~14 linhas.
              Na primeira carga ainda não há o que saber: 8 é o palpite. */}
          {Array.from({ length: linhas.length || 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              <div className="min-w-0 flex-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      ) : erro ? (
        // A falha de carga já é dita pelo banner no topo, com o botão de retry.
        // Sem esta guarda o vazio aparecia JUNTO do erro, afirmando "nenhum
        // paciente" quando na verdade não se sabe.
        <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
          Dados indisponíveis — use “Tentar de novo” acima.
        </p>
      ) : linhas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum paciente no Controle de Prazos do PDI.
        </p>
      ) : visiveis.length === 0 ? (
        // "O filtro não achou ninguém" é diferente de "não há dados": aqui a
        // saída é mexer no filtro, e o texto diz isso.
        <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum analista neste recorte.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {visiveis.map((linha) => (
              <ItemPrioridade
                key={linha.profissionalId}
                linha={linha}
                piorAtraso={piorAtrasoPorAnalista.get(linha.profissionalId) ?? null}
                onAbrir={() => onAbrir(linha.profissionalId)}
              />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Mostrando {visiveis.length}{" "}
            {visiveis.length === 1 ? "analista" : "analistas"}
            {visiveis.length !== linhas.length && ` de ${linhas.length}`}
          </p>
          {/* A soma dos selos excede o total do painel de propósito — e quem
              somar e não fechar vai suspeitar do número, não da regra. Só
              aparece quando o caso existe; no dia em que ninguém tem dois
              coordenadores, a linha não tem o que explicar. */}
          {comDoisCoordenadores > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {comDoisCoordenadores}{" "}
              {comDoisCoordenadores === 1
                ? "paciente tem mais de um Coordenador de Caso e conta para cada um"
                : "pacientes têm mais de um Coordenador de Caso e contam para cada um"}
              .
            </p>
          )}
        </>
      )}
    </section>
  )
}
