'use client'

import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { DestaqueLeitura } from './DestaqueLeitura'
import { FilaNaoReconhecidos, resumoPendencias } from './FilaNaoReconhecidos'
import { DetalheExecucaoDrawer } from './detalhe/DetalheExecucaoDrawer'
import { useRoboSharepoint } from '@/hooks/useRoboSharepoint'
import { execucoesDeReferencia } from '@/lib/roboSharepoint/referencias'
import type { RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'

// O robô SharePoint dentro da tela Entregas PEP (pedido de 02/10/2026): o que
// ele encontrou na última leitura e o que precisa de uma pessoa (pedir
// planilha, dizer de quem é a pasta). Saiu de /admin/robo-sharepoint, que
// ficou com a parte técnica. Leitura liberada para quem tem
// relacionamento_prestador_pep (migration 20261002100000, seção 10).
//
// Sem permissão ou sem a migration aplicada, não mostra nada: a tela PEP
// funciona igual sem o robô.

const cartao = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6'

export function RoboNaPep({ onCarregado }: { onCarregado?: () => void } = {}) {
  const { execucoes, pendencias, itensPresos, carregando, erro, carregarPendencias } = useRoboSharepoint({ comSaude: false })
  // A tela PEP só aparece quando tudo carregou: avisa assim que os dados chegam.
  useEffect(() => { if (!carregando) onCarregado?.() }, [carregando, onCarregado])
  const { ultima, idUltimaGravada, ultimaCompleta } = execucoesDeReferencia(execucoes)
  const [detalhe, setDetalhe] = useState<{ execucao: RoboExecucao; etapa: RoboEtapaNome } | null>(null)

  if (carregando) return null
  if (erro && execucoes.length === 0) return null

  return (
    <div className="space-y-4">
      <DestaqueLeitura execucao={ultima} onAbrir={etapa => ultima && setDetalhe({ execucao: ultima, etapa })} />

      <section className={cartao} aria-labelledby="titulo-precisa-de-voce">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="titulo-precisa-de-voce" className="flex items-center gap-2 text-base font-bold text-slate-800">
            <ClipboardList className="h-4 w-4 text-brand-fg" aria-hidden /> O que precisa de você
          </h2>
          <span className="text-xs text-slate-500">{resumoPendencias(pendencias, itensPresos)}</span>
        </div>
        <FilaNaoReconhecidos fila={pendencias} itens={itensPresos} onAtualizar={carregarPendencias} />
      </section>

      {detalhe && (
        <DetalheExecucaoDrawer
          execucao={execucoes.find(e => e.id === detalhe.execucao.id) ?? detalhe.execucao}
          etapaInicial={detalhe.etapa}
          ehUltima={detalhe.execucao.id === idUltimaGravada}
          ultimaCompleta={ultimaCompleta}
          onAbrirExecucao={(execucao, etapa) => setDetalhe({ execucao, etapa })}
          onClose={() => setDetalhe(null)}
        />
      )}
    </div>
  )
}
