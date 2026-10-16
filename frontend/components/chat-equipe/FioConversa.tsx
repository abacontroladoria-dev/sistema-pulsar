'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, Loader2, Paperclip } from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  EVENTO_CHAT_LEITURA, EVENTO_CHAT_MENSAGEM, EVENTO_CHAT_MENSAGEM_ALTERADA, POR_PAGINA,
  apagarMensagem, buscarMensagens, editarMensagem, enviarMensagem, listarLeituras, listarMensagens,
  marcarConversaLida, reagir,
  type AnexoChat, type ConversaLista, type LeituraChat, type MensagemChat,
} from '@/lib/chat/cliente'
import { useOnline } from '@/lib/chat/presenca'
import { getSupabaseClient } from '@/lib/supabase/client'
import BolhaMensagem, { type Bolha } from './BolhaMensagem'
import Compositor, { type CompositorApi } from './Compositor'

// ============================================================================
// Um fio do Chat da equipe.
//
// Mensagem nova, edição, reação e apagamento chegam pelo tempo real (o provider
// repassa como eventos da janela); um repique a cada 20s com a aba visível
// cobre o canal que caiu sem avisar, e voltar à aba relê a última página. Ler
// = fio aberto com a aba visível: marca como lido ao abrir, ao chegar mensagem
// e ao voltar à aba.
//
// "Visto" é o lido_ate da outra pessoa (tempo real de chat_membros).
// "digitando…" e a bolinha de online não passam pelo banco: broadcast e
// presença do Realtime.
//
// Envio otimista: o balão aparece na hora como "enviando" e é trocado pelo
// gravado. Se falhar, sai do fio e o texto e os anexos voltam para o campo.
// ============================================================================

const REPIQUE_MS = 20_000
const DIGITANDO_MS = 5_000
const AVISO_DIGITANDO_MS = 2_500
const AGRUPAR_MS = 5 * 60_000

interface Props {
  conversa: Pick<ConversaLista, 'id' | 'outro_id' | 'outro_nome' | 'outro_ativo'>
  euId:     string
  aoVoltar: () => void
}

