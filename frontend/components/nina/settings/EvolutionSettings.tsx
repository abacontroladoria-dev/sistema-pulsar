'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  MessageSquare, Smartphone, Bot, Plus, Loader2, QrCode, Users, RotateCw, Unplug, Trash2, X, Check,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '../Button'

// ============================================================================
// Números WhatsApp — configurações do Connect (só admin)
//
// A Maia atende pelo número oficial da Meta, que não se configura aqui (as
// credenciais são variáveis de ambiente). Os números Evolution são de
// atendimento humano: criados, conectados por QR e distribuídos por pessoa
// nesta tela. Quem não é membro de um número não o vê na /connect/inbox.
//
// As rotas de escrita terminam com barra: `trailingSlash: true` transforma POST
// sem barra em 308, e o corpo não sobrevive ao redirecionamento.
// ============================================================================

interface Numero {
  channelId: string
  nome: string
  status: string
  ultimaSincronizacao: string | null
  membros: number
}

interface Usuario { id: string; nome: string; central_role: string }

const BASE = '/api/central/evolution/instances'

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  active:       { rotulo: 'Online',        cor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  connecting:   { rotulo: 'Aguardando QR', cor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  disconnected: { rotulo: 'Offline',       cor: 'bg-slate-500/10 text-muted-foreground border-border' },
  error:        { rotulo: 'Erro',          cor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30' },
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error?.message ?? `A operação falhou (${res.status}).`)
  return json?.data as T
}

export function EvolutionSettings() {
  const [numeros, setNumeros] = useState<Numero[]>([])
  const [configurada, setConfigurada] = useState(true)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [criando, setCriando] = useState(false)
  const [qrDe, setQrDe] = useState<Numero | null>(null)
  const [membrosDe, setMembrosDe] = useState<Numero | null>(null)
  const [removendo, setRemovendo] = useState<Numero | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const d = await api<{ configurada: boolean; numeros: Numero[] }>(BASE)
      setNumeros(d.numeros)
      setConfigurada(d.configurada)
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    const nome = nomeNovo.trim()
    if (nome.length < 2) return
    setCriando(true)
    try {
      const { channelId } = await api<{ channelId: string }>(`${BASE}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      })
      setNomeNovo('')
      await carregar()
      setQrDe({ channelId, nome, status: 'connecting', ultimaSincronizacao: null, membros: 1 })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCriando(false)
    }
  }

  const acao = async (n: Numero, action: 'restart' | 'logout') => {
    setOcupado(n.channelId)
    try {
      await api(`${BASE}/${n.channelId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      toast.success(action === 'restart' ? `${n.nome}: reiniciando.` : `${n.nome}: desconectado.`)
      await carregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const remover = async (n: Numero) => {
    setOcupado(n.channelId)
    try {
      const res = await fetch(`${BASE}/${n.channelId}/`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? `A remoção falhou (${res.status}).`)
      }
      toast.success(`${n.nome} removido. O histórico das conversas foi mantido.`)
      setRemovendo(null)
      await carregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-3 mb-1">
        <MessageSquare className="w-5 h-5 text-cyan-500" />
        <h3 className="font-semibold text-foreground">Números WhatsApp</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        A Maia atende pelo número oficial. Os demais números são de atendimento humano e
        aparecem na caixa de entrada só para quem for membro deles.
      </p>

      {/* O número da Maia — só leitura */}
      <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background mb-3">
        <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-violet-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Maia · número oficial (Meta)</p>
          <p className="text-xs text-muted-foreground/70">Configurado no servidor. Não é gerenciado por esta tela.</p>
        </div>
      </div>

      {!configurada && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
          A Evolution API ainda não está configurada no servidor (EVOLUTION_API_URL e EVOLUTION_API_KEY).
        </p>
      )}
      {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">{erro}</p>}

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando números...
        </div>
      ) : (
        <div className="space-y-2">
          {numeros.map(n => {
            const st = STATUS[n.status] ?? STATUS.error
            const travado = ocupado === n.channelId
            return (
              <div key={n.channelId} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-border bg-background">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <Smartphone className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{n.nome}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {n.membros} {n.membros === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                  <span className={`ml-auto sm:ml-2 px-2 py-0.5 rounded-md text-[10px] font-medium border shrink-0 ${st.cor}`}>
                    {st.rotulo}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {n.status !== 'active' && (
                    <Button size="sm" variant="secondary" onClick={() => setQrDe(n)} disabled={travado}>
                      <QrCode className="w-3.5 h-3.5 mr-1.5" /> Conectar
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setMembrosDe(n)} disabled={travado}>
                    <Users className="w-3.5 h-3.5 mr-1.5" /> Membros
                  </Button>
                  <Button size="sm" variant="ghost" title="Reiniciar" aria-label={`Reiniciar ${n.nome}`}
                    onClick={() => acao(n, 'restart')} disabled={travado}>
                    {travado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
                  </Button>
                  {n.status === 'active' && (
                    <Button size="sm" variant="ghost" title="Desconectar" aria-label={`Desconectar ${n.nome}`}
                      onClick={() => acao(n, 'logout')} disabled={travado}>
                      <Unplug className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" title="Remover" aria-label={`Remover ${n.nome}`}
                    onClick={() => setRemovendo(n)} disabled={travado}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}

          {numeros.length === 0 && (
            <p className="text-sm text-muted-foreground/70 py-2">Nenhum número de atendimento humano ainda.</p>
          )}
        </div>
      )}

      <form onSubmit={criar} className="flex flex-col sm:flex-row gap-2 mt-4">
        <input
          value={nomeNovo}
          onChange={e => setNomeNovo(e.target.value)}
          placeholder="Nome do número (ex.: Marketing)"
          maxLength={60}
          disabled={!configurada || criando}
          className="flex-1 px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20"
        />
        <Button type="submit" size="md" disabled={!configurada || criando || nomeNovo.trim().length < 2}>
          {criando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Adicionar número
        </Button>
      </form>

      {qrDe && (
        <ModalQr
          numero={qrDe}
          aoFechar={() => { setQrDe(null); carregar() }}
        />
      )}
      {membrosDe && (
        <ModalMembros
          numero={membrosDe}
          aoFechar={() => { setMembrosDe(null); carregar() }}
        />
      )}
      {removendo && (
        <Modal titulo={`Remover ${removendo.nome}?`} aoFechar={() => setRemovendo(null)}>
          <p className="text-sm text-muted-foreground">
            O número é desconectado da Evolution e some da caixa de entrada. As conversas já
            registradas continuam no histórico.
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" size="sm" onClick={() => setRemovendo(null)}>Cancelar</Button>
            <Button variant="danger" size="sm" onClick={() => remover(removendo)} disabled={ocupado === removendo.channelId}>
              {ocupado === removendo.channelId && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Remover
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ titulo, subtitulo, aoFechar, children }: {
  titulo: string
  subtitulo?: string
  aoFechar: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-foreground truncate">{titulo}</h3>
            {subtitulo && <p className="text-xs text-muted-foreground mt-0.5">{subtitulo}</p>}
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// QR novo a cada 20s (o do WhatsApp expira) e status a cada 3s, até conectar.
function ModalQr({ numero, aoFechar }: { numero: Numero; aoFechar: () => void }) {
  const [qr, setQr] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [conectado, setConectado] = useState(false)

  useEffect(() => {
    let vivo = true

    const pedirQr = async () => {
      try {
        const d = await api<{ qrBase64: string | null; conectado: boolean }>(`${BASE}/${numero.channelId}/qr`)
        if (!vivo) return
        if (d.conectado) setConectado(true)
        else if (d.qrBase64) setQr(d.qrBase64)
        setErro(null)
      } catch (e) {
        if (vivo) setErro((e as Error).message)
      }
    }

    const conferir = async () => {
      try {
        const d = await api<{ estado: string }>(`${BASE}/${numero.channelId}/status`)
        if (vivo && d.estado === 'open') setConectado(true)
      } catch { /* o próximo tique tenta de novo */ }
    }

    pedirQr()
    const tQr = setInterval(pedirQr, 20_000)
    const tStatus = setInterval(conferir, 3_000)
    return () => { vivo = false; clearInterval(tQr); clearInterval(tStatus) }
  }, [numero.channelId])

  // `aoFechar` muda a cada render do pai; a trava garante um aviso e um
  // fechamento só.
  const avisado = useRef(false)
  useEffect(() => {
    if (!conectado || avisado.current) return
    avisado.current = true
    toast.success(`${numero.nome} conectado.`)
    setTimeout(aoFechar, 1200)
  }, [conectado, numero.nome, aoFechar])

  const src = qr && (qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`)

  return (
    <Modal titulo={`Conectar ${numero.nome}`} subtitulo="WhatsApp › Aparelhos conectados › Conectar aparelho" aoFechar={aoFechar}>
      <div className="flex flex-col items-center gap-3">
        {conectado ? (
          <div className="flex flex-col items-center gap-2 py-10 text-emerald-600 dark:text-emerald-400">
            <Check className="w-10 h-10" />
            <p className="text-sm font-medium">Conectado</p>
          </div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`QR code para conectar ${numero.nome}`} className="w-64 h-64 rounded-xl bg-white p-2" />
        ) : (
          <div className="w-64 h-64 rounded-xl border border-border flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {erro && <p className="text-xs text-rose-600 dark:text-rose-400 text-center">{erro}</p>}
        {!conectado && (
          <p className="text-xs text-muted-foreground/70 text-center">
            Escaneie com o celular do número. O código se renova sozinho a cada 20 segundos.
          </p>
        )}
      </div>
    </Modal>
  )
}

function ModalMembros({ numero, aoFechar }: { numero: Numero; aoFechar: () => void }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    api<{ membros: string[]; usuarios: Usuario[] }>(`${BASE}/${numero.channelId}/membros`)
      .then(d => { setUsuarios(d.usuarios); setMarcados(new Set(d.membros)) })
      .catch(e => toast.error((e as Error).message))
      .finally(() => setCarregando(false))
  }, [numero.channelId])

  const alternar = (id: string) => setMarcados(atual => {
    const proximo = new Set(atual)
    if (proximo.has(id)) proximo.delete(id)
    else proximo.add(id)
    return proximo
  })

  const salvar = async () => {
    setSalvando(true)
    try {
      await api(`${BASE}/${numero.channelId}/membros/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...marcados] }),
      })
      toast.success('Membros atualizados.')
      aoFechar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal titulo={`Quem atende ${numero.nome}`} subtitulo="Só os membros veem este número na caixa de entrada" aoFechar={aoFechar}>
      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-1">
          {usuarios.map(u => (
            <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer">
              <input
                type="checkbox"
                checked={marcados.has(u.id)}
                onChange={() => alternar(u.id)}
                className="w-4 h-4 accent-cyan-600"
              />
              <span className="text-sm text-foreground flex-1 truncate">{u.nome}</span>
              <span className="text-[10px] text-muted-foreground/70">{u.central_role}</span>
            </label>
          ))}
          {usuarios.length === 0 && (
            <p className="text-sm text-muted-foreground/70">Nenhum usuário com acesso à Central.</p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground/70 mt-3">
        Administradores e diretores veem todos os números mesmo sem serem membros.
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" size="sm" onClick={aoFechar}>Cancelar</Button>
        <Button size="sm" onClick={salvar} disabled={salvando || carregando}>
          {salvando && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Salvar
        </Button>
      </div>
    </Modal>
  )
}
