'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Paperclip, Send, Mic, X, Trash2, Reply, Square, Lock, MessageSquare, UserRoundCog } from 'lucide-react'
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
//
// ABA "NOTA INTERNA"
//
// O mesmo campo, em outra cor, grava uma nota que só a equipe vê. Não há anexo
// nem áudio nesse modo, e o envio vai para outra rota — a nota nunca passa
// pelo caminho do WhatsApp. "@" abre a lista de quem enxerga a conversa; quem
// for mencionado é avisado em "Menções a mim" e pode receber a conversa
// ("Delegar"). Cada aba guarda o próprio rascunho: trocar de aba no meio de
// uma frase não pode mandar ao contato o que era recado para a colega.
// ============================================================================

export interface PessoaMencionavel {
  id:   string
  nome: string
}

type Aba = 'responder' | 'nota'

// Sem acento e minúsculo: "@dani" acha "Danielle", "@joao" acha "João".
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// O "@" em digitação logo antes do cursor: início do texto ou depois de espaço
// / quebra de linha, e até o cursor sem quebra de linha. Nomes têm espaço
// ("@Danielle Me"), então o termo também pode ter — no máximo 40 caracteres.
function arrobaNoCursor(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const antes = texto.slice(0, cursor)
  const m = /(^|\s)@([^\n@]{0,40})$/.exec(antes)
  if (!m) return null
  return { inicio: cursor - m[2].length - 1, termo: m[2] }
}

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
  // Nota interna. Lança em caso de falha — o texto fica no campo.
  enviarNota:     (texto: string, mencoes: string[], delegarPara: string | null) => Promise<void>
  enviandoNota:   boolean
  // Quem pode ser @mencionado nesta conversa (quem enxerga a caixa dela).
  mencionaveis:   PessoaMencionavel[]
  // Conversa encerrada não se delega: o backend recusaria.
  podeDelegar:    boolean
}

