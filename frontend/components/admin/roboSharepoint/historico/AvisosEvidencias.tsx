'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, FolderMinus, History, Lock } from 'lucide-react'
import { btnSecundario, selo } from '@/components/cronograma/grade/estilo'
import { CabecalhoSecao, Cartao, type LinhaAjudaPadrao } from '@/components/ui/padrao'
import { listarAvisosEvidencias } from '@/services/roboSharepoint.service'
import type { EventoEvidencia } from '@/types/roboSharepoint'
import { CartaoEvento } from './CartaoEvento'

// Na tela Entregas PEP: as entregas que mudaram porque a evidência saiu da
// pasta no SharePoint (20261003100000). A entrega e o valor acompanham a
// pasta; este bloco deixa à vista o que mudou, de quem era e quando. Some
// quando não há nada nos últimos 30 dias (ou sem a migration).

const INICIAIS = 4

export function AvisosEvidencias() {
  const [avisos, setAvisos] = useState<EventoEvidencia[] | null>(null)
  const [todos, setTodos] = useState(false)

  useEffect(() => {
    let vivo = true
    listarAvisosEvidencias(30).then(a => { if (vivo) setAvisos(a) })
    return () => { vivo = false }
  }, [])

  if (!avisos || avisos.length === 0) return null
  const visiveis = todos ? avisos : avisos.slice(0, INICIAIS)

  return (
    <Cartao titulo="titulo-avisos-evidencias">
      <CabecalhoSecao
        id="titulo-avisos-evidencias"
        titulo="Entregas que mudaram com o SharePoint"
        nivel="h3"
        Icone={History}
        apoio="Últimos 30 dias"
        ajuda={AJUDA}
        rotuloAjuda="Por que a entrega mudou?"
        direita={<span className={selo('amber')}>{avisos.length} {avisos.length === 1 ? 'mudança' : 'mudanças'}</span>}
      />
      <ul className="divide-y divide-border">
        {visiveis.map(e => <li key={e.id}><CartaoEvento e={e} compacto /></li>)}
      </ul>
      {avisos.length > INICIAIS && (
        <button type="button" onClick={() => setTodos(v => !v)} aria-expanded={todos} className={`mt-3 ${btnSecundario}`}>
          {todos ? 'Mostrar menos' : `Ver as ${avisos.length}`}
          <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${todos ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      )}
    </Cartao>
  )
}

const AJUDA: LinhaAjudaPadrao[] = [
  { tone: 'amber', Icone: FolderMinus, texto: 'Quando uma evidência sai da pasta, a entrega e o valor acompanham.' },
  { tone: 'green', Icone: Lock, texto: 'Mês já liberado não muda.' },
]
