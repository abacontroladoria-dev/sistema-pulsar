'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Image as Icone, Mic, Video, Paperclip, Download, Loader2, AlertCircle, ExternalLink, X } from 'lucide-react'
import type { AnexoUI } from './adapters/centralToNina'
import { VisualizadorImagem } from './VisualizadorImagem'

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
//
// EXCEÇÃO: IMAGEM ABRE SOZINHA. Foto é lida de relance, e um chip "Imagem"
// pedindo clique em cada uma travava o atendimento. Ainda sob demanda, mas a
// demanda é a bolha APARECER na tela (IntersectionObserver): o histórico que
// ninguém rolou até ver continua sem custar ida nenhuma à Graph.
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
  const [ampliada, setAmpliada] = useState(false)
  // A URL assinada vence em 5 min; se a <img> remontar depois disso, uma nova
  // busca resolve. Uma só — arquivo quebrado de verdade não pode virar laço.
  const [renovou, setRenovou] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  const Icon = ICONE[anexo.rotulo] ?? Paperclip
  const ehImagem = anexo.rotulo === 'Imagem' || anexo.rotulo === 'Figurinha'
  const ehPdf = anexo.rotulo === 'Documento' && !!anexo.nome?.toLowerCase().endsWith('.pdf')
  // Imagem e PDF abrem sozinhos ao aparecer na tela; o resto espera o clique.
  const abreSozinho = ehImagem || ehPdf

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
      const res  = await fetch(`/api/central/anexos/${anexo.id}/`, { cache: 'no-store' })
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

  // Imagem: abre quando o chip entra na tela. Só a partir de 'fechado' — erro
  // fica no chip (o clique tenta de novo), senão uma mídia expirada na Meta
  // seria pedida de novo a cada rolagem.
  const fechado = estado.fase === 'fechado'
  useEffect(() => {
    if (!abreSozinho || !fechado) return
    const el = chipRef.current
    if (!el) return
    const obs = new IntersectionObserver(entradas => {
      if (entradas.some(e => e.isIntersecting)) {
        obs.disconnect()
        void abrir()
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
    // `abrir` é recriada a cada render; o que importa é a fase e o anexo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abreSozinho, fechado, anexo.id])

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
    if (ehImagem) {
      const url = estado.url
      return (
        <>
          <button
            type="button"
            onClick={() => setAmpliada(true)}
            title="Ampliar"
            aria-label={`Ampliar ${titulo}`}
            className="block rounded-lg cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={titulo}
              onError={() => {
                if (renovou) {
                  setEstado({ fase: 'erro', mensagem: 'Não foi possível exibir a imagem.' })
                  return
                }
                setRenovou(true)
                setEstado({ fase: 'fechado' })
              }}
              className="rounded-lg max-h-72 w-auto object-contain bg-black/10"
            />
          </button>
          {ampliada && (
            <VisualizadorImagem url={url} titulo={titulo} aoFechar={() => setAmpliada(false)} />
          )}
        </>
      )
    }
    if (ehPdf) {
      return <PreviaPdf url={estado.url} titulo={titulo} legenda={legenda} nome={anexo.nome} claro={claro} />
    }
    if (anexo.rotulo === 'Áudio') {
      return <PlayerAudio url={estado.url} claro={claro} />
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
      ref={chipRef}
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

// ----------------------------------------------------------------------------
// PDF: a primeira página na própria bolha (o visualizador nativo do navegador
// dentro de um <iframe>, sem barra) e o documento inteiro num painel ao clicar.
// A camada transparente por cima impede o iframe de engolir o clique e a
// rolagem da conversa.
// ----------------------------------------------------------------------------
const PreviaPdf: React.FC<{
  url: string; titulo: string; legenda: string; nome: string | null; claro: boolean
}> = ({ url, titulo, legenda, nome, claro }) => {
  const [aberta, setAberta] = useState(false)
  useEffect(() => {
    if (!aberta) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aberta])
  const secundario = claro ? 'text-white/70' : 'text-muted-foreground'

  return (
    <>
      <div className={`w-full max-w-xs overflow-hidden rounded-lg border ${claro ? 'border-white/25' : 'border-border'}`}>
        <button
          type="button"
          onClick={() => setAberta(true)}
          title="Ver documento"
          aria-label={`Ver ${titulo}`}
          className="relative block h-56 w-full cursor-zoom-in bg-white"
        >
          <iframe
            src={`${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={`Prévia de ${titulo}`}
            tabIndex={-1}
            loading="lazy"
            className="pointer-events-none h-full w-full border-0"
          />
          <span aria-hidden className="absolute inset-0" />
        </button>
        <div className={`flex items-center gap-2 px-3 py-2 ${claro ? 'bg-white/10' : 'bg-background/60'}`}>
          <FileText className="w-4 h-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{titulo}</p>
            <p className={`text-[10px] ${secundario}`}>{legenda}</p>
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download={nome ?? undefined}
            title="Baixar"
            aria-label={`Baixar ${titulo}`}
            className="shrink-0 p-1 rounded hover:bg-black/10"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {aberta && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          onClick={() => setAberta(false)}
          className="fixed inset-0 z-60 flex flex-col items-center bg-black/85 p-3 sm:p-6"
        >
          <div className="mb-2 flex w-full max-w-4xl items-center justify-between gap-2 text-white" onClick={e => e.stopPropagation()}>
            <p className="truncate text-sm font-medium">{titulo}</p>
            <div className="flex items-center gap-1">
              <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir em nova aba" aria-label="Abrir em nova aba" className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10">
                <ExternalLink className="w-5 h-5" />
              </a>
              <button type="button" onClick={() => setAberta(false)} aria-label="Fechar" className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <iframe
            src={url}
            title={titulo}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-4xl flex-1 rounded-lg border-0 bg-white"
          />
        </div>,
        document.body,
      )}
    </>
  )
}

// ----------------------------------------------------------------------------
// Áudio: o player nativo, mais duas coisas que ele não tem e que quem atende
// usa o dia todo — acelerar (1× → 1,5× → 2×) e tocar um áudio por vez. Dar
// play num pausa o que estiver tocando, como no WhatsApp.
// ----------------------------------------------------------------------------
const VELOCIDADES = [1, 1.5, 2] as const
let tocandoAgora: HTMLAudioElement | null = null

const PlayerAudio: React.FC<{ url: string; claro: boolean }> = ({ url, claro }) => {
  const ref = useRef<HTMLAudioElement>(null)
  const [vel, setVel] = useState(0)

  const trocarVelocidade = () => {
    const proxima = (vel + 1) % VELOCIDADES.length
    setVel(proxima)
    if (ref.current) ref.current.playbackRate = VELOCIDADES[proxima]
  }

  return (
    <div className="flex items-center gap-1.5 w-full max-w-xs">
      <audio
        ref={ref}
        src={url}
        controls
        className="w-full min-w-0"
        onPlay={e => {
          if (tocandoAgora && tocandoAgora !== e.currentTarget) tocandoAgora.pause()
          tocandoAgora = e.currentTarget
          e.currentTarget.playbackRate = VELOCIDADES[vel]
        }}
      />
      <button
        type="button"
        onClick={trocarVelocidade}
        title="Velocidade de reprodução"
        aria-label={`Velocidade ${String(VELOCIDADES[vel]).replace('.', ',')}×`}
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums transition-colors ${
          claro ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-background text-foreground border border-border hover:bg-muted'
        }`}
      >
        {String(VELOCIDADES[vel]).replace('.', ',')}×
      </button>
    </div>
  )
}
