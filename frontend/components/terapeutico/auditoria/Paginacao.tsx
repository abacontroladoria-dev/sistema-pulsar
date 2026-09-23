'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FOCO } from './vocabulario'

/**
 * Paginação em memória, compartilhada pelas duas abas.
 *
 * Em memória e não no banco: o serviço já traz o período inteiro numa consulta
 * (é assim que os KPIs contam sobre o todo em vez de sobre a página), então
 * buscar de novo a cada troca de página seria uma ida ao servidor para dados
 * que já estão aqui. O que pesava era o React montar 400 linhas de uma vez.
 */
export function usePaginacao<T>(itens: T[], porPagina: number) {
  const [pagina, setPagina] = useState(1)

  /*
   * Mudou o conjunto, volta para a primeira página.
   *
   * Ajustado DURANTE o render, e não num efeito: corrigir depois faria a tela
   * pintar uma vez a página errada — no melhor caso um piscar, no pior a lista
   * vazia de uma "página 8 de 3", que se parece com "nenhum resultado" quando
   * há resultados na página 1. É o padrão que a doc do React chama de ajustar
   * estado quando um prop muda.
   *
   * `length` como gatilho porque é o sinal barato de "outro conjunto": o array
   * é recriado a cada filtro, então comparar a referência resetaria sempre.
   */
  const [tamanhoAnterior, setTamanhoAnterior] = useState(itens.length)
  if (tamanhoAnterior !== itens.length) {
    setTamanhoAnterior(itens.length)
    setPagina(1)
  }

  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina))
  // A página vigente nunca passa do total, mesmo no render em que os dois
  // ainda não conversaram.
  const paginaSegura = Math.min(pagina, totalPaginas)

  const fatia = useMemo(
    () => itens.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina),
    [itens, paginaSegura, porPagina]
  )

  return { pagina: paginaSegura, setPagina, totalPaginas, fatia }
}

export function Paginacao({
  pagina, totalPaginas, total, porPagina, onMudar, rotuloItem, comDivisoria = true
}: {
  pagina: number
  totalPaginas: number
  total: number
  porPagina: number
  onMudar: (p: number) => void
  /** Como chamar o que está sendo paginado: ['evolução', 'evoluções']. */
  rotuloItem: [string, string]
  /** Falso quando a paginação já tem moldura própria (fora de uma tabela). */
  comDivisoria?: boolean
}) {
  // Uma página só não é paginação — é ruído com dois botões desabilitados.
  if (totalPaginas <= 1) return null

  const primeiro = (pagina - 1) * porPagina + 1
  const ultimo = Math.min(pagina * porPagina, total)

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${
      comDivisoria ? 'border-t border-border' : ''
    }`}>
      <p className="text-[11px] text-muted-foreground">
        <span className="font-semibold tabular-nums text-foreground">{primeiro}–{ultimo}</span>
        {' de '}
        <span className="font-semibold tabular-nums text-foreground">{total}</span>
        {' '}{total === 1 ? rotuloItem[0] : rotuloItem[1]}
      </p>

      <div className="flex items-center gap-1">
        <BotaoPagina
          rotulo="Página anterior"
          onClick={() => onMudar(pagina - 1)}
          desabilitado={pagina === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </BotaoPagina>

        <span className="px-2 text-[11px] tabular-nums text-muted-foreground">
          {pagina} de {totalPaginas}
        </span>

        <BotaoPagina
          rotulo="Próxima página"
          onClick={() => onMudar(pagina + 1)}
          desabilitado={pagina === totalPaginas}
        >
          <ChevronRight className="h-4 w-4" />
        </BotaoPagina>
      </div>
    </div>
  )
}

function BotaoPagina({ rotulo, onClick, desabilitado, children }: {
  rotulo: string
  onClick: () => void
  desabilitado: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-border
        bg-background text-foreground transition hover:bg-muted/40
        disabled:opacity-30 disabled:hover:bg-background ${FOCO}`}
    >
      {children}
    </button>
  )
}
