'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bot, User, AlertTriangle, Archive, Loader2, WifiOff, ShieldAlert, Hourglass, CheckCircle2,
} from 'lucide-react'
import type { ConversationStatus } from '@/modules/atendimento/types/central.types'
import { tempoDeEspera, esperaCritica } from '@/modules/atendimento/agente/espera'
import { useCaixasAtendimento, type Fila } from '@/hooks/nina/useCaixasAtendimento'
import { iniciais, type NinaConversation } from '@/components/nina/adapters/centralToNina'
import { STATUS_ATENDIMENTO } from '@/components/nina/StatusAtendimento'

// ============================================================================
// Triagem do atendimento — uma coluna por status.
//
// As mesmas seis do seletor de status do inbox, com as mesmas cores, rótulos e
// descrições (STATUS_ATENDIMENTO): quem vê "Aguardando" aqui vê "Aguardando"
// lá. O status é movido pelos fatos do ciclo e pela leitura da Maia
// (ConversationService, workers/status.worker.ts), e a equipe o troca no inbox.
//
// ORDEM DENTRO DA COLUNA: as quatro vivas são fila de espera, com quem aguarda
// há MAIS tempo no topo — o inverso do inbox, de propósito: numa triagem, a
// conversa esquecida há quatro horas é a que importa. Resolvido e Fechado são
// histórico e se leem do fim para trás; ali o tempo vem como "há 5min", que é
// o que distingue as duas leituras sem uma linha de explicação por coluna.
//
// NO CELULAR, ABAS: é onde as atendentes usam a tela. Seis colunas empilhadas
// punham Aberto embaixo dos cards da Maia, cada coluna rolando dentro da
// rolagem da página. Lá é uma fileira de abas (status + número) e uma lista só,
// abrindo em Aberto — a fila que pede alguém.
//
// PESO VISUAL DESIGUAL, deliberado: só "Aberto" tem fundo vivo. É a conversa
// que a Maia passou e ninguém da equipe pegou — a única fila em que a espera
// vira alarme. As outras têm alguém conduzindo ou já terminaram.
// ============================================================================

interface Extra {
  icon:      React.ElementType
  // Só a coluna que pede ação tem realce e alarme de espera.
  realce:    boolean
  encerrada: boolean
}

const EXTRA: Record<ConversationStatus, Extra> = {
  self_service: { icon: Bot,           realce: false, encerrada: false },
  open:         { icon: AlertTriangle, realce: true,  encerrada: false },
  assigned:     { icon: User,          realce: false, encerrada: false },
  waiting:      { icon: Hourglass,     realce: false, encerrada: false },
  resolved:     { icon: CheckCircle2,  realce: false, encerrada: true },
  archived:     { icon: Archive,       realce: false, encerrada: true },
}

type DefColuna = (typeof STATUS_ATENDIMENTO)[number] & Extra

const COLUNAS: DefColuna[] = STATUS_ATENDIMENTO.map(s => ({ ...s, ...EXTRA[s.valor] }))

