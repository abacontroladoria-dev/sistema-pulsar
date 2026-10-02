'use client'

import { useEffect, useState } from 'react'
import { Bot, FileCheck2, FileX2, Repeat2 } from 'lucide-react'
import { numero } from '@/lib/roboSharepoint/rotulos'
import { contarPadrao } from '@/services/roboSharepoint.service'

// O robô entrega sozinho (20261002100000) — sempre. A chave de ligar/desligar
// saiu em 02/10/2026 (decisão do usuário: "não encontro benefício nenhum de
// desligar"; migration 20261003100000). Fica o que ajuda a entender o que ele
// entrega: quantos arquivos seguem o padrão de nome.

export function EntregaAutomatica() {
  const [padrao, setPadrao] = useState<Awaited<ReturnType<typeof contarPadrao>>>(null)
  const [carregado, setCarregado] = useState(false)

  useEffect(() => {
    let vivo = true
    contarPadrao().then(p => { if (vivo) { setPadrao(p); setCarregado(true) } })
    return () => { vivo = false }
  }, [])

  if (!carregado) return null

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="titulo-entrega-auto">
      <div className="h-1 w-full bg-violet-600" aria-hidden />
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <Bot className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 id="titulo-entrega-auto" className="text-base font-bold text-slate-800">O robô entrega sozinho</h2>
            <p className="text-sm text-slate-600">
              Todo arquivo reconhecido e no padrão de nome vira entrega (em roxo), em todo mês ainda não liberado. O RP desfaz
              quando ele errar. Se a evidência sumir do SharePoint, a entrega e o valor acompanham a pasta — e fica registrado
              no histórico de mudanças abaixo.
            </p>
          </div>
        </div>

        {padrao && (
          <div>
            <p className="text-xs font-semibold text-slate-700">Padrão de nome dos arquivos (SIGLA-PACIENTE-MMAAAA)</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              <li className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                <FileCheck2 className="h-5 w-5 shrink-0" aria-hidden />
                <span><span className="block text-xl font-bold tabular-nums leading-none">{numero(padrao.ok)}</span><span className="text-xs font-semibold">seguem o padrão e contam</span></span>
              </li>
              <li className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <FileX2 className="h-5 w-5 shrink-0" aria-hidden />
                <span><span className="block text-xl font-bold tabular-nums leading-none">{numero(padrao.fora)}</span><span className="text-xs font-semibold">ferem o padrão e não contam</span></span>
              </li>
              <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-800">
                <Repeat2 className="h-5 w-5 shrink-0" aria-hidden />
                <span><span className="block text-xl font-bold tabular-nums leading-none">{numero(padrao.duplicado)}</span><span className="text-xs font-semibold">repetidos (contam uma vez)</span></span>
              </li>
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Geral: STC-01-092026 · Paciente: PIC-JOAO SILVA-092026 · TAP com número: TAP-01-JOAO SILVA-092026 · Reprogramação: REP-PIC-JOAO SILVA-092026.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
