"use client"

import { AlertOctagon, ClockAlert, Hourglass } from "lucide-react"
import type { ResumoExecutivoPdi, Semaforo } from "@/lib/pdi/painelAnalista"
import { SELECIONADO, type RecortePainel } from "./tipos"

// Os três cards do topo do "PDI — Painel por Analista". Substituem a fileira de
// cinco cards de peso igual (`lg:grid-cols-5`), em que "Ativos com Autorização
// ABA" — contexto — competia em tamanho com "Atrasados" — a ação. Aqui há uma
// hierarquia só: ATRASADOS domina, o resto acompanha, e os dois números que
// sobraram (Dentro do prazo, Ativos) foram para a coluna lateral, onde são
// contexto de verdade.
//
// O banner "Indicador Geral (Semáforo)" que existia acima foi ABSORVIDO por
// este card: a moldura passa a ser a cor do semáforo, e o rótulo, o seu nome.
// Era um bloco inteiro de largura total dizendo, com outras palavras, o que o
// número de atrasados já dizia.
//
// As linhas de apoio em cinza saíram dos três cards pelo mesmo motivo. Diziam
// "Casos que já ultrapassaram o prazo · de 1 a 5 PDIs atrasados" sob o número de
// atrasados, "Casos que vencem em breve" sob "próximos do prazo" e "PDI
// aprovados, em fila de implementação" sob "aguardando implementação": os três
// eram o rótulo reescrito em voz de manual. Cada card fica com número e
// substantivo — é o que se lê em um relance, e é para isso que eles existem. A
// única que sobrou é "Números indisponíveis", que não repete nada: é o estado
// que o "—" no lugar do número não consegue nomear sozinho.
//
// Cada card continua RECORTANDO a lista abaixo (`aria-pressed` + `onRecorte`),
// exatamente como os cinco antigos — a interação não mudou, só a hierarquia.

/**
 * A moldura do card de ação carrega o semáforo: os limites (0 / 1-5 / >5) são
 * de `calcularSemaforo`, 1:1 com a planilha original. O rótulo nomeia o estado
 * em palavras, para ele não depender de enxergar a cor.
 *
 * A `regra` por extenso ("de 1 a 5 PDIs atrasados") saiu da linha de apoio: era
 * a definição do limite escrita ao lado do número que já a satisfaz — letra
 * miúda de manual no elemento de maior prioridade da tela.
 */
const SEMAFORO_INFO: Record<Semaforo, { rotulo: string }> = {
  verde: { rotulo: "Sem atrasos" },
  amarelo: { rotulo: "Atenção" },
  vermelho: { rotulo: "Acima do limite" },
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
  // O card inteiro é o gatilho de clique — sem selo próprio dizendo isso, o
  // `title` é quem carrega a dica para quem passa o mouse; `aria-pressed` já
  // avisa quem usa leitor de tela.
  const dicaHero =
    semNumeros || semAtraso
      ? undefined
      : recorte === "atrasados"
        ? "Clique para limpar o filtro"
        : "Clique para filtrar a lista"

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-[1.4fr_1fr_1fr]" aria-label="Resumo do dia">
      {/* AÇÃO AGORA — o elemento de maior prioridade da tela. Fica neutro
          enquanto carrega ou depois de falhar: uma moldura verde de "tudo
          certo" sob um banner de erro é pior que um painel que ainda não sabe.
          Quando não há atraso nenhum, também não há alarme — a cor sai e o
          rótulo diz "Sem atrasos". */}
      <button
        type="button"
        // Clicar de novo no card já ativo desfaz o recorte — mesma regra dos
        // KPIs da tela irmã (FiltrosPdi.tsx) e das fatias da Distribuição.
        onClick={() => onRecorte(recorte === "atrasados" ? "totalPacientes" : "atrasados")}
        // Só fica inerte quando não há número NENHUM. Antes ficava desabilitado
        // também no dia sem atraso — o maior elemento da tela virava um bloco
        // cinza-esverdeado sem cursor e sem explicação justamente no dia que o
        // desenho deveria premiar, e "desabilitado" se lê como "quebrado" muito
        // mais do que como "vazio".
        disabled={semNumeros}
        aria-pressed={recorte === "atrasados"}
        title={dicaHero}
        className={`flex min-h-11 flex-col justify-between gap-3 rounded-2xl border p-4 text-left shadow-sm transition-all duration-200 ease-out enabled:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none ${
          semNumeros
            ? "border-border bg-muted/20"
            : semAtraso
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/25"
              : "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/25"
        } ${recorte === "atrasados" ? SELECIONADO : ""}`}
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
            className={`text-[32px] font-extrabold leading-none tabular-nums ${
              semNumeros
                ? "text-muted-foreground"
                : semAtraso
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {semNumeros ? "—" : resumo.atrasados}
          </span>
          {/* `min-w-full sm:min-w-0` mantém número e substantivo juntos: com
              `flex-wrap`, no estreito o rótulo subia para a linha do numeral e
              se descolava do número. Aqui ele ocupa a linha inteira abaixo, de
              propósito. O denominador vem para cá porque a coluna lateral, onde
              ele mora, desce para depois de vinte linhas em qualquer tela menor
              que `lg` — e o número de atrasados sem o total não diz nada. */}
          <span className="min-w-full flex-1 sm:min-w-0">
            <span className="block text-[15px] font-bold leading-tight text-foreground">
              PDI atrasados{!semNumeros && resumo.totalPacientes > 0 && ` de ${resumo.totalPacientes}`}
            </span>
            {semNumeros && <span className="block text-xs text-muted-foreground">Números indisponíveis</span>}
          </span>
        </span>
      </button>

      <CardSecundario
        chave="proximoPrazo"
        valor={resumo.proximoPrazo}
        titulo="próximos do prazo"
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
  icone: Icone,
  tom,
  semNumeros,
  recorte,
  onRecorte,
}: {
  chave: RecortePainel
  valor: number
  titulo: string
  icone: typeof ClockAlert
  tom: string
  semNumeros: boolean
  recorte: RecortePainel
  onRecorte: (r: RecortePainel) => void
}) {
  // Recortar por um status que ninguém tem esvazia a lista — e é exatamente
  // isso que a lista sabe dizer ("Nenhum analista neste recorte"), com palavras
  // melhores do que um botão morto. O card fica clicável mesmo em zero.
  const vazio = !semNumeros && valor === 0

  return (
    <button
      type="button"
      onClick={() => onRecorte(recorte === chave ? "totalPacientes" : chave)}
      disabled={semNumeros}
      aria-pressed={recorte === chave}
      title={vazio ? `Nenhum paciente ${titulo}` : undefined}
      className={`flex min-h-11 flex-col justify-between gap-2 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all duration-200 ease-out enabled:hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none ${
        recorte === chave ? SELECIONADO : "border-border"
      }`}
    >
      <Icone className={`h-4 w-4 shrink-0 ${semNumeros ? "text-muted-foreground" : tom}`} aria-hidden="true" />
      <span className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className={`text-2xl font-extrabold leading-none tabular-nums ${semNumeros ? "text-muted-foreground" : "text-foreground"}`}>
          {semNumeros ? "—" : valor}
        </span>
        <span className="text-[13px] font-semibold leading-tight text-foreground">{titulo}</span>
      </span>
    </button>
  )
}
