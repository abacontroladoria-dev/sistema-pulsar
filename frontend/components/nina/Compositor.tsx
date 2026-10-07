'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Loader2, Paperclip, Send, Mic, X, Trash2, Reply, Square } from 'lucide-react'
import { toast } from 'sonner'

import { MessageDirection } from '@/types/nina'
import type { NinaMessage } from './adapters/centralToNina'
import { SeletorEmoji } from './SeletorEmoji'
import { Button } from './Button'

// ============================================================================
// Compositor da conversa
//
// Texto (Enter envia, Shift+Enter quebra linha), emoji no cursor, anexo,
// imagem colada (Ctrl+V), gravação de áudio e a barra "Respondendo a…".
//
// O texto digitado vira LEGENDA do anexo — a convenção do WhatsApp — e só é
// limpo depois do envio confirmado: o envio pode falhar (janela de 24h,
// número desconectado) e reescrever a mensagem inteira é o pior castigo.
// ============================================================================

// Precisa concordar com TIPOS_ACEITOS da rota /api/central/messages/midia e com
// `allowed_mime_types` do bucket (20260921160000).
const TIPOS_ACEITOS = [
  'image/jpeg', 'image/png', 'image/webp',
  'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
  'video/mp4', 'video/3gpp',
  'application/pdf', 'text/plain', 'text/csv',
  '.doc', '.docx', '.xls', '.xlsx',
].join(',')

// O que o gravador do navegador sabe produzir E o bucket/WhatsApp aceitam.
// Firefox grava ogg/opus; Chrome/Edge recentes e Safari, mp4. webm (o padrão
// antigo do Chrome) fica de fora: nem o bucket nem a Meta o aceitam.
const FORMATOS_GRAVACAO = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']

function formatoDeGravacao(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATOS_GRAVACAO.find(f => MediaRecorder.isTypeSupported(f)) ?? null
}

interface Props {
  enviando:       boolean
  enviandoMidia:  boolean
  // Conversa encerrada: o backend recusaria o envio — melhor dizer antes.
  bloqueado:      string | null
  respondendo:    NinaMessage | null
  nomeContato:    string
  aoCancelarResposta: () => void
  enviarTexto:    (texto: string, replyToId?: string) => Promise<void>
  enviarArquivo:  (arquivo: File, legenda?: string) => Promise<void>
}

