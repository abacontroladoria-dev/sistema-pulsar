'use client'

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { AlertCircle, FileText, Loader2, Paperclip, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  MAX_ANEXOS, MAX_BYTES_ANEXO, MAX_CARACTERES, ehImagem, removerAnexos, subirAnexo,
  type AnexoChat, type MensagemChat,
} from '@/lib/chat/cliente'
import SeletorEmoji from './SeletorEmoji'
import { resumo } from './BolhaMensagem'

// ============================================================================
// O campo de escrita do fio.
//
//   Enter envia, Shift+Enter quebra linha (no celular o Enter quebra linha e
//   quem envia é o botão). Esc cancela a resposta ou a edição. Seta para cima
//   com o campo vazio edita a sua última mensagem.
//   Anexo: clipe, colar (Ctrl+V de um print) ou arrastar sobre o fio — o fio
//   chama `adicionar` pela ref. Cada arquivo sobe assim que entra; enviar só
//   espera os que ainda estão subindo.
//   Rascunho: o que ficou escrito volta ao reabrir a conversa (nesta aba).
// ============================================================================

export interface CompositorApi {
  adicionar: (arquivos: File[]) => void
  focar:     () => void
}

interface Pendente {
  id:      string
  arquivo: File
  previa:  string | null
  anexo:   AnexoChat | null
  erro:    string | null
}

interface Props {
  ref?:             Ref<CompositorApi>
  conversaId:       string
  euId:             string
  nomeOutro:        string
  respondendo:      MensagemChat | null
  editando:         MensagemChat | null
  nomeDe:           (id: string) => string
  aoCancelar:       () => void
  aoEnviar:         (corpo: string, anexos: AnexoChat[]) => Promise<boolean>
  aoSalvarEdicao:   (m: MensagemChat, corpo: string) => Promise<boolean>
  aoEditarUltima:   () => void
  aoDigitar:        () => void
}

const chaveRascunho = (id: string) => `pulsar:chat:rascunho:${id}`

function lerRascunho(id: string): string {
  try { return sessionStorage.getItem(chaveRascunho(id)) ?? '' } catch { return '' }
}
function gravarRascunho(id: string, texto: string): void {
  try {
    if (texto.trim()) sessionStorage.setItem(chaveRascunho(id), texto)
    else sessionStorage.removeItem(chaveRascunho(id))
  } catch { /* sem armazenamento: o rascunho só não volta */ }
}

