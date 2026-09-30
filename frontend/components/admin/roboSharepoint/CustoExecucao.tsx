'use client'

import { Activity, ArrowLeftRight, CheckCircle2, Cloud, Database, FilePlus2, Lightbulb, Timer, TriangleAlert } from 'lucide-react'
import { segundos } from '@/lib/roboSharepoint/rotulos'
import type { RoboExecucao } from '@/types/roboSharepoint'

// Quanto UMA execução custou ao Pulsar. Usado no painel (a última) e em cada
// linha do histórico completo.
//
// O número que responde "o robô atrapalhou quem estava usando o Pulsar?" é a
// MAIOR chamada ao banco: é o tempo máximo em que o robô ocupou o banco de uma
// vez. O tempo total da execução é quase todo espera pela Microsoft, que não
// pesa no Pulsar.

export const META_TOTAL_MS = 15000
export const META_BANCO_MS = 1000

export function CustoExecucao({ execucao, compacto = false }: { execucao: RoboExecucao | null; compacto?: boolean }) {
  if (!execucao) return <p className="text-sm text-slate-500">Nenhuma execução concluída ainda.</p>

  const m = execucao.metricas ?? {}
  const r = execucao.resumo ?? {}
  const total = execucao.duracao_ms ?? m.duracao_ms ?? null
  const banco = m.ms_banco ?? r.ms_banco ?? null
  const maior = m.ms_maior_chamada_banco ?? null
  const dentro = total != null && total <= META_TOTAL_MS && (banco == null || banco <= META_BANCO_MS)

  const itens: { icone: typeof Timer; rotulo: string; valor: React.ReactNode; nota: string; meta?: { usado: number | null; limite: number } }[] = [
    { icone: Timer, rotulo: 'Tempo total', valor: segundos(total), nota: 'meta: até 15 s', meta: { usado: total, limite: META_TOTAL_MS } },
    { icone: Database, rotulo: 'Tempo dentro do banco', valor: banco != null ? `${banco} ms` : '—', nota: 'meta: até 1 s', meta: { usado: banco, limite: META_BANCO_MS } },
    { icone: Activity, rotulo: 'Maior chamada ao banco', valor: maior ? `${maior} ms` : '—', nota: 'o pior momento para os usuários' },
    { icone: ArrowLeftRight, rotulo: 'Chamadas ao banco', valor: m.chamadas_banco ?? '—', nota: '1 lote + marcos da linha do tempo' },
    { icone: Cloud, rotulo: 'Chamadas à Microsoft', valor: m.chamadas_graph ?? '—', nota: m.bytes_graph != null ? `${Math.round(m.bytes_graph / 1024).toLocaleString('pt-BR')} KB lidos` : '' },
    { icone: FilePlus2, rotulo: 'Arquivos novos', valor: r.novos ?? '—', nota: r.removidos ? `${r.removidos} removido(s)` : 'desde a leitura anterior' },
    { icone: Lightbulb, rotulo: 'Sugestões pendentes', valor: r.sugeridos ?? '—', nota: r.nao_reconhecidos ? `${r.nao_reconhecidos} não reconhecido(s)` : '' },
  ]

  return (
    <>
      <dl className={`grid grid-cols-2 gap-3 ${compacto ? 'sm:grid-cols-4' : 'sm:grid-cols-4 xl:grid-cols-7'}`}>
        {itens.map(i => {
          const pct = i.meta?.usado != null ? Math.min((i.meta.usado / i.meta.limite) * 100, 100) : null
          const passou = i.meta?.usado != null && i.meta.usado > i.meta.limite
          return (
            <div key={i.rotulo} className={`flex flex-col rounded-2xl border border-slate-200 bg-white ${compacto ? 'p-3' : 'p-4'}`}>
              <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                {!compacto && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-fg"><i.icone className="h-3.5 w-3.5" aria-hidden /></span>
                )}
                <span className="min-w-0 leading-tight">{i.rotulo}</span>
              </dt>
              <dd className={`font-black tabular-nums text-slate-800 ${compacto ? 'mt-1 text-base' : 'mt-3 text-2xl leading-none'}`}>{i.valor}</dd>
              {pct != null && (
                <dd className="mt-2.5" aria-hidden>
                  <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full ${passou ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </span>
                </dd>
              )}
              {i.nota && <dd className={`text-[11px] leading-snug text-slate-500 ${pct != null ? 'mt-1' : 'mt-1.5'}`}>{i.nota}{pct != null && ` · usou ${Math.round(pct)}%`}</dd>}
            </div>
          )
        })}
      </dl>
      {execucao.status !== 'executando' && total != null && (
        <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${dentro ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          {dentro ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
          {dentro ? 'Dentro da meta: não pesa no Pulsar' : 'Acima da meta: vale olhar esta execução'}
        </p>
      )}
    </>
  )
}
