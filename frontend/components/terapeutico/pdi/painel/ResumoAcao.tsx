"use client"

import { AlertOctagon, ArrowRight, ClockAlert, Hourglass } from "lucide-react"
import type { ResumoExecutivoPdi, Semaforo } from "@/lib/pdi/painelAnalista"
import type { RecortePainel } from "./tipos"

// Os três cards do topo do "PDI — Painel por Analista". Substituem a fileira de
// cinco cards de peso igual (`lg:grid-cols-5`), em que "Ativos com Autorização
// ABA" — contexto — competia em tamanho com "Atrasados" — a ação. Aqui há uma
// hierarquia só: ATRASADOS domina, o resto acompanha, e os dois números que
// sobraram (Dentro do prazo, Ativos) foram para a coluna lateral, onde são
// contexto de verdade.
//
// O banner "Indicador Geral (Semáforo)" que existia acima foi ABSORVIDO por
// este card: a moldura passa a ser a cor do semáforo e `regra` vira a linha de
// apoio. Era um bloco inteiro de largura total dizendo, com outras palavras, o
// que o número de atrasados já dizia.
//
// Cada card continua RECORTANDO a lista abaixo (`aria-pressed` + `onRecorte`),
// exatamente como os cinco antigos — a interação não mudou, só a hierarquia.

/**
 * A moldura do card de ação carrega o semáforo: os limites (0 / 1-5 / >5) são
 * de `calcularSemaforo`, 1:1 com a planilha original. `regra` explica o limite
 * em palavras, para o estado não depender de enxergar a cor.
 */
const SEMAFORO_INFO: Record<Semaforo, { rotulo: string; regra: string }> = {
  verde: { rotulo: "Sem atrasos", regra: "nenhum PDI atrasado" },
  amarelo: { rotulo: "Atenção", regra: "de 1 a 5 PDIs atrasados" },
  vermelho: { rotulo: "Acima do limite", regra: "mais de 5 PDIs atrasados" },
}

export function ResumoAcao({
  resumo,
  semaforo,
  semNumeros,
  recorte,
  onRecorte,
}: {
  resumo: ResumoExecutivoPdi
  semaforo: Semaforo
  /** Carregando ou em erro: nenhum número vale, tudo mostra "—" e fica neutro. */
  semNumeros: boolean
  recorte: RecortePainel
  onRecorte: (r: RecortePainel) => void
}) {
  const info = SEMAFORO_INFO[semaforo]
  const semAtraso = !semNumeros && resumo.atrasados === 0

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]" aria-label="Resumo do dia">
      {/* AÇÃO AGORA — o elemento de maior prioridade da tela. Fica neutro
          enquanto carrega ou depois de falhar: uma moldura verde de "tudo
          certo" sob um banner de erro é pior que um painel que ainda não sabe.
          Quando não há atraso nenhum, também não há alarme — a cor sai e o
          rótulo diz "Sem atrasos". */}
      <button
        type="button"
        onClick={() => onRecorte("atrasados")}
        disabled={semNumeros || semAtraso}
        aria-pressed={recorte === "atrasados"}
        className={`flex min-h-11 flex-col justify-between gap-4 rounded-2xl border p-5 text-left shadow-sm transition-all duration-200 ease-out enabled:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none ${
          semNumeros
            ? "border-border bg-muted/20"
            : semAtraso
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25"
              : "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/25"
        } ${recorte === "atrasados" ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
      >
        <span className="flex items-center gap-2">
          <AlertOctagon
            className={`h-5 w-5 shrink-0 ${
              semNumeros
                ? "text-muted-foreground"
                : semAtraso
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
            }`}
            aria-hidden="true"
          />
          <span
            className={`text-sm font-bold uppercase tracking-wide ${
              semNumeros
                ? "text-muted-foreground"
                : semAtraso
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400"
            }`}
          >
            {semNumeros ? "Indicador geral" : semAtraso ? info.rotulo : "Ação agora"}
          </span>
        </span>

        {/* Só a parte que MUDA é anunciada — com o aria-live no card inteiro,
            cada atualização relia também o rótulo estático. */}
        <span aria-live="polite" className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <span
            className={`text-5xl font-extrabold leading-none tabular-nums ${
              semNumeros
                ? "text-muted-foreground"
                : semAtraso
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {semNumeros ? "—" : resumo.atrasados}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight text-foreground">PDI atrasados</span>
            <span className="block text-xs text-muted-foreground">
              {semNumeros ? "Números indisponíveis" : `Casos que já ultrapassaram o prazo · ${info.regra}`}
            </span>
          </span>
        </span>

        {!semNumeros && !semAtraso && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-[13px] font-semibold text-white dark:bg-rose-700">
            Ver atrasados
            <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>
        )}
      </button>

      <CardSecundario
        chave="proximoPrazo"
        valor={resumo.proximoPrazo}
        titulo="próximos do prazo"
        apoio="Casos que vencem em breve"
        icone={ClockAlert}
        tom="text-amber-600 dark:text-amber-400"
        semNumeros={semNumeros}
        recorte={recorte}
        onRecorte={onRecorte}
      />
      <CardSecundario
        chave="aguardandoImplementacao"
        valor={resumo.aguardandoImplementacao}
        titulo="aguardando implementação"
        apoio="PDI aprovados, em fila de implementação"
        icone={Hourglass}
        tom="text-sky-600 dark:text-sky-400"
        semNumeros={semNumeros}
        recorte={recorte}
        onRecorte={onRecorte}
      />
    </section>
  )
}

/**
 * Os dois cards de apoio. Moldura neutra de propósito: cor aqui é só o ícone e
 * o número — encher a tela de cartões tingidos era o que fazia "atrasados" não
 * se destacar de nada.
 */
function CardSecundario({
  chave,
  valor,
  titulo,
  apoio,
  icone: Icone,
  tom,
  semNumeros,
  recorte,
  onRecorte,
}: {
  chave: RecortePainel
  valor: number
  titulo: string
  apoio: string
  icone: typeof ClockAlert
  tom: string
  semNumeros: boolean
  recorte: RecortePainel
  onRecorte: (r: RecortePainel) => void
}) {
  // Recortar por um status que ninguém tem esconderia a lista inteira e não
  // sobraria nada para ver — o card fica inerte, como já ficava antes.
  const vazio = !semNumeros && valor === 0

  return (
    <button
      type="button"
      onClick={() => onRecorte(chave)}
      disabled={semNumeros || vazio}
      aria-pressed={recorte === chave}
      className={`flex min-h-11 flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all duration-200 ease-out enabled:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none ${
        recorte === chave ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
      }`}
    >
      <Icone className={`h-5 w-5 shrink-0 ${semNumeros ? "text-muted-foreground" : tom}`} aria-hidden="true" />
      <span className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className={`text-4xl font-extrabold leading-none tabular-nums ${semNumeros ? "text-muted-foreground" : "text-foreground"}`}>
          {semNumeros ? "—" : valor}
        </span>
        <span className="text-[15px] font-semibold leading-tight text-foreground">{titulo}</span>
      </span>
      <span className="text-xs text-muted-foreground">{apoio}</span>
    </button>
  )
}
