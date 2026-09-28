'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X, Loader2, MessageSquare, Phone, Bot, RotateCcw, FileText, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { crmApi } from '@/services/crm/client'
import type { DealUI, DealActivityUI, KanbanColumnUI } from '@/services/crm/adapter'
import type { TrilhaNegocio } from '@/modules/comercial/types/crm.types'
import type { TagDefinition } from '@/modules/atendimento/types/central.types'
import { Button } from '@/components/nina/Button'
import { BlocoTags } from '@/components/nina/detalhamento/BlocoTags'
import { TagChip } from '@/components/central/shared/TagChip'
import { ROTULO_TRILHA, podeReceber, separarEstagios, tempoNaPosicao } from './funil'

// ============================================================================
// Gaveta do negócio — abre ao clicar no card.
//
// Tudo o que se decide sobre UM negócio: posição, trilha, resgate,
// responsável, anotações e as últimas mensagens da conversa de origem.
//
// Mudança de posição NÃO é feita aqui: sobe para o board (aoMover), que é
// quem pede o motivo quando a posição exige — um caminho só para as duas
// formas de mover (arrastar e escolher), para as regras não divergirem.
// ============================================================================

interface Usuario { id: string; nome: string }

interface MensagemCentral {
  id:         string
  direction:  'inbound' | 'outbound'
  body:       string | null
  sent_by_ai: boolean
  created_at: string
}

// O que a gaveta lê da Central sobre a pessoa. As tags moram em DOIS lugares:
// no contato (as que a equipe marca — editáveis aqui, as mesmas do painel da
// inbox) e na conversa (as que a Maia aplica — só leitura aqui, porque a Maia
// reescreve as dela a cada turno). O funil lê as duas
// (20260930110000_crm_funil_tags_do_contato).
interface DadosCentral {
  tagsContato:  string[]
  tagsMaia:     string[]
  mensagens:    MensagemCentral[]
}

