'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Loader2, ChevronDown, AlertTriangle, PlugZap, Archive } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from './Button'
import { crmApi } from '@/services/crm/client'
import type { DealUI, KanbanColumnUI } from '@/services/crm/adapter'
import { CardNegocio } from './funil/CardNegocio'
import { GavetaNegocio } from './funil/GavetaNegocio'
import { MotivoModal } from './funil/MotivoModal'
import { NovoNegocioModal } from './funil/NovoNegocioModal'
import {
  type FiltroTrilha,
  separarEstagios, estagioVisivel, negocioVisivel, podeReceber, buscaCasa, ROTULO_TRILHA,
} from './funil/funil'

// ============================================================================
// Funil de atendimento (/connect/pipeline)
//
// O funil é o da diretoria (migration 20260930100000): 11 posições em
// andamento viram colunas; as 6 que encerram o negócio (Iniciou tratamento +
// 5 perdas) ficam numa área "Encerrados" à direita, que também é alvo de
// soltura. 17 colunas lado a lado não caberiam em tela nenhuma, e o trabalho
// do dia é o que está em andamento.
//
// Mover (arrastando o card ou escolhendo na gaveta) passa sempre por `pedirMovimento`:
// é ali que a trilha é conferida e o motivo é pedido. Um caminho só, para as
// duas formas de mover não divergirem — o servidor confere as mesmas regras
// de novo (DealService.moverParaEstagio).
//
// Atualização por polling de 15s, não Realtime: nenhuma tabela do `crm` está
// na publicação de Realtime (ver components/central/useCentralData.ts).
// ============================================================================

interface Usuario { id: string; nome: string }

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'indisponivel'; mensagem: string }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'pronto' }

const DIAS_ENCERRADOS = 30

