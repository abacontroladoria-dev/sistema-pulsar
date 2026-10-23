'use client'

import React, { useState } from 'react'
import { Captions, Loader2, RotateCw } from 'lucide-react'
import type { TranscricaoUI } from './adapters/centralToNina'

// ============================================================================
// O texto do áudio, embaixo do player
//
// O worker do tique transcreve todo áudio recebido; quando a atendente abre a
// conversa o texto quase sempre já está aqui. O botão cobre o resto: áudio de
// antes da feature, o que falhou, e o que chegou há segundos e o tique ainda
// não pegou.
//
// O texto vem do anexo pelo polling de 5s do detalhe. O resultado do clique é
// mostrado na hora (estado local) e o poll seguinte confirma — mesma promessa
// do ChipAnexo: nenhuma cópia do servidor sobrevive ao componente.
// ============================================================================

// Acima disto a transcrição abre recolhida: um áudio de 3 minutos vira um
// parágrafo que empurra a conversa para fora da tela.
const LIMITE_RECOLHIDA = 320

type Local =
  | { fase: 'ocioso' }
  | { fase: 'pedindo' }
  | { fase: 'pronta'; texto: string }
  | { fase: 'erro'; mensagem: string }

export const TranscricaoAudio: React.FC<{
  anexoId:     string
  transcricao: TranscricaoUI
  claro:       boolean
}> = ({ anexoId, transcricao, claro }) => {
  const [local, setLocal] = useState<Local>({ fase: 'ocioso' })
  const [aberta, setAberta] = useState(false)
  const secundario = claro ? 'text-white/70' : 'text-muted-foreground'
  const filete     = claro ? 'border-white/30' : 'border-border'
  const link       = `inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline disabled:opacity-60 ${secundario}`

  const pedir = async () => {
    if (local.fase === 'pedindo') return
    setLocal({ fase: 'pedindo' })
    try {
      // Barra final obrigatória: sem ela o POST vira 308 e o corpo se perde.
      const res  = await fetch(`/api/central/anexos/${anexoId}/transcrever/`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Não foi possível transcrever (${res.status}).`)
      }
      setLocal({ fase: 'pronta', texto: String(json?.data?.texto ?? '') })
    } catch (err) {
      setLocal({ fase: 'erro', mensagem: (err as Error).message })
    }
  }

  // O que vale: o servidor quando já tem texto; senão o que o clique trouxe.
  const texto = transcricao.fase === 'pronta'
    ? transcricao.texto
    : local.fase === 'pronta' ? local.texto : null

  if (texto !== null) {
    if (!texto) {
      return <p className={`text-[11px] italic ${secundario}`}>Sem fala no áudio.</p>
    }
    const longa = texto.length > LIMITE_RECOLHIDA
    return (
      <div className={`border-l-2 pl-2 ${filete}`}>
        <p className={`mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${secundario}`}>
          <Captions className="w-3 h-3" aria-hidden /> Transcrição
        </p>
        <p className={`text-xs leading-relaxed whitespace-pre-wrap wrap-break-word ${longa && !aberta ? 'line-clamp-4' : ''}`}>
          {texto}
        </p>
        {longa && (
          <button type="button" onClick={() => setAberta(v => !v)} className={link}>
            {aberta ? 'Ver menos' : 'Ver tudo'}
          </button>
        )}
      </div>
    )
  }

  if (local.fase === 'pedindo' || transcricao.fase === 'processando') {
    return (
      <p className={`flex items-center gap-1.5 text-[11px] ${secundario}`} role="status">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Transcrevendo…
      </p>
    )
  }

  // Erro do clique ganha do erro gravado: é mais recente e é o que a pessoa
  // acabou de provocar.
  const erro = local.fase === 'erro'
    ? local.mensagem
    : transcricao.fase === 'falhou' ? (transcricao.motivo ?? 'motivo não registrado') : null

  if (erro) {
    return (
      <p className={`flex flex-wrap items-center gap-x-2 text-[11px] ${secundario}`}>
        <span title={erro}>Transcrição indisponível</span>
        <button type="button" onClick={pedir} className={link}>
          <RotateCw className="w-3 h-3" aria-hidden /> Tentar de novo
        </button>
      </p>
    )
  }

  return (
    <button type="button" onClick={pedir} className={link}>
      <Captions className="w-3 h-3" aria-hidden /> Transcrever
    </button>
  )
}
