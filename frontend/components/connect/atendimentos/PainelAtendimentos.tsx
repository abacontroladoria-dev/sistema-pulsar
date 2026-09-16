'use client'

import React from 'react'
import Link from 'next/link'
import { Bot, User, AlertTriangle, Archive, Loader2, WifiOff, ShieldAlert } from 'lucide-react'
import type { Caixa } from '@/modules/atendimento/agente/caixas'
import { useCaixasAtendimento, type Contagens } from '@/hooks/nina/useCaixasAtendimento'
import { iniciais } from '@/components/nina/adapters/centralToNina'

// ============================================================================
// Triagem do atendimento — quem está com quem.
//
// As quatro caixas respondem à pergunta que o inbox não responde: a Maia passou
// a conversa e alguém pegou? A caixa "Ninguém" é a que justifica a tela — é
// onde cai a conversa que escalarParaHumano largou e nenhum humano assumiu.
//
// Cores: cada uma significa uma coisa só, como no resto do sistema.
//   violet  = a Maia conduz        (mesmo violeta da chave Maia no chat)
//   emerald = um humano conduz     (mesmo emerald do "Atendente")
//   amber   = ninguém conduz       — é a fila que dói
//   slate   = encerrada            — histórico, sem urgência
// ============================================================================

interface DefCaixa {
  id:    Caixa
  label: string
  // O que a caixa QUER dizer. Sem isto, "Ninguém" lê como erro de dados em vez
  // de fila de trabalho.
  ajuda: string
  icon:  React.ElementType
  cor:   string   // texto + borda quando ativa
  fundo: string   // fundo quando ativa
}

const CAIXAS_UI: DefCaixa[] = [
  { id: 'maia',       label: 'Maia',       ajuda: 'A atendente automática está conduzindo',
    icon: Bot,           cor: 'text-violet-400 border-violet-500/50',  fundo: 'bg-violet-500/10' },
  { id: 'humano',     label: 'Humano',     ajuda: 'Alguém da equipe assumiu',
    icon: User,          cor: 'text-emerald-400 border-emerald-500/50', fundo: 'bg-emerald-500/10' },
  { id: 'ninguem',    label: 'Ninguém',    ajuda: 'A Maia saiu e nenhum humano pegou',
    icon: AlertTriangle, cor: 'text-amber-400 border-amber-500/50',    fundo: 'bg-amber-500/10' },
  { id: 'encerradas', label: 'Encerradas', ajuda: 'Resolvidas ou arquivadas',
    icon: Archive,       cor: 'text-slate-300 border-slate-500/50',    fundo: 'bg-slate-500/10' },
]

const PainelAtendimentos: React.FC = () => {
  const {
    caixa, abrirCaixa, conversas, contagens, modoPadrao, urgentes, loading, erro,
  } = useCaixasAtendimento()

  const ativa = CAIXAS_UI.find(c => c.id === caixa)!

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      <header className="px-6 pt-6 pb-4 border-b border-slate-800">
        <h1 className="text-xl font-semibold">Atendimentos</h1>
        <p className="text-sm text-slate-400 mt-1">
          Quem está conduzindo cada conversa agora.
        </p>

        {/* O padrão da clínica desligado explica uma caixa "Maia" vazia. Sem
            este aviso, parece falta de movimento — e alguém vai procurar defeito
            no lugar errado. */}
        {modoPadrao === 'off' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              A atendente automática está <strong>desligada</strong> no padrão da clínica.
              Só aparecem em “Maia” as conversas ligadas manualmente.
            </span>
          </div>
        )}
      </header>

      {/* Os quatro cards são o filtro. */}
      <nav className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4" aria-label="Caixas">
        {CAIXAS_UI.map(c => {
          const selecionada = c.id === caixa
          const total = contagens[c.id as keyof Contagens]
          return (
            <button
              key={c.id}
              onClick={() => abrirCaixa(c.id)}
              aria-pressed={selecionada}
              title={c.ajuda}
              className={`text-left rounded-xl border px-4 py-3 transition ${
                selecionada
                  ? `${c.cor} ${c.fundo}`
                  : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <c.icon className="w-4 h-4" />
                <span className="text-sm font-medium">{c.label}</span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {loading && selecionada ? '—' : total}
              </div>
              <div className="text-[11px] leading-tight mt-0.5 opacity-80">{c.ajuda}</div>
            </button>
          )
        })}
      </nav>

      <section className="flex-1 overflow-auto px-6 pb-6">
        {erro && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Carregando…
          </div>
        ) : conversas.length === 0 ? (
          <div className="py-16 text-center text-slate-500">
            <ativa.icon className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhuma conversa em “{ativa.label}”.</p>
            <p className="text-xs mt-1 opacity-70">{ativa.ajuda}.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {conversas.map(c => {
              const urgente = urgentes.has(c.id)
              return (
                <li key={c.id}>
                  {/* Leva ao chat em vez de duplicá-lo: a conversa se atende no
                      inbox, que já tem a chave Maia/Atendente e o histórico. */}
                  <Link
                    href={`/connect/inbox?c=${c.id}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 hover:border-slate-700 transition"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-xs font-medium text-slate-300 shrink-0">
                      {iniciais(c.contactName)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{c.contactName}</span>
                        {/* A escalada da Maia que ninguém pegou. Não é caixa
                            própria (decisão do usuário), mas o banco distingue
                            — priority 'high' vem de escalarParaHumano — e perder
                            esse sinal seria perder o pedido de socorro. */}
                        {urgente && caixa === 'ninguem' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                            escalada pela Maia
                          </span>
                        )}
                      </div>
                      {/* Tipo do contato, NÃO a última mensagem.
                          A triagem carrega as conversas sem histórico (o
                          histórico é do chat), então `lastMessage` aqui seria
                          sempre o literal "Sem mensagens" que o adapter usa como
                          fallback — um texto falso em toda linha da tela.
                          Buscar a última mensagem custaria um join por conversa
                          para exibir uma prévia que não ajuda a decidir: numa
                          fila, o que importa é quem espera e há quanto tempo. */}
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {c.rotuloTipo}{c.contactPhone ? ` · ${c.contactPhone}` : ''}
                      </p>
                    </div>

                    <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                      {c.lastMessageTime}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

export default PainelAtendimentos