export const Compositor: React.FC<Props> = ({
  enviando, enviandoMidia, bloqueado, respondendo, nomeContato,
  aoCancelarResposta, enviarTexto, enviarArquivo,
}) => {
  const [texto, setTexto] = useState('')
  const [colado, setColado] = useState<{ arquivo: File; url: string } | null>(null)
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const arquivoRef  = useRef<HTMLInputElement>(null)
  const gravador    = useRef<MediaRecorder | null>(null)
  const pedacos     = useRef<Blob[]>([])
  const descartar   = useRef(false)

  const ocupado = enviando || enviandoMidia || !!bloqueado

  // Responder põe o cursor no campo, como no WhatsApp.
  useEffect(() => {
    if (respondendo) textareaRef.current?.focus()
  }, [respondendo])

  // Cronômetro da gravação.
  useEffect(() => {
    if (!gravando) return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [gravando])

  // Solta a prévia colada e o microfone ao sair da conversa.
  useEffect(() => () => {
    if (colado) URL.revokeObjectURL(colado.url)
  }, [colado])
  useEffect(() => () => {
    descartar.current = true
    gravador.current?.stream.getTracks().forEach(t => t.stop())
    if (gravador.current?.state === 'recording') gravador.current.stop()
  }, [])

  const enviar = async () => {
    if (ocupado) return
    if (colado) {
      try {
        await enviarArquivo(colado.arquivo, texto)
        setColado(null)
        setTexto('')
      } catch (err) {
        toast.error((err as Error).message)
      }
      return
    }
    if (!texto.trim()) return
    try {
      await enviarTexto(texto, respondendo?.id)
      setTexto('')
      aoCancelarResposta()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const inserirEmoji = (emoji: string) => {
    const el = textareaRef.current
    const inicio = el?.selectionStart ?? texto.length
    const fim    = el?.selectionEnd   ?? texto.length
    setTexto(texto.slice(0, inicio) + emoji + texto.slice(fim))
    // O textarea é controlado: o valor novo só chega ao DOM no próximo render.
    requestAnimationFrame(() => {
      const campo = textareaRef.current
      if (!campo) return
      campo.focus()
      const pos = inicio + emoji.length
      campo.setSelectionRange(pos, pos)
    })
  }

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0]
    // Zera antes do await: senão escolher o mesmo arquivo de novo não dispara.
    e.target.value = ''
    if (!arquivo) return
    try {
      await enviarArquivo(arquivo, texto)
      setTexto('')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // Print colado (Ctrl+V) vira prévia com legenda, como no WhatsApp Web.
  // Texto colado segue o caminho normal.
  const colar = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find(i => i.kind === 'file')
    const arquivo = item?.getAsFile()
    if (!arquivo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(arquivo.type)) {
      e.preventDefault()
      toast.error('Só dá para colar imagem (JPG, PNG ou WebP). Para outros arquivos, use o clipe.')
      return
    }
    e.preventDefault()
    if (colado) URL.revokeObjectURL(colado.url)
    const nome = arquivo.name && arquivo.name !== 'image.png' ? arquivo.name : `print-${Date.now()}.png`
    const comNome = new File([arquivo], nome, { type: arquivo.type })
    setColado({ arquivo: comNome, url: URL.createObjectURL(comNome) })
  }

  const iniciarGravacao = async () => {
    const formato = formatoDeGravacao()
    if (!formato) {
      toast.error('Este navegador não grava áudio num formato que o WhatsApp aceita. Use o Chrome, Edge, Firefox ou Safari atualizados.')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast.error('Sem acesso ao microfone. Libere a permissão no cadeado da barra de endereço.')
      return
    }
    const rec = new MediaRecorder(stream, { mimeType: formato })
    pedacos.current = []
    descartar.current = false
    rec.ondataavailable = ev => { if (ev.data.size > 0) pedacos.current.push(ev.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      setGravando(false)
      if (descartar.current) return
      const base = formato.split(';')[0]
      const blob = new Blob(pedacos.current, { type: base })
      if (blob.size === 0) return
      const ext = base === 'audio/ogg' ? 'ogg' : 'm4a'
      const arquivo = new File([blob], `audio-${Date.now()}.${ext}`, { type: base })
      try {
        await enviarArquivo(arquivo)
      } catch (err) {
        toast.error((err as Error).message)
      }
    }
    gravador.current = rec
    rec.start()
    setSegundos(0)
    setGravando(true)
  }

  const pararGravacao = (enviarAoParar: boolean) => {
    descartar.current = !enviarAoParar
    if (gravador.current?.state === 'recording') gravador.current.stop()
  }

  const tempo = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
  const temConteudo = !!texto.trim() || !!colado

  return (
    <div className="p-3 sm:p-4 bg-card border-t border-border backdrop-blur-sm z-10">
      <div className="max-w-4xl mx-auto">
        {bloqueado && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">{bloqueado}</p>
        )}

        {respondendo && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-border border-l-4 border-l-cyan-500 bg-muted px-3 py-2">
            <Reply className="w-4 h-4 mt-0.5 text-cyan-500 shrink-0" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-semibold text-cyan-600 dark:text-cyan-400">
                Respondendo a {respondendo.direction === MessageDirection.INCOMING ? nomeContato : 'você'}
              </p>
              <p className="text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                {respondendo.content || respondendo.anexos.map(a => a.nome ?? a.rotulo).join(', ')}
              </p>
            </div>
            <button
              type="button"
              onClick={aoCancelarResposta}
              aria-label="Cancelar resposta"
              className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {colado && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-muted p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={colado.url} alt="Imagem colada" className="h-16 w-16 rounded-lg object-cover" />
            <p className="flex-1 text-xs text-muted-foreground">
              Imagem colada. O texto digitado vai como legenda.
            </p>
            <button
              type="button"
              onClick={() => setColado(null)}
              aria-label="Descartar imagem"
              className="p-1.5 rounded hover:bg-background text-muted-foreground hover:text-rose-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {gravando ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => pararGravacao(false)}
              aria-label="Descartar gravação"
              title="Descartar"
              className="p-2.5 rounded-full text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/5 px-4 py-3">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="text-sm font-medium tabular-nums text-foreground">{tempo}</span>
              <span className="text-xs text-muted-foreground">Gravando…</span>
            </div>
            <Button
              type="button"
              onClick={() => pararGravacao(true)}
              aria-label="Parar e enviar áudio"
              className="rounded-full w-12 h-12 p-0 shadow-lg shadow-cyan-500/20"
            >
              <Square className="w-4 h-4 fill-current" />
            </Button>
          </div>
        ) : (
          <form
            onSubmit={e => { e.preventDefault(); void enviar() }}
            className="flex items-end gap-1.5 sm:gap-2"
          >
            <SeletorEmoji aoEscolher={inserirEmoji} desabilitado={ocupado} />

            <input
              ref={arquivoRef}
              type="file"
              className="hidden"
              accept={TIPOS_ACEITOS}
              onChange={escolherArquivo}
            />
            <button
              type="button"
              onClick={() => arquivoRef.current?.click()}
              disabled={ocupado}
              title="Anexar arquivo"
              aria-label="Anexar arquivo"
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {enviandoMidia ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
            </button>

            <div className="flex-1 min-w-0 bg-background rounded-2xl border border-border focus-within:ring-2 focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50 transition-all shadow-inner">
              <textarea
                ref={textareaRef}
                value={texto}
                onChange={e => setTexto(e.target.value)}
                onPaste={colar}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void enviar()
                  } else if (e.key === 'Escape' && respondendo) {
                    aoCancelarResposta()
                  }
                }}
                disabled={!!bloqueado}
                placeholder={colado ? 'Legenda (opcional)…' : 'Digite sua mensagem…'}
                className="w-full bg-transparent border-none p-3.5 max-h-32 min-h-[48px] text-sm text-foreground focus:ring-0 resize-none outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
                rows={1}
              />
            </div>

            {/* Sem texto, o botão grava áudio; com texto, envia — como no WhatsApp. */}
            {temConteudo ? (
              <Button
                type="submit"
                disabled={ocupado}
                aria-label="Enviar"
                className={`rounded-full w-12 h-12 p-0 transition-all ${
                  !ocupado ? 'shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {enviando || enviandoMidia ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 ml-0.5" />}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void iniciarGravacao()}
                disabled={ocupado}
                aria-label="Gravar áudio"
                title="Gravar áudio"
                className={`rounded-full w-12 h-12 p-0 transition-all ${
                  !ocupado ? 'shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {enviandoMidia ? <Loader2 className="w-5 h-5 animate-spin" /> : <Mic className="w-5 h-5" />}
              </Button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
