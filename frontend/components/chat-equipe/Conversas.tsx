'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, MessagesSquare, Search, WifiOff } from 'lucide-react'
import { toast } from 'sonner'

import {
  EVENTO_CHAT_ALTERADO, EVENTO_CHAT_MENSAGEM, EVENTO_CHAT_MENSAGEM_ALTERADA, abrirConversaDireta, listarConversas, listarPessoas,
  type ConversaLista, type PessoaChat,
} from '@/lib/chat/cliente'
import { quandoRelativo } from '@/lib/central/mencoes-cliente'
import { useOnline } from '@/lib/chat/presenca'
import { semFormatacao } from '@/lib/chat/texto'
import FioConversa, { Avatar } from './FioConversa'

// ============================================================================
// Abas "Conversas" e "Usuários" do Chat da equipe.
//
// Conversas — só as conversas ativas (com ao menos uma mensagem):
//   Não lidas  com mensagem do outro que eu ainda não li
//   Lidas      todas lidas
//   Todos      todas, a mais recente no topo
//
// Usuários — todo usuário ativo do Pulsar, por nome. Clicar abre a conversa
// (a que já existe, ou uma nova). Conversa aberta e ainda sem mensagem não
// aparece em Conversas: só passa a aparecer depois da primeira mensagem.
//
// A busca vale para tudo. O fio aberto ocupa o mesmo espaço (o painel tem
// 26rem, e o celular, menos) e "Voltar" devolve à lista no mesmo filtro.
// ============================================================================

type Modo = 'conversas' | 'usuarios'
type Filtro = 'nao_lidas' | 'lidas' | 'todos'

const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'nao_lidas', rotulo: 'Não lidas' },
  { id: 'lidas',     rotulo: 'Lidas' },
  { id: 'todos',     rotulo: 'Todos' },
]

const VAZIO: Record<Filtro, string> = {
  nao_lidas: 'Nada pendente. Mensagem nova de alguém da equipe aparece aqui.',
  lidas:     'Nenhuma conversa lida ainda.',
  todos:     'Nenhuma conversa ainda.',
}

// Uma linha da lista: uma conversa que já existe, ou uma pessoa sem conversa.
interface Linha {
  chave:    string
  nome:     string
  conversa: ConversaLista | null
  pessoa:   PessoaChat | null
}

type FioAberto = Pick<ConversaLista, 'id' | 'outro_id' | 'outro_nome' | 'outro_ativo'>

const DEBOUNCE_MS = 400

