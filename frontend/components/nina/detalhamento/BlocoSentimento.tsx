'use client'

import React from 'react'
import { Sparkles, RefreshCw, Loader2, TrendingDown, TrendingUp, Minus, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type {
  LeituraSentimento,
  SentimentLabel,
} from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio, BotaoAcao } from './Bloco'

// ----------------------------------------------------------------------------
// A leitura da IA sobre a pessoa.
//
// Responde UMA pergunta — para que lado este responsável está inclinado nos
// últimos 30 dias — e existe para mudar a conduta de quem está prestes a
// responder. Por isso fica no topo do painel, antes do canal e da origem: é o
// que precisa ser lido ANTES de escrever, e não mais um campo da ficha.
//
// TRÊS DECISÕES DE DESENHO
//
// 1. A CONFIANÇA APARECE. "Negativo a 41%" pede outra reação que "negativo a
//    95%", e esconder o número transformaria um palpite num veredito. Ela vem
//    discreta, ao lado do rótulo, porque é qualificador e não manchete.
//
// 2. A TENDÊNCIA SÓ APARECE QUANDO EXISTE. Com uma leitura só não há
//    movimento, e escrever "estável" ali seria afirmar algo que ninguém mediu.
//    O bloco simplesmente não mostra a linha.
//
// 3. LEITURA VELHA SE DENUNCIA. Passando de VALIDADE_DIAS, o rodapé fica âmbar
//    e diz que está desatualizada. Sem isso, uma leitura de três semanas atrás
//    se parece com uma de hoje para quem bate o olho — que é pior do que não
//    ter leitura nenhuma, porque parece informação.
//
// Cor: um matiz, um significado. Emerald é positivo, rose é negativo, e o
// neutro fica em `muted` — de propósito, porque a maioria das conversas é
// neutra e pintá-las de azul faria o painel inteiro parecer estar dizendo algo.
// Os tons seguem o padrão do projeto (bg-X-500/…, text-X-700 dark:text-X-200),
// que é o que sobrevive à troca de tema.
// ----------------------------------------------------------------------------

const APARENCIA: Record<SentimentLabel, { rotulo: string; chip: string; texto: string }> = {
  positivo: {
    rotulo: 'Positivo',
    chip:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-500/30',
    texto:  'text-emerald-700 dark:text-emerald-300',
  },
  negativo: {
    rotulo: 'Negativo',
    chip:   'bg-rose-500/15 text-rose-700 dark:text-rose-200 border-rose-500/30',
    texto:  'text-rose-700 dark:text-rose-300',
  },
  neutro: {
    rotulo: 'Neutro',
    chip:   'bg-muted text-muted-foreground border-border',
    texto:  'text-muted-foreground',
  },
}

// Ordena o eixo para comparar duas leituras. É a única razão pela qual os
// rótulos têm ordem: sem ela não dá para dizer se andou para cima ou para baixo.
const EIXO: Record<SentimentLabel, number> = { negativo: -1, neutro: 0, positivo: 1 }

// Espelha VALIDADE_DIAS do service. Duplicado de propósito e não importado: o
// módulo `atendimento` é server-only, e puxá-lo para um componente do cliente
// arrastaria a camada de serviço inteira para o bundle.
const VALIDADE_DIAS = 7

