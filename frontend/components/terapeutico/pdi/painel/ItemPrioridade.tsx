"use client"

import { ChevronRight, Hourglass, ClockAlert, AlertOctagon, UserX } from "lucide-react"
import { getTomAvatar, ICONES, indiceIconeAvatar } from "@/lib/cadastros/avatarPastel"
import type { LinhaAnalista } from "@/lib/pdi/painelAnalista"

// Uma linha da "Prioridade de atendimento" — um Coordenador de Caso
// ("Analista", no jargão da clínica) e o que há sob sua responsabilidade hoje.
//
// Substitui o `CardAnalista` da versão anterior, que invertia a hierarquia da
// tela: o TOTAL DE PACIENTES era o número grande (`text-3xl font-extrabold`) e
// os atrasados eram um selo de 11px ao pé do cartão. Numa tela cuja frase é
// "priorize os casos que precisam da sua atenção", o número que saltava aos
// olhos era justamente o que não decide nada — todo coordenador tem entre 15 e
// 18 pacientes, e essa contagem não distingue ninguém.
//
// Aqui o total de pacientes é texto secundário e o sinal forte é o NÚMERO DE
// ATRASADOS, em coluna própria à direita do nome.
//
// A primeira versão desta linha punha os três status como selos de forma
// idêntica, lado a lado. Não era hierarquia: eram quatro elementos empatados
// (nome, total, e três selos iguais) e nada dizia por onde começar — o mesmo
// erro do cartão antigo, só que menor. Agora atrasados tem tamanho próprio, e
// "próximos"/"aguardando" são marcas de ícone e número.
//
// A moldura rose que pintava o cartão inteiro de quem tinha atraso também saiu:
// com 8 linhas visíveis ao mesmo tempo, oito molduras vermelhas não destacam
// nada — destacar todo mundo é destacar ninguém.

const TONS_SELO = {
  rose: "border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400",
  amber: "border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  sky: "border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400",
  neutro: "border-border bg-muted/40 text-muted-foreground",
} as const

export function ItemPrioridade({
  linha,
  piorAtraso,
  onAbrir,
}: {
  linha: LinhaAnalista
  /** `diasRestantes` mais negativo entre os atrasados deste coordenador, ou null. */
  piorAtraso: number | null
  onAbrir: () => void
}) {
  const semCoordenador = linha.profissionalId === 0
  const Icone = ICONES[indiceIconeAvatar(linha.profissionalId)]
  const tom = getTomAvatar(linha.profissionalId)

  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        // O rótulo carrega a SITUAÇÃO, não só o nome: com "Ver pacientes de X"
        // um leitor de tela ouvia 20 botões idênticos e só descobria quem
        // estava pegando fogo abrindo um por um. O que está na tela em cor e
        // posição precisa estar aqui em palavras.
        aria-label={[
          `Ver pacientes de ${linha.nome}`,
          `${linha.total} ${linha.total === 1 ? "paciente" : "pacientes"}`,
          linha.atrasados > 0
            ? `${linha.atrasados} ${linha.atrasados === 1 ? "atrasado" : "atrasados"}${
                piorAtraso !== null ? `, pior com ${Math.abs(piorAtraso)} dias de atraso` : ""
              }`
            : null,
          linha.proximoPrazo > 0 ? `${linha.proximoPrazo} próximo do prazo` : null,
          linha.aguardandoImplementacao > 0 ? `${linha.aguardandoImplementacao} aguardando implementação` : null,
        ]
          .filter(Boolean)
          .join(". ")}
        className={`flex w-full min-h-11 items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
          semCoordenador ? "border-dashed border-border bg-muted/20" : "border-border bg-card"
        }`}
      >
        {/* Ícone pastel, não inicial — decisão do repositório (28/08/2026), a
            mesma de CardPdi.tsx. "Sem Coordenador de Caso" não é uma pessoa:
            ganha o `UserX` em âmbar, que é o que ele significa. */}
        {semCoordenador ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-amber-400 bg-amber-500/10">
            <UserX className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </span>
        ) : (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: tom.bg, color: tom.fg }}
            aria-hidden="true"
          >
            <Icone className="h-5 w-5" strokeWidth={1.75} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-foreground" title={linha.nome}>
            {linha.nome}
          </span>
          {/* Contexto, não sinal: o total de pacientes não distingue ninguém
              (todo coordenador tem 15-18), então fica pequeno e cinza. */}
          <span className="block truncate text-[11px] text-muted-foreground">
            {linha.total} {linha.total === 1 ? "paciente" : "pacientes"}
          </span>
        </span>

        {/* ATRASADOS tem coluna própria e tamanho próprio. Antes era um selo
            entre três de forma idêntica: a linha tinha quatro elementos
            empatados e nada dizia por onde começar. Os outros dois viram marca
            — ícone e número, sem palavra — porque o rótulo repetido três vezes
            por linha, com duas colunas de lista, quebrava e crescia a linha. */}
        <span className="flex shrink-0 items-center gap-2.5">
          <span
            className={`flex min-w-9 flex-col items-center ${
              linha.atrasados > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
            }`}
          >
            <span className="text-xl font-extrabold leading-none tabular-nums">{linha.atrasados}</span>
            <span className="mt-0.5 text-[10px] font-semibold leading-none">atrasados</span>
          </span>
          <span className="flex flex-col gap-1">
            <Marca
              valor={linha.proximoPrazo}
              icone={ClockAlert}
              tom={linha.proximoPrazo > 0 ? "amber" : "neutro"}
              rotulo={`${linha.proximoPrazo} próximos do prazo`}
            />
            <Marca
              valor={linha.aguardandoImplementacao}
              icone={Hourglass}
              tom={linha.aguardandoImplementacao > 0 ? "sky" : "neutro"}
              rotulo={`${linha.aguardandoImplementacao} aguardando implementação`}
            />
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
}

/**
 * Um dos dois status de apoio: ícone e número, sem palavra. As duas aparecem
 * SEMPRE, inclusive zeradas em cinza — numa lista de linhas alinhadas a
 * ausência desalinharia as colunas e obrigaria a reler cada linha; com posição
 * fixa, a mesma altura quer dizer a mesma coisa em todas, e o zero cinza é
 * informação.
 *
 * O rótulo escrito saiu porque a linha inteira já tem um `aria-label` que diz
 * tudo por extenso — e porque "aguardando" repetido em catorze linhas ocupava
 * a largura que o nome do coordenador precisa. Aqui o ícone é o rótulo, com o
 * texto no `title` para quem passar o mouse.
 */
function Marca({
  valor,
  icone: Icone,
  tom,
  rotulo,
}: {
  valor: number
  icone: typeof AlertOctagon
  tom: keyof typeof TONS_SELO
  /** Só para o `title` — a linha inteira já se anuncia pelo aria-label. */
  rotulo: string
}) {
  return (
    <span
      title={rotulo}
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${TONS_SELO[tom]}`}
    >
      <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="w-3 text-center tabular-nums">{valor}</span>
    </span>
  )
}
