'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, User, AlertTriangle, Archive, Loader2, WifiOff, ShieldAlert } from 'lucide-react'
import { CAIXAS, type Caixa } from '@/modules/atendimento/agente/caixas'
import { tempoDeEspera, esperaCritica } from '@/modules/atendimento/agente/espera'
import { useCaixasAtendimento, type Fila } from '@/hooks/nina/useCaixasAtendimento'
import { iniciais, type NinaConversation } from '@/components/nina/adapters/centralToNina'

// ============================================================================
// Triagem do atendimento — quem está com quem, nas quatro filas.
//
// As quatro colunas respondem à pergunta que o inbox não responde: a Maia passou
// a conversa e alguém pegou? A coluna "Ninguém" é a que justifica a tela — é
// onde cai a conversa que escalarParaHumano largou e nenhum humano assumiu.
//
// ORDEM DAS COLUNAS, e ela é a decisão de desenho principal: as três vivas são
// fila de espera, com quem aguarda há MAIS tempo no topo. É o inverso do inbox,
// de propósito — o inbox mostra movimento recente, e numa triagem a conversa
// esquecida há quatro horas é justamente a que o inbox empurra para o fim, onde
// ninguém olha. "Encerradas" é a exceção: é histórico, não fila, e se lê do fim
// para trás. Cada cabeçalho diz qual das duas ordens está em vigor, senão a
// inversão pareceria defeito para quem compara as colunas lado a lado.
//
// PESO VISUAL DESIGUAL, também deliberado: só "Ninguém" tem fundo e borda vivos.
// Quatro colunas idênticas diriam que as quatro pedem a mesma atenção, e não
// pedem — três têm alguém conduzindo, uma não tem ninguém. É a única coluna onde
// a espera vira alarme.
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
  // O que a coluna QUER dizer. Sem isto, "Ninguém" lê como erro de dados em vez
  // de fila de trabalho.
  ajuda: string
  // A ordem, dita em voz alta no cabeçalho.
  ordem: string
  icon:  React.ElementType
  texto: string
  borda: string
  fundo: string
  // Só a coluna que pede ação tem realce. As outras ficam quietas.
  realce: boolean
}

const CAIXAS_UI: Record<Caixa, DefCaixa> = {
  maia: {
    id: 'maia', label: 'Maia', ajuda: 'A atendente automática está conduzindo',
    ordem: 'quem espera há mais tempo primeiro',
    icon: Bot, texto: 'text-violet-300', borda: 'border-slate-800',
    fundo: 'bg-slate-900/40', realce: false,
  },
  humano: {
    id: 'humano', label: 'Humano', ajuda: 'Alguém da equipe assumiu',
    ordem: 'quem espera há mais tempo primeiro',
    icon: User, texto: 'text-emerald-300', borda: 'border-slate-800',
    fundo: 'bg-slate-900/40', realce: false,
  },
  ninguem: {
    id: 'ninguem', label: 'Ninguém', ajuda: 'A Maia saiu e nenhum humano pegou',
    ordem: 'quem espera há mais tempo primeiro',
    icon: AlertTriangle, texto: 'text-amber-300', borda: 'border-amber-500/40',
    fundo: 'bg-amber-500/[0.06]', realce: true,
  },
  encerradas: {
    id: 'encerradas', label: 'Encerradas', ajuda: 'Resolvidas ou arquivadas',
    ordem: 'as que fecharam por último primeiro',
    icon: Archive, texto: 'text-slate-400', borda: 'border-slate-800',
    fundo: 'bg-slate-900/40', realce: false,
  },
}

// O tempo de espera envelhece sozinho. Sem um tique próprio, uma linha mostraria
// "2min" até o próximo poll de 8s — e as colunas paradas (ninguém escreve numa
// conversa abandonada, que é justamente o caso grave) ficariam congeladas por
// muito mais tempo, porque o poll traz os mesmos dados.
function useAgora(intervaloMs = 30_000): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs])
  return agora
}

