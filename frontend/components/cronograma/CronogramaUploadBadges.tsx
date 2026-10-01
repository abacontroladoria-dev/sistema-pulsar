"use client"

import { useRef, useState } from "react"
import { CheckCircle2, CalendarDays, Upload, Loader2, X, AlertTriangle } from "lucide-react"
import { getRefWeek } from "@/lib/cronograma/helpers"
import type { CsvRow, DispRow, LaudoRow, MetaImportacaoLaudos } from "@/types/cronograma"

// Acima disto o dado para de ser "de hoje" e o badge sai do verde. Dois dias
// cobre o robô perder uma rodada (ele roda diário) sem alarme falso, e acusa a
// segunda perda — que já é robô parado, não soluço.
const HORAS_PARA_ALERTA = 48

/**
 * Quão velho é o relatório carregado, e como dizer isso em uma linha.
 *
 * Existe porque carga automática troca a pergunta de quem olha o header: com
 * upload manual a pessoa sabia a idade do dado (ela mesma tinha baixado o
 * arquivo); com o robô, não sabe. E robô parado é falha silenciosa — badge
 * verde com relatório de cinco dias é pior do que erro, porque ninguém
 * investiga o que parece certo.
 */
function frescorDoRelatorio(meta: MetaImportacaoLaudos | null | undefined) {
  if (!meta) return null
  if (!meta.concluidoEm) {
    return { velho: false, titulo: `Relatório do Órbita · ${meta.arquivoNome} · data da carga não informada` }
  }
  const carga = new Date(meta.concluidoEm)
  if (Number.isNaN(carga.getTime())) {
    return { velho: false, titulo: `Relatório do Órbita · ${meta.arquivoNome}` }
  }
  const horas = (Date.now() - carga.getTime()) / 3_600_000
  const quando = carga.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  const idade = horas < 1
    ? "há menos de 1 hora"
    : horas < 24
      ? `há ${Math.floor(horas)}h`
      : `há ${Math.floor(horas / 24)} dia(s)`
  return {
    velho: horas >= HORAS_PARA_ALERTA,
    titulo: `Relatório do Órbita · ${meta.arquivoNome} · carregado ${quando} (${idade})`
      + (horas >= HORAS_PARA_ALERTA ? " — o robô do Órbita pode estar parado" : ""),
  }
}

interface Props {
  cRows: CsvRow[]
  lRows: LaudoRow[]
  gradeLoading: boolean
  loading: boolean
  error: string | null
  // Falha da grade, separada da dos laudos: uma não pode esconder o badge da outra.
  gradeError?: string | null
  onSelectFile: (file: File) => void
  onClear: () => void
  // Laudos — algumas telas (ex.: Ocupação de Salas) não dependem desse relatório, então o badge some lá.
  showLaudos?: boolean
  // Disponibilidade (CSV do Órbita) — só aparece onde faz sentido (aba Novo Cronograma).
  showDisponibilidade?: boolean
  dispRows?: DispRow[]
  dispLoading?: boolean
  dispError?: string | null
  onSelectDisp?: (file: File) => void
  onClearDisp?: () => void
  // Sobrescreve o rótulo do "Período" — usado por Ocupação de Paciente, que carrega sua
  // própria janela de grade (getJanelaOcupacaoPaciente) em vez do cRows deste layout.
  periodLabel?: string
  // De onde veio o relatório de laudos, quando veio do robô do Órbita. Opcional:
  // sem ela o badge se comporta como antes (só a contagem), que é o certo para o
  // upload manual — ali não há frescor de carga automática a informar.
  laudosMeta?: MetaImportacaoLaudos | null
}

