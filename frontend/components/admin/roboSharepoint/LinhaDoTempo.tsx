'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, ChevronRight, Circle, Loader2, X } from 'lucide-react'
import { ETAPAS, numero, segundos } from '@/lib/roboSharepoint/rotulos'
import type { RoboEtapa, RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'

// A execução contada etapa por etapa. É a tela que responde "o que o robô
// está fazendo agora e quanto tempo levou": cada etapa chega pelo Realtime no
// momento em que o robô a registra, e a que está rodando ganha um cronômetro
// local (o banco só recebe o tempo quando ela termina).
//
// Cor = estado da etapa, sempre com ícone e texto junto (DESIGN.md: sky em
// trânsito, emerald concluída, rose falhou, slate ainda não começou). A cor
// fica na faixa do topo e no selo; o cartão é branco. Etapa terminada é um
// botão: abre "O que o robô leu" naquela etapa.

function useAgora(ativo: boolean) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ativo) return
    const id = setInterval(() => setAgora(Date.now()), 200)
    return () => clearInterval(id)
  }, [ativo])
  return agora
}

type Numero = { valor: number | null | undefined; rotulo: string; atencao?: boolean }

/** Os números que cada etapa registrou, para mostrar grandes em vez de numa frase. */
function numerosDetalhe(etapa: RoboEtapa): { numeros: Numero[]; nota?: string } | null {
  const d = etapa.detalhe as Record<string, unknown> | null | undefined
  if (!d || typeof d.erro === 'string') return null
  const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null)
  switch (etapa.etapa) {
    case 'autenticar':
      return { numeros: [{ valor: n('certificado_dias_restantes'), rotulo: 'dias até o certificado vencer', atencao: (n('certificado_dias_restantes') ?? 99) < 30 }], nota: 'acesso só de leitura' }
    case 'listar':
      return {
        numeros: [{ valor: n('arquivos_novos_ou_alterados'), rotulo: 'arquivos' }, { valor: n('pastas'), rotulo: 'pastas' }],
        nota: d.leitura === 'completa' ? 'leitura completa' : 'só o que mudou',
      }
    case 'classificar':
      return { numeros: [{ valor: n('evidencias'), rotulo: 'evidências' }, { valor: n('planilhas'), rotulo: 'planilhas' }, { valor: n('fora_padrao'), rotulo: 'fora do padrão', atencao: (n('fora_padrao') ?? 0) > 0 }] }
    case 'planilhas':
      return { numeros: [{ valor: n('lidas'), rotulo: 'lidas' }, { valor: n('pacientes_nas_planilhas'), rotulo: 'pacientes' }, { valor: n('cpfs_invalidos'), rotulo: 'CPF inválido', atencao: (n('cpfs_invalidos') ?? 0) > 0 }] }
    case 'enviar':
      if (d.sem_banco) return { numeros: [], nota: 'banco desligado (demonstração)' }
      return { numeros: [{ valor: n('sugeridos'), rotulo: 'sugestões' }, { valor: n('novos'), rotulo: 'novos' }, { valor: n('ms_banco'), rotulo: 'ms no banco' }] }
    default:
      return null
  }
}

const TOM = {
  concluida: { faixa: 'bg-emerald-500', selo: 'bg-emerald-50 text-emerald-700 ring-emerald-200', texto: 'concluída', Icone: Check },
  executando: { faixa: 'bg-sky-500', selo: 'bg-sky-50 text-sky-700 ring-sky-200', texto: 'em andamento', Icone: Loader2 },
  erro: { faixa: 'bg-rose-500', selo: 'bg-rose-50 text-rose-700 ring-rose-200', texto: 'falhou', Icone: X },
  pendente: { faixa: 'bg-slate-200', selo: 'bg-slate-50 text-slate-500 ring-slate-200', texto: 'aguardando', Icone: Circle },
} as const

