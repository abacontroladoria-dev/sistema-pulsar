'use client'

import { useEffect } from 'react'
import { useHeader } from '@/contexts/HeaderContext'
import { useChatEquipe } from '@/contexts/ChatEquipeContext'
import ChatEquipe from '@/components/chat-equipe/ChatEquipe'

// Chat da equipe em tela cheia. No dia a dia ele abre como painel lateral pelo
// item do menu; esta rota serve a quem prefere a tela inteira. Liberada a todo
// usuário logado (ROTAS_DE_TODOS em lib/permissions/routes.ts).
export default function ChatEquipePage() {
  const { setHeader } = useHeader()
  const { fechar } = useChatEquipe()

  useEffect(() => {
    setHeader('Chat da equipe', 'Conversas diretas com a equipe e menções em notas internas do Connect')
    return () => setHeader('', '')
  }, [setHeader])

  // O painel some nesta rota; fechá-lo evita que reapareça ao sair dela.
  useEffect(() => { fechar() }, [fechar])

  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-3xl overflow-hidden rounded-2xl border border-border bg-background">
      <ChatEquipe />
    </div>
  )
}
