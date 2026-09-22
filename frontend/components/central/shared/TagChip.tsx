'use client'

import React from 'react'
import { X } from 'lucide-react'

// ============================================================================
// TagChip — visual único de tag em toda a Central.
//
// Extraído de components/nina/detalhamento/BlocoTags.tsx (que continua usando
// este mesmo componente, não uma cópia) para não duplicar a lógica de cor: a
// cor vem de tag_definitions.color, hex do banco, não classe do Tailwind — por
// isso é style inline (`bg-[${cor}]` não existiria no CSS final, que é
// estático em build). A cor entra com transparência no fundo e cheia no
// texto, o que mantém contraste legível para qualquer matiz cadastrada depois.
//
// Chave desconhecida (aplicada mas fora do catálogo) é desenhada assim mesmo,
// em cinza — esconder faria a tag sumir sem ninguém saber que ela existia, e
// o banco aceita qualquer string na coluna.
// ============================================================================

export function corComAlfa(hex: string | null, alfa: string): string | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined
  return `${hex}${alfa}`
}

export const TagChip: React.FC<{
  rotulo:     string
  cor:        string | null
  aoRemover?: () => void
}> = ({ rotulo, cor, aoRemover }) => (
  <span
    className="inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full text-[11px] font-medium border"
    style={{
      backgroundColor: corComAlfa(cor, '22'),
      borderColor:     corComAlfa(cor, '55'),
      color:           cor ?? undefined,
    }}
  >
    <span className={cor ? '' : 'text-muted-foreground'}>{rotulo}</span>
    {aoRemover && (
      <button
        type="button"
        onClick={aoRemover}
        title={`Remover ${rotulo}`}
        aria-label={`Remover ${rotulo}`}
        className="opacity-60 hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </button>
    )}
  </span>
)
