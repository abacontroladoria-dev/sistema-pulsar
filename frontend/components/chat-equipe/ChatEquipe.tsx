'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

import { useChatEquipe } from '@/contexts/ChatEquipeContext'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import Conversas from './Conversas'

const MencoesAMim = dynamic(() => import('@/components/connect/mencoes/MencoesAMim'), { ssr: false })

// ============================================================================
// O conteúdo do Chat da equipe — o mesmo no painel lateral e em /chat-equipe.
//
// Abas, cada uma só para quem tem a fonte:
//   Conversas  as conversas diretas que já têm mensagem (todo usuário logado)
//   Usuários   todo usuário ativo — de onde se começa uma conversa
//   Menções    acesso ao Connect (notas internas em que marcaram a pessoa)
// Quem tem só Menções vê só ela, sem a barra de abas.
// ============================================================================

type Aba = 'conversas' | 'usuarios' | 'mencoes'

export default function ChatEquipe() {
  const { fontes, naoLidas } = useChatEquipe()
  const { userId, loading } = useUsuarioAtual()
  const [escolhida, setEscolhida] = useState<Aba>('conversas')

  const abas = ([
    { id: 'conversas', rotulo: 'Conversas', n: naoLidas.conversas, tem: fontes.conversas },
    { id: 'usuarios',  rotulo: 'Usuários',  n: 0,                  tem: fontes.conversas },
    { id: 'mencoes',   rotulo: 'Menções',   n: naoLidas.mencoes,   tem: fontes.mencoes },
  ] as const).filter(a => a.tem)
  const aba: Aba = abas.some(a => a.id === escolhida) ? escolhida : (abas[0]?.id ?? 'conversas')

  if (!fontes.conversas && !fontes.mencoes) {
    return (
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">
        Você ainda não tem acesso ao Chat da equipe. Peça a liberação a quem administra os acessos.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {abas.length > 1 && (
        <div role="tablist" aria-label="Chat da equipe" className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          {abas.map(a => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={aba === a.id}
              onClick={() => setEscolhida(a.id)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors ${
                aba === a.id
                  ? 'border-cyan-600 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {a.rotulo}
              {a.n > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
                  {a.n > 99 ? '99+' : a.n}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {aba === 'mencoes' ? (
          <MencoesAMim noPainel />
        ) : loading || !userId ? (
          <div className="flex justify-center py-12 text-muted-foreground/70">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <Conversas
            key={aba}
            euId={userId}
            modo={aba}
            aoIrParaUsuarios={() => setEscolhida('usuarios')}
          />
        )}
      </div>
    </div>
  )
}