// O tempo de espera envelhece sozinho. Sem um tique próprio, uma linha mostraria
// "2min" até o próximo poll — e as colunas paradas (ninguém escreve numa
// conversa abandonada, que é justamente o caso grave) ficariam congeladas.
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
  // Só vale no celular; da tela média para cima as seis aparecem.
  const [aba, setAba] = useState<ConversationStatus>('open')

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <header className="px-4 sm:px-6 pt-6 pb-4 border-b border-border shrink-0">
        <h1 className="text-xl font-semibold">Atendimentos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Em que pé está cada conversa agora.
        </p>

        {/* O padrão da clínica desligado explica um Autoatendimento vazio. Sem
            este aviso, parece falta de movimento. */}
        {modoPadrao === 'off' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              A atendente automática está <strong>desligada</strong> no padrão da clínica.
              Só aparecem em “Autoatendimento” as conversas dos números com “Maia responde”
              e as ligadas manualmente.
            </span>
          </div>
        )}

        {erro && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
            <WifiOff className="w-4 h-4 shrink-0" />
            {erro}
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground/70">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Carregando…
        </div>
      ) : (
        <>
          <AbasCelular aba={aba} aoEscolher={setAba} filas={filas} />
          {/* Celular: só a aba escolhida, rolando com a página. Tela média: 3 por
              linha, cada coluna com altura própria. Tela larga: as seis lado a
              lado, ocupando a altura toda, cada uma rolando por dentro. */}
          <div
            id="triagem-colunas"
            className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 2xl:grid-cols-6 auto-rows-max 2xl:auto-rows-fr gap-3 px-4 sm:px-6 py-4 md:py-5 overflow-auto 2xl:overflow-hidden"
          >
            {COLUNAS.map(def => (
              <Coluna
                key={def.valor}
                def={def}
                fila={filas[def.valor]}
                agora={agora}
                limite={limitePorColuna}
                foraDaAba={def.valor !== aba}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------

// A fileira de status do celular. Rola de lado; cada aba diz quantas tem.
const AbasCelular: React.FC<{
  aba: ConversationStatus; aoEscolher: (s: ConversationStatus) => void; filas: Record<ConversationStatus, Fila>
}> = ({ aba, aoEscolher, filas }) => (
  <div
    role="tablist"
    aria-label="Status do atendimento"
    className="md:hidden flex gap-2 overflow-x-auto px-4 pt-4 pb-1 shrink-0 [scrollbar-width:none]"
  >
    {COLUNAS.map(def => {
      const ativa = def.valor === aba
      return (
        <button
          key={def.valor}
          type="button"
          role="tab"
          aria-selected={ativa}
          aria-controls="triagem-colunas"
          onClick={() => aoEscolher(def.valor)}
          className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
            ativa ? 'border-transparent bg-foreground text-background' : 'border-border bg-card text-foreground'
          }`}
        >
          <span aria-hidden className={`w-2 h-2 rounded-full ${def.ponto}`} />
          {def.rotulo}
          <span className={`tabular-nums ${ativa ? 'text-background/80' : def.realce && filas[def.valor].total > 0 ? 'text-red-600 dark:text-red-300 font-semibold' : 'text-muted-foreground'}`}>
            {filas[def.valor].total}
          </span>
        </button>
      )
    })}
  </div>
)

const Coluna: React.FC<{
  def: DefColuna; fila: Fila; agora: number; limite: number; foraDaAba: boolean
}> = ({ def, fila, agora, limite, foraDaAba }) => {
  const ocultas = Math.max(0, fila.total - fila.conversas.length)

  return (
    <section
      // No celular, só a coluna da aba aparece, e sem teto de altura: a lista
      // rola com a página, uma rolagem só.
      className={`${foraDaAba ? 'hidden md:flex' : 'flex'} flex-col min-h-0 md:max-h-112 2xl:max-h-none rounded-xl border border-l-4 ${def.faixa} ${
        def.realce ? 'border-y-red-500/30 border-r-red-500/30 bg-red-500/5' : 'border-y-border border-r-border bg-card'
      }`}
      aria-label={`${def.rotulo} — ${def.descricao}`}
    >
      <header className="px-3 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <def.icon className={`w-4 h-4 ${def.texto}`} />
          <span className={`text-sm font-semibold ${def.texto}`}>{def.rotulo}</span>
          <span className={`ml-auto text-lg font-semibold tabular-nums ${def.texto}`}>
            {fila.total}
            {/* Encerradas contam só o dia (a rota recorta): sem o "hoje", o
                número pareceria o histórico inteiro. */}
            {def.encerrada && <span className="ml-1 text-xs font-medium text-muted-foreground">hoje</span>}
          </span>
        </div>
        <p className="text-xs leading-snug text-muted-foreground mt-1">{def.descricao}</p>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
        {fila.conversas.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">Nenhuma conversa.</p>
        ) : (
          fila.conversas.map(c => (
            <LinhaConversa
              key={c.id}
              conversa={c}
              agora={agora}
              urgente={fila.urgentes.has(c.id)}
              motivo={fila.motivos.get(c.id) ?? null}
              encerrada={def.encerrada}
              responsavel={fila.responsaveis.get(c.id) ?? null}
              // A espera só vira alarme onde ninguém está conduzindo. Nas outras
              // colunas alguém já está com a conversa, e pintar o tempo ali
              // cobraria uma ação que não existe.
              alarmar={def.realce}
            />
          ))
        )}
      </div>

      {ocultas > 0 && (
        // O cabeçalho mostra o total real; a coluna avisa que a lista está
        // cortada, senão a diferença parece defeito.
        <footer className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground shrink-0">
          mostrando {limite} · +{ocultas} não exibidas
        </footer>
      )}
    </section>
  )
}

const LinhaConversa: React.FC<{
  conversa: NinaConversation; agora: number; urgente: boolean; motivo: string | null
  alarmar: boolean; encerrada: boolean; responsavel: string | null
}> = ({ conversa: c, agora, urgente, motivo, alarmar, encerrada, responsavel }) => {
  const critica = alarmar && esperaCritica(c.lastMessageAt, agora)
  const tempo = tempoDeEspera(c.lastMessageAt, agora)
  // Sem nome, o adapter já usa o telefone como nome: repeti-lo embaixo é ruído.
  const telefone = c.contactPhone && c.contactPhone !== c.contactName ? c.contactPhone : ''
  const sigla = iniciais(c.contactName)

  return (
    // Leva ao chat em vez de duplicá-lo: a conversa se atende no inbox, onde
    // também se troca o status.
    <Link
      href={`/connect/inbox?c=${c.id}`}
      className="block rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
    >
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground shrink-0">
          {sigla === '?' ? <User aria-hidden className="w-3.5 h-3.5" /> : sigla}
        </div>
        <span className="text-sm font-medium truncate">{c.contactName}</span>
        {/* O tempo de espera é o dado que decide a ação, então é ele que carrega
            o peso tipográfico da linha. */}
        <span
          className={`ml-auto text-sm font-semibold tabular-nums shrink-0 ${
            critica ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'
          }`}
        >
          {/* Na fila é espera ("4h20"); no histórico, quando foi ("há 4h20"). */}
          {encerrada && tempo !== 'agora' && tempo !== '—' ? `há ${tempo}` : tempo}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-1 pl-9">
        {/* Tipo do contato, não a última mensagem: a triagem não carrega o
            histórico, e a prévia seria sempre o fallback "Sem mensagens". */}
        <p className="text-[11px] text-muted-foreground truncate">
          {c.rotuloTipo}{telefone ? ` · ${telefone}` : ''}
        </p>
        {/* A escalada da Maia (priority 'high' de escalarParaHumano). */}
        {urgente && (
          <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-700 dark:text-amber-200 border border-amber-500/30 shrink-0">
            escalada
          </span>
        )}
      </div>

      {/* Quem está com a conversa: a pergunta que a triagem existe para responder. */}
      {responsavel && (
        <p className="mt-1 pl-9 flex items-center gap-1 text-[11px] text-foreground/80 truncate">
          <User aria-hidden className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="truncate">com {responsavel}</span>
        </p>
      )}

      {/* Por que a Maia pôs a conversa aqui ("Ficou de mandar a carteirinha").
          Só quando a última palavra sobre o status foi dela. */}
      {motivo && (
        <p className="mt-1 pl-9 flex items-start gap-1 text-[11px] text-muted-foreground line-clamp-2">
          <Bot aria-hidden className="w-3 h-3 mt-px shrink-0 text-violet-500" />
          <span>{motivo}</span>
        </p>
      )}
    </Link>
  )
}

export default PainelAtendimentos
