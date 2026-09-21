'use client'

import React, { useState } from 'react'
import { FileText, Image as Icone, Mic, Video, Paperclip, Download, Loader2, AlertCircle } from 'lucide-react'
import type { AnexoUI } from './adapters/centralToNina'

// ============================================================================
// O que veio anexado
//
// Antes, a bolha mostrava `[imagem]` — o placeholder que o webhook escreve no
// corpo quando a mídia chega sem legenda. Isso diz que algo chegou e nada além.
//
// Agora o arquivo abre. O caminho é indireto de propósito:
//
//   bolha → GET /api/central/anexos/[id] → URL assinada (5 min) → <img>/<audio>
//
// O bucket é PRIVADO e o `storage_path` nunca chega ao cliente. Se a bolha
// tivesse o path, um cliente poderia montar caminhos de outras conversas — a
// policy os barraria, mas o padrão do path já contaria quantas conversas a
// organização tem e quando aconteceram.
//
// SOB DEMANDA, E NÃO NO CARREGAMENTO DA CONVERSA
//
// Abrir uma conversa com trinta áudios dispararia trinta idas à Graph API e
// trinta subidas ao bucket, das quais o atendente vai ouvir uma. O clique é o
// sinal de que aquele arquivo importa. A primeira abertura paga a espera; as
// seguintes leem do bucket.
//
// É também o que mantém a promessa do painel: o bloco não guarda cópia do
// estado do servidor. A URL vive no componente e morre com ele — ela expira em
// cinco minutos de qualquer forma.
// ============================================================================

const ICONE: Record<string, React.ComponentType<{ className?: string }>> = {
  'Imagem':     Icone,
  'Áudio':      Mic,
  'Vídeo':      Video,
  'Documento':  FileText,
  'Figurinha':  Icone,
}

type Estado =
  | { fase: 'fechado' }
  | { fase: 'buscando' }
  | { fase: 'aberto'; url: string }
  | { fase: 'erro'; mensagem: string }

export const ChipAnexo: React.FC<{ anexo: AnexoUI; claro: boolean }> = ({ anexo, claro }) => {
  const [estado, setEstado] = useState<Estado>({ fase: 'fechado' })
  const Icon = ICONE[anexo.rotulo] ?? Paperclip

  // A bolha de saída é o gradiente cyan/teal com texto branco; a de entrada é
  // `bg-muted` com texto do tema. O chip vive DENTRO da bolha, então herda o
  // contraste dela — daí o par em vez de tokens fixos, que sumiriam num dos
  // dois fundos.
  const moldura = claro
    ? 'border-white/25 bg-white/10 hover:bg-white/20'
    : 'border-border bg-background/60 hover:bg-background'
  const secundario = claro ? 'text-white/70' : 'text-muted-foreground'

  const abrir = async () => {
    if (estado.fase === 'buscando' || estado.fase === 'aberto') return
    setEstado({ fase: 'buscando' })
    try {
      const res  = await fetch(`/api/central/anexos/${anexo.id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // A mensagem do backend é a boa: para 422 ANEXO_INDISPONIVEL ela diz
        // POR QUE o arquivo não veio, e o motivo é o que decide se adianta
        // tentar de novo (mídia expirada na Meta, não; token vencido, sim).
        throw new Error(json?.error?.message ?? `Não foi possível abrir (${res.status}).`)
      }
      setEstado({ fase: 'aberto', url: json.data.url as string })
    } catch (err) {
      setEstado({ fase: 'erro', mensagem: (err as Error).message })
    }
  }

  // Nome quando há; senão o rótulo vira o título. Documento quase sempre traz
  // nome, imagem e áudio quase nunca — e "Áudio · 12s" é um título perfeitamente
  // bom, melhor que um nome inventado.
  const titulo = anexo.nome ?? anexo.rotulo
  const legenda = [anexo.nome ? anexo.rotulo : null, anexo.detalhe]
    .filter(Boolean)
    .join(' · ') || anexo.rotulo

  // Aberto: a mídia em si, quando o navegador sabe desenhá-la. Documento não
  // tem prévia — vira link de download, que é o que dá para fazer com um PDF
  // numa coluna de 400px.
  if (estado.fase === 'aberto') {
    if (anexo.rotulo === 'Imagem' || anexo.rotulo === 'Figurinha') {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={estado.url}
          alt={titulo}
          className="rounded-lg max-h-72 w-auto object-contain bg-black/10"
        />
      )
    }
    if (anexo.rotulo === 'Áudio') {
      // `controls` nativo: um player próprio precisaria de waveform, seek e
      // velocidade para ganhar do nativo, e nada disso muda a decisão de quem
      // ouve um áudio de paciente.
      return <audio src={estado.url} controls className="w-full max-w-xs" />
    }
    if (anexo.rotulo === 'Vídeo') {
      return <video src={estado.url} controls className="rounded-lg max-h-72 w-auto" />
    }
    return (
      <a
        href={estado.url}
        target="_blank"
        rel="noopener noreferrer"
        // `download` com o nome ORIGINAL: o arquivo no bucket tem nome gerado
        // (o original vazaria dado de paciente em log de storage), então sem
        // isto quem baixa recebe "1758470400.pdf".
        download={anexo.nome ?? undefined}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${moldura}`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{titulo}</p>
          <p className={`text-[10px] ${secundario}`}>{legenda}</p>
        </div>
        <Download className="w-3.5 h-3.5 shrink-0" />
      </a>
    )
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={estado.fase === 'buscando'}
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left w-full transition-colors ${moldura} disabled:cursor-wait`}
    >
      {estado.fase === 'buscando'
        ? <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
        : estado.fase === 'erro'
          ? <AlertCircle className="w-4 h-4 shrink-0" />
          : <Icon className="w-4 h-4 shrink-0" />}

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{titulo}</p>
        <p className={`text-[10px] ${secundario}`}>
          {estado.fase === 'erro' ? estado.mensagem : legenda}
        </p>
      </div>

      {/* Só quando o arquivo ainda não é nosso. Depois da primeira abertura ele
          está no bucket e o aviso deixa de valer — mas o componente não recarrega
          a conversa para descobrir isso, então o rótulo some junto com o clique. */}
      {estado.fase === 'fechado' && !anexo.disponivel && (
        <span className={`text-[10px] shrink-0 ${secundario}`}>abrir</span>
      )}
    </button>
  )
}
