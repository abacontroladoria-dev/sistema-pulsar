'use client'

import React, { useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { iniciais } from './adapters/centralToNina'
import { VisualizadorImagem } from './VisualizadorImagem'

// `avatar_url` é nullable no banco e o caminho /assets/default-avatar.png que o
// transform legado usava não existe no projeto — apontar <img> para ele daria
// ícone de imagem quebrada em toda linha da lista. Sem url, desenha iniciais.
//
// Mora em arquivo próprio porque o painel de detalhamento também o usa;
// importá-lo do ChatInterface criaria ciclo (o ChatInterface importa o painel).
//
// `ampliavel`: a lupa por cima da foto abre ela em tamanho real. Só onde a
// foto é O contato da tela (cabeçalho da conversa, painel) — na lista, um
// clique no avatar tem que abrir a conversa, não a foto.
export const Avatar: React.FC<{ url: string; nome: string; ampliavel?: boolean }> = ({ url, nome, ampliavel }) => {
  // URL que falhou (foto apagada do bucket, sessão expirou): volta às iniciais
  // em vez de mostrar o ícone de imagem quebrada.
  const [falhou, setFalhou] = useState<string | null>(null)
  const [ampliada, setAmpliada] = useState(false)

  if (url && falhou !== url) {
    const foto = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={nome}
        loading="lazy"
        onError={() => setFalhou(url)}
        className="w-full h-full rounded-full object-cover border border-border"
      />
    )
    if (!ampliavel) return foto

    return (
      <>
        <button
          type="button"
          onClick={() => setAmpliada(true)}
          title="Ver foto"
          aria-label={`Ver foto de ${nome}`}
          className="group/foto relative block w-full h-full rounded-full"
        >
          {foto}
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 group-hover/foto:opacity-100 group-focus-visible/foto:opacity-100 transition-opacity">
            <ZoomIn className="w-1/2 h-1/2 max-w-6 max-h-6" />
          </span>
        </button>
        {ampliada && (
          <VisualizadorImagem url={url} titulo={`Foto de ${nome}`} aoFechar={() => setAmpliada(false)} />
        )}
      </>
    )
  }
  return (
    <div className="w-full h-full rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs font-semibold">
      {iniciais(nome)}
    </div>
  )
}

export default Avatar
