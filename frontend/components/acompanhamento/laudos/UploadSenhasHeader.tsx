"use client"

import { memo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, Lock } from "lucide-react"
import toast from "react-hot-toast"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { foco } from "@/components/cadastros/pacientes/ui/campos"
import type { MesesFechadosUpload, RespostaUploadSenhas } from "@/types/laudosAcompanhamento"

/**
 * O botão "Atualizar senhas" do cabeçalho: escolhe o
 * `relatorio_autorizacoes_assim_*.csv` e manda para
 * /api/acompanhamento-laudos/senhas/.
 *
 * DONO DO PRÓPRIO ESTADO (enviando/arquivo), pela mesma lição do `BuscaHeader`:
 * estado de um controle do `setRightContent` morando no shell recria a árvore
 * do header e re-renderiza o layout inteiro a cada mudança. Aqui o shell só
 * ouve o resultado final, por um callback estável.
 *
 * `rotulo` é o resumo da importação em uso ("28/09 11:30 · Fulano"). Aparece à
 * esquerda do botão só em telas largas (no celular o cabeçalho já está cheio) e
 * sempre no `title`.
 */
export const UploadSenhasHeader = memo(function UploadSenhasHeader({
  rotulo,
  onConcluido,
}: {
  rotulo: string | null
  onConcluido: (resposta: RespostaUploadSenhas) => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(arquivo: File) {
    setEnviando(true)
    try {
      const form = new FormData()
      form.append("arquivo", arquivo)
      // Barra no fim: `trailingSlash: true` no next.config (ver o GET da tela).
      const resposta = await fetch("/api/acompanhamento-laudos/senhas/", {
        method: "POST",
        body: form,
      })
      const corpo = await resposta.json().catch(() => null)
      if (!resposta.ok || !corpo?.ok) {
        throw new Error(corpo?.error ?? `Falha no envio (HTTP ${resposta.status}).`)
      }
      onConcluido(corpo as RespostaUploadSenhas)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.", {
        duration: 8000,
      })
    } finally {
      setEnviando(false)
      // Zera o input: escolher o MESMO arquivo de novo precisa disparar o change.
      if (entrada.current) entrada.current.value = ""
    }
  }

  // Meses fechados (migration 20261001100000): o upload só mexe do mês corrente
  // em diante. Dito no `title` para ninguém esperar que um relatório novo
  // corrija agosto.
  const titulo = rotulo
    ? `Atualizar senhas (só do mês corrente em diante; meses anteriores ficam como estão) — em uso: ${rotulo}`
    : "Atualizar senhas — nenhum relatório importado ainda"

  return (
    <div className="flex shrink-0 items-center gap-2">
      <input
        ref={entrada}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0]
          if (arquivo) void enviar(arquivo)
        }}
      />
      {/* O resumo vem ANTES do botão (pedido do usuário, 28/09/2026): lê-se "de
          quando são as senhas" e, em seguida, a ação de trocá-las. */}
      {rotulo && (
        <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground 2xl:inline">
          Senhas: {rotulo}
        </span>
      )}
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        disabled={enviando}
        title={titulo}
        aria-label={titulo}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60 ${foco}`}
      >
        {enviando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{enviando ? "Enviando…" : "Atualizar senhas"}</span>
      </button>
    </div>
  )
})

/**
 * O que o upload fez: quantas autorizações, quantos laudos casaram e o que ficou
 * de fora — com os IDs, para conferir no sistema da ASSIM. Nunca nomes.
 */
export function ResultadoUploadSenhasModal({
  resultado,
  onFechar,
}: {
  resultado: RespostaUploadSenhas
  onFechar: () => void
}) {
  const r = resultado.resumo
  const titulo = resultado.duplicado ? "Este arquivo já tinha sido importado" : "Senhas atualizadas"

  return (
    <ScheduleModal
      title={titulo}
      subtitle={
        resultado.duplicado
          ? `Importado em ${resultado.importadoEm ?? "—"}${
              resultado.importadoPorNome ? ` por ${resultado.importadoPorNome}` : ""
            }. Nada foi gravado de novo.`
          : "A lista já mostra as senhas atualizadas."
      }
      maxWidth={520}
      onClose={onFechar}
      footer={
        <button
          type="button"
          onClick={onFechar}
          className={`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 ${foco}`}
        >
          Fechar
        </button>
      }
    >
      <div className="space-y-4 text-sm">
        {!resultado.duplicado && <BlocoMesesFechados meses={resultado.mesesFechados} />}

        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">{r.autorizacoes}</span>{" "}
            {r.autorizacoes === 1 ? "autorização" : "autorizações"} em {r.linhas} linhas ·{" "}
            <span className="font-bold">{r.laudosCasados}</span>{" "}
            {r.laudosCasados === 1 ? "laudo casado" : "laudos casados"} com o Órbita (laudo +
            favorecido).
          </p>
        </div>

        <ul className="space-y-2">
          <Linha
            rotulo="Laudos do relatório que não estão no Órbita"
            explicacao="Geralmente laudo já substituído por um novo. As senhas deles não aparecem na lista."
            ids={r.laudosOrfaos}
          />
          <Linha
            rotulo="Laudos com favorecido diferente do Órbita"
            explicacao="Mesmo ID de laudo, paciente diferente. Não casados — conferir na ASSIM e no Órbita."
            ids={r.laudosDivergentes}
            alerta
          />
          <Linha
            rotulo="Autorizações com dados diferentes entre as linhas"
            explicacao="Valeu a primeira linha de cada uma."
            ids={r.autorizacoesDivergentes}
            alerta
          />
        </ul>

        {(r.datasInvalidas > 0 || r.linhasDescartadas > 0) && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {r.linhasDescartadas > 0 &&
                `${r.linhasDescartadas} linha(s) sem ID autorização ou ID laudo foram ignoradas. `}
              {r.datasInvalidas > 0 &&
                `${r.datasInvalidas} data(s) fora do formato DD/MM/AAAA ficaram em branco.`}
            </span>
          </p>
        )}
      </div>
    </ScheduleModal>
  )
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/** "2026-09-01" → "setembro/2026". */
function mesPorExtenso(iso: string): string {
  const [ano, mes] = iso.split("-").map(Number)
  return `${MESES[mes - 1]}/${ano}`
}

/**
 * O que a regra de meses fechados fez. `null` num upload gravado = a função do
 * banco ainda é a antiga (migration pendente) e substituiu TODOS os meses — a
 * tela diz isso em vez de prometer uma proteção que não houve.
 */
function BlocoMesesFechados({ meses }: { meses: MesesFechadosUpload | null }) {
  if (!meses) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          A proteção dos meses fechados ainda não está ativa no banco: este upload substituiu
          todos os meses. Avise o responsável pelo sistema.
        </span>
      </p>
    )
  }
  if (meses.primeiraImportacao) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Primeira importação: todos os meses do arquivo foram gravados.</span>
      </p>
    )
  }

  const aberto = mesPorExtenso(meses.mesCorte)
  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2">
      <p className="flex items-start gap-2 font-semibold text-sky-900 dark:text-sky-200">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Só {aberto} em diante foi atualizado. Os meses anteriores estão fechados.</span>
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Aplicadas do arquivo ({aberto} em diante)</dt>
        <dd className="text-right font-bold tabular-nums text-foreground">{meses.aplicadas}</dd>
        <dt className="text-muted-foreground">Ignoradas do arquivo (meses fechados)</dt>
        <dd className="text-right font-bold tabular-nums text-foreground">{meses.ignoradas}</dd>
        <dt className="text-muted-foreground">Mantidas como estavam (meses fechados)</dt>
        <dd className="text-right font-bold tabular-nums text-foreground">{meses.mantidas}</dd>
        {meses.removidas > 0 && (
          <>
            <dt className="text-muted-foreground">
              Saíram do relatório ({aberto} em diante)
            </dt>
            <dd className="text-right font-bold tabular-nums text-amber-700 dark:text-amber-400">
              {meses.removidas}
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

function Linha({
  rotulo,
  explicacao,
  ids,
  alerta = false,
}: {
  rotulo: string
  explicacao: string
  ids: string[]
  alerta?: boolean
}) {
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-foreground">{rotulo}</span>
        <span
          className={`shrink-0 font-bold tabular-nums ${
            ids.length > 0 && alerta ? "text-amber-700 dark:text-amber-400" : "text-foreground"
          }`}
        >
          {ids.length}
        </span>
      </p>
      {ids.length > 0 && (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">{explicacao}</p>
          <p className="mt-1 break-words text-xs font-semibold tabular-nums text-foreground">
            {ids.join(", ")}
          </p>
        </>
      )}
    </li>
  )
}
