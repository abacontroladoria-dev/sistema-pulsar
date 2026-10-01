'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, FileCheck2, FileX2, Loader2, Power, Repeat2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { dataHora, numero } from '@/lib/roboSharepoint/rotulos'
import { contarPadrao, definirEntregaAutomatica, obterEntregaAutomatica, type EstadoEntregaAutomatica } from '@/services/roboSharepoint.service'

// A chave da entrega automática (20261002100000). Desligada, o robô só lê e
// mostra o padrão de nome; ligada, ele MARCA a entrega de todo arquivo
// reconhecido e no padrão, em todo mês ainda não liberado — e o RP desfaz
// quando ele errar. Só admin liga/desliga (a RPC confere). Também é o botão
// de pânico: desligar para tudo na hora, sem apagar o que já foi entregue.

export function EntregaAutomatica({ ehAdmin }: { ehAdmin: boolean }) {
  const [estado, setEstado] = useState<EstadoEntregaAutomatica | null>(null)
  const [padrao, setPadrao] = useState<Awaited<ReturnType<typeof contarPadrao>>>(null)
  const [carregado, setCarregado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const [e, p] = await Promise.all([obterEntregaAutomatica(), contarPadrao()])
    setEstado(e)
    setPadrao(p)
    setCarregado(true)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => { void carregar() }, 0)
    return () => clearTimeout(id)
  }, [carregar])

  if (!carregado) return null
  if (!estado) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Entrega automática: a migration 20261002100000 ainda não foi aplicada neste ambiente.
      </p>
    )
  }

  async function mudar(ligar: boolean) {
    setSalvando(true)
    try {
      const r = await definirEntregaAutomatica(ligar)
      const entregues = Number((r.resultado as { entrega?: { entregues?: number } })?.entrega?.entregues ?? 0)
      toast.success(ligar ? `Entrega automática ligada. O robô entregou ${entregues} arquivo(s) agora.` : 'Entrega automática desligada. O robô volta a só sugerir.')
      setConfirmando(false)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível mudar a entrega automática')
    } finally {
      setSalvando(false)
    }
  }

  const ligada = estado.ligada
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-labelledby="titulo-entrega-auto">
      <div className={`h-1 w-full ${ligada ? 'bg-violet-600' : 'bg-slate-200'}`} aria-hidden />
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${ligada ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
              <Bot className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h2 id="titulo-entrega-auto" className="text-base font-bold text-slate-800">
                Entrega automática: <span className={ligada ? 'text-violet-700' : 'text-slate-600'}>{ligada ? 'ligada' : 'desligada'}</span>
              </h2>
              <p className="text-sm text-slate-600">
                {ligada
                  ? 'O robô marca sozinho a entrega de todo arquivo reconhecido e no padrão de nome. O RP desfaz quando ele errar.'
                  : 'O robô lê e confere o padrão de nome, mas não marca entrega. Ligue para ele começar a entregar.'}
              </p>
              {estado.por && (
                <p className="mt-0.5 text-xs text-slate-500">{ligada ? 'Ligada' : 'Desligada'} por {estado.por}{estado.em ? ` em ${dataHora(estado.em)}` : ''}</p>
              )}
            </div>
          </div>
          {ehAdmin && !confirmando && (
            <button type="button" onClick={() => (ligada ? mudar(false) : setConfirmando(true))} disabled={salvando}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50
                ${ligada ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />}
              {ligada ? 'Desligar' : 'Ligar entrega automática'}
            </button>
          )}
        </div>

        {confirmando && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-sm text-violet-900">
              Ao ligar, o robô reprocessa <strong>todo mês ainda não liberado</strong> e marca agora as entregas que seguem o padrão.
              O que uma pessoa já marcou continua azul e não é tocado. Dá para desligar a qualquer momento.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => mudar(true)} disabled={salvando}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {salvando ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Power className="h-4 w-4" aria-hidden />}
                Ligar e reprocessar
              </button>
              <button type="button" onClick={() => setConfirmando(false)} disabled={salvando}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
            </div>
          </div>
        )}

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
