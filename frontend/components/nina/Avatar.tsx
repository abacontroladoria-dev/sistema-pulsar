'use client'

import React, { useState } from 'react'
import { iniciais } from './adapters/centralToNina'

// `avatar_url` é nullable no banco e o caminho /assets/default-avatar.png que o
// transform legado usava não existe no projeto — apontar <img> para ele daria
// ícone de imagem quebrada em toda linha da lista. Sem url, desenha iniciais.
//
// Mora em arquivo próprio porque o painel de detalhamento também o usa;
// importá-lo do ChatInterface criaria ciclo (o ChatInterface importa o painel).
export const Avatar: React.FC<{ url: string; nome: string }> = ({ url, nome }) => {
  // URL que falhou (foto apagada do bucket, sessão expirou): volta às iniciais
  // em vez de mostrar o ícone de imagem quebrada.
  const [falhou, setFalhou] = useState<string | null>(null)
  if (url && falhou !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={nome}
        loading="lazy"
        onError={() => setFalhou(url)}
        className="w-full h-full rounded-full object-cover border border-border"
      />
    )
  }
  return (
    <div className="w-full h-full rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs font-semibold">
      {iniciais(nome)}
    </div>
  )
}

export default Avatar
