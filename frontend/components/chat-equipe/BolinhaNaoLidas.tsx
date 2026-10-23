'use client'

import { useState } from 'react'

// ============================================================================
// A bolinha de não lidas no canto superior direito do item "Chat da equipe"
// (sidebar do Pulsar e do Connect). Quem usa põe `relative` no item.
//
// Pulsa (3 ondas) toda vez que o número SOBE — chegou mensagem ou menção.
// Quando desce (a pessoa leu) só troca o número, sem chamar atenção.
// ============================================================================

export default function BolinhaNaoLidas({ n, compacta = false }: { n: number; compacta?: boolean }) {
  // Número anterior guardado em estado e ajustado durante a renderização — o
  // padrão do React para "reagir a mudança de prop" sem efeito.
  const [visto, setVisto] = useState(n)
  const [pulsos, setPulsos] = useState(0)
  if (n !== visto) {
    if (n > visto) setPulsos(p => p + 1)
    setVisto(n)
  }

  if (n <= 0) return null
  const rotulo = n > 99 ? '99+' : String(n)

  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -right-1 -top-1.5 flex items-center justify-center ${
        compacta ? 'h-4 min-w-4' : 'h-5 min-w-5'
      }`}
    >
      {pulsos > 0 && (
        <span
          key={pulsos}
          // A classe (e não `animation` inline) é o que faz o Tailwind emitir
          // o @keyframes ping; o número de ondas vem por cima dela.
          className="absolute inset-0 animate-ping motion-reduce:hidden rounded-full bg-destructive/70 [animation-iteration-count:3]"
        />
      )}
      <span
        className={`relative flex h-full w-full items-center justify-center rounded-full bg-destructive px-1 font-bold leading-none text-white ring-2 ring-sidebar tabular-nums ${
          compacta ? 'text-[9px]' : 'text-[11px]'
        }`}
      >
        {rotulo}
      </span>
    </span>
  )
}
