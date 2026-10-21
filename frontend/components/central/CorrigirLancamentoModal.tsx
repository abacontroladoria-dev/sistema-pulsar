'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, PenLine, AlertCircle } from 'lucide-react'
import {
  CODIGOS_JUSTIFICATIVA_PACIENTE,
  type CodigoJustificativaFalta,
} from '@/services/autorizacoes.service'

type TipoFalta = 'paciente' | 'terapeuta'

interface Atendimento {
  id: string
  paciente_nome: string
  classificacao_terapia: string
  data_atendimento: string
  horario: string
  numero_autorizacao?: string | null
}

interface CorrigirLancamentoModalProps {
  open: boolean
  atendimento: Atendimento | null
  onCancel: () => void
  onConfirm: (dados: {
    tipoFalta: TipoFalta
    justificativa: string
    codigo: CodigoJustificativaFalta | null
  }) => Promise<void>
  loading: boolean
}

// Mesmo mínimo da RPC: abaixo disso ela recusa, e a tela não deve deixar
// clicar num botão que vai dar erro.
const MIN_JUSTIFICATIVA = 10

/**
 * Troca uma presença (ou sessão com guia capturada) já lançada por falta.
 * Mesmo esqueleto do ReverteFaltaModal; a escolha do tipo e o código seguem o
 * modal de falta da /solicitar, para a recepção ver o mesmo vocabulário.
 */
export function CorrigirLancamentoModal({
  open,
  atendimento,
  onCancel,
  onConfirm,
  loading,
}: CorrigirLancamentoModalProps) {
  // Começa limpo a cada abertura porque o SidePanel só monta este modal
  // enquanto ele está aberto — reabrir em outra sessão não herda o texto.
  const [tipoFalta, setTipoFalta] = useState<TipoFalta | null>(null)
  const [codigo, setCodigo] = useState<CodigoJustificativaFalta>(102)
  const [justificativa, setJustificativa] = useState('')

  if (!atendimento) return null

  // Data civil fatiada, sem `new Date()` — ver a nota em ReverteFaltaModal.
  const [ano, mes, dia] = atendimento.data_atendimento.slice(0, 10).split('-')
  const dataFormatada = `${dia}/${mes}/${ano}`

  const numero = atendimento.numero_autorizacao?.trim()
  const temGuia = !!numero && numero.toUpperCase() !== 'N/A'

  const podeConfirmar =
    !!tipoFalta && justificativa.trim().length >= MIN_JUSTIFICATIVA && !loading

  const opcaoClasse = (ativo: boolean) =>
    `flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
      ativo
        ? 'border-blue-400 bg-blue-50 text-blue-800'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`

  return (
    <Dialog open={open} onOpenChange={(aberto) => !aberto && !loading && onCancel()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="space-y-5 py-2">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-50 p-2.5 shrink-0">
              <PenLine className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">Corrigir lançamento para falta</DialogTitle>
              <DialogDescription className="mt-1">
                A presença registrada deixa de valer e a sessão passa a contar como falta.
              </DialogDescription>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Paciente</p>
            <p className="text-base font-semibold text-slate-900">{atendimento.paciente_nome}</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
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

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Quem faltou</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTipoFalta('paciente')}
                className={opcaoClasse(tipoFalta === 'paciente')}
              >
                Falta do Paciente
              </button>
              <button
                type="button"
                onClick={() => setTipoFalta('terapeuta')}
                className={opcaoClasse(tipoFalta === 'terapeuta')}
              >
                Falta do Terapeuta
              </button>
            </div>
          </div>

          {/* Motivo 101-113 só na falta do paciente: a do terapeuta é 106 por
              definição, e o banco deriva sozinho. */}
          {tipoFalta === 'paciente' && (
            <select
              value={codigo}
              onChange={(e) => setCodigo(Number(e.target.value) as CodigoJustificativaFalta)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700"
            >
              {CODIGOS_JUSTIFICATIVA_PACIENTE.map((c) => (
                <option key={c.codigo} value={c.codigo}>{c.rotulo}</option>
              ))}
            </select>
          )}

          <div>
            <textarea
              value={justificativa}
              onChange={(e) => setJustificativa(e.target.value)}
              placeholder="Justificativa obrigatória (ex.: paciente chegou atrasada e não foi atendida)"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-700 placeholder:text-slate-400"
            />
            {justificativa.trim().length > 0 && justificativa.trim().length < MIN_JUSTIFICATIVA && (
              <p className="mt-1 text-xs text-slate-400">Mínimo de {MIN_JUSTIFICATIVA} caracteres.</p>
            )}
          </div>

          {temGuia && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-900 leading-relaxed">
                A guia <span className="font-semibold tabular-nums">{numero}</span> continua
                emitida na ASSIM — o Pulsar não cancela guia. Depois de corrigir, ela aparece
                sem sessão na Reconciliação da Auditoria ASSIM para ser triada.
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
            <Button variant="outline" onClick={onCancel} disabled={loading} className="flex-1">
              Manter lançamento
            </Button>
            <Button
              onClick={() =>
                tipoFalta &&
                onConfirm({
                  tipoFalta,
                  justificativa: justificativa.trim(),
                  codigo: tipoFalta === 'paciente' ? codigo : null,
                })
              }
              disabled={!podeConfirmar}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Corrigindo
                </>
              ) : (
                'Lançar como falta'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