export function LinhaDoTempo({ execucao, onAbrir }: {
  execucao: RoboExecucao | null
  /** Clique num card de etapa concluída → "O que o robô leu" naquela etapa. */
  onAbrir?: (etapa: RoboEtapaNome) => void
}) {
  const rodando = execucao?.status === 'executando'
  const agora = useAgora(rodando)

  if (!execucao) {
    return (
      <p className="text-sm text-slate-500">
        Nenhuma execução ainda. Quando o robô rodar, cada etapa aparece aqui, com o tempo que levou.
      </p>
    )
  }

  const porEtapa = new Map(execucao.etapas.map(e => [e.etapa, e]))
  const totalMs = rodando
    ? agora - new Date(execucao.iniciado_em).getTime()
    : execucao.duracao_ms ?? execucao.metricas?.duracao_ms ?? null
  const algumaAbrivel = !!onAbrir && execucao.etapas.some(e => e.status === 'concluida' || e.status === 'erro')

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">
          {rodando ? 'Executando agora' : execucao.status === 'erro' ? 'Última execução falhou' : 'Última execução'}
          {algumaAbrivel && <span className="font-normal"> · toque numa etapa para ver, item por item, o que o robô leu</span>}
        </p>
        <p className="text-sm text-slate-600" aria-live="polite">
          Tempo total <strong className="text-2xl font-bold tabular-nums text-slate-800">{segundos(totalMs)}</strong>
        </p>
      </div>

      <ol className="mt-4 grid gap-3 md:grid-cols-5">
        {ETAPAS.map(({ etapa, rotulo, explica }, i) => {
          const e = porEtapa.get(etapa)
          const bruto = e?.status ?? (rodando ? 'pendente' : execucao.status === 'erro' ? 'pulada' : 'pendente')
          const estado = bruto === 'concluida' || bruto === 'executando' || bruto === 'erro' ? bruto : 'pendente'
          const tom = TOM[estado]
          const ms = e?.status === 'executando' && e.inicio ? agora - new Date(e.inicio).getTime() : e?.duracao_ms ?? null
          const det = e ? numerosDetalhe(e) : null
          const erroTexto = e && typeof (e.detalhe as { erro?: unknown } | null)?.erro === 'string' ? String((e.detalhe as { erro: string }).erro) : null
          const ultimo = i === ETAPAS.length - 1

          const abrivel = !!onAbrir && (estado === 'concluida' || estado === 'erro')
          const corpo = (
            <>
              <span className={`block h-1 w-full ${tom.faixa} ${estado === 'executando' ? 'animate-pulse motion-reduce:animate-none' : ''}`} aria-hidden />
              <span className="flex flex-1 flex-col p-4">
                <span className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold tabular-nums text-white">{i + 1}</span>
                    <span className="truncate text-sm font-bold text-slate-800">{rotulo}</span>
                  </span>
                  {abrivel && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 text-brand-fg transition-colors group-hover:border-brand-fg group-hover:bg-brand-fg group-hover:text-white motion-reduce:transition-none" aria-hidden>
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  )}
                </span>

                <span className="mt-3 flex items-end justify-between gap-2">
                  <span className="text-[28px] font-black leading-none tabular-nums text-slate-800">
                    {ms != null ? segundos(ms, 2) : <span className="text-slate-300">—</span>}
                  </span>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${tom.selo}`}>
                    <tom.Icone className={`h-3 w-3 ${estado === 'executando' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />{tom.texto}
                  </span>
                </span>

                {!e && <span className="mt-2 block text-xs leading-snug text-slate-500">{explica}</span>}

                {erroTexto ? (
                  <span className="mt-3 block rounded-lg bg-rose-50 px-2.5 py-2 text-xs leading-snug text-rose-800">{erroTexto}</span>
                ) : det && det.numeros.length > 0 ? (
                  <span className={`mt-3 grid divide-x divide-slate-200 border-t border-slate-100 pt-3 ${
                    det.numeros.length === 1 ? 'grid-cols-1' : det.numeros.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {det.numeros.map(x => (
                      <span key={x.rotulo} className="min-w-0 px-2 first:pl-0">
                        <span className={`block text-lg font-black leading-none tabular-nums ${x.atencao ? 'text-amber-700' : 'text-slate-800'}`}>{numero(x.valor)}</span>
                        <span className="mt-1 block text-[10px] leading-tight text-slate-500">{x.rotulo}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
                {det?.nota && <span className="mt-2 block text-[11px] font-medium text-slate-500">{det.nota}</span>}
              </span>

              {abrivel && (
                <span className="mt-auto flex items-center justify-between border-t border-slate-100 bg-brand-surface/60 px-4 py-2.5 text-xs font-bold text-brand-fg transition-colors group-hover:bg-brand-fg group-hover:text-white motion-reduce:transition-none">
                  Ver o que foi lido
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transform-none" aria-hidden />
                </span>
              )}
            </>
          )

          return (
            <li key={etapa} className="relative flex">
              {abrivel ? (
                <button
                  type="button"
                  onClick={() => onAbrir!(etapa)}
                  aria-label={`${rotulo}: ${tom.texto}, ${ms != null ? segundos(ms, 2) : ''}. Ver o que foi lido`}
                  className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition-colors hover:border-brand-fg/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  {corpo}
                </button>
              ) : (
                <div className={`flex w-full flex-col overflow-hidden rounded-2xl border bg-white ${estado === 'executando' ? 'border-sky-300' : 'border-slate-200'}`}>{corpo}</div>
              )}
              {/* seta de uma etapa para a próxima */}
              {!ultimo && (
                <span className="pointer-events-none absolute -right-[18px] top-[4.25rem] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 md:flex" aria-hidden>
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {execucao.status === 'erro' && execucao.erro && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {execucao.erro}
        </p>
      )}
    </div>
  )
}
