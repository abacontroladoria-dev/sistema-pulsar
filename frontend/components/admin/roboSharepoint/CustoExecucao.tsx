'use client'

import { CheckCircle2, TriangleAlert } from 'lucide-react'
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

  const itens = [
    { rotulo: 'Tempo total', valor: segundos(total), nota: 'meta: até 15 s' },
    { rotulo: 'Tempo dentro do banco', valor: banco != null ? `${banco} ms` : '—', nota: 'meta: até 1 s' },
    { rotulo: 'Maior chamada ao banco', valor: maior ? `${maior} ms` : '—', nota: 'o pior momento para os usuários' },
    { rotulo: 'Chamadas ao banco', valor: m.chamadas_banco ?? '—', nota: '1 lote + marcos da linha do tempo' },
    { rotulo: 'Chamadas à Microsoft', valor: m.chamadas_graph ?? '—', nota: m.bytes_graph != null ? `${Math.round(m.bytes_graph / 1024)} KB lidos` : '' },
    { rotulo: 'Arquivos novos', valor: r.novos ?? '—', nota: r.removidos ? `${r.removidos} removido(s)` : '' },
    { rotulo: 'Sugestões pendentes', valor: r.sugeridos ?? '—', nota: r.nao_reconhecidos ? `${r.nao_reconhecidos} não reconhecido(s)` : '' },
  ]

  return (
    <>
      <dl className={`grid grid-cols-2 gap-3 ${compacto ? 'sm:grid-cols-4' : 'sm:grid-cols-4 xl:grid-cols-7'}`}>
        {itens.map(i => (
          <div key={i.rotulo} className="rounded-xl border border-slate-200 p-3">
            <dt className="text-xs text-slate-500">{i.rotulo}</dt>
            <dd className={`mt-1 font-bold tabular-nums text-slate-800 ${compacto ? 'text-base' : 'text-xl'}`}>{i.valor}</dd>
            {i.nota && <dd className="mt-0.5 text-[11px] text-slate-500">{i.nota}</dd>}
          </div>
        ))}
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
