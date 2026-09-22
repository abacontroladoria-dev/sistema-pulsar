'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Undo2, X } from 'lucide-react'
import { useModalDialog } from '@/hooks/useModalDialog'
import type { VinculoAutorizacao } from './types'

/**
 * Confirmação de desfazer uma triagem — o passo que faltava para a Reconciliação
 * ser reversível pela tela.
 *
 * `desvincular_autorizacao` existe desde 2026-08-21 e nunca teve porta de
 * entrada: o service a exportava, o hook a devolvia, e nenhum componente a
 * chamava. Na prática a triagem era só de ida — quem errasse o desfecho não
 * tinha como corrigir, e a saída era UPDATE no banco. A lacuna apareceu quando o
 * tipo `substituicao` nasceu (22/09) e os vínculos gravados como
 * `falta_terapeuta` precisaram ser refeitos.
 *
 * MODAL, e não um `confirm()` nem um clique seco, por duas razões que não são
 * cerimônia:
 *
 * 1. a RPC aceita um MOTIVO e o grava em `desfeito_motivo`. Um clique seco
 *    jogaria fora o único campo que explica, seis meses depois, por que aquela
 *    triagem foi desfeita — e a tabela é um livro de auditoria, é para isso que
 *    ela guarda autoria e data do desfazer;
 * 2. o efeito não é local. A guia volta para a fila de órfãs, a cobertura deixa
 *    de valer e as contagens da listagem sobem de novo. Quem clica precisa ler
 *    isso antes, não descobrir pela grade.
 *
 * O desfazer é SOFT DELETE — a linha fica, com `desfeito_em` preenchido. Então
 * "desfazer" aqui nunca é perda de histórico, e é isso que o texto promete.
 */

type Props = {
  open: boolean
  onClose: () => void
  /** A triagem a desfazer. Nula = modal fechado. */
  vinculo: VinculoAutorizacao | null
  salvando: boolean
  onConfirmar: (motivo: string) => Promise<void>
}

/**
 * O que cada desfecho de triagem AFIRMA hoje — para o modal dizer o que deixa
 * de valer, em vez de um "vínculo" genérico que não descreve três dos quatro.
 *
 * Espelha a união de `VinculoAutorizacao['tipo']`. O `default` do `??` cobre um
 * tipo novo que chegue sem passar por aqui: a frase fica vaga, mas nunca vazia.
 */
const OQUE_AFIRMA: Record<VinculoAutorizacao['tipo'], string> = {
  vinculo: 'que esta guia cobre a sessão vinculada',
  sem_sessao: 'que esta guia é autorização extra, sem sessão correspondente',
  falta_terapeuta: 'que esta guia autorizou o horário em que o titular faltou',
  substituicao: 'que houve substituto e a sessão aconteceu, coberta por esta guia',
}

export default function ModalDesfazerTriagem({
  open,
  onClose,
  vinculo,
  salvando,
  onConfirmar,
}: Props) {
  const idTitulo = 'titulo-desfazer-triagem'
  const { refDialogo, propsDialogo } = useModalDialog(open, onClose, idTitulo)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Reabrir para outra triagem não herda o texto nem o erro da anterior.
  useEffect(() => {
    if (open) { setMotivo(''); setErro(null) }
  }, [open, vinculo?.id])

  if (!open || !vinculo) return null

  async function confirmar() {
    setErro(null)
    try {
      await onConfirmar(motivo.trim())
    } catch (e) {
      // A mensagem vem da RPC escrita para ser lida por uma pessoa ("Vínculo X
      // não existe ou já foi desfeito"). Aqui dentro, e não num toast, porque é
      // aqui que a decisão está sendo tomada.
      setErro(e instanceof Error ? e.message : 'Não foi possível desfazer')
    }
  }

  const afirma = OQUE_AFIRMA[vinculo.tipo] ?? 'o que esta triagem registrou'

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={refDialogo}
        {...propsDialogo}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={idTitulo} className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Undo2 size={17} className="text-rose-600" aria-hidden />
              Desfazer esta triagem
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              A guia <span className="font-mono tabular-nums">{vinculo.guia}</span> volta para a
              fila de autorizações sem vínculo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] leading-relaxed text-rose-900">
            <p>
              Deixa de valer <strong className="font-semibold">{afirma}</strong>.
            </p>
            {/* O efeito que a grade mostraria depois, dito antes. Vale para os
                dois tipos que afirmam cobertura — nos outros dois não há
                cobertura a retirar, e prometer isso seria mentir ao contrário. */}
            {(vinculo.tipo === 'vinculo' || vinculo.tipo === 'substituicao') && (
              <p className="mt-1.5">
                A sessão volta a aparecer <strong className="font-semibold">sem cobertura</strong> e
                as pendências do paciente sobem de novo.
              </p>
            )}
            <p className="mt-1.5">
              O registro <strong className="font-semibold">não é apagado</strong>: fica guardado
              quem desfez, quando e por quê.
            </p>
          </div>

          {/* A falta do titular não é tocada por nada disto, e é justamente onde
              alguém poderia esperar que fosse. Só nos dois tipos nascidos de uma
              falta — nos outros a frase não teria referente. */}
          {(vinculo.tipo === 'falta_terapeuta' || vinculo.tipo === 'substituicao') && (
            <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
              A falta do titular continua registrada, como antes — ela é fato, e desfazer a triagem
              não a altera.
            </p>
          )}

          <label className="mt-4 block">
            <span className="text-[12px] font-medium text-slate-600">Motivo (opcional)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Ex.: houve substituto, vou refazer como substituição"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400">{motivo.length}/500</span>
          </label>

          {erro && (
            <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {erro}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {salvando && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Desfazer triagem
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