export function CronogramaUploadBadges({
  cRows, lRows, gradeLoading, loading, error, gradeError = null, onSelectFile, onClear,
  showLaudos = true,
  showDisponibilidade = false, dispRows = [], dispLoading = false, dispError = null, onSelectDisp, onClearDisp,
  periodLabel, laudosMeta = null,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dispInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const rw = getRefWeek()
  const periodo = periodLabel ?? rw.label
  const gradeLoaded = cRows.length > 0
  const laudosLoaded = lRows.length > 0
  const dispLoaded = dispRows.length > 0
  const frescor = laudosLoaded ? frescorDoRelatorio(laudosMeta) : null

  function onDispInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onSelectDisp) onSelectDisp(file)
    e.target.value = ""
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onSelectFile(file)
    e.target.value = ""
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!loading && !laudosLoaded) setDragging(true)
  }

  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (loading || laudosLoaded) return
    const file = e.dataTransfer.files?.[0]
    if (file) onSelectFile(file)
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Linha 1: Grade + Laudos */}
      <div className="flex items-center gap-2">
        {/* Grade — apenas status */}
        <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors
          ${gradeLoaded
            ? "border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400"
            : "border-border bg-muted text-muted-foreground"}`}
        >
          {gradeLoading && !gradeLoaded
            ? <Loader2 size={11} className="animate-spin" />
            : <CheckCircle2 size={11} className={gradeLoaded ? "text-green-500" : "text-muted-foreground/30"} />
          }
          Grade{gradeLoaded ? ` · ${cRows.length.toLocaleString("pt-BR")} horários` : ""}
        </span>

        {/* Laudos — carregados automaticamente do relatório do Órbita que o robô do Coolify
            grava no Supabase (ver services/laudos/relatorio.ts). Status-only, igual à Grade,
            mais o frescor da carga: âmbar acima de 48h. */}
        {showLaudos && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onInputChange}
            />
            {!error && (
              <span
                title={frescor?.titulo}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors
                ${!laudosLoaded
                  ? "border-border bg-muted text-muted-foreground"
                  : frescor?.velho
                    ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
                    : "border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400"}`}
              >
                {loading && !laudosLoaded
                  ? <Loader2 size={11} className="animate-spin" />
                  : frescor?.velho
                    ? <AlertTriangle size={11} className="text-amber-500" />
                    : <CheckCircle2 size={11} className={laudosLoaded ? "text-green-500" : "text-muted-foreground/30"} />
                }
                Laudos{laudosLoaded ? ` · ${lRows.length.toLocaleString("pt-BR")} registros` : ""}
              </span>
            )}

            {/* A API falhou — fallback manual (upload do Excel de laudos). */}
            {error && !laudosLoaded && (
              <button
                onClick={() => !loading && inputRef.current?.click()}
                disabled={loading}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs font-medium transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                  ${dragging
                    ? "border-[#2A92C0] bg-[#2A92C0]/15 text-[#2A92C0] scale-105"
                    : "border-[#2A92C0]/60 bg-[#2A92C0]/5 text-[#2A92C0] hover:bg-[#2A92C0]/10"}`}
              >
                {loading
                  ? <Loader2 size={11} className="animate-spin" />
                  : <Upload size={11} className={dragging ? "animate-bounce" : ""} />
                }
                {loading ? "Carregando..." : dragging ? "Solte aqui" : "Selecionar Laudos"}
              </button>
            )}
          </>
        )}

        {/* Disponibilidade — interativo (só na aba Novo Cronograma) */}
        {showDisponibilidade && (
          <>
            <input ref={dispInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={onDispInputChange} />
            {dispLoaded ? (
              <span className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400 px-3 py-1 text-xs font-medium">
                <CheckCircle2 size={11} className="text-green-500" />
                Disponibilidade · {dispRows.length.toLocaleString("pt-BR")} pacientes
                {onClearDisp && (
                  <button onClick={onClearDisp} className="ml-0.5 text-green-600/50 hover:text-destructive transition-colors" title="Remover disponibilidade">
                    <X size={11} />
                  </button>
                )}
              </span>
            ) : (
              <button
                onClick={() => !dispLoading && dispInputRef.current?.click()}
                disabled={dispLoading}
                className="flex items-center gap-1.5 rounded-full border border-dashed border-[#2A92C0]/60 bg-[#2A92C0]/5 text-[#2A92C0] hover:bg-[#2A92C0]/10 px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {dispLoading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                {dispLoading ? "Carregando..." : "Selecionar Disponibilidade"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Linha 2: Período */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays size={11} />
        <span className="font-medium text-foreground/60">Período</span>
        <span>{periodo}</span>
      </div>

      {[gradeError, showLaudos ? error : null, dispError].filter(Boolean).map(msg => (
        <p key={msg} className="text-[11px] text-destructive mt-0.5">{msg}</p>
      ))}
    </div>
  )
}
