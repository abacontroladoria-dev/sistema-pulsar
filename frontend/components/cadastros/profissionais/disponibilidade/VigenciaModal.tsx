"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import toast from "react-hot-toast"
import { rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { ScheduleModal } from "@/components/cronograma/ui/ScheduleModal"
import { DatePicker } from "@/components/ui/date-picker"
import { dataBR, hojeBrasilia, periodoBR, somarDias } from "@/lib/disponibilidadeProfissional"
import { alterarVigencia } from "@/services/profissionalDisponibilidade.service"
import type { VersaoDisponibilidade } from "@/types/disponibilidadeProfissional"

// Encerrar uma versão numa data, ou ajustar o período de uma que ainda não
// começou. Motivo obrigatório: vai para a trilha de eventos.

export function VigenciaModal({
  versao,
  modo,
  onFechar,
  onSalvo,
}: {
  versao: VersaoDisponibilidade
  /** "encerrar" abre já com o fim em hoje; "ajustar" mostra o período inteiro. */
  modo: "encerrar" | "ajustar"
  onFechar: () => void
  onSalvo: () => void
}) {
  const hoje = hojeBrasilia()
  const comecou = versao.vigente_de <= hoje
  const [de, setDe] = useState(versao.vigente_de)
  const [indeterminado, setIndeterminado] = useState(modo === "ajustar" && versao.vigente_ate === null)
  const [ate, setAte] = useState(versao.vigente_ate ?? (modo === "encerrar" ? (comecou ? hoje : versao.vigente_de) : ""))
  const [motivo, setMotivo] = useState("")
  const [salvando, setSalvando] = useState(false)

  const ateFinal = indeterminado ? null : ate || null
  const invalido =
    !de ? "Informe o início." :
    !indeterminado && !ate ? "Informe a data de fim (ou marque prazo indeterminado)." :
    ateFinal && ateFinal < de ? "O fim é anterior ao início." :
    motivo.trim().length < 3 ? "Informe o motivo." : null

  const salvar = async () => {
    if (invalido) return
    setSalvando(true)
    try {
      await alterarVigencia(versao.id, de, ateFinal, motivo.trim())
      toast.success("Vigência atualizada.")
      onSalvo()
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e), { duration: 8000 })
      setSalvando(false)
    }
  }

  return (
    <ScheduleModal
      title={modo === "encerrar" ? `Encerrar a versão nº ${versao.numero}` : `Vigência da versão nº ${versao.numero}`}
      subtitle={`Hoje: ${periodoBR(versao.vigente_de, versao.vigente_ate)}`}
      maxWidth={560}
      onClose={onFechar}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted/50">Cancelar</button>
          <button type="button" onClick={salvar} disabled={!!invalido || salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar vigência
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={rotulo}>Vale a partir de</span>
            <div className="mt-1"><DatePicker value={de} onChange={setDe} disabled={comecou} /></div>
            {comecou && <p className="mt-1 text-xs text-muted-foreground">Já começou a valer — o início não muda.</p>}
          </div>
          <div>
            <span className={rotulo}>Até</span>
            <div className="mt-1 space-y-2">
              {modo === "ajustar" && (
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={indeterminado} onChange={e => setIndeterminado(e.target.checked)} className="h-4 w-4" />
                  Prazo indeterminado
                </label>
              )}
              {!indeterminado && <DatePicker value={ate} onChange={setAte} />}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="vig-motivo" className={rotulo}>Motivo *</label>
          <textarea id="vig-motivo" rows={2} maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Ex.: licença a partir de novembro"
            className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>

        {ateFinal && ateFinal < hoje && (
          <p className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            A grade ficará inativa desde {dataBR(somarDias(ateFinal, 1))} — o profissional fica sem disponibilidade valendo a partir daí, a menos que haja outra versão.
          </p>
        )}
        {invalido && <p className="text-xs font-semibold text-muted-foreground">{invalido}</p>}
      </div>
    </ScheduleModal>
  )
}
