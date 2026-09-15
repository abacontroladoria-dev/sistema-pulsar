'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, RotateCcw, AlertCircle } from 'lucide-react'

interface Atendimento {
  id: string
  paciente_nome: string
  classificacao_terapia: string
  data_atendimento: string
  horario: string
}

interface ReverteFaltaModalProps {
  open: boolean
  atendimento: Atendimento | null
  onCancel: () => void
  onConfirm: () => Promise<void>
  loading: boolean
}

export function ReverteFaltaModal({
  open,
  atendimento,
  onCancel,
  onConfirm,
  loading,
}: ReverteFaltaModalProps) {
  if (!atendimento) return null

  // `data_atendimento` é data civil ('2026-09-15'), não instante. Passar por
  // `new Date()` fazia o modal mostrar o DIA ANTERIOR: a string sem fuso é lida
  // como meia-noite UTC e `getDate()` renderiza em horário local (UTC−3), então
  // 15/09 virava 14/09. Fatiar a string não passa por fuso nenhum — é o mesmo
  // padrão já usado em `isoParaBR` (components/connect/agenda/tipos.ts:66).
  const [ano, mes, dia] = atendimento.data_atendimento.slice(0, 10).split('-')
  const dataFormatada = `${dia}/${mes}/${ano}`

  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-md">
        <div className="space-y-6 py-2">
          {/* Header com ícone */}
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-50 p-2.5 shrink-0">
              <RotateCcw className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">Reverter falta do paciente</DialogTitle>
              <DialogDescription className="mt-1">
                O atendimento voltará para "Pendente" e a ação será registrada.
              </DialogDescription>
            </div>
          </div>

          {/* Dados do atendimento */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Paciente</p>
                <p className="text-base font-semibold text-slate-900">{atendimento.paciente_nome}</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Terapia</p>
                  <p className="text-sm text-slate-700 leading-snug">{atendimento.classificacao_terapia}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Data</p>
                  <p className="text-sm text-slate-700 font-medium">{dataFormatada}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Horário</p>
                  <p className="text-sm text-slate-700 font-medium">{atendimento.horario}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Aviso — informativo, não assustador */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-900 leading-relaxed">
              Esta ação não pode ser desfeita. O paciente será notificado sobre a reversão.
            </p>
          </div>

          {/* Botões */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={loading}
              className="flex-1"
            >
              Manter falta
            </Button>
            <Button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Revertendo
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reverter agora
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
