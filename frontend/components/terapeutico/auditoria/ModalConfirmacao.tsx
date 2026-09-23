'use client'

import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from './vocabulario'

interface Props {
  isOpen: boolean
  titulo: string
  descricao: string
  rotuloConfirmar?: string
  onConfirmar: () => void
  onCancelar: () => void
}

/**
 * Confirmação no padrão visual do módulo — substitui window.confirm(), que
 * quebra a identidade da tela e não é estilizável em nenhum navegador.
 */
export function ModalConfirmacao({
  isOpen,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  onConfirmar,
  onCancelar
}: Props) {
  if (!isOpen) return null

  return (
    <Dialog open onOpenChange={aberto => { if (!aberto) onCancelar() }}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-full max-w-sm gap-0 rounded-2xl bg-card p-6"
      >
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <DialogTitle className="text-sm font-bold text-foreground">{titulo}</DialogTitle>
            <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{descricao}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancelar} className={BOTAO_SECUNDARIO}>
            Cancelar
          </button>
          <button onClick={onConfirmar} className={BOTAO_PRIMARIO}>
            {rotuloConfirmar}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