export const BlocoSentimento: React.FC<{
  leitura:     LeituraSentimento | null
  carregando:  boolean
  analisando:  boolean
  // Ausente quando não há contato: sem alguém para analisar, o botão não aparece.
  aoReanalisar?: () => void
  // Mensagem da última tentativa que falhou. Vem de quem chama porque o bloco
  // não sabe chamar rota — e porque um spinner eterno seria a alternativa.
  erro?:       string | null
}> = ({ leitura, carregando, analisando, aoReanalisar, erro }) => {
  const atual    = leitura?.atual ?? null
  const anterior = leitura?.anterior ?? null

  const acao = aoReanalisar ? (
    <BotaoAcao
      titulo={atual ? 'Reanalisar o sentimento' : 'Analisar o sentimento'}
      onClick={aoReanalisar}
      disabled={analisando || carregando}
    >
      {analisando
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : atual ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-4 h-4" />}
    </BotaoAcao>
  ) : undefined

  return (
    <Bloco titulo="Leitura da IA" icone={<Sparkles className="w-3.5 h-3.5" />} acao={acao}>
      {carregando && !atual ? (
        <div className="h-16 rounded-xl bg-muted/50 animate-pulse" />
      ) : !atual ? (
        // Diz POR QUE está vazio, e não só que está. "Nenhuma leitura" faria
        // parecer defeito; o que há é conversa de menos, e isso o atendente
        // resolve conversando.
        <Vazio>
          {erro ?? 'Ainda não há conversa suficiente para ler o sentimento desta pessoa.'}
        </Vazio>
      ) : (
        <div className="space-y-3">
          {/* Veredito: o que se lê de relance. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${APARENCIA[atual.sentiment].chip}`}>
                {APARENCIA[atual.sentiment].rotulo}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                {Math.round(atual.confidence * 100)}% de confiança
              </span>
            </div>

            <p className={`text-xs font-medium leading-snug ${APARENCIA[atual.sentiment].texto}`}>
              {atual.headline}
            </p>
          </div>

          <Tendencia de={anterior?.sentiment} para={atual.sentiment} desde={anterior?.created_at} />

          {/* A justificativa cita o que a pessoa disse — é o que torna a leitura
              discordável. Um veredito sem base não se questiona, se obedece. */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            {atual.reasoning}
          </p>

          {atual.recommendations.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                Como conduzir
              </p>
              <ul className="space-y-1">
                {atual.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-foreground/90 leading-snug">
                    <span className="text-cyan-600 dark:text-cyan-400 shrink-0">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Rodape
            criadoEm={atual.created_at}
            mensagens={atual.messages_analyzed}
            erro={erro}
          />
        </div>
      )}
    </Bloco>
  )
}

// ----------------------------------------------------------------------------
// A tendência.
//
// Só desenha quando há leitura anterior E ela é diferente. Movimento é a
// informação; "continua negativo" ocuparia a mesma linha para dizer que nada
// mudou, e o espaço do painel é curto.
// ----------------------------------------------------------------------------
const Tendencia: React.FC<{
  de?:    SentimentLabel
  para:   SentimentLabel
  desde?: string
}> = ({ de, para, desde }) => {
  if (!de || de === para) return null

  const subiu = EIXO[para] > EIXO[de]
  const Icone = subiu ? TrendingUp : TrendingDown
  const cor   = subiu
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-rose-700 dark:text-rose-300'

  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-medium ${cor}`}>
      <Icone className="w-3.5 h-3.5 shrink-0" />
      <span>
        {subiu ? 'Melhorando' : 'Piorando'} — era {APARENCIA[de].rotulo.toLowerCase()}
        {desde && ` ${formatDistanceToNow(new Date(desde), { locale: ptBR, addSuffix: true })}`}
      </span>
    </p>
  )
}

// ----------------------------------------------------------------------------
// Rodapé: quantas mensagens, de quando, e o aviso de validade.
// ----------------------------------------------------------------------------
const Rodape: React.FC<{
  criadoEm:  string
  mensagens: number
  erro?:     string | null
}> = ({ criadoEm, mensagens, erro }) => {
  const idadeDias = (Date.now() - new Date(criadoEm).getTime()) / 86_400_000
  const vencida   = idadeDias >= VALIDADE_DIAS

  return (
    <div className="pt-1 space-y-1 border-t border-border/60">
      <p className="text-[10px] text-muted-foreground/60 pt-1.5">
        {mensagens} {mensagens === 1 ? 'mensagem' : 'mensagens'}
        {' · '}
        {formatDistanceToNow(new Date(criadoEm), { locale: ptBR, addSuffix: true })}
      </p>

      {/* Uma leitura de três semanas atrás desenha igual a uma de hoje. O aviso
          é o que impede alguém de agir sobre um retrato vencido achando que é o
          atual. Âmbar, que no projeto é "atenção", nunca "erro". */}
      {vencida && (
        <p className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          Pode estar desatualizada — reanalise antes de confiar.
        </p>
      )}

      {/* A leitura mostrada continua válida; o que falhou foi a tentativa de
          atualizá-la. Dizer as duas coisas juntas evita que o atendente ache
          que está vendo o resultado do clique que acabou de dar. */}
      {erro && (
        <p className="flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-400">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {erro}
        </p>
      )}
    </div>
  )
}
