'use client'

import React from 'react'
import { iniciais } from './adapters/centralToNina'

// `avatar_url` é nullable no banco e o caminho /assets/default-avatar.png que o
// transform legado usava não existe no projeto — apontar <img> para ele daria
// ícone de imagem quebrada em toda linha da lista. Sem url, desenha iniciais.
//
// Mora em arquivo próprio porque o painel de detalhamento também o usa;
// importá-lo do ChatInterface criaria ciclo (o ChatInterface importa o painel).
export const Avatar: React.FC<{ url: string; nome: string }> = ({ url, nome }) => {
  if (url) {
    return (
      <img
        src={url}
        alt={nome}
        className="w-full h-full rounded-full object-cover border border-slate-800"
      />
    )
  }
  return (
    <div className="w-full h-full rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 text-xs font-semibold">
      {iniciais(nome)}
    </div>
  )
}

export default Avatar