export const GavetaNegocio: React.FC<{
  negocio:    DealUI | null
  estagios:   KanbanColumnUI[]
  usuarios:   Usuario[]
  catalogoTags: TagDefinition[]
  aoMover:    (negocio: DealUI, estagio: KanbanColumnUI) => void
  aoAtualizar: (id: string, patch: Record<string, unknown>) => Promise<void>
  // As tags podem mudar a trilha e a posição (gatilho no banco): o board
  // precisa reler os negócios depois de gravar.
  aoTagsGravadas: () => void
  aoFechar:   () => void
}> = ({ negocio, estagios, usuarios, catalogoTags, aoMover, aoAtualizar, aoTagsGravadas, aoFechar }) => {
  const [atividades, setAtividades] = useState<DealActivityUI[]>([])
  const [carregandoAtividades, setCarregandoAtividades] = useState(false)
  const [central, setCentral] = useState<DadosCentral | null>(null)
  const [carregandoCentral, setCarregandoCentral] = useState(false)
  const [nota, setNota] = useState('')
  const [salvandoNota, setSalvandoNota] = useState(false)

  const id = negocio?.id ?? null
  const conversa = negocio?.conversationId ?? null
  const contato = negocio?.contactId ?? null

  const carregarAtividades = useCallback(async (dealId: string) => {
    setCarregandoAtividades(true)
    try {
      setAtividades(await crmApi.fetchDealActivities(dealId))
    } catch {
      setAtividades([])
    } finally {
      setCarregandoAtividades(false)
    }
  }, [])

  // A timeline muda a cada movimento, e o movimento acontece fora daqui (o
  // board). Recarregar quando a POSIÇÃO muda mantém a gaveta aberta em dia.
  useEffect(() => {
    if (id) carregarAtividades(id)
  }, [id, negocio?.stageId, negocio?.status, carregarAtividades])

  // Uma chamada traz as duas listas de tags e as mensagens: a rota da conversa
  // já devolve o contato embutido. Sem conversa (negócio cadastrado à mão),
  // lê só o contato.
  const carregarCentral = useCallback(async (signal?: AbortSignal) => {
    if (!conversa && !contato) { setCentral(null); return }
    setCarregandoCentral(true)
    try {
      if (conversa) {
        const r = await fetch(`/api/central/conversations/${conversa}/`, { signal })
        const corpo = await r.json()
        if (!r.ok) throw new Error(corpo?.error?.message)
        const d = corpo?.data ?? {}
        const mensagens = ((d.recentMessages ?? []) as MensagemCentral[])
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(-15)
        setCentral({ tagsContato: d.contact?.tags ?? [], tagsMaia: d.tags ?? [], mensagens })
      } else {
        const r = await fetch(`/api/central/contacts/${contato}/`, { signal })
        const corpo = await r.json()
        if (!r.ok) throw new Error(corpo?.error?.message)
        setCentral({ tagsContato: corpo?.data?.tags ?? [], tagsMaia: [], mensagens: [] })
      }
    } catch {
      if (!signal?.aborted) setCentral(null)
    } finally {
      if (!signal?.aborted) setCarregandoCentral(false)
    }
  }, [conversa, contato])

  useEffect(() => {
    const controller = new AbortController()
    carregarCentral(controller.signal)
    return () => controller.abort()
  }, [carregarCentral])

  const salvarTags = async (chaves: string[]) => {
    if (!contato) return
    try {
      const r = await fetch(`/api/central/contacts/${contato}/`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tags: chaves }),
      })
      if (!r.ok) {
        const corpo = await r.json().catch(() => null)
        throw new Error(corpo?.error?.message ?? `A gravação falhou com ${r.status}.`)
      }
      await carregarCentral()
      aoTagsGravadas()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const mensagens = central?.mensagens ?? []
  const carregandoMensagens = carregandoCentral && !central

  useEffect(() => { setNota('') }, [id])

  if (!negocio) return null

  const estagioAtual = estagios.find(e => e.id === negocio.stageId) ?? null
  const { andamento, encerrados } = separarEstagios(estagios)
  const nome = negocio.contactName?.trim() || negocio.title

  const escolherPosicao = (estagioId: string) => {
    const destino = estagios.find(e => e.id === estagioId)
    if (destino && destino.id !== negocio.stageId) aoMover(negocio, destino)
  }

  // Trilha incompatível com a posição atual fica desabilitada: trocar para
  // Particular um card parado em "Aguardando elegibilidade" deixaria o funil
  // afirmando duas coisas contrárias.
  const trilhaTravada = estagioAtual && estagioAtual.trilha !== 'ambas' ? estagioAtual.trilha : null

  const salvarNota = async () => {
    const texto = nota.trim()
    if (!texto) return
    setSalvandoNota(true)
    try {
      await crmApi.createDealActivity(negocio.id, { type: 'note', title: texto })
      setNota('')
      await carregarAtividades(negocio.id)
    } catch (err) {
      toast.error((err as Error).message || 'Não foi possível salvar a anotação')
    } finally {
      setSalvandoNota(false)
    }
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(aberto) => { if (!aberto) aoFechar() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:animate-none"
        >
          {/* Cabeçalho */}
          <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-xl font-bold text-foreground">{nome}</DialogPrimitive.Title>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {negocio.contactPhone && (
                  <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{negocio.contactPhone}</span>
                )}
                {estagioAtual && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: estagioAtual.color }} aria-hidden="true" />
                    {estagioAtual.title}
                    {tempoNaPosicao(negocio.stageChangedAt) && <span className="text-muted-foreground/70">· {tempoNaPosicao(negocio.stageChangedAt)}</span>}
                  </span>
                )}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Campos do negócio */}
            <section className="grid grid-cols-1 gap-4 border-b border-border px-6 py-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                Posição no funil
                <select
                  value={negocio.stageId}
                  onChange={(e) => escolherPosicao(e.target.value)}
                  className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <optgroup label="Em andamento">
                    {andamento.map(e => (
                      <option key={e.id} value={e.id} disabled={!podeReceber(e, negocio)}>
                        {e.title}{e.trilha !== 'ambas' ? ` (${ROTULO_TRILHA[e.trilha]})` : ''}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Encerrar">
                    {encerrados.map(e => (
                      <option key={e.id} value={e.id} disabled={!podeReceber(e, negocio)}>
                        {e.title}{e.trilha !== 'ambas' ? ` (${ROTULO_TRILHA[e.trilha]})` : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Trilha</legend>
                <div className="flex rounded-lg border border-border bg-card p-0.5" role="radiogroup">
                  {([null, 'particular', 'convenio'] as (TrilhaNegocio | null)[]).map(t => {
                    const ativo = negocio.trilha === t
                    const travado = trilhaTravada !== null && t !== trilhaTravada
                    return (
                      <button
                        key={t ?? 'nenhuma'}
                        type="button"
                        role="radio"
                        aria-checked={ativo}
                        disabled={travado}
                        title={travado ? `A posição atual é da trilha ${ROTULO_TRILHA[trilhaTravada!]}` : undefined}
                        onClick={() => { if (!ativo) aoAtualizar(negocio.id, { trilha: t }) }}
                        className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:opacity-40 ${
                          ativo ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t ? ROTULO_TRILHA[t] : 'A definir'}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Responsável
                <select
                  value={negocio.ownerId ?? ''}
                  onChange={(e) => aoAtualizar(negocio.id, { assignedTo: e.target.value || null })}
                  className="h-[38px] rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Sem responsável</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </label>

              <label className="flex items-center gap-2.5 text-sm text-foreground sm:col-span-2">
                <input
                  type="checkbox"
                  checked={negocio.resgate}
                  onChange={(e) => aoAtualizar(negocio.id, { resgate: e.target.checked })}
                  className="h-4 w-4 rounded border-border accent-violet-600"
                />
                <RotateCcw className="h-3.5 w-3.5 text-violet-500" aria-hidden="true" />
                Resgate
                <span className="text-xs text-muted-foreground">lead antigo reativado por campanha</span>
              </label>

              {(negocio.motivo || negocio.closedReason) && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 sm:col-span-2">
                  <p className="text-[11px] font-medium text-muted-foreground">Motivo</p>
                  <p className="text-sm text-foreground">{negocio.motivo || negocio.closedReason}</p>
                </div>
              )}

              {conversa && (
                <a
                  href={`/connect/inbox/?c=${conversa}`}
                  className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 sm:col-span-2"
                >
                  <MessageSquare className="h-4 w-4 text-cyan-500" aria-hidden="true" />
                  Abrir a conversa
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </a>
              )}
            </section>

            {/* Tags — a taxonomia da planilha (13 grupos). As da equipe são
                as mesmas do painel da inbox; as da Maia, só leitura. */}
            {contato && (
              <section className="space-y-4 border-b border-border px-6 py-5">
                {carregandoCentral && !central ? (
                  <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" /></div>
                ) : (
                  <>
                    <BlocoTags
                      tags={central?.tagsContato ?? []}
                      catalogo={catalogoTags}
                      aoSalvar={central ? salvarTags : undefined}
                    />
                    {(() => {
                      const soDaMaia = (central?.tagsMaia ?? []).filter(t => !(central?.tagsContato ?? []).includes(t))
                      if (soDaMaia.length === 0) return null
                      const porChave = new Map(catalogoTags.map(t => [t.key, t]))
                      return (
                        <div>
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                            <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Classificação da Maia nesta conversa
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {soDaMaia.map(chave => (
                              <TagChip key={chave} rotulo={porChave.get(chave)?.label ?? chave} cor={porChave.get(chave)?.color ?? null} />
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </section>
            )}

            {/* Anotação + histórico */}
            <section className="border-b border-border px-6 py-5">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Histórico</h3>
              <div className="overflow-hidden rounded-lg border border-border bg-card focus-within:ring-1 focus-within:ring-cyan-500/50">
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvarNota() }}
                  rows={2}
                  placeholder="Anotar algo sobre este negócio…"
                  aria-label="Nova anotação"
                  className="w-full resize-none bg-transparent p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />
                <div className="flex justify-end border-t border-border bg-background px-3 py-2">
                  <Button size="sm" onClick={salvarNota} disabled={!nota.trim() || salvandoNota}>
                    {salvandoNota ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Anotar'}
                  </Button>
                </div>
              </div>

              {carregandoAtividades && atividades.length === 0 ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" /></div>
              ) : atividades.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {atividades.map(a => (
                    <li key={a.id} className="flex gap-3">
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${a.type === 'note' ? 'bg-cyan-500/10 text-cyan-600' : 'bg-muted text-muted-foreground'}`}>
                        {a.createdByAi ? <Bot className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{a.title}</p>
                        {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                          {a.createdAt ? new Date(a.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          {a.createdByAi ? ' · automático' : a.createdBy ? ` · ${usuarios.find(u => u.id === a.createdBy)?.nome ?? 'equipe'}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Últimas mensagens */}
            {conversa && (
              <section className="px-6 py-5">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Últimas mensagens</h3>
                {carregandoMensagens ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" /></div>
                ) : mensagens.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Sem mensagens para mostrar.</p>
                ) : (
                  <div className="space-y-2">
                    {mensagens.map(m => (
                      <div
                        key={m.id}
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                          m.direction === 'inbound'
                            ? 'mr-auto bg-muted text-foreground'
                            : 'ml-auto bg-cyan-500/10 text-foreground'
                        }`}
                      >
                        <p className="mb-0.5 text-[10px] text-muted-foreground">
                          {m.direction === 'inbound' ? 'Família' : m.sent_by_ai ? 'Maia' : 'Equipe'}
                          {' · '}
                          {new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="line-clamp-4 whitespace-pre-line">{m.body || '[mídia]'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
