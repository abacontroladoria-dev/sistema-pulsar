"use client"

import type { Tone } from "@/hooks/useToneColor"
import { TONE_PANEL } from "@/components/ui/tones"
import { FOCO } from "./vocabulario"

// Extraído de AuditoriaEvolucoesShell.tsx (15/10/2026) para a Auditoria de
// Documentos PEP usar o mesmo cartão-filtro. Visual idêntico.

/**
 * Borda do card selecionado, por tom.
 *
 * Escrita por extenso porque o Tailwind varre o código em busca de classes
 * literais — montar `border-${tom}-300` em tempo de execução produziria classes
 * que nunca chegam ao CSS. Espelha `TONE_PANEL.ring` de components/ui/tones.
 */
const BORDA_ATIVA: Record<Tone, string> = {
  green: 'border-emerald-300 dark:border-emerald-700',
  amber: 'border-amber-300 dark:border-amber-700',
  red: 'border-rose-300 dark:border-rose-700',
  purple: 'border-purple-300 dark:border-purple-700',
  blue: 'border-sky-300 dark:border-sky-700',
  gray: 'border-slate-300 dark:border-slate-600'
}

/**
 * Cartão de KPI que também é o filtro daquele recorte.
 *
 * Era um `<div>` inerte enquanto dois `<select>` ofereciam os mesmos cortes sem
 * o número que motiva o clique — a porta interessante estava pintada na parede.
 * O padrão de card-como-filtro (`border-2` + tint no ativo) vem de
 * central-terapeutas/ControleFiltersBar e auditoria-assim/FiltrosAuditoria; a
 * diferença aqui é usar os tokens semânticos em vez da paleta crua.
 *
 * Card com zero fica desabilitado: oferecer um filtro que não devolve nada é
 * prometer uma porta para um cômodo vazio.
 */
export function KpiFiltro({
  rotulo, valor, nota, cor, tom = 'gray', ativo = false,
  desabilitado = false, onClick, rotuloFiltro, className = ''
}: {
  rotulo: string
  valor: number | string
  nota: string
  cor?: string
  tom?: Tone
  ativo?: boolean
  desabilitado?: boolean
  onClick?: () => void
  rotuloFiltro?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-pressed={ativo}
      title={desabilitado ? undefined : rotuloFiltro}
      className={`
        rounded-2xl border-2 p-5 text-left shadow-sm transition
        ${FOCO}
        ${ativo
          ? `${TONE_PANEL[tom].bg} ${BORDA_ATIVA[tom]}`
          : 'border-border bg-card'}
        ${desabilitado
          ? 'cursor-default opacity-60'
          : 'cursor-pointer hover:-translate-y-px hover:shadow-md'}
        ${className}
      `}
    >
      <span className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <div
        className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-foreground"
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </div>
      <span className="mt-1.5 block text-[11px] text-muted-foreground">{nota}</span>
    </button>
  )
}
