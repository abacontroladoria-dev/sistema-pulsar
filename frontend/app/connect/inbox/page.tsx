'use client'

import { Suspense } from 'react'
import ChatInterface from '@/components/nina/ChatInterface'

// O <Suspense> é obrigatório: useCentralInbox lê `?c=<id>` com useSearchParams
// para abrir a conversa que a triagem (/connect/atendimentos) apontou, e um
// componente cliente que chama useSearchParams sem boundary faz o `next build`
// falhar com "Missing Suspense boundary with useSearchParams". Em dev o erro não
// aparece — só quebra na build de produção.
export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <ChatInterface />
    </Suspense>
  )
}
