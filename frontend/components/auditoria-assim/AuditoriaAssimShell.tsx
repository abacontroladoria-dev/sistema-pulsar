'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { useHeader } from '@/contexts/HeaderContext'
import AuditoriaTab from './tabs/AuditoriaTab'
import ReconciliacaoTab from './tabs/ReconciliacaoTab'
import type { AlvoAnalise } from './types'
import { descartarAlvoReconciliacao, lerAlvoReconciliacao } from './ponteReconciliacao'

const TABS = ['auditoria', 'reconciliacao'] as const
type TabKey = (typeof TABS)[number]

const TAB_META: Record<TabKey, { titulo: string; subtitulo: string }> = {
  auditoria: {
    titulo: 'Conferência ASSIM',
    subtitulo: 'Controle operacional de autorizações e pendências',
  },
  reconciliacao: {
    titulo: 'Autorizações e pendências',
    subtitulo: 'Autorizações, faltas, cancelamentos e glosas.',
  },
}

/**
 * Casca de abas do módulo ASSIM.
 *
 * Mesmo padrão de components/cronograma/ocupacao/OcupacaoShell.tsx: o Shell lê o
 * `?tab=` e cada aba é um componente em ./tabs/. A page.tsx só envolve num
 * <Suspense> — obrigatório, porque useSearchParams em componente cliente quebra o
 * build de produção sem boundary (em dev funciona, o que esconde o problema).
 *
 * Permissões: NÃO há código novo. `auditoria_assim` em lib/permissions/routes.ts é
 * bare path ('/auditoria-assim'), e routeMatches sem '?' compara só o pathname —
 * então já cobre as duas abas para todos os roles que hoje têm acesso (recepcao,
 * autorizacao, admin, diretoria). Trocar para '?tab=auditoria' faria quem abrisse
 * /auditoria-assim puro cair em /sem-permissao.
 */
export default function AuditoriaAssimShell() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setHeader } = useHeader()

  const rawTab = searchParams.get('tab')
  const activeTab: TabKey = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'auditoria'

  useEffect(() => {
    if (!rawTab) router.replace('/auditoria-assim?tab=auditoria')
  }, [rawTab, router])

  useEffect(() => {
    const meta = TAB_META[activeTab]
    setHeader(meta.titulo, meta.subtitulo)
  }, [activeTab, setHeader])

  /**
   * A ponte da Conferência para a Reconciliação: a linha em glosa manda o
   * paciente e a semana, e a outra aba abre já resolvida.
   *
   * Estado, e não query string, por dois motivos. Nome de paciente e carteirinha
   * numa URL vazam para o histórico do navegador sem necessidade. E o Shell é o
   * mesmo componente montado nas duas abas — só o `?tab=` muda —, então o estado
   * sobrevive à navegação. O preço, aceito: o pulo não é bookmarkável e se perde
   * no reload.
   */
  // A mesma ponte pode vir de OUTRA rota (a Conferência de Guias), por
  // sessionStorage — só vale se a chegada é na aba de destino. Apagada depois de
  // montar, chegue ou não a ser usada: um alvo velho não pode ressuscitar.
  const [alvoAnalise, setAlvoAnalise] = useState<AlvoAnalise | null>(() =>
    rawTab === 'reconciliacao' ? lerAlvoReconciliacao() : null
  )
  useEffect(() => descartarAlvoReconciliacao(), [])

  const irParaAnalise = useCallback(
    (alvo: AlvoAnalise) => {
      setAlvoAnalise(alvo)
      router.push('/auditoria-assim?tab=reconciliacao')
    },
    [router]
  )

  return (
    <div className="flex flex-col gap-4">
      {activeTab === 'auditoria' && <AuditoriaTab onAnalisarSemana={irParaAnalise} />}
      {activeTab === 'reconciliacao' && (
        <ReconciliacaoTab alvo={alvoAnalise} onAlvoConsumido={() => setAlvoAnalise(null)} />
      )}
    </div>
  )
}
