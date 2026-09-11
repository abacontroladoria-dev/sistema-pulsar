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
// Aqui o total de pacientes é texto secundário, ao lado do nome, e o sinal
// forte é o selo de atrasados somado à POSIÇÃO na lista (o rank à esquerda).
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
          <span className="block truncate text-sm font-bold text-foreground" title={linha.nome}>
            {linha.nome}
          </span>
          {/* Contexto, não sinal: pequeno e cinza, de propósito. */}
          <span className="block text-xs text-muted-foreground">
            {linha.total} {linha.total === 1 ? "paciente" : "pacientes"}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            <Selo
              valor={linha.atrasados}
              rotuloSingular="atrasado"
              rotuloPlural="atrasados"
              icone={AlertOctagon}
              tom={linha.atrasados > 0 ? "rose" : "neutro"}
              // `piorAtraso` é o MENOR `diasRestantes` (negativo para quem já
              // passou do prazo) — vai para a tela em módulo. "pior -38d" seria
              // negativo qualificando um conceito já negativo ("atrasados"), e
              // ainda contradiria o modal que abre desta mesma linha, que diz
              // "38 dias de atraso" para o mesmo paciente.
              sufixo={linha.atrasados > 0 && piorAtraso !== null ? `pior ${Math.abs(piorAtraso)}d` : undefined}
            />
            <Selo
              valor={linha.proximoPrazo}
              rotuloSingular="próximo"
              rotuloPlural="próximos"
              icone={ClockAlert}
              tom={linha.proximoPrazo > 0 ? "amber" : "neutro"}
            />
            <Selo
              valor={linha.aguardandoImplementacao}
              rotuloSingular="aguardando"
              rotuloPlural="aguardando"
              icone={Hourglass}
              tom={linha.aguardandoImplementacao > 0 ? "sky" : "neutro"}
            />
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )
}

/**
 * Um selo de status. Aqui os três aparecem SEMPRE, inclusive zerados (em
 * cinza) — ao contrário do cartão antigo, que os escondia quando valiam 0.
 * Numa lista de linhas alinhadas, a ausência de um selo desalinhava as colunas
 * e obrigava a reler o rótulo de cada um; com posição fixa, a mesma coluna
 * quer dizer a mesma coisa em todas as linhas e o zero cinza é informação.
 */
function Selo({
  valor,
  rotuloSingular,
  rotuloPlural,
  icone: Icone,
  tom,
  sufixo,
}: {
  valor: number
  rotuloSingular: string
  rotuloPlural: string
  icone: typeof AlertOctagon
  tom: keyof typeof TONS_SELO
  /** Ex.: "pior 38d" — a MAGNITUDE, sempre em módulo. */
  sufixo?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONS_SELO[tom]}`}
    >
      <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="tabular-nums">{valor}</span> {valor === 1 ? rotuloSingular : rotuloPlural}
      {sufixo && <span className="font-bold tabular-nums">· {sufixo}</span>}
    </span>
  )
}