const PainelAtendimentos: React.FC = () => {
  const { filas, modoPadrao, limitePorColuna, loading, erro } = useCaixasAtendimento()
  const agora = useAgora()

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      <header className="px-6 pt-6 pb-4 border-b border-slate-800 shrink-0">
        <h1 className="text-xl font-semibold">Atendimentos</h1>
        <p className="text-sm text-slate-400 mt-1">
          Quem está conduzindo cada conversa agora.
        </p>

        {/* O padrão da clínica desligado explica uma coluna "Maia" vazia. Sem
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

        {erro && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            {erro}
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Carregando…
        </div>
      ) : (
        // Em telas estreitas as colunas empilham: quatro filas lado a lado num
        // celular seriam quatro tiras ilegíveis.
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 px-6 py-5 overflow-auto xl:overflow-hidden">
          {CAIXAS.map(id => (
            <Coluna
              key={id}
              def={CAIXAS_UI[id]}
              fila={filas[id]}
              agora={agora}
              limite={limitePorColuna}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------

const Coluna: React.FC<{
  def: DefCaixa; fila: Fila; agora: number; limite: number
}> = ({ def, fila, agora, limite }) => {
  const ocultas = Math.max(0, fila.total - fila.conversas.length)

  return (
    <section
      className={`flex flex-col min-h-0 rounded-xl border ${def.borda} ${def.fundo}`}
      aria-label={`${def.label} — ${def.ajuda}`}
    >
      <header className="px-4 py-3 border-b border-slate-800/80 shrink-0">
        <div className="flex items-center gap-2">
          <def.icon className={`w-4 h-4 ${def.texto}`} />
          <span className="text-sm font-medium text-slate-200">{def.label}</span>
          <span className={`ml-auto text-lg font-semibold tabular-nums ${def.texto}`}>
            {fila.total}
          </span>
        </div>
        <p className="text-[11px] leading-tight text-slate-500 mt-1">{def.ajuda}</p>
        <p className="text-[11px] leading-tight text-slate-600 mt-0.5">{def.ordem}</p>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
        {fila.conversas.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-8">Nenhuma conversa.</p>
        ) : (
          fila.conversas.map(c => (
            <LinhaConversa
              key={c.id}
              conversa={c}
              agora={agora}
              urgente={fila.urgentes.has(c.id)}
              // A espera só vira alarme onde ninguém está conduzindo. Nas outras
              // colunas alguém já está com a conversa, e pintar o tempo de
              // vermelho ali cobraria uma ação que não existe.
              alarmar={def.id === 'ninguem'}
            />
          ))
        )}
      </div>

      {ocultas > 0 && (
        // O cabeçalho mostra o total real, então o número nunca mente — mas a
        // coluna precisa dizer que a lista está cortada, senão a diferença entre
        // o contador e o que se vê parece defeito.
        <footer className="px-4 py-2 border-t border-slate-800/80 text-[11px] text-slate-500 shrink-0">
          mostrando as {limite} que esperam há mais tempo · +{ocultas} não exibidas
        </footer>
      )}
    </section>
  )
}

const LinhaConversa: React.FC<{
  conversa: NinaConversation; agora: number; urgente: boolean; alarmar: boolean
}> = ({ conversa: c, agora, urgente, alarmar }) => {
  const critica = alarmar && esperaCritica(c.lastMessageAt, agora)

  return (
    // Leva ao chat em vez de duplicá-lo: a conversa se atende no inbox, que já
    // tem a chave Maia/Atendente e o histórico.
    <Link
      href={`/connect/inbox?c=${c.id}`}
      className="block rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2.5 hover:border-slate-700 hover:bg-slate-900 transition"
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-medium text-slate-300 shrink-0">
          {iniciais(c.contactName)}
        </div>
        <span className="text-sm font-medium truncate">{c.contactName}</span>
        {/* O tempo de espera é o dado que decide a ação, então é ele que carrega
            o peso tipográfico da linha — não o nome, não o horário. */}
        <span
          className={`ml-auto text-sm font-semibold tabular-nums shrink-0 ${
            critica ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          {tempoDeEspera(c.lastMessageAt, agora)}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-1 pl-9">
        {/* Tipo do contato, NÃO a última mensagem. A triagem carrega as conversas
            sem histórico (o histórico é do chat), então `lastMessage` aqui seria
            sempre o literal "Sem mensagens" que o adapter usa como fallback — um
            texto falso em toda linha da tela. Buscar a última mensagem custaria
            um join por conversa para exibir uma prévia que não ajuda a decidir:
            numa fila, o que importa é quem espera e há quanto tempo. */}
        <p className="text-[11px] text-slate-500 truncate">
          {c.rotuloTipo}{c.contactPhone ? ` · ${c.contactPhone}` : ''}
        </p>
        {/* A escalada da Maia que ninguém pegou. Não é coluna própria (decisão do
            usuário), mas o banco distingue — priority 'high' vem de
            escalarParaHumano — e perder esse sinal seria perder o pedido de
            socorro. */}
        {urgente && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
            escalada
          </span>
        )}
      </div>
    </Link>
  )
}

export default PainelAtendimentos