const Kanban: React.FC = () => {
  const [estado, setEstado]       = useState<Estado>({ tipo: 'carregando' })
  const [estagios, setEstagios]   = useState<KanbanColumnUI[]>([])
  const [negocios, setNegocios]   = useState<DealUI[]>([])
  const [usuarios, setUsuarios]   = useState<Usuario[]>([])
  const [busca, setBusca]         = useState('')
  const [trilha, setTrilha]       = useState<FiltroTrilha>('todas')
  const [abertoId, setAbertoId]   = useState<string | null>(null)
  const [arrastando, setArrastando] = useState<DealUI | null>(null)
  const [alvo, setAlvo]           = useState<string | null>(null)
  const [pendente, setPendente]   = useState<{ negocio: DealUI; estagio: KanbanColumnUI } | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({})

  // --------------------------------------------------------------------------
  // Carga
  // --------------------------------------------------------------------------

  const recarregarNegocios = useCallback(async () => {
    setNegocios(await crmApi.fetchPipeline(DIAS_ENCERRADOS))
  }, [])

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const [st, ng] = await Promise.all([
        crmApi.fetchPipelineStages(),
        crmApi.fetchPipeline(DIAS_ENCERRADOS),
      ])
      setEstagios(st)
      setNegocios(ng)
      setEstado({ tipo: 'pronto' })
    } catch (err) {
      // No polling a falha fica calada: a tela mantém o que tinha, e o erro
      // real aparece quando alguém age.
      if (silencioso) return
      const e = err as Error & { code?: string }
      setEstado(e.code === 'CRM_NAO_HABILITADO'
        ? { tipo: 'indisponivel', mensagem: e.message }
        : { tipo: 'erro', mensagem: e.message || 'Não foi possível carregar o funil.' })
    }
  }, [])

  useEffect(() => {
    carregar()
    const intervalo = setInterval(() => carregar(true), 15_000)
    return () => clearInterval(intervalo)
  }, [carregar])

  useEffect(() => {
    // Mesma rota do painel de detalhamento da inbox: gente da Central, com nome.
    fetch('/api/central/users/')
      .then(r => r.json())
      .then(c => setUsuarios(c?.data ?? []))
      .catch(() => { /* o seletor de responsável fica vazio */ })
  }, [])

  // --------------------------------------------------------------------------
  // Movimento
  // --------------------------------------------------------------------------

  const mover = useCallback(async (negocio: DealUI, estagio: KanbanColumnUI, motivo: string | null) => {
    // Otimista: o card vai já, com o status que a posição impõe.
    setNegocios(atual => atual.map(n => n.id !== negocio.id ? n : {
      ...n,
      stageId:        estagio.id,
      status:         estagio.autoWin ? 'won' : estagio.autoLose ? 'lost' : 'open',
      motivo,
      stageChangedAt: new Date().toISOString(),
      trilha:         n.trilha ?? (estagio.trilha !== 'ambas' ? estagio.trilha : null),
    }))
    try {
      await crmApi.moveDealStage(negocio.id, estagio.id, motivo)
      if (estagio.autoWin)  toast.success(`${negocio.contactName ?? negocio.title}: iniciou tratamento`)
    } catch (err) {
      toast.error((err as Error).message || 'Não foi possível mover o card')
    } finally {
      // O servidor é a verdade: a resposta do move não traz o contato
      // embutido, então relê a lista em vez de mesclar.
      recarregarNegocios().catch(() => {})
    }
  }, [recarregarNegocios])

  const pedirMovimento = useCallback((negocio: DealUI, estagio: KanbanColumnUI) => {
    if (negocio.stageId === estagio.id) return
    if (!podeReceber(estagio, negocio)) {
      toast.error(`“${estagio.title}” é da trilha ${ROTULO_TRILHA[estagio.trilha as 'particular' | 'convenio']}. Troque a trilha do negócio antes.`)
      return
    }
    // Encerrar sempre abre o modal (motivo opcional nas perdas sem
    // obrigação): fechar um negócio é decisão, não arrasto acidental.
    if (estagio.exigeMotivo || estagio.autoLose) {
      setPendente({ negocio, estagio })
      return
    }
    mover(negocio, estagio, null)
  }, [mover])

  const atualizar = useCallback(async (id: string, patch: Record<string, unknown>) => {
    setNegocios(atual => atual.map(n => n.id !== id ? n : {
      ...n,
      ...('trilha'     in patch ? { trilha:  patch.trilha as DealUI['trilha'] } : {}),
      ...('resgate'    in patch ? { resgate: patch.resgate as boolean } : {}),
      ...('assignedTo' in patch ? { ownerId: patch.assignedTo as string | null } : {}),
    }))
    try {
      await crmApi.updateDeal(id, patch)
    } catch (err) {
      toast.error((err as Error).message || 'Não foi possível salvar')
    } finally {
      recarregarNegocios().catch(() => {})
    }
  }, [recarregarNegocios])

  // --------------------------------------------------------------------------
  // Derivados
  // --------------------------------------------------------------------------

  const { andamento, encerrados } = useMemo(() => separarEstagios(estagios), [estagios])
  const colunas   = andamento.filter(e => estagioVisivel(e, trilha))
  const visiveis  = negocios.filter(n => negocioVisivel(n, trilha) && buscaCasa(n, busca))
  const porEstagio = useMemo(() => {
    const mapa = new Map<string, DealUI[]>()
    for (const n of visiveis) {
      const lista = mapa.get(n.stageId) ?? []
      lista.push(n)
      mapa.set(n.stageId, lista)
    }
    // Mais antigo na posição primeiro: é quem está esperando há mais tempo.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => (a.stageChangedAt ?? '').localeCompare(b.stageChangedAt ?? ''))
    }
    return mapa
  }, [visiveis])

  const nomeDoUsuario = (id: string | null) => (id ? usuarios.find(u => u.id === id)?.nome ?? null : null)
  const slugDe = (id: string) => estagios.find(e => e.id === id)?.slug ?? null
  const aberto = abertoId ? negocios.find(n => n.id === abertoId) ?? null : null

  const emAndamento = negocios.filter(n => n.status === 'open').length
  const fechados    = negocios.length - emAndamento

  // --------------------------------------------------------------------------
  // Arrastar e soltar
  // --------------------------------------------------------------------------

  const propsDeAlvo = (estagio: KanbanColumnUI) => {
    const recusa = arrastando !== null && !podeReceber(estagio, arrastando)
    return {
      recusa,
      destacado: alvo === estagio.id && !recusa,
      handlers: {
        onDragOver: (e: React.DragEvent) => {
          if (recusa) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (alvo !== estagio.id) setAlvo(estagio.id)
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setAlvo(null)
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          setAlvo(null)
          const negocio = arrastando
          setArrastando(null)
          if (negocio) pedirMovimento(negocio, estagio)
        },
      },
    }
  }

  const card = (n: DealUI) => (
    <CardNegocio
      key={n.id}
      negocio={n}
      slugEstagio={slugDe(n.stageId)}
      responsavel={nomeDoUsuario(n.ownerId)}
      arrastavel
      aoAbrir={() => setAbertoId(n.id)}
      aoArrastar={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); setArrastando(n) }}
      aoSoltar={() => { setArrastando(null); setAlvo(null) }}
    />
  )

  // --------------------------------------------------------------------------
  // Estados da tela
  // --------------------------------------------------------------------------

  if (estado.tipo === 'carregando') {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    )
  }

  if (estado.tipo === 'indisponivel' || estado.tipo === 'erro') {
    const indisponivel = estado.tipo === 'indisponivel'
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className={`max-w-md rounded-xl border p-6 text-center ${indisponivel ? 'border-amber-500/30 bg-amber-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
          {indisponivel
            ? <PlugZap className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
            : <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" aria-hidden="true" />}
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {indisponivel ? 'O funil ainda não foi ligado' : 'Não foi possível carregar o funil'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{estado.mensagem}</p>
          {!indisponivel && (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { setEstado({ tipo: 'carregando' }); carregar() }}>
              Tentar de novo
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (estagios.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Nenhuma posição de funil configurada para esta organização. Aplique a migration do funil
          (20260930100000) e recarregue.
        </p>
      </div>
    )
  }

  // --------------------------------------------------------------------------
  // Board
  // --------------------------------------------------------------------------

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 flex-col gap-4 px-4 pb-4 pt-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Funil de atendimento</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {emAndamento} em andamento · {fechados} encerrados nos últimos {DIAS_ENCERRADOS} dias
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex rounded-lg border border-border bg-card p-0.5" role="radiogroup" aria-label="Trilha">
            {(['todas', 'particular', 'convenio'] as FiltroTrilha[]).map(t => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={trilha === t}
                onClick={() => setTrilha(t)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 sm:flex-none ${
                  trilha === t ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'todas' ? 'Todas as trilhas' : ROTULO_TRILHA[t]}
              </button>
            ))}
          </div>

          <div className="relative sm:w-60">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome ou telefone"
              aria-label="Buscar no funil"
              className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <Button size="sm" className="h-9" onClick={() => setNovoAberto(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Novo negócio
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto overflow-y-hidden px-4 pb-4 sm:px-6 snap-x snap-mandatory md:snap-none">
        <div className="flex h-full min-w-max gap-3">
          {colunas.map(estagio => {
            const lista = porEstagio.get(estagio.id) ?? []
            const { recusa, destacado, handlers } = propsDeAlvo(estagio)
            return (
              <section
                key={estagio.id}
                aria-label={estagio.title}
                {...handlers}
                className={`flex h-full w-[82vw] max-w-72 snap-start flex-col rounded-xl border bg-card/60 transition-colors sm:w-72 ${
                  destacado ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-border'
                } ${recusa ? 'opacity-40' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5" title={estagio.description ?? undefined}>
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: estagio.color }} aria-hidden="true" />
                      <span className="truncate">{estagio.title}</span>
                    </h2>
                    {estagio.trilha !== 'ambas' && trilha === 'todas' && (
                      <p className="mt-0.5 pl-4 text-[11px] text-muted-foreground">só {ROTULO_TRILHA[estagio.trilha]}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {lista.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2 custom-scrollbar">
                  {lista.map(card)}
                  {lista.length === 0 && estagio.slug === 'novo' && negocios.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Quem escrever pela primeira vez no WhatsApp da Maia aparece aqui.
                    </p>
                  )}
                </div>
              </section>
            )
          })}

          {/* Encerrados — alvo de soltura para fechar, e o que fechou há pouco. */}
          <aside
            aria-label="Encerrados"
            className="z-10 flex h-full w-[82vw] max-w-72 snap-start flex-col rounded-xl border border-border bg-background sm:w-72 md:sticky md:right-0 md:shadow-[-16px_0_16px_-12px_rgba(0,0,0,0.18)]"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Encerrados</h2>
              <span className="ml-auto text-[11px] text-muted-foreground">{DIAS_ENCERRADOS} dias</span>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2 custom-scrollbar">
              {encerrados.filter(e => estagioVisivel(e, trilha)).map(estagio => {
                const lista = porEstagio.get(estagio.id) ?? []
                const { recusa, destacado, handlers } = propsDeAlvo(estagio)
                const expandido = !!expandidos[estagio.id]
                return (
                  <div
                    key={estagio.id}
                    {...handlers}
                    className={`rounded-lg border transition-colors ${
                      destacado
                        ? estagio.autoWin ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-rose-500/60 bg-rose-500/10'
                        : 'border-border bg-card'
                    } ${recusa ? 'opacity-40' : ''} ${arrastando && !recusa ? 'border-dashed' : ''}`}
                  >
                    <button
                      type="button"
                      aria-expanded={expandido}
                      onClick={() => setExpandidos(x => ({ ...x, [estagio.id]: !x[estagio.id] }))}
                      title={estagio.description ?? undefined}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 rounded-lg"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: estagio.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{estagio.title}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{lista.length}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform motion-reduce:transition-none ${expandido ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                    {expandido && (
                      <div className="space-y-2 px-2 pb-2">
                        {lista.length === 0
                          ? <p className="px-1 pb-1 text-xs text-muted-foreground">Nenhum nos últimos {DIAS_ENCERRADOS} dias.</p>
                          : lista.map(card)}
                      </div>
                    )}
                  </div>
                )
              })}
              <p className="px-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                Solte um card aqui para encerrar. Arrastar de volta para uma coluna reabre o negócio.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <GavetaNegocio
        negocio={aberto}
        estagios={estagios}
        usuarios={usuarios}
        aoMover={pedirMovimento}
        aoAtualizar={atualizar}
        aoFechar={() => setAbertoId(null)}
      />

      <MotivoModal
        estagio={pendente?.estagio ?? null}
        negocio={pendente ? (pendente.negocio.contactName ?? pendente.negocio.title) : ''}
        aoCancelar={() => setPendente(null)}
        aoConfirmar={(motivo) => {
          if (pendente) mover(pendente.negocio, pendente.estagio, motivo)
          setPendente(null)
        }}
      />

      <NovoNegocioModal
        aberto={novoAberto}
        aoFechar={() => setNovoAberto(false)}
        aoCriar={() => { recarregarNegocios().catch(() => {}) }}
      />
    </div>
  )
}

export default Kanban