export const Compositor: React.FC<Props> = ({
  enviando, enviandoMidia, bloqueado, respondendo, nomeContato,
  aoCancelarResposta, enviarTexto, enviarArquivo,
  enviarNota, enviandoNota, mencionaveis, podeDelegar,
}) => {
  const [aba, setAba] = useState<Aba>('responder')
  // Um rascunho por aba — ver o cabeçalho.
  const [textoResposta, setTextoResposta] = useState('')
  const [textoNota, setTextoNota]         = useState('')
  const emNota   = aba === 'nota'
  const texto    = emNota ? textoNota : textoResposta
  const setTexto = emNota ? setTextoNota : setTextoResposta

  // Pessoas escolhidas na lista do "@". Quem continua mencionado é quem ainda
  // tem o "@Nome" no texto — apagar o nome desfaz a menção.
  const [escolhidas, setEscolhidas] = useState<PessoaMencionavel[]>([])
  const [arroba, setArroba] = useState<{ inicio: number; termo: string } | null>(null)
  const [destaque, setDestaque] = useState(0)
  const [delegar, setDelegar] = useState(false)
  const [delegarPara, setDelegarPara] = useState<string | null>(null)

  const mencionadas = useMemo(
    () => escolhidas.filter(p => textoNota.includes(`@${p.nome}`)),
    [escolhidas, textoNota],
  )

  // A pessoa para quem delegar: a escolhida, se ainda mencionada; senão a
  // única mencionada. Com várias e nenhuma escolhida, nenhuma.
  const alvoDelegacao = mencionadas.find(p => p.id === delegarPara)
    ?? (mencionadas.length === 1 ? mencionadas[0] : null)

  const sugestoes = useMemo(() => {
    if (!arroba) return []
    const termo = normalizar(arroba.termo.trim())
    // Nome completo seguido de espaço = menção já feita (é o que `escolher`
    // insere). Sem isto a lista reabriria logo depois de escolher alguém.
    if (/\s$/.test(arroba.termo) && mencionaveis.some(p => normalizar(p.nome) === termo)) return []
    return mencionaveis
      .filter(p => !termo || normalizar(p.nome).includes(termo))
      .slice(0, 8)
  }, [arroba, mencionaveis])

  // Termo com espaço que não acha ninguém: a pessoa já saiu do nome e está
  // escrevendo a frase. A lista fecha em vez de ficar aberta sobre o texto.
  const listaAberta = emNota && !!arroba && sugestoes.length > 0
  const [colado, setColado] = useState<{ arquivo: File; url: string } | null>(null)
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const arquivoRef  = useRef<HTMLInputElement>(null)
  const gravador    = useRef<MediaRecorder | null>(null)
  const pedacos     = useRef<Blob[]>([])
  const descartar   = useRef(false)

  // Conversa encerrada bloqueia a RESPOSTA, não a nota: anotar o que aconteceu
  // depois de encerrar é justamente quando a equipe mais precisa.
  const ocupado = emNota ? enviandoNota : (enviando || enviandoMidia || !!bloqueado)

  // Responder põe o cursor no campo, como no WhatsApp — e volta para a aba de
  // resposta: citar uma mensagem do contato numa nota não faz sentido. A troca
  // de aba acontece no render (padrão "ajustar estado quando a prop muda"), e
  // não num efeito, para não pintar um quadro com a aba errada.
  const [respondendoVisto, setRespondendoVisto] = useState(respondendo)
  if (respondendo !== respondendoVisto) {
    setRespondendoVisto(respondendo)
    if (respondendo) setAba('responder')
  }
  useEffect(() => {
    if (respondendo) textareaRef.current?.focus()
  }, [respondendo])

  const trocarAba = (nova: Aba) => {
    setAba(nova)
    setArroba(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // Recalcula o "@" em digitação a cada tecla ou clique que mova o cursor.
  const acompanharArroba = (valor: string, cursor: number) => {
    if (!emNota) return
    const achado = arrobaNoCursor(valor, cursor)
    setArroba(achado)
    setDestaque(0)
  }

  const escolher = (p: PessoaMencionavel) => {
    if (!arroba) return
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? textoNota.length
    const inserido = `@${p.nome} `
    const novo = textoNota.slice(0, arroba.inicio) + inserido + textoNota.slice(cursor)
    setTextoNota(novo)
    setEscolhidas(atual => atual.some(x => x.id === p.id) ? atual : [...atual, p])
    setArroba(null)
    requestAnimationFrame(() => {
      const campo = textareaRef.current
      if (!campo) return
      campo.focus()
      const pos = arroba.inicio + inserido.length
      campo.setSelectionRange(pos, pos)
    })
  }

  const gravarNota = async () => {
    if (ocupado || !textoNota.trim()) return
    const ids = mencionadas.map(p => p.id)
    // A caixa "Delegar" só vale enquanto está à mostra — apagada a última
    // menção, ela some e não pode mais segurar o envio.
    const querDelegar = podeDelegar && delegar && mencionadas.length > 0
    const para = querDelegar && alvoDelegacao ? alvoDelegacao.id : null
    if (querDelegar && !alvoDelegacao) {
      toast.error('Escolha para quem delegar a conversa.')
      return
    }
    try {
      await enviarNota(textoNota, ids, para)
      setTextoNota('')
      setEscolhidas([])
      setDelegar(false)
      setDelegarPara(null)
      toast.success(para
        ? `Nota gravada. A conversa agora é de ${alvoDelegacao!.nome}.`
        : ids.length > 0 ? 'Nota gravada e a pessoa foi avisada.' : 'Nota gravada.')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

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
    if (emNota) return gravarNota()
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
    if (emNota) {
      e.preventDefault()
      toast.error('A nota interna aceita só texto. Para mandar a imagem ao contato, volte para "Responder".')
      return
    }
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
  const temConteudo = !!texto.trim() || (!emNota && !!colado)

  const abaClasse = (ativa: boolean, nota: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
      ativa
        ? nota
          ? 'bg-amber-400 text-amber-950 shadow-sm'
          : 'bg-card text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className={`p-3 sm:p-4 border-t backdrop-blur-sm z-10 transition-colors ${
      emNota
        ? 'bg-amber-50 border-amber-300 dark:bg-amber-500/5 dark:border-amber-500/30'
        : 'bg-card border-border'
    }`}>
      <div className="max-w-4xl mx-auto">
        {!gravando && (
          <div role="tablist" aria-label="O que escrever" className="mb-2 inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs font-medium">
            <button type="button" role="tab" aria-selected={!emNota} onClick={() => trocarAba('responder')} className={abaClasse(!emNota, false)}>
              <MessageSquare className="w-3.5 h-3.5" aria-hidden />
              Responder
            </button>
            <button type="button" role="tab" aria-selected={emNota} onClick={() => trocarAba('nota')} className={abaClasse(emNota, true)}>
              <Lock className="w-3.5 h-3.5" aria-hidden />
              Nota interna
            </button>
          </div>
        )}

        {emNota && (
          <p className="mb-2 text-xs text-amber-800 dark:text-amber-300">
            Só a equipe vê. O contato não recebe. Digite <strong>@</strong> para mencionar alguém.
          </p>
        )}

        {emNota && podeDelegar && mencionadas.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-100/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <label className="inline-flex items-center gap-2 cursor-pointer font-medium min-h-[32px]">
              <input
                type="checkbox"
                checked={delegar}
                onChange={e => setDelegar(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
              />
              <UserRoundCog className="w-3.5 h-3.5" aria-hidden />
              {mencionadas.length === 1
                ? `Delegar a conversa para ${mencionadas[0].nome}`
                : 'Delegar a conversa para'}
            </label>
            {delegar && mencionadas.length > 1 && mencionadas.map(p => (
              <button
                key={p.id}
                type="button"
                aria-pressed={alvoDelegacao?.id === p.id}
                onClick={() => setDelegarPara(p.id)}
                className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                  alvoDelegacao?.id === p.id
                    ? 'border-amber-600 bg-amber-500 text-amber-950'
                    : 'border-amber-300 bg-white/60 hover:bg-white dark:border-amber-500/40 dark:bg-transparent dark:hover:bg-amber-500/10'
                }`}
              >
                {p.nome}
              </button>
            ))}
          </div>
        )}

        {!emNota && bloqueado && (
          <p className="mb-2 text-xs text-[var(--status-atencao)]">{bloqueado}</p>
        )}

        {!emNota && respondendo && (
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

        {!emNota && colado && (
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

            {!emNota && (
              <>
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
              </>
            )}

            <div className={`relative flex-1 min-w-0 rounded-2xl border focus-within:ring-2 transition-all shadow-inner ${
              emNota
                ? 'bg-white border-amber-300 focus-within:ring-amber-500/30 focus-within:border-amber-500 dark:bg-amber-500/5 dark:border-amber-500/40'
                : 'bg-background border-border focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50'
            }`}>
              {/* Lista do "@": acima do campo, para o teclado do celular não
                  cobri-la. onMouseDown impede o campo de perder o foco no
                  clique — sem isso o cursor some antes de a escolha entrar. */}
              {listaAberta && (
                <ul
                  id="lista-mencoes"
                  role="listbox"
                  aria-label="Mencionar alguém da equipe"
                  className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-full max-w-xs overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg"
                >
                  {sugestoes.map((p, i) => (
                    <li key={p.id} role="option" aria-selected={i === destaque}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setDestaque(i)}
                        onClick={() => escolher(p)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground ${
                          i === destaque ? 'bg-muted' : ''
                        }`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-semibold text-amber-900">
                          {p.nome.charAt(0).toUpperCase()}
                        </span>
                        <span className="truncate">{p.nome}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                ref={textareaRef}
                value={texto}
                onChange={e => {
                  setTexto(e.target.value)
                  acompanharArroba(e.target.value, e.target.selectionStart)
                }}
                onSelect={e => acompanharArroba(e.currentTarget.value, e.currentTarget.selectionStart)}
                onBlur={() => setArroba(null)}
                onPaste={colar}
                onKeyDown={e => {
                  if (listaAberta) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque(d => (d + 1) % sugestoes.length); return }
                    if (e.key === 'ArrowUp')   { e.preventDefault(); setDestaque(d => (d - 1 + sugestoes.length) % sugestoes.length); return }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolher(sugestoes[destaque] ?? sugestoes[0]); return }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setArroba(null); return }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void enviar()
                  } else if (e.key === 'Escape' && respondendo && !emNota) {
                    aoCancelarResposta()
                  }
                }}
                disabled={!emNota && !!bloqueado}
                aria-label={emNota ? 'Nota interna' : 'Mensagem para o contato'}
                aria-autocomplete={emNota ? 'list' : undefined}
                aria-controls={listaAberta ? 'lista-mencoes' : undefined}
                placeholder={
                  emNota ? 'Escreva uma nota para a equipe… (@ para mencionar)'
                  : colado ? 'Legenda (opcional)…'
                  : 'Digite sua mensagem…'
                }
                className="w-full bg-transparent border-none p-3.5 max-h-32 min-h-[48px] text-sm text-foreground focus:ring-0 resize-none outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
                rows={1}
              />
            </div>

            {/* Na nota, o botão só grava a nota — não há áudio para a equipe.
                Na resposta, sem texto ele grava áudio; com texto, envia — como
                no WhatsApp. */}
            {emNota ? (
              <button
                type="submit"
                disabled={ocupado || !temConteudo}
                aria-label="Gravar nota interna"
                title="Gravar nota interna"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-amber-950 shadow-lg shadow-amber-500/20 transition-all hover:scale-105 hover:bg-amber-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
              >
                {enviandoNota ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
              </button>
            ) : temConteudo ? (
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
