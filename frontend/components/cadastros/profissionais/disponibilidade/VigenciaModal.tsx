"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import toast from "react-hot-toast"
import { campo, foco, rotulo } from "@/components/cadastros/pacientes/ui/campos"
import { aviso, btnPrimario, btnSecundario } from "@/components/cronograma/grade/estilo"
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
        <>
          <button type="button" onClick={onFechar} className={btnSecundario}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={!!invalido || salvando} className={btnPrimario}>
            {salvando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Salvar vigência
          </button>
        </>
      }
    >
      <div className="space-y-4">
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
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-0">
                  <input type="checkbox" checked={indeterminado} onChange={e => setIndeterminado(e.target.checked)} className={`h-4 w-4 rounded border-border accent-primary ${foco}`} />
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
            className={`mt-1 ${campo} resize-y`} />
        </div>

        {ateFinal && ateFinal < hoje && (
          <p className={`${aviso("red")} font-semibold`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            A grade ficará inativa desde {dataBR(somarDias(ateFinal, 1))} — o profissional fica sem disponibilidade valendo a partir daí, a menos que haja outra versão.
          </p>
        )}
        {invalido && <p className="text-xs text-muted-foreground">{invalido}</p>}
      </div>
    </ScheduleModal>
  )
}
