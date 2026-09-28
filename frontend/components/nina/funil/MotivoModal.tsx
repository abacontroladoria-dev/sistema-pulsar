'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/nina/Button'
import type { KanbanColumnUI } from '@/services/crm/adapter'

// ============================================================================
// Motivo do movimento — pedido ao soltar o card numa posição com exige_motivo
// ("Encaminhado para humano", "Perdido / Objeção", "Não elegível", "Nunca
// respondeu"). Também serve para as perdas sem motivo obrigatório, em que o
// campo fica opcional.
//
// As sugestões vêm da própria planilha da diretoria. Clicar preenche o campo
// e ainda deixa editar: servem para o relatório agrupar as mesmas causas com
// as mesmas palavras, não para limitar o que se escreve.
// ============================================================================

const SUGESTOES: Record<string, string[]> = {
  encaminhado_humano:   ['Queixa clínica', 'Pediu para falar com uma pessoa', 'RQE', 'Reclamação', 'Plano não credenciado (Rota D)', 'Advogado', 'Decisão judicial'],
  perdido_objecao:      ['Achou caro', 'Distância / localização', 'Horário não serve', 'Vai pensar'],
  perdido_nao_elegivel: ['Plano não credenciado', 'Diagnóstico fora da regra', 'Orientado para Av. Neuro pelo plano', 'Orientado para particular / reembolso'],
  nunca_respondeu:      ['Abriu e sumiu', 'Telefone inativo'],
}

export const MotivoModal: React.FC<{
  estagio:   KanbanColumnUI | null
  negocio:   string
  aoConfirmar: (motivo: string | null) => void
  aoCancelar:  () => void
}> = ({ estagio, negocio, aoConfirmar, aoCancelar }) => {
  const [motivo, setMotivo] = useState('')
  const campo = useRef<HTMLTextAreaElement>(null)

  // Cada abertura começa vazia: o motivo de um card não pode vazar para o
  // próximo movimento.
  useEffect(() => { if (estagio) setMotivo('') }, [estagio])

  if (!estagio) return null

  const obrigatorio = estagio.exigeMotivo
  const pronto = !obrigatorio || motivo.trim().length > 0
  const sugestoes = SUGESTOES[estagio.slug ?? ''] ?? []

  const confirmar = () => {
    if (!pronto) return
    aoConfirmar(motivo.trim() || null)
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) aoCancelar() }}>
      <DialogContent
        className="sm:max-w-[480px] bg-popover border-border"
        onOpenAutoFocus={(e) => { e.preventDefault(); campo.current?.focus() }}
      >
        <DialogHeader>
          <DialogTitle className="text-foreground">Mover para “{estagio.title}”</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {negocio}{estagio.description ? ` · ${estagio.description}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {sugestoes.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Motivos frequentes">
              {sugestoes.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setMotivo(s); campo.current?.focus() }}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
                    motivo === s
                      ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <label htmlFor="motivo-movimento" className="block text-xs font-medium text-muted-foreground">
            Motivo{obrigatorio ? '' : ' (opcional)'}
          </label>
          <textarea
            id="motivo-movimento"
            ref={campo}
            value={motivo}
            maxLength={500}
            rows={3}
            onChange={(e) => setMotivo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmar() }}
            placeholder="Uma frase basta."
            className="w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoCancelar}>Cancelar</Button>
          <Button
            onClick={confirmar}
            disabled={!pronto}
            variant={estagio.autoLose ? 'danger' : 'primary'}
          >
            {estagio.autoLose ? 'Encerrar' : 'Mover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
