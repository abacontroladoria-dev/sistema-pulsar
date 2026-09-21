'use client'

import React from 'react'
import { FileText, Image as Icone, Mic, Video, Paperclip } from 'lucide-react'
import type { AnexoUI } from './adapters/centralToNina'

// ============================================================================
// O que veio anexado
//
// Até agora a bolha mostrava `[imagem]` — o placeholder que o webhook escreve
// no corpo quando a mídia chega sem legenda. Isso diz ao atendente que algo
// chegou e nada além: não diz o quê, não diz se vale parar para abrir, e some
// no meio do texto como se fosse uma mensagem escrita pela pessoa.
//
// Este chip diz o que é (Documento), como se chama (laudo-neuro.pdf) e quanto
// pesa ou quanto dura (1,2 MB / 12s). Com isso o atendente decide: um áudio de
// 8 segundos ele ouve agora, um de 4 minutos ele agenda; um PDF chamado
// "laudo" ele sabe que precisa pedir de novo se não abrir.
//
// POR QUE NÃO ABRE
//
// Porque não há o que abrir ainda. `storage_path` está 'pending' em todo anexo
// de produção (o worker que baixa a mídia da Meta não existe — não há bucket
// para a Central), e `external_url` é a URL temporária da Meta: expira em 24h e
// exige o token da WABA no header, então um <img src> nela leva 401.
//
// Enquanto isso, o chip é honesto sobre o estado: "ainda não disponível aqui" e
// a saída prática, que é abrir a conversa no WhatsApp. Um chip clicável que
// leva a lugar nenhum seria pior que o placeholder que ele substitui.
//
// `disponivel` é o fio já religado para quando o bucket existir: nesse dia o
// chip vira link, e nada mais nesta tela precisa mudar.
// ============================================================================

const ICONE: Record<string, React.ComponentType<{ className?: string }>> = {
  'Imagem':     Icone,
  'Áudio':      Mic,
  'Vídeo':      Video,
  'Documento':  FileText,
  'Figurinha':  Icone,
}

export const ChipAnexo: React.FC<{ anexo: AnexoUI; claro: boolean }> = ({ anexo, claro }) => {
  const Icon = ICONE[anexo.rotulo] ?? Paperclip

  // A bolha de saída é o gradiente cyan/teal com texto branco; a de entrada é
  // `bg-muted` com texto do tema. O chip vive DENTRO da bolha, então herda o
  // contraste dela — daí o par em vez de tokens fixos, que sumiriam num dos
  // dois fundos.
  const moldura = claro
    ? 'border-white/25 bg-white/10'
    : 'border-border bg-background/60'
  const secundario = claro ? 'text-white/70' : 'text-muted-foreground'

  // Nome quando há; senão o rótulo vira o título. Documento quase sempre traz
  // nome, imagem e áudio quase nunca — e "Áudio · 12s" é um título perfeitamente
  // bom, melhor que um nome inventado.
  const titulo = anexo.nome ?? anexo.rotulo

  return (
    <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${moldura}`}>
      <Icon className="w-4 h-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{titulo}</p>
        <p className={`text-[10px] ${secundario}`}>
          {/* Sem repetir o rótulo quando ele já é o título. */}
          {[anexo.nome ? anexo.rotulo : null, anexo.detalhe]
            .filter(Boolean)
            .join(' · ') || anexo.rotulo}
        </p>
      </div>
      {!anexo.disponivel && (
        <span
          className={`text-[10px] shrink-0 ${secundario}`}
          title="O arquivo fica no WhatsApp; a Central ainda não guarda uma cópia."
        >
          só no WhatsApp
        </span>
      )}
    </div>
  )
}
