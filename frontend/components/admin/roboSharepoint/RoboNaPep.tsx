'use client'

import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { DestaqueLeitura } from './DestaqueLeitura'
import { FilaNaoReconhecidos, resumoPendencias } from './FilaNaoReconhecidos'
import { DetalheExecucaoDrawer } from './detalhe/DetalheExecucaoDrawer'
import { AvisosEvidencias } from './historico/AvisosEvidencias'
import { useRoboSharepoint } from '@/hooks/useRoboSharepoint'
import { ESTADO_ATUAL, execucaoEstadoAtual, execucoesDeReferencia } from '@/lib/roboSharepoint/referencias'
import { estadoAtualDisponivel, obterResumoExecucao } from '@/services/roboSharepoint.service'
import type { ResumoExecucao, RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'

// O robô SharePoint dentro da tela Entregas PEP (pedido de 02/10/2026): o que
// está na pasta e o que precisa de uma pessoa (pedir planilha, dizer de quem
// é a pasta). Saiu de /admin/robo-sharepoint, que ficou com a parte técnica.
// Leitura liberada para quem tem relacionamento_prestador_pep (migration
// 20261002100000, seção 10).
//
// Desde 20261003100000 o topo é o RETRATO da pasta (estado atual, todos os
// arquivos), não o que a última execução leu — e as entregas que mudaram
// porque a evidência saiu da pasta aparecem logo abaixo. Sem a migration,
// volta ao de antes.
//
// Sem permissão ou sem a migration aplicada, não mostra nada: a tela PEP
// funciona igual sem o robô.

const cartao = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6'

export function RoboNaPep({ onCarregado, competencia }: { onCarregado?: () => void; competencia?: string } = {}) {
  const { execucoes, pendencias, itensPresos, carregando, erro, carregarPendencias } = useRoboSharepoint({ comSaude: false })
  const { ultima, ultimaConcluida, idUltimaGravada, ultimaCompleta } = execucoesDeReferencia(execucoes)
  const [detalhe, setDetalhe] = useState<{ execucao: RoboExecucao; etapa: RoboEtapaNome } | null>(null)
  // undefined = carregando; null = migration pendente (cai no comportamento de antes).
  const [estadoAtual, setEstadoAtual] = useState<ResumoExecucao | null | undefined>(undefined)

  // O retrato muda quando uma leitura termina: recarrega quando a última concluída muda.
  const idRetrato = ultimaConcluida?.id ?? null
  useEffect(() => {
    let vivo = true
    estadoAtualDisponivel()
      .then(ok => (ok ? obterResumoExecucao(ESTADO_ATUAL) : null))
      // Segunda trava: só a RPC nova responde estado_atual=true. A antiga,
      // chamada com NULL, devolveria zero arquivos — melhor o comportamento
      // de antes do que um retrato vazio.
      .then(r => { if (vivo) setEstadoAtual(r?.estado_atual ? r : null) })
      .catch(e => { console.warn('estado atual do SharePoint:', e); if (vivo) setEstadoAtual(null) })
    return () => { vivo = false }
  }, [idRetrato])

  const pronto = !carregando && estadoAtual !== undefined
  // A tela PEP só aparece quando tudo carregou: avisa assim que os dados chegam.
  useEffect(() => { if (pronto) onCarregado?.() }, [pronto, onCarregado])

  if (!pronto) return null
  if (erro && execucoes.length === 0) return null

  const abrir = (etapa: RoboEtapaNome) => {
    if (estadoAtual) setDetalhe({ execucao: execucaoEstadoAtual(ultimaConcluida, estadoAtual.pastas.total), etapa })
    else if (ultima) setDetalhe({ execucao: ultima, etapa })
  }

  return (
    <div className="tema-robo space-y-4">
      <DestaqueLeitura execucao={ultima} estadoAtual={estadoAtual} retratoDe={ultimaConcluida} onAbrir={abrir} />

      <AvisosEvidencias cartao={cartao} />

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
          simples
          competencia={competencia}
        />
      )}
    </div>
  )
}