// Busca sem acento e sem caixa: "joao" acha "João".
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export default function Conversas({ euId, modo, aoIrParaUsuarios }: {
  euId:             string
  modo:             Modo
  aoIrParaUsuarios: () => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [fio, setFio] = useState<FioAberto | null>(null)
  const [conversas, setConversas] = useState<ConversaLista[]>([])
  const [pessoas, setPessoas] = useState<PessoaChat[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)

  const carregarConversas = useCallback(async () => {
    try {
      setConversas(await listarConversas())
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])

  // As pessoas mudam pouco: uma leitura ao montar. As conversas acompanham
  // mensagem nova (tempo real) e leitura/envio (evento local).
  useEffect(() => {
    let vivo = true
    Promise.all([
      carregarConversas(),
      listarPessoas().then(p => { if (vivo) setPessoas(p) }).catch(e => { if (vivo) setErro((e as Error).message) }),
    ]).finally(() => { if (vivo) setCarregando(false) })

    let espera: ReturnType<typeof setTimeout> | null = null
    const recarregar = () => {
      if (espera) clearTimeout(espera)
      espera = setTimeout(() => void carregarConversas(), DEBOUNCE_MS)
    }
    window.addEventListener(EVENTO_CHAT_MENSAGEM, recarregar)
    window.addEventListener(EVENTO_CHAT_ALTERADO, recarregar)
    window.addEventListener(EVENTO_CHAT_MENSAGEM_ALTERADA, recarregar)
    return () => {
      vivo = false
      if (espera) clearTimeout(espera)
      window.removeEventListener(EVENTO_CHAT_MENSAGEM, recarregar)
      window.removeEventListener(EVENTO_CHAT_ALTERADO, recarregar)
      window.removeEventListener(EVENTO_CHAT_MENSAGEM_ALTERADA, recarregar)
    }
  }, [carregarConversas])

  const naoLidas = conversas.filter(c => c.nao_lidas > 0).length

  const linhas = useMemo<Linha[]>(() => {
    let lista: Linha[]
    if (modo === 'usuarios') {
      // A conversa que já existe com a pessoa vai junto, para abrir direto.
      const porPessoa = new Map(conversas.map(c => [c.outro_id, c]))
      lista = pessoas
        .map(p => ({ chave: p.id, nome: p.nome, conversa: porPessoa.get(p.id) ?? null, pessoa: p }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    } else {
      // A lista já vem da mais recente para a mais antiga.
      const ativas = conversas.filter(c => c.ultima_mensagem_em)
      lista = ativas
        .filter(c => filtro === 'todos' || (filtro === 'nao_lidas' ? c.nao_lidas > 0 : c.nao_lidas === 0))
        .map(c => ({ chave: c.id, nome: c.outro_nome, conversa: c, pessoa: null }))
    }
    const termo = normalizar(busca.trim())
    return termo ? lista.filter(l => normalizar(l.nome).includes(termo)) : lista
  }, [modo, filtro, busca, conversas, pessoas])

  const abrir = async (l: Linha) => {
    if (l.conversa) {
      setFio(l.conversa)
      return
    }
    if (!l.pessoa || abrindo) return
    setAbrindo(l.chave)
    try {
      const id = await abrirConversaDireta(l.pessoa.id)
      setFio({ id, outro_id: l.pessoa.id, outro_nome: l.pessoa.nome, outro_ativo: true })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAbrindo(null)
    }
  }

  if (fio) {
    return <FioConversa key={fio.id} conversa={fio} euId={euId} aoVoltar={() => setFio(null)} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        {modo === 'conversas' && (
          <div role="tablist" aria-label="Filtrar conversas" className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-sm font-medium">
            {FILTROS.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtro === f.id}
                onClick={() => setFiltro(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
                  filtro === f.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.rotulo}
                {f.id === 'nao_lidas' && naoLidas > 0 && (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white tabular-nums">
                    {naoLidas > 99 ? '99+' : naoLidas}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-cyan-500/40">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Digite para buscar..."
            aria-label="Buscar pessoa"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </label>
      </div>

      {erro && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
          <WifiOff className="h-4 w-4 shrink-0" />
          {erro}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {carregando ? (
          <div className="flex justify-center py-12 text-muted-foreground/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : linhas.length === 0 ? (
          !erro && (
            <div className="flex flex-col items-center px-6 py-12 text-center text-muted-foreground">
              <MessagesSquare className="mb-3 h-10 w-10 opacity-30" aria-hidden />
              <p className="max-w-xs text-sm">
                {busca.trim()
                  ? 'Ninguém com esse nome.'
                  : modo === 'usuarios' ? 'Nenhuma outra pessoa ativa no Pulsar.' : VAZIO[filtro]}
              </p>
              {modo === 'conversas' && filtro === 'todos' && !busca.trim() && (
                <button
                  type="button"
                  onClick={aoIrParaUsuarios}
                  className="mt-3 text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400"
                >
                  Começar uma pela aba Usuários
                </button>
              )}
            </div>
          )
        ) : (
          <ul className="space-y-0.5">
            {linhas.map(l => (
              <li key={l.chave}>
                <LinhaConversa
                  linha={l}
                  euId={euId}
                  soPessoa={modo === 'usuarios'}
                  abrindo={abrindo === l.chave}
                  aoAbrir={() => void abrir(l)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// `soPessoa` (aba Usuários): sem prévia nem horário da última mensagem — a
// linha diz só se já há conversa com a pessoa.
function LinhaConversa({ linha: l, euId, soPessoa, abrindo, aoAbrir }: {
  linha:    Linha
  euId:     string
  soPessoa: boolean
  abrindo:  boolean
  aoAbrir:  () => void
}) {
  const online = useOnline()
  const c = soPessoa ? null : l.conversa
  const n = l.conversa?.nao_lidas ?? 0
  const previa = soPessoa
    ? (l.conversa?.ultima_mensagem_em ? 'Abrir conversa' : 'Começar conversa')
    : c?.ultima_corpo
      ? `${c.ultima_autor_id === euId ? 'Você: ' : ''}${semFormatacao(c.ultima_corpo)}`
      : c && !c.outro_ativo
        ? 'Não está mais ativo'
        : 'Começar conversa'

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <Avatar nome={l.nome} online={online.has(l.conversa?.outro_id ?? l.pessoa?.id ?? '')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-sm ${n > 0 ? 'font-semibold' : 'font-medium'}`}>{l.nome}</span>
          {c?.ultima_mensagem_em && (
            <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {quandoRelativo(c.ultima_mensagem_em)}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={`truncate text-xs ${n > 0 ? 'text-foreground' : 'text-muted-foreground'} ${c?.ultima_corpo ? '' : 'italic'}`}>
            {previa}
          </span>
          {abrindo && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          {n > 0 && (
            <span
              className="ml-auto min-w-5 shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white tabular-nums"
              aria-label={`${n} não lidas`}
            >
              {n > 99 ? '99+' : n}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