export default function FioConversa({ conversa, euId, aoVoltar }: Props) {
  const [mensagens, setMensagens] = useState<Bolha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [temAnteriores, setTemAnteriores] = useState(false)
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [lidoOutro, setLidoOutro] = useState<string | null>(null)
  const [divisorId, setDivisorId] = useState<string | null>(null)
  const [citadasFora, setCitadasFora] = useState<Record<string, MensagemChat | null>>({})
  const [respondendo, setRespondendo] = useState<MensagemChat | null>(null)
  const [editando, setEditando] = useState<MensagemChat | null>(null)
  const [apagando, setApagando] = useState<MensagemChat | null>(null)
  const [ativaId, setAtivaId] = useState<string | null>(null)
  const [destacadaId, setDestacadaId] = useState<string | null>(null)
  const [digitando, setDigitando] = useState(false)
  const [noFim, setNoFim] = useState(true)
  const [novasAbaixo, setNovasAbaixo] = useState(0)
  const [arrastando, setArrastando] = useState(false)

  const rolagemRef = useRef<HTMLDivElement>(null)
  const compositorRef = useRef<CompositorApi>(null)
  // Rolar para o fim só quando quem lê já está no fim — senão uma mensagem nova
  // arrancaria a pessoa do trecho antigo que ela está lendo.
  const colarNoFim = useRef(true)
  const rolarPara = useRef<string | null>(null)
  const preservarAltura = useRef<number | null>(null)
  const mensagensRef = useRef<Bolha[]>([])
  useEffect(() => { mensagensRef.current = mensagens }, [mensagens])

  const id = conversa.id
  const primeiroNome = conversa.outro_nome.split(' ')[0]
  const online = useOnline()
  const outroOnline = !!conversa.outro_id && online.has(conversa.outro_id)

  const nomeDe = useCallback((uid: string) => (uid === euId ? 'Você' : conversa.outro_nome), [euId, conversa.outro_nome])

  const marcarLida = useCallback(() => {
    if (document.visibilityState === 'visible') void marcarConversaLida(id)
  }, [id])

  const aplicarLeituras = useCallback((leituras: LeituraChat[]) => {
    const outro = leituras.find(l => l.usuario_id !== euId)
    if (outro?.lido_ate) setLidoOutro(atual => (atual && atual > outro.lido_ate! ? atual : outro.lido_ate))
  }, [euId])

  // Abrir o fio: mensagens e leituras juntas — o lido_ate de quem abre, ANTES
  // de marcar como lido, é o que põe a faixa "Novas mensagens" no lugar certo.
  useEffect(() => {
    let vivo = true
    Promise.all([listarMensagens(id), listarLeituras(id)])
      .then(([lista, leituras]) => {
        if (!vivo) return
        setMensagens(lista)
        setTemAnteriores(lista.length === POR_PAGINA)
        setErro(null)
        aplicarLeituras(leituras)
        const meuLido = leituras.find(l => l.usuario_id === euId)?.lido_ate ?? null
        const primeira = lista.find(m => m.autor_id !== euId && !m.apagada_em && (!meuLido || m.criada_em > meuLido))
        setDivisorId(primeira?.id ?? null)
        rolarPara.current = primeira?.id ?? null
        colarNoFim.current = !primeira
        marcarLida()
      })
      .catch(e => { if (vivo) setErro((e as Error).message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [id, euId, marcarLida, aplicarLeituras])

  const mesclar = useCallback((novas: MensagemChat[]) => {
    if (novas.length === 0) return
    setMensagens(atual => {
      const porId = new Map(novas.map(m => [m.id, m]))
      const trocadas = atual.map(m => porId.get(m.id) ?? m)
      const ids = new Set(atual.map(m => m.id))
      const ineditas = novas.filter(m => !ids.has(m.id))
      return ineditas.length
        ? [...trocadas, ...ineditas].sort((a, b) => a.criada_em.localeCompare(b.criada_em))
        : trocadas
    })
    setCitadasFora(atual => {
      const toca = novas.filter(m => m.id in atual)
      if (toca.length === 0) return atual
      const copia = { ...atual }
      toca.forEach(m => { copia[m.id] = m })
      return copia
    })
  }, [])

  // Tempo real + repique + voltar à aba.
  useEffect(() => {
    const aoChegar = (e: Event) => {
      const m = (e as CustomEvent<MensagemChat>).detail
      if (!m || m.conversa_id !== id) return
      const jaTinha = mensagensRef.current.some(x => x.id === m.id)
      mesclar([m])
      if (m.autor_id !== euId) {
        setDigitando(false)
        marcarLida()
        if (!jaTinha && !colarNoFim.current) setNovasAbaixo(n => n + 1)
      }
    }
    const aoAlterar = (e: Event) => {
      const m = (e as CustomEvent<MensagemChat>).detail
      if (m?.conversa_id === id) mesclar([m])
    }
    const aoLer = (e: Event) => {
      const l = (e as CustomEvent<LeituraChat>).detail
      if (l?.conversa_id === id) aplicarLeituras([l])
    }
    const repicar = async () => {
      if (document.visibilityState !== 'visible') return
      const ultima = mensagensRef.current.filter(m => !m.enviando).at(-1)
      try {
        const [novas, leituras] = await Promise.all([
          listarMensagens(id, ultima ? { depoisDe: ultima.criada_em } : {}),
          listarLeituras(id),
        ])
        mesclar(novas)
        aplicarLeituras(leituras)
        if (novas.some(m => m.autor_id !== euId)) marcarLida()
      } catch { /* o próximo repique tenta de novo */ }
    }
    // Na volta à aba relê a última página inteira: pega também o que foi
    // editado, apagado ou reagido enquanto o canal podia estar dormindo.
    const aoVoltarAba = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const [ultimas, leituras] = await Promise.all([listarMensagens(id), listarLeituras(id)])
        mesclar(ultimas)
        aplicarLeituras(leituras)
      } catch { /* o repique tenta de novo */ }
      marcarLida()
    }

    window.addEventListener(EVENTO_CHAT_MENSAGEM, aoChegar)
    window.addEventListener(EVENTO_CHAT_MENSAGEM_ALTERADA, aoAlterar)
    window.addEventListener(EVENTO_CHAT_LEITURA, aoLer)
    document.addEventListener('visibilitychange', aoVoltarAba)
    const t = setInterval(repicar, REPIQUE_MS)
    return () => {
      window.removeEventListener(EVENTO_CHAT_MENSAGEM, aoChegar)
      window.removeEventListener(EVENTO_CHAT_MENSAGEM_ALTERADA, aoAlterar)
      window.removeEventListener(EVENTO_CHAT_LEITURA, aoLer)
      document.removeEventListener('visibilitychange', aoVoltarAba)
      clearInterval(t)
    }
  }, [id, euId, mesclar, marcarLida, aplicarLeituras])

  // "digitando…": broadcast do Realtime, sem banco. Um aviso a cada 2,5s no
  // máximo enquanto se digita; some 5s depois do último.
  const canalRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null>(null)
  const ultimoAviso = useRef(0)
  useEffect(() => {
    const supabase = getSupabaseClient()
    let apagar: ReturnType<typeof setTimeout> | null = null
    const canal = supabase
      .channel(`chat-digitando:${id}`)
      .on('broadcast', { event: 'digitando' }, ({ payload }) => {
        if (payload?.usuario_id === euId) return
        setDigitando(true)
        if (apagar) clearTimeout(apagar)
        apagar = setTimeout(() => setDigitando(false), DIGITANDO_MS)
      })
      .subscribe()
    canalRef.current = canal
    return () => {
      if (apagar) clearTimeout(apagar)
      canalRef.current = null
      supabase.removeChannel(canal)
    }
  }, [id, euId])

  const avisarDigitando = useCallback(() => {
    const agora = Date.now()
    if (agora - ultimoAviso.current < AVISO_DIGITANDO_MS) return
    ultimoAviso.current = agora
    void canalRef.current?.send({ type: 'broadcast', event: 'digitando', payload: { usuario_id: euId } })
  }, [euId])

  // Citações de mensagens que não estão carregadas (resposta a algo antigo).
  useEffect(() => {
    const carregadas = new Set(mensagens.map(m => m.id))
    const faltam = [...new Set(mensagens.map(m => m.responde_a).filter((x): x is string => !!x))]
      .filter(x => !carregadas.has(x) && !(x in citadasFora))
    if (faltam.length === 0) return
    let vivo = true
    buscarMensagens(faltam).then(achadas => {
      if (!vivo) return
      setCitadasFora(atual => {
        const copia = { ...atual }
        faltam.forEach(x => { copia[x] = achadas.find(a => a.id === x) ?? null })
        return copia
      })
    })
    return () => { vivo = false }
  }, [mensagens, citadasFora])

  // Posição da rolagem depois de cada mudança na lista.
  useLayoutEffect(() => {
    const el = rolagemRef.current
    if (!el) return
    if (preservarAltura.current !== null) {
      // "Carregar anteriores": mantém na tela a mensagem que estava no topo.
      el.scrollTop = el.scrollHeight - preservarAltura.current
      preservarAltura.current = null
    } else if (rolarPara.current) {
      // Ao abrir com não lidas: a faixa "Novas mensagens" perto do topo.
      const alvo = el.querySelector<HTMLElement>('[data-divisor-novas]')
      if (alvo) el.scrollTop = Math.max(0, alvo.offsetTop - 56)
      rolarPara.current = null
    } else if (colarNoFim.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [mensagens, digitando])

  // Conteúdo que cresce sozinho (imagem que termina de carregar, reação nova)
  // ou área que encolhe
  // não pode tirar do fim quem estava no fim.
  const conteudoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rolagemRef.current
    const conteudo = conteudoRef.current
    if (!el || !conteudo) return
    const obs = new ResizeObserver(() => { if (colarNoFim.current) el.scrollTop = el.scrollHeight })
    obs.observe(conteudo)
    obs.observe(el) // a faixa "Respondendo a" e os anexos encolhem a área do fio
    return () => obs.disconnect()
  }, [carregando])

  const aoRolar = () => {
    const el = rolagemRef.current
    if (!el) return
    const fim = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    colarNoFim.current = fim
    if (fim !== noFim) setNoFim(fim)
    if (fim && novasAbaixo) setNovasAbaixo(0)
  }

  const irAoFim = () => {
    const el = rolagemRef.current
    if (!el) return
    colarNoFim.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setNovasAbaixo(0)
  }

  const irPara = (alvoId: string) => {
    const alvo = document.getElementById(`msg-${alvoId}`)
    if (!alvo) {
      toast('Essa mensagem é mais antiga. Use "Carregar anteriores" no topo do fio.')
      return
    }
    alvo.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    setDestacadaId(alvoId)
    setTimeout(() => setDestacadaId(atual => (atual === alvoId ? null : atual)), 1600)
  }

  const carregarAnteriores = async () => {
    const primeira = mensagens.find(m => !m.enviando)
    if (!primeira || carregandoAnteriores) return
    setCarregandoAnteriores(true)
    try {
      const lista = await listarMensagens(id, { antesDe: primeira.criada_em })
      const el = rolagemRef.current
      preservarAltura.current = el ? el.scrollHeight - el.scrollTop : null
      setMensagens(atual => [...lista.filter(m => !atual.some(a => a.id === m.id)), ...atual])
      setTemAnteriores(lista.length === POR_PAGINA)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCarregandoAnteriores(false)
    }
  }

  // ── Ações ────────────────────────────────────────────────────────────────
  const enviar = async (corpo: string, anexos: AnexoChat[]): Promise<boolean> => {
    const provisoria: Bolha = {
      id: `enviando-${crypto.randomUUID()}`, conversa_id: id, autor_id: euId, corpo,
      criada_em: new Date().toISOString(), responde_a: respondendo?.id ?? null,
      editada_em: null, apagada_em: null, reacoes: {}, anexos, enviando: true,
    }
    const respondeA = respondendo?.id ?? null
    colarNoFim.current = true
    setDivisorId(null)
    setRespondendo(null)
    setMensagens(atual => [...atual, provisoria])
    try {
      const gravada = await enviarMensagem(id, corpo, { respondeA, anexos })
      // O tempo real pode ter entregado a gravada antes da resposta da RPC.
      setMensagens(atual => atual.some(m => m.id === gravada.id)
        ? atual.filter(m => m.id !== provisoria.id)
        : atual.map(m => (m.id === provisoria.id ? gravada : m)))
      return true
    } catch (e) {
      setMensagens(atual => atual.filter(m => m.id !== provisoria.id))
      if (respondeA) setRespondendo(mensagensRef.current.find(m => m.id === respondeA) ?? null)
      toast.error((e as Error).message)
      return false
    }
  }

  const salvarEdicao = async (m: MensagemChat, corpo: string): Promise<boolean> => {
    if (corpo === m.corpo) return true
    const antes = m
    mesclar([{ ...m, corpo, editada_em: new Date().toISOString() }])
    try {
      mesclar([await editarMensagem(m.id, corpo)])
      return true
    } catch (e) {
      mesclar([antes])
      toast.error((e as Error).message)
      return false
    }
  }

  const alternarReacao = useCallback(async (m: MensagemChat, emoji: string) => {
    const quem = m.reacoes[emoji] ?? []
    const lista = quem.includes(euId) ? quem.filter(x => x !== euId) : [...quem, euId]
    const reacoes = { ...m.reacoes }
    if (lista.length) reacoes[emoji] = lista
    else delete reacoes[emoji]
    mesclar([{ ...m, reacoes }])
    try {
      mesclar([await reagir(m.id, emoji)])
    } catch (e) {
      mesclar([m])
      toast.error((e as Error).message)
    }
  }, [euId, mesclar])

  const confirmarApagar = async () => {
    const m = apagando
    setApagando(null)
    if (!m) return
    if (editando?.id === m.id) setEditando(null)
    if (respondendo?.id === m.id) setRespondendo(null)
    try {
      mesclar([await apagarMensagem(m)])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const editarUltima = () => {
    const minha = [...mensagens].reverse().find(m => m.autor_id === euId && !m.apagada_em && !m.enviando)
    if (minha) { setRespondendo(null); setEditando(minha) }
  }

  // ── Arrastar arquivo sobre o fio ────────────────────────────────────────
  const temArquivo = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
  const podeAnexar = conversa.outro_ativo && !editando

  // Toque fora de um balão desliga a barra de ações (celular).
  const aoTocarFio = (e: React.MouseEvent) => {
    if (ativaId && !(e.target as HTMLElement).closest('[role="toolbar"], [id^="msg-"]')) setAtivaId(null)
  }

  // Agrupa por dia (a pílula fica presa no topo enquanto o dia passa).
  const dias = useMemo(() => {
    const grupos: { chave: string; iso: string; itens: Bolha[] }[] = []
    for (const m of mensagens) {
      const chave = new Date(m.criada_em).toDateString()
      const g = grupos.at(-1)
      if (g && g.chave === chave) g.itens.push(m)
      else grupos.push({ chave, iso: m.criada_em, itens: [m] })
    }
    return grupos
  }, [mensagens])

  const porId = useMemo(() => new Map(mensagens.map(m => [m.id, m])), [mensagens])

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragEnter={e => { if (podeAnexar && temArquivo(e)) { e.preventDefault(); setArrastando(true) } }}
      onDragOver={e => { if (podeAnexar && temArquivo(e)) e.preventDefault() }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false) }}
      onDrop={e => {
        if (!podeAnexar || !temArquivo(e)) return
        e.preventDefault()
        setArrastando(false)
        compositorRef.current?.adicionar(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
        <button
          type="button"
          onClick={aoVoltar}
          aria-label="Voltar para as conversas"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar nome={conversa.outro_nome} pequeno online={outroOnline} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{conversa.outro_nome}</p>
          <p className={`truncate text-[11px] ${digitando ? 'text-cyan-700 dark:text-cyan-300' : 'text-muted-foreground'}`} aria-live="polite">
            {digitando ? 'digitando…' : !conversa.outro_ativo ? 'Não está mais ativo' : outroOnline ? 'Online' : ''}
          </p>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={rolagemRef}
          onScroll={aoRolar}
          onClick={aoTocarFio}
          className="h-full overflow-y-auto px-3 pb-3"
        >
          {carregando ? (
            <div className="flex justify-center py-10 text-muted-foreground/70">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : erro ? (
            <p className="py-10 text-center text-sm text-rose-600 dark:text-rose-300">{erro}</p>
          ) : (
            <div ref={conteudoRef}>
              {temAnteriores && (
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    onClick={() => void carregarAnteriores()}
                    disabled={carregandoAnteriores}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-wait"
                  >
                    {carregandoAnteriores && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Carregar anteriores
                  </button>
                </div>
              )}
              {mensagens.length === 0 && (
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <Avatar nome={conversa.outro_nome} />
                  <p className="mt-3 text-sm font-medium">{conversa.outro_nome}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {conversa.outro_ativo ? `Comece a conversa com ${primeiroNome}.` : 'Nenhuma mensagem.'}
                  </p>
                </div>
              )}

              {dias.map(d => (
                <section key={d.chave} aria-label={rotuloDia(d.iso)}>
                  {/* A pílula gruda no topo enquanto o dia rola; o fio (a linha)
                      fica onde o dia começa. */}
                  <div className="pointer-events-none sticky top-2 z-20 mt-3 flex justify-center">
                    <span className="rounded-full border border-border bg-background px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm">
                      {rotuloDia(d.iso)}
                    </span>
                  </div>
                  <div className="-mt-2.75 mb-1 h-px bg-border" aria-hidden />

                  <ul>
                    {d.itens.map((m, i) => {
                      const anterior = d.itens[i - 1]
                      const inicioGrupo = !anterior
                        || anterior.autor_id !== m.autor_id
                        || !!anterior.apagada_em !== !!m.apagada_em
                        || +new Date(m.criada_em) - +new Date(anterior.criada_em) > AGRUPAR_MS
                        || m.id === divisorId
                      const minha = m.autor_id === euId
                      return (
                        <li key={m.id}>
                          {m.id === divisorId && (
                            <div data-divisor-novas className="my-3 flex items-center gap-2 text-xs font-medium text-rose-600 dark:text-rose-300" role="separator">
                              <span className="h-px flex-1 bg-rose-500/40" />
                              Novas mensagens
                              <span className="h-px flex-1 bg-rose-500/40" />
                            </div>
                          )}
                          <BolhaMensagem
                            m={m}
                            minha={minha}
                            inicioGrupo={inicioGrupo}
                            citada={m.responde_a ? (porId.get(m.responde_a) ?? citadasFora[m.responde_a]) : null}
                            nomeDe={nomeDe}
                            euId={euId}
                            vista={minha && !!lidoOutro && lidoOutro >= m.criada_em}
                            destacada={destacadaId === m.id}
                            ativa={ativaId === m.id}
                            aoAtivar={() => setAtivaId(a => (a === m.id ? null : m.id))}
                            aoReagir={emoji => { setAtivaId(null); void alternarReacao(m, emoji) }}
                            aoResponder={() => { setAtivaId(null); setEditando(null); setRespondendo(m) }}
                            aoEditar={() => { setAtivaId(null); setRespondendo(null); setEditando(m) }}
                            aoApagar={() => { setAtivaId(null); setApagando(m) }}
                            aoIrPara={irPara}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

              {digitando && (
                <div className="flex justify-start pt-2" aria-hidden>
                  <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3 py-2.5">
                    {[0, 150, 300].map(atraso => (
                      <span
                        key={atraso}
                        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
                        style={{ animationDelay: `${atraso}ms` }}
                      />
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {!noFim && !carregando && (
          <button
            type="button"
            onClick={irAoFim}
            aria-label={novasAbaixo ? `${novasAbaixo} mensagens novas — ir para o fim` : 'Ir para o fim'}
            className="absolute bottom-3 right-3 z-30 flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-sm text-foreground shadow-lg transition-colors hover:bg-muted"
          >
            {novasAbaixo > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold leading-4 text-white tabular-nums">{novasAbaixo}</span>
            )}
            <ArrowDown className="h-4 w-4" />
          </button>
        )}

        {arrastando && (
          <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cyan-600 bg-background/90 text-sm font-medium text-cyan-800 dark:text-cyan-200">
            <Paperclip className="h-6 w-6" aria-hidden />
            Solte para anexar
          </div>
        )}
      </div>

      {!conversa.outro_ativo ? (
        <p className="shrink-0 border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
          {conversa.outro_nome} não está mais ativo no Pulsar. O histórico fica, mas não dá para enviar.
        </p>
      ) : (
        <Compositor
          ref={compositorRef}
          conversaId={id}
          euId={euId}
          nomeOutro={primeiroNome}
          respondendo={respondendo}
          editando={editando}
          nomeDe={nomeDe}
          aoCancelar={() => { setRespondendo(null); setEditando(null) }}
          aoEnviar={enviar}
          aoSalvarEdicao={salvarEdicao}
          aoEditarUltima={editarUltima}
          aoDigitar={avisarDigitando}
        />
      )}

      <AlertDialog open={!!apagando} onOpenChange={v => { if (!v) setApagando(null) }}>
        <AlertDialogContent className="border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Apagar mensagem?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Ela some para você e para {primeiroNome}, com os anexos e as reações. No lugar fica “Mensagem apagada”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-muted">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmarApagar()} className="bg-rose-600 hover:bg-rose-700">
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function Avatar({ nome, pequeno = false, online = false }: { nome: string; pequeno?: boolean; online?: boolean }) {
  return (
    <span aria-hidden className="relative shrink-0">
      <span
        className={`flex items-center justify-center rounded-full bg-cyan-100 font-semibold text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-200 ${
          pequeno ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'
        }`}
      >
        {nome.trim().charAt(0).toUpperCase() || '?'}
      </span>
      {online && (
        <span className={`absolute bottom-0 right-0 rounded-full bg-emerald-500 ring-2 ring-background ${pequeno ? 'h-2 w-2' : 'h-2.5 w-2.5'}`} />
      )}
    </span>
  )
}

// "Hoje", "Ontem", "segunda-feira, 28 de setembro" (com o ano, se for outro).
function rotuloDia(iso: string): string {
  const d = new Date(iso)
  const hoje = new Date()
  const ontem = new Date(); ontem.setDate(hoje.getDate() - 1)
  if (d.toDateString() === hoje.toDateString()) return 'Hoje'
  if (d.toDateString() === ontem.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
    ...(d.getFullYear() !== hoje.getFullYear() ? { year: 'numeric' } : {}),
  })
}