export default function Compositor({ ref, ...p }: Props) {
  const [texto, setTextoBruto] = useState(() => lerRascunho(p.conversaId))
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [emojiAberto, setEmojiAberto] = useState(false)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const arquivoRef = useRef<HTMLInputElement>(null)
  // O que estava escrito antes de entrar na edição volta quando ela acaba.
  const [antesDaEdicao, setAntesDaEdicao] = useState<string | null>(null)

  // O rascunho guardado é o da mensagem nova, nunca o texto de uma edição.
  const setTexto = (t: string | ((a: string) => string)) => {
    setTextoBruto(atual => {
      const novo = typeof t === 'function' ? t(atual) : t
      if (!p.editando) gravarRascunho(p.conversaId, novo)
      return novo
    })
  }

  // Entrar/sair da edição troca o texto do campo (ajuste durante a renderização).
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const idEdicao = p.editando?.id ?? null
  if (idEdicao !== editandoId) {
    setEditandoId(idEdicao)
    if (p.editando) {
      if (editandoId === null) setAntesDaEdicao(texto)
      setTextoBruto(p.editando.corpo)
    } else {
      setTextoBruto(antesDaEdicao ?? '')
      setAntesDaEdicao(null)
    }
  }

  const focar = () => campoRef.current?.focus()

  const adicionar = (arquivos: File[]) => {
    if (p.editando) {
      toast.error('Termine a edição antes de anexar.')
      return
    }
    const vagas = MAX_ANEXOS - pendentes.length
    if (arquivos.length > vagas) toast.error(`Até ${MAX_ANEXOS} anexos por mensagem.`)
    const novos: Pendente[] = arquivos.slice(0, Math.max(0, vagas)).map(arquivo => ({
      id: crypto.randomUUID(),
      arquivo,
      previa: ehImagem({ tipo: arquivo.type }) ? URL.createObjectURL(arquivo) : null,
      anexo: null,
      erro: arquivo.size > MAX_BYTES_ANEXO ? 'Passa de 25 MB' : null,
    }))
    if (novos.length === 0) return
    setPendentes(atual => [...atual, ...novos])
    for (const n of novos) {
      if (n.erro) continue
      subirAnexo(p.conversaId, p.euId, n.arquivo)
        .then(anexo => setPendentes(atual => {
          // Removido enquanto subia: o arquivo não tem mais dono.
          if (!atual.some(x => x.id === n.id)) { void removerAnexos([anexo.path]); return atual }
          return atual.map(x => (x.id === n.id ? { ...x, anexo } : x))
        }))
        .catch(e => setPendentes(atual => atual.map(x => (x.id === n.id ? { ...x, erro: (e as Error).message } : x))))
    }
    focar()
  }

  useImperativeHandle(ref, () => ({ adicionar, focar }))

  const remover = (x: Pendente) => {
    if (x.previa) URL.revokeObjectURL(x.previa)
    if (x.anexo) void removerAnexos([x.anexo.path])
    setPendentes(atual => atual.filter(y => y.id !== x.id))
  }

  const subindo = pendentes.some(x => !x.anexo && !x.erro)
  const prontos = pendentes.filter(x => x.anexo).map(x => x.anexo as AnexoChat)
  const corpo = texto.trim()
  const excedeu = corpo.length > MAX_CARACTERES
  const podeEnviar = p.editando
    ? !excedeu && (corpo.length > 0 || p.editando.anexos.length > 0)
    : !excedeu && !subindo && (corpo.length > 0 || prontos.length > 0)

  const enviar = async () => {
    if (!podeEnviar) return
    if (p.editando) {
      const m = p.editando
      const ok = await p.aoSalvarEdicao(m, corpo)
      if (ok) p.aoCancelar()
      return
    }
    const levados = pendentes.filter(x => x.anexo)
    const restantes = pendentes.filter(x => !x.anexo)
    setTexto('')
    setPendentes(restantes)
    const ok = await p.aoEnviar(corpo, prontos)
    if (ok) {
      levados.forEach(x => x.previa && URL.revokeObjectURL(x.previa))
    } else {
      // Nada se perde: o texto e os anexos voltam para o campo.
      setTexto(t => (t ? `${corpo}\n${t}` : corpo))
      setPendentes(atual => [...levados, ...atual])
    }
    focar()
  }

  const aoTeclar = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && (p.editando || p.respondendo)) {
      // preventDefault: o painel do chat vê e não fecha junto.
      e.preventDefault()
      p.aoCancelar()
      return
    }
    if (e.key === 'ArrowUp' && !texto && !p.editando && pendentes.length === 0) {
      e.preventDefault()
      p.aoEditarUltima()
      return
    }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    e.preventDefault()
    void enviar()
  }

  const aoColar = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const arquivos = Array.from(e.clipboardData.files)
    if (arquivos.length === 0) return
    e.preventDefault()
    adicionar(arquivos)
  }

  // O emoji entra onde está o cursor, e o cursor vai para depois dele.
  const inserirEmoji = (emoji: string) => {
    const el = campoRef.current
    const ini = el?.selectionStart ?? texto.length
    const fim = el?.selectionEnd ?? texto.length
    setTexto(t => t.slice(0, ini) + emoji + t.slice(fim))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(ini + emoji.length, ini + emoji.length)
    })
  }

  // O campo cresce com o texto até umas 6 linhas.
  useLayoutEffect(() => {
    const el = campoRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 156)}px`
  }, [texto])

  // Focar ao entrar em resposta ou edição.
  useLayoutEffect(() => {
    if (p.respondendo || p.editando) focar()
  }, [p.respondendo, p.editando])

  const faixa = p.editando
    ? { Icone: Pencil, titulo: 'Editando mensagem', texto: resumo(p.editando) }
    : p.respondendo
      ? { Icone: Reply, titulo: `Respondendo a ${p.nomeDe(p.respondendo.autor_id)}`, texto: resumo(p.respondendo) }
      : null

  return (
    <div className="shrink-0 border-t border-border bg-background p-2">
      {faixa && (
        <div className="mb-1.5 flex items-start gap-2 rounded-lg border-l-[3px] border-cyan-600 bg-muted px-2.5 py-1.5">
          <faixa.Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" aria-hidden />
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-semibold text-foreground">{faixa.titulo}</p>
            <p className="truncate text-muted-foreground">{faixa.texto}</p>
          </div>
          <button
            type="button"
            onClick={p.aoCancelar}
            aria-label={p.editando ? 'Cancelar edição' : 'Cancelar resposta'}
            title="Cancelar (Esc)"
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card transition-shadow focus-within:border-cyan-600/50 focus-within:ring-2 focus-within:ring-cyan-500/30">
        {pendentes.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto px-2.5 pt-2.5" aria-label="Anexos">
            {pendentes.map(x => <ChipAnexo key={x.id} item={x} aoRemover={() => remover(x)} />)}
          </ul>
        )}
        <textarea
          ref={campoRef}
          value={texto}
          onChange={e => { setTexto(e.target.value); if (e.target.value) p.aoDigitar() }}
          onKeyDown={aoTeclar}
          onPaste={aoColar}
          rows={1}
          placeholder={p.editando ? 'Edite a mensagem' : `Mensagem para ${p.nomeOutro}`}
          aria-label="Mensagem"
          className="block max-h-39 min-h-10 w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          {!p.editando && (
            <>
              <button
                type="button"
                onClick={() => arquivoRef.current?.click()}
                title="Anexar arquivo"
                aria-label="Anexar arquivo"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
              <input
                ref={arquivoRef}
                type="file"
                multiple
                hidden
                onChange={e => { adicionar(Array.from(e.target.files ?? [])); e.target.value = '' }}
              />
            </>
          )}
          <SeletorEmoji aoEscolher={inserirEmoji} aberto={emojiAberto} aoMudarAberto={setEmojiAberto}>
            <button
              type="button"
              title="Emoji"
              aria-label="Inserir emoji"
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground ${
                emojiAberto ? 'bg-muted text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Smile className="h-4.5 w-4.5" />
            </button>
          </SeletorEmoji>

          <span className={`ml-auto pr-1 text-[11px] tabular-nums ${excedeu ? 'font-medium text-rose-600 dark:text-rose-300' : 'text-muted-foreground'}`}>
            {excedeu
              ? `${corpo.length.toLocaleString('pt-BR')} / ${MAX_CARACTERES.toLocaleString('pt-BR')}`
              : subindo ? 'Enviando anexo…' : ''}
          </span>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!podeEnviar}
            aria-label={p.editando ? 'Salvar edição' : 'Enviar'}
            title={p.editando ? 'Salvar (Enter)' : 'Enviar (Enter)'}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-40"
          >
            {p.editando ? 'Salvar' : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChipAnexo({ item: x, aoRemover }: { item: Pendente; aoRemover: () => void }) {
  return (
    <li
      className={`relative flex h-14 shrink-0 items-center gap-2 overflow-hidden rounded-lg border bg-background ${
        x.erro ? 'border-rose-500/50' : 'border-border'
      } ${x.previa ? 'w-14' : 'max-w-52 pl-2 pr-7'}`}
      title={x.erro ? `${x.arquivo.name}: ${x.erro}` : x.arquivo.name}
    >
      {x.previa ? (
        // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:)
        <img src={x.previa} alt={x.arquivo.name} className="h-full w-full object-cover" />
      ) : (
        <>
          <FileText className="h-5 w-5 shrink-0 text-cyan-700 dark:text-cyan-300" aria-hidden />
          <span className="min-w-0 truncate text-xs">{x.arquivo.name}</span>
        </>
      )}
      {(x.erro || !x.anexo) && (
        <span className={`absolute inset-0 flex items-center justify-center ${x.previa ? 'bg-background/60' : 'bg-background/40'}`}>
          {x.erro
            ? <AlertCircle className="h-5 w-5 text-rose-600" aria-label={x.erro} />
            : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Enviando" />}
        </span>
      )}
      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Tirar ${x.arquivo.name}`}
        className="absolute right-0.5 top-0.5 z-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/70 text-background hover:bg-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </li>
  )
}
