'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AtSign, CheckCheck, Loader2, Lock, MailOpen, Mail, UserRoundCog, WifiOff, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

import {
  listarMencoes, marcarMencao, marcarTodasComoLidas, quandoRelativo, linkDaConversa,
  type FiltroMencoes, type MencaoVista,
} from '@/lib/central/mencoes-cliente'
import { useMencoesNaoLidas } from '@/hooks/nina/useMencoesNaoLidas'

// ============================================================================
// "Menções a mim" — /connect/mencoes
//
// As notas internas em que alguém da equipe marcou quem está logado. Lida /
// não lida e nada além disso: a conversa se atende no inbox, para onde
// "Abrir conversa" leva (e onde abrir já marca como lida).
// ============================================================================

const ABAS: { id: FiltroMencoes; rotulo: string }[] = [
  { id: 'nao_lidas', rotulo: 'Não lidas' },
  { id: 'lidas',     rotulo: 'Lidas' },
  { id: 'todas',     rotulo: 'Todas' },
]

const VAZIO: Record<FiltroMencoes, string> = {
  nao_lidas: 'Nada pendente. Quando alguém marcar você numa nota interna, aparece aqui.',
  lidas:     'Nenhuma menção lida ainda.',
  todas:     'Ninguém marcou você em nota interna ainda.',
}

const MencoesAMim: React.FC = () => {
  const naoLidas = useMencoesNaoLidas()
  const [aba, setAba] = useState<FiltroMencoes>('nao_lidas')
  const [mencoes, setMencoes] = useState<MencaoVista[]>([])
  const [temMais, setTemMais] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [marcandoTodas, setMarcandoTodas] = useState(false)

  const carregar = useCallback(async (filtro: FiltroMencoes, signal?: AbortSignal) => {
    try {
      const r = await listarMencoes(filtro, { signal })
      setMencoes(r.mencoes)
      setTemMais(r.temMais)
      setErro(null)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setCarregando(true)
    void carregar(aba, controller.signal)
    return () => controller.abort()
  }, [aba, carregar])

  // Uma menção nova (o contador do menu mudou) ou a volta à aba trazem a lista
  // atualizada sem F5. O número muda sozinho a cada 30s; a lista acompanha.
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') void carregar(aba) }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => document.removeEventListener('visibilitychange', aoVoltar)
  }, [aba, carregar])

  const contagemAnterior = useRef(naoLidas)
  useEffect(() => {
    if (contagemAnterior.current === naoLidas) return
    contagemAnterior.current = naoLidas
    void carregar(aba)
  }, [naoLidas, aba, carregar])

  const carregarMais = async () => {
    const ultima = mencoes.at(-1)
    if (!ultima || carregandoMais) return
    setCarregandoMais(true)
    try {
      const r = await listarMencoes(aba, { antesDe: ultima.criadaEm })
      setMencoes(atual => [...atual, ...r.mencoes.filter(m => !atual.some(a => a.id === m.id))])
      setTemMais(r.temMais)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCarregandoMais(false)
    }
  }

  // Otimista: a linha muda na hora e volta atrás se o servidor recusar. Na aba
  // "Não lidas", a menção marcada como lida sai da lista.
  const alternar = async (m: MencaoVista) => {
    const lida = !m.lida
    const antes = mencoes
    setMencoes(atual => {
      const trocada = atual.map(x => x.id === m.id ? { ...x, lida, lidaEm: lida ? new Date().toISOString() : null } : x)
      if (aba === 'nao_lidas' && lida) return trocada.filter(x => x.id !== m.id)
      if (aba === 'lidas' && !lida)    return trocada.filter(x => x.id !== m.id)
      return trocada
    })
    try {
      await marcarMencao(m.id, lida)
    } catch (e) {
      setMencoes(antes)
      toast.error((e as Error).message)
    }
  }

  const marcarTodas = async () => {
    setMarcandoTodas(true)
    try {
      await marcarTodasComoLidas()
      toast.success('Todas as menções foram marcadas como lidas.')
      await carregar(aba)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMarcandoTodas(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <header className="px-4 sm:px-6 pt-6 pb-4 border-b border-border shrink-0">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <AtSign className="w-5 h-5 text-amber-500" aria-hidden />
              Menções a mim
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Notas internas em que alguém da equipe marcou você. O contato não vê nada disto.
            </p>
          </div>
          {naoLidas > 0 && (
            <button
              type="button"
              onClick={() => void marcarTodas()}
              disabled={marcandoTodas}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {marcandoTodas ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              Marcar todas como lidas
            </button>
          )}
        </div>

        <div role="tablist" aria-label="Filtrar menções" className="mt-4 inline-flex rounded-lg border border-border bg-muted p-0.5 text-sm font-medium">
          {ABAS.map(a => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              onClick={() => setAba(a.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
                aba === a.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {a.rotulo}
              {a.id === 'nao_lidas' && naoLidas > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white tabular-nums">
                  {naoLidas > 99 ? '99+' : naoLidas}
                </span>
              )}
            </button>
          ))}
        </div>

        {erro && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            {erro}
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 py-5">
        {carregando ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground/70">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Carregando…
          </div>
        ) : mencoes.length === 0 ? (
          !erro && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <AtSign className="w-10 h-10 mb-3 opacity-30" aria-hidden />
              <p className="text-sm max-w-sm">{VAZIO[aba]}</p>
            </div>
          )
        ) : (
          <ul className="mx-auto max-w-3xl space-y-2.5">
            {mencoes.map(m => (
              <CartaoMencao key={m.id} mencao={m} aoAlternar={() => void alternar(m)} />
            ))}
            {temMais && (
              <li className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => void carregarMais()}
                  disabled={carregandoMais}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:cursor-wait"
                >
                  {carregandoMais && <Loader2 className="w-4 h-4 animate-spin" />}
                  Carregar mais
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

const CartaoMencao: React.FC<{ mencao: MencaoVista; aoAlternar: () => void }> = ({ mencao: m, aoAlternar }) => (
  <li
    className={`rounded-xl border px-4 py-3 transition-colors ${
      m.lida
        ? 'border-border bg-card'
        : 'border-amber-300 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/5'
    }`}
  >
    <div className="flex items-start gap-3">
      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-200 text-sm font-semibold text-amber-900">
          {m.autor.nome.charAt(0).toUpperCase()}
        </div>
        {!m.lida && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-background" aria-label="Não lida" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className={`text-sm ${m.lida ? 'text-foreground' : 'font-medium text-foreground'}`}>
            {m.deMim
              ? <>Você se marcou na conversa com </>
              : <><strong className="font-semibold">{m.autor.nome}</strong> mencionou você na conversa com </>}
            <strong className="font-semibold">{m.contato}</strong>
          </p>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums" title={new Date(m.criadaEm).toLocaleString('pt-BR')}>
            {quandoRelativo(m.criadaEm)}
          </span>
        </div>

        <p className="mt-1.5 flex gap-1.5 rounded-lg bg-background/70 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <span className="min-w-0 line-clamp-3 whitespace-pre-wrap break-words">{m.trecho}</span>
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {m.delegadaAMim && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-200/70 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
              <UserRoundCog className="w-3.5 h-3.5" aria-hidden />
              Conversa delegada a você
            </span>
          )}
          {m.conversaEncerrada && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">Conversa encerrada</span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={aoAlternar}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {m.lida ? <Mail className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
              {m.lida ? 'Marcar como não lida' : 'Marcar como lida'}
            </button>
            <Link
              href={linkDaConversa(m.conversationId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition-colors"
            >
              Abrir conversa
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  </li>
)

export default MencoesAMim
