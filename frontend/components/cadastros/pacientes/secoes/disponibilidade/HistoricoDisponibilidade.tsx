"use client"

import { useState } from "react"
import { ChevronRight, History, LockOpen, UserRoundCog } from "lucide-react"
import { deColunas, diferencas, mudouQuemPreenche } from "@/lib/disponibilidadePaciente"
import type { LiberacaoEdicao, VersaoDisponibilidade } from "@/services/pacienteDisponibilidade.service"
import { foco } from "../../ui/campos"
import { ResumoDisponibilidade } from "./ResumoDisponibilidade"
import { COR_ORIGEM, ROTULO_ORIGEM, declarante, formatarDataHora } from "./formato"

// Linha do tempo da disponibilidade: cada versão e cada liberação de prazo, da
// mais nova para a mais antiga.
//
// Ela existe para responder "quem disse o quê, e quando" — o caso que motivou o
// desenho é pai e mãe (separados) declarando disponibilidades diferentes. Por
// isso cada versão mostra três coisas, nessa ordem de destaque:
//
//   1. QUEM: a pessoa da família, a origem (formulário/equipe/importação) e, se
//      foi a equipe, o usuário que registrou;
//   2. O QUE MUDOU em relação à versão anterior, em frases ("Seg: 08:00–12:00 →
//      13:00–17:00"), e não as duas grades lado a lado para o leitor comparar;
//   3. a disponibilidade COMPLETA daquela versão, recolhida, para quem precisar.
//
// Só a versão ATUAL fica aberta. As anteriores aparecem amarelas e reduzidas a
// uma linha (versão, origem, data, quem) e só mostram o detalhe ao clicar.
//
// A troca de pessoa ganha marca própria: é o sinal de que a família pode estar
// em desacordo, e a equipe deve confirmar antes de montar o cronograma.

const VISIVEIS_RECOLHIDO = 3

type Item =
  | { tipo: "versao"; data: string; versao: VersaoDisponibilidade; anterior: VersaoDisponibilidade | null; trocouPessoa: { antes: string; depois: string } | null }
  | { tipo: "liberacao"; data: string; liberacao: LiberacaoEdicao }

function montarItens(versoes: VersaoDisponibilidade[], liberacoes: LiberacaoEdicao[]): Item[] {
  // `versoes` chega da mais nova para a mais antiga.
  const itens: Item[] = versoes.map((v, i) => {
    const anterior = versoes[i + 1] ?? null
    // A troca de pessoa compara com a última versão que DIZ quem declarou: uma
    // edição da equipe sem "informado por" no meio não pode esconder que o pai
    // declarou antes e a mãe agora.
    const ultimaComNome = versoes.slice(i + 1).find((x) => x.preenchido_por_nome) ?? null
    const trocou =
      ultimaComNome &&
      mudouQuemPreenche(
        { nome: ultimaComNome.preenchido_por_nome, parentesco: ultimaComNome.preenchido_por_parentesco },
        { nome: v.preenchido_por_nome, parentesco: v.preenchido_por_parentesco }
      )
    return {
      tipo: "versao",
      data: v.criado_em,
      versao: v,
      anterior,
      trocouPessoa: trocou ? { antes: declarante(ultimaComNome)!, depois: declarante(v)! } : null,
    }
  })

  for (const l of liberacoes) itens.push({ tipo: "liberacao", data: l.liberado_em, liberacao: l })

  return itens.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
}

/** A troca de pessoa mais recente (versão atual × última declaração anterior), para o alerta do topo da aba. */
export function trocaDePessoaAtual(versoes: VersaoDisponibilidade[]): { antes: VersaoDisponibilidade; depois: VersaoDisponibilidade } | null {
  const [atual, ...resto] = versoes
  if (!atual?.preenchido_por_nome) return null
  const antes = resto.find((x) => x.preenchido_por_nome)
  if (!antes) return null
  return mudouQuemPreenche(
    { nome: antes.preenchido_por_nome, parentesco: antes.preenchido_por_parentesco },
    { nome: atual.preenchido_por_nome, parentesco: atual.preenchido_por_parentesco }
  )
    ? { antes, depois: atual }
    : null
}

export function HistoricoDisponibilidade({
  versoes,
  liberacoes,
}: {
  versoes: VersaoDisponibilidade[]
  liberacoes: LiberacaoEdicao[]
}) {
  const [expandido, setExpandido] = useState(false)
  const itens = montarItens(versoes, liberacoes)
  const visiveis = expandido ? itens : itens.slice(0, VISIVEIS_RECOLHIDO)
  const idAtual = versoes[0]?.id

  return (
    <section id="historico-disponibilidade" className="rounded-lg border border-border bg-card px-4 py-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Histórico de alterações
        <span className="font-normal text-muted-foreground">({itens.length})</span>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Nada é apagado: cada envio ou edição vira uma versão nova, e as anteriores ficam aqui.
      </p>

      <ol className="mt-4 space-y-3 border-l border-border pl-4">
        {visiveis.map((item) =>
          item.tipo === "liberacao" ? (
            <ItemLiberacao key={`l-${item.liberacao.id}`} liberacao={item.liberacao} />
          ) : (
            <ItemVersao
              key={`v-${item.versao.id}`}
              versao={item.versao}
              anterior={item.anterior}
              trocouPessoa={item.trocouPessoa}
              atual={item.versao.id === idAtual}
            />
          )
        )}
      </ol>

      {itens.length > VISIVEIS_RECOLHIDO && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className={`mt-3 min-h-11 rounded-md px-2 text-sm font-medium text-primary hover:underline sm:min-h-0 ${foco}`}
        >
          {expandido ? "Mostrar só os mais recentes" : `Mostrar todo o histórico (${itens.length})`}
        </button>
      )}
    </section>
  )
}

