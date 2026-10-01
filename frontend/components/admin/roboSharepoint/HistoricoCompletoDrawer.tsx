'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { Drawer } from '@/components/cronograma/ui/Drawer'
import { Z_MODAL_EMPILHADO } from '@/components/cronograma/ui/useModalLayer'
import { DetalheExecucaoDrawer } from './detalhe/DetalheExecucaoDrawer'
import { dataHora, GATILHOS, MODOS, segundos } from '@/lib/roboSharepoint/rotulos'
import { listarExecucoesPagina } from '@/services/roboSharepoint.service'
import type { RoboEtapaNome, RoboExecucao } from '@/types/roboSharepoint'
import { LinhaDoTempo } from './LinhaDoTempo'
import { CustoExecucao } from './CustoExecucao'

// O log inteiro das execuções, página por página. Cada linha abre a execução
// como ela aconteceu: a linha do tempo com o tempo de cada etapa e o custo
// para o Pulsar. É onde se compara um "Executar agora" perto do pagamento com
// as execuções da madrugada.

const TAMANHO = 25

type FiltroStatus = 'todos' | 'concluido' | 'erro'
type FiltroGatilho = 'todos' | 'agenda' | 'manual'

function Filtro<T extends string>({ rotulo, valor, opcoes, onMudar }: {
  rotulo: string
  valor: T
  opcoes: { valor: T; rotulo: string }[]
  onMudar: (v: T) => void
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{rotulo}</legend>
      {opcoes.map(o => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onMudar(o.valor)}
          className={`min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
            valor === o.valor ? 'border-slate-400 bg-slate-100 text-slate-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </fieldset>
  )
}

const textoStatus = (e: RoboExecucao) => (e.status === 'erro' ? 'Falhou' : e.status === 'executando' ? 'Executando' : 'Concluída')

export function HistoricoCompletoDrawer({ idUltimaGravada, ultimaCompleta, onClose }: {
  idUltimaGravada: string | null
  ultimaCompleta: RoboExecucao | null
  onClose: () => void
}) {
  const [detalhe, setDetalhe] = useState<{ execucao: RoboExecucao; etapa: RoboEtapaNome } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [status, setStatus] = useState<FiltroStatus>('todos')
  const [gatilho, setGatilho] = useState<FiltroGatilho>('todos')
  const [dados, setDados] = useState<{ execucoes: RoboExecucao[]; total: number }>({ execucoes: [], total: 0 })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setDados(await listarExecucoesPagina({
        pagina, tamanho: TAMANHO,
        status: status === 'todos' ? null : status,
        gatilho: gatilho === 'todos' ? null : gatilho,
      }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar o histórico')
    } finally {
      setCarregando(false)
    }
  }, [pagina, status, gatilho])

  useEffect(() => {
    const id = setTimeout(() => { void carregar() }, 0)
    return () => clearTimeout(id)
  }, [carregar])

  const paginas = Math.max(1, Math.ceil(dados.total / TAMANHO))

  return (
    <Drawer
      title="Histórico completo de execuções"
      subtitle={`${dados.total} execução(ões) registradas`}
      width={960}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-slate-500">Página {pagina + 1} de {paginas}</span>
          <div className="flex gap-2">
            <button type="button" disabled={pagina === 0 || carregando} onClick={() => setPagina(p => p - 1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
            </button>
            <button type="button" disabled={pagina + 1 >= paginas || carregando} onClick={() => setPagina(p => p + 1)}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Próxima <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      }
    >
      <div className="tema-robo">
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <Filtro rotulo="Situação" valor={status} onMudar={v => { setStatus(v); setPagina(0) }}
          opcoes={[{ valor: 'todos', rotulo: 'Todas' }, { valor: 'concluido', rotulo: 'Concluídas' }, { valor: 'erro', rotulo: 'Falharam' }]} />
        <Filtro rotulo="Origem" valor={gatilho} onMudar={v => { setGatilho(v); setPagina(0) }}
          opcoes={[{ valor: 'todos', rotulo: 'Qualquer origem' }, { valor: 'agenda', rotulo: 'Madrugada' }, { valor: 'manual', rotulo: 'Executar agora' }]} />
      </div>

      {erro && <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

      <div className="overflow-x-auto" aria-busy={carregando}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="pb-2 pr-3">Quando</th>
              <th className="pb-2 pr-3">Origem</th>
              <th className="pb-2 pr-3">Situação</th>
              <th className="pb-2 pr-3 text-right">Duração</th>
              <th className="pb-2 pr-3 text-right">No banco</th>
              <th className="pb-2 pr-3 text-right">Maior chamada</th>
              <th className="pb-2 pr-3 text-right">Arquivos novos</th>
              <th className="pb-2"><span className="sr-only">Detalhe</span></th>
            </tr>
          </thead>
          <tbody>
            {dados.execucoes.map(e => {
              const expandida = aberta === e.id
              return (
                <Fragment key={e.id}>
                  <tr className={`border-b border-slate-100 ${carregando ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-3 tabular-nums text-slate-700">{dataHora(e.iniciado_em)}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {GATILHOS[e.gatilho]}
                      {e.modo !== 'producao' && <span className="ml-1 text-xs text-slate-400">({MODOS[e.modo]})</span>}
                      {e.solicitado_por_nome && <span className="block text-xs text-slate-400">{e.solicitado_por_nome}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        e.status === 'erro' ? 'bg-rose-50 text-rose-700' : e.status === 'executando' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>{textoStatus(e)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{segundos(e.duracao_ms)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{e.metricas?.ms_banco != null ? `${e.metricas.ms_banco} ms` : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{e.metricas?.ms_maior_chamada_banco ? `${e.metricas.ms_maior_chamada_banco} ms` : '—'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{e.resumo?.novos ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => setAberta(expandida ? null : e.id)} aria-expanded={expandida}
                        className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-medium text-brand-fg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                        {expandida ? <>Fechar <ChevronUp className="h-3.5 w-3.5" aria-hidden /></> : <>Ver <ChevronDown className="h-3.5 w-3.5" aria-hidden /></>}
                      </button>
                    </td>
                  </tr>
                  {expandida && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={8} className="space-y-5 px-3 py-4">
                        <LinhaDoTempo execucao={e} onAbrir={etapa => setDetalhe({ execucao: e, etapa })} />
                        <CustoExecucao execucao={e} compacto />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!carregando && dados.execucoes.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-sm text-slate-500">Nenhuma execução com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {detalhe && (
        <DetalheExecucaoDrawer
          execucao={detalhe.execucao}
          etapaInicial={detalhe.etapa}
          ehUltima={detalhe.execucao.id === idUltimaGravada}
          ultimaCompleta={ultimaCompleta}
          onAbrirExecucao={(execucao, etapa) => setDetalhe({ execucao, etapa })}
          zIndex={Z_MODAL_EMPILHADO}
          onClose={() => setDetalhe(null)}
        />
      )}
      </div>
    </Drawer>
  )
}
