'use client'

import { useEffect, useState } from 'react'
import { Loader2, OctagonPause } from 'lucide-react'
import toast from 'react-hot-toast'
import { dataHora, numero } from '@/lib/roboSharepoint/rotulos'
import { confirmarRemocoesSuspensas, obterRemocaoSuspensa } from '@/services/roboSharepoint.service'
import type { RemocaoSuspensa } from '@/types/roboSharepoint'

// Freio da leitura completa (20261003100000): quando a leitura do dia acha
// "sumidos" demais de uma vez (mais de 10 e mais de 15%), o banco não apaga
// nada e guarda o alerta — pode ser permissão revogada ou falha da Microsoft,
// e apagar desfaria entregas. Se a próxima leitura vier normal, o alerta some
// sozinho. Se sumiram mesmo, um admin confirma aqui.

export function AlertaFreio({ ehAdmin, recarregarEm }: { ehAdmin: boolean; recarregarEm?: string | null }) {
  const [freio, setFreio] = useState<RemocaoSuspensa | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    obterRemocaoSuspensa().then(f => { if (vivo) setFreio(f) })
    return () => { vivo = false }
  }, [recarregarEm, versao])

  if (!freio) return null

  async function confirmar() {
    setSalvando(true)
    try {
      const r = await confirmarRemocoesSuspensas()
      toast.success(r.aplicado ? `Remoções aplicadas: ${numero(r.evidencias_removidas ?? 0)} evidência(s) saíram.` : 'Não havia nada suspenso.')
      setConfirmando(false)
      setVersao(v => v + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível confirmar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-6" role="alert" aria-labelledby="titulo-freio">
      <div className="flex items-start gap-3">
        <OctagonPause className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" aria-hidden />
        <div className="min-w-0 space-y-2">
          <h2 id="titulo-freio" className="text-base font-bold text-amber-900">A leitura de {dataHora(freio.em)} não apagou nada</h2>
          <p className="text-sm text-amber-900">
            Ela não encontrou {numero(freio.evidencias)} de {numero(freio.evidencias_total)} evidências
            {freio.arquivos ? ` e ${numero(freio.arquivos)} de ${numero(freio.arquivos_total)} arquivos` : ''}
            {freio.pastas ? ` (${numero(freio.pastas)} de ${numero(freio.pastas_total)} pastas)` : ''}. Sumir tanto de uma vez costuma ser
            falta de acesso ao SharePoint, não arquivo apagado — por isso nada saiu da tela e nenhuma entrega foi retirada.
            Se a próxima leitura vier normal, este aviso some sozinho.
          </p>
          {ehAdmin && !confirmando && (
            <button type="button" onClick={() => setConfirmando(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
              Conferi no SharePoint: foram apagados mesmo
            </button>
          )}
          {confirmando && (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-white p-4">
              <p className="text-sm text-amber-900">
                Os arquivos saem da tela e as entregas que dependiam deles perdem a unidade (mês liberado não muda). Tudo fica no histórico.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={confirmar} disabled={salvando}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                  {salvando && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />} Aplicar as remoções
                </button>
                <button type="button" onClick={() => setConfirmando(false)} disabled={salvando}
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