function ItemVersao({
  versao,
  anterior,
  trocouPessoa,
  atual,
}: {
  versao: VersaoDisponibilidade
  anterior: VersaoDisponibilidade | null
  trocouPessoa: { antes: string; depois: string } | null
  atual: boolean
}) {
  const selos = (
    <>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COR_ORIGEM[versao.origem]}`}>
        {ROTULO_ORIGEM[versao.origem]}
      </span>
      <span className="text-xs text-muted-foreground">{formatarDataHora(versao.criado_em)}</span>
    </>
  )

  // Versão atual: aberta, é a que vale hoje.
  if (atual) {
    return (
      <li className="relative">
        <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500" />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-foreground">Versão {versao.numero_versao}</span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            atual
          </span>
          {selos}
        </div>
        <DetalhesVersao versao={versao} anterior={anterior} trocouPessoa={trocouPessoa} />
      </li>
    )
  }

  // Versões antigas: amarelas e recolhidas numa linha — já não valem, e a
  // linha do tempo precisa ser lida de relance. O detalhe abre com um clique.
  const quem = declarante(versao)
  return (
    <li className="relative">
      <span aria-hidden="true" className="absolute -left-[21px] top-2.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-amber-400" />
      <details className="group rounded-md border border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20">
        <summary
          className={`flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden ${foco}`}
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-amber-700 transition-transform group-open:rotate-90 dark:text-amber-400" aria-hidden="true" />
          <span className="font-semibold text-amber-900 dark:text-amber-200">Versão {versao.numero_versao}</span>
          {selos}
          {quem && <span className="min-w-0 truncate text-xs text-amber-900/80 dark:text-amber-200/80">· {quem}</span>}
          {trocouPessoa && (
            <UserRoundCog className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-label="Preenchida por outra pessoa" />
          )}
        </summary>
        <div className="border-t border-amber-200 px-3 pb-3 dark:border-amber-900">
          <DetalhesVersao versao={versao} anterior={anterior} trocouPessoa={trocouPessoa} />
        </div>
      </details>
    </li>
  )
}

function DetalhesVersao({
  versao,
  anterior,
  trocouPessoa,
}: {
  versao: VersaoDisponibilidade
  anterior: VersaoDisponibilidade | null
  trocouPessoa: { antes: string; depois: string } | null
}) {
  const quem = declarante(versao)
  const mudancas = anterior ? diferencas(deColunas(anterior), deColunas(versao)) : []

  return (
    <>
      <p className="mt-1 text-sm text-foreground">
        {quem ? (
          <>Preenchido por <span className="font-medium">{quem}</span></>
        ) : (
          <span className="text-muted-foreground">Sem identificação de quem da família informou</span>
        )}
        {versao.origem === "equipe" && versao.registrado_por_nome && (
          <span className="text-muted-foreground"> · registrado por {versao.registrado_por_nome}</span>
        )}
      </p>

      {trocouPessoa && (
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <UserRoundCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Outra pessoa: antes {trocouPessoa.antes}, agora {trocouPessoa.depois}
        </p>
      )}

      {versao.observacao && <p className="mt-1 text-xs italic text-muted-foreground">“{versao.observacao}”</p>}

      <div className="mt-1.5 text-sm">
        {!anterior ? (
          <p className="text-muted-foreground">Primeiro registro.</p>
        ) : versao.sem_alteracao || mudancas.length === 0 ? (
          <p className="text-muted-foreground">Sem mudanças — confirmou a versão anterior.</p>
        ) : (
          <ul className="space-y-0.5">
            {mudancas.map((m) => (
              <li key={m} className="tabular-nums text-foreground">{m}</li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-1.5">
        <summary className={`cursor-pointer text-xs font-medium text-primary hover:underline ${foco}`}>
          Ver disponibilidade completa desta versão
        </summary>
        <div className="mt-2 rounded-md border border-border bg-card p-3">
          <ResumoDisponibilidade disponibilidade={deColunas(versao)} />
        </div>
      </details>
    </>
  )
}

function ItemLiberacao({ liberacao }: { liberacao: LiberacaoEdicao }) {
  return (
    <li className="relative opacity-90">
      <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-sky-500" />
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-foreground">
        <LockOpen className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
        <span>
          <span className="font-medium">{liberacao.liberado_por_nome ?? "Equipe"}</span> liberou a edição do responsável até{" "}
          <span className="font-medium">{formatarDataHora(liberacao.prazo_ate)}</span>
        </span>
        <span className="text-xs text-muted-foreground">{formatarDataHora(liberacao.liberado_em)}</span>
      </p>
    </li>
  )
}
