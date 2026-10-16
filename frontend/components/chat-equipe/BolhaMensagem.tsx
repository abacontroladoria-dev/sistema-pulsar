'use client'

import { memo, useState } from 'react'
import { Ban, Check, CheckCheck, Copy, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { REACOES_RAPIDAS } from '@/lib/chat/emojis'
import { TextoMensagem, semFormatacao, soEmojis } from '@/lib/chat/texto'
import type { MensagemChat } from '@/lib/chat/cliente'
import AnexosMensagem from './AnexosMensagem'
import SeletorEmoji from './SeletorEmoji'

// ============================================================================
// Uma mensagem do fio: o balão (citação, anexos, texto, hora, "editada", visto)
// e, embaixo, as reações. A barra de ações aparece por cima ao passar o mouse
// — no toque, ao tocar no balão (o fio guarda qual está ativa).
// ============================================================================

export type Bolha = MensagemChat & { enviando?: boolean }

interface Props {
  m:           Bolha
  minha:       boolean
  inicioGrupo: boolean
  /** undefined = ainda buscando; null = não deu para ler. */
  citada:      MensagemChat | null | undefined
  nomeDe:      (id: string) => string
  euId:        string
  vista:       boolean
  destacada:   boolean
  ativa:       boolean
  aoAtivar:    () => void
  aoReagir:    (emoji: string) => void
  aoResponder: () => void
  aoEditar:    () => void
  aoApagar:    () => void
  aoIrPara:    (id: string) => void
}

function BolhaMensagem(p: Props) {
  const { m, minha } = p
  const [menuAberto, setMenuAberto] = useState(false)
  const [seletorAberto, setSeletorAberto] = useState(false)
  const apagada = !!m.apagada_em
  const grande = !apagada && m.anexos.length === 0 && !m.responde_a && soEmojis(m.corpo)
  const acoesVisiveis = p.ativa || menuAberto || seletorAberto
  const reacoes = Object.entries(m.reacoes).filter(([, quem]) => quem.length > 0)

  // Toque no balão (fora de link e de botão) liga a barra no celular.
  const aoTocar = (e: React.MouseEvent) => {
    if (m.enviando || apagada) return
    if ((e.target as HTMLElement).closest('a, button')) return
    if (window.matchMedia('(hover: none)').matches) p.aoAtivar()
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(m.corpo)
      toast.success('Texto copiado')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const corBalao = apagada
    ? 'border border-dashed border-border bg-transparent text-muted-foreground'
    : grande
      ? 'bg-transparent'
      : minha
        ? 'bg-cyan-600 text-white'
        : 'bg-muted text-foreground'
  // Mensagens seguidas da mesma pessoa formam um bloco: o canto do lado dela
  // fica reto entre uma e outra.
  const cantos = minha
    ? `rounded-2xl rounded-br-md ${p.inicioGrupo ? '' : 'rounded-tr-md'}`
    : `rounded-2xl rounded-bl-md ${p.inicioGrupo ? '' : 'rounded-tl-md'}`

  return (
    <div
      id={`msg-${m.id}`}
      className={`group/msg relative flex ${minha ? 'justify-end' : 'justify-start'} ${p.inicioGrupo ? 'pt-2' : 'pt-0.5'}`}
    >
      <div className={`relative flex max-w-[85%] flex-col ${minha ? 'items-end' : 'items-start'}`}>
        <div
          onClick={aoTocar}
          className={`relative ${grande ? '' : 'px-3 py-1.5'} text-sm ${corBalao} ${cantos} ${
            m.enviando ? 'opacity-60' : ''
          } ${p.destacada ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background' : ''} transition-shadow`}
        >
          {apagada ? (
            <p className="flex items-center gap-1.5 italic">
              <Ban className="h-3.5 w-3.5" aria-hidden />
              {minha ? 'Você apagou esta mensagem' : 'Mensagem apagada'}
            </p>
          ) : (
            <>
              {m.responde_a && <Citacao citada={p.citada} nomeDe={p.nomeDe} minha={minha} aoIrPara={p.aoIrPara} />}
              {m.anexos.length > 0 && (
                <div className={m.corpo ? 'mb-1.5 pt-0.5' : 'py-0.5'}>
                  <AnexosMensagem anexos={m.anexos} minha={minha} />
                </div>
              )}
              {m.corpo && (
                <p className={`whitespace-pre-wrap wrap-break-word ${grande ? 'text-4xl leading-tight' : ''}`}>
                  <TextoMensagem corpo={m.corpo} minha={minha} />
                </p>
              )}
            </>
          )}
          <p
            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums ${
              minha && !apagada && !grande ? 'text-white/75' : 'text-muted-foreground'
            }`}
          >
            {m.editada_em && !apagada && <span title={`Editada às ${hora(m.editada_em)}`}>editada</span>}
            <span>{m.enviando ? 'enviando…' : hora(m.criada_em)}</span>
            {minha && !m.enviando && !apagada && (
              p.vista
                ? <CheckCheck className="h-3.5 w-3.5" aria-label="Vista" />
                : <Check className="h-3.5 w-3.5" aria-label="Enviada" />
            )}
          </p>
        </div>

        {reacoes.length > 0 && (
          <div className={`-mt-1 flex flex-wrap gap-1 ${minha ? 'justify-end pr-1' : 'pl-1'}`}>
            {reacoes.map(([emoji, quem]) => {
              const eu = quem.includes(p.euId)
              const nomes = quem.map(id => (id === p.euId ? 'Você' : p.nomeDe(id)))
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => p.aoReagir(emoji)}
                  title={`${juntar(nomes)} ${quem.length > 1 ? 'reagiram' : 'reagiu'} com ${emoji}`}
                  aria-pressed={eu}
                  className={`inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs tabular-nums shadow-sm ring-1 transition-colors ${
                    eu
                      ? 'bg-cyan-50 text-cyan-800 ring-cyan-600/50 dark:bg-cyan-500/15 dark:text-cyan-200'
                      : 'bg-background text-muted-foreground ring-border hover:bg-muted'
                  }`}
                >
                  <span className="text-sm leading-none">{emoji}</span>
                  {quem.length > 1 && <span>{quem.length}</span>}
                </button>
              )
            })}
          </div>
        )}

        {!m.enviando && !apagada && (
          <div
            role="toolbar"
            aria-label="Ações da mensagem"
            className={`absolute -top-7 z-30 flex items-center gap-0.5 rounded-full border border-border bg-popover p-0.5 shadow-md transition-opacity ${
              minha ? 'right-1' : 'left-1'
            } ${
              acoesVisiveis
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100'
            }`}
          >
            {REACOES_RAPIDAS.slice(0, 4).map(e => (
              <button
                key={e}
                type="button"
                onClick={() => p.aoReagir(e)}
                aria-label={`Reagir com ${e}`}
                className="flex h-7 w-7 items-center justify-center rounded-full text-base leading-none transition-transform hover:bg-muted motion-safe:hover:scale-110"
              >
                {e}
              </button>
            ))}
            <SeletorEmoji aoEscolher={p.aoReagir} fecharAoEscolher side="bottom" align={minha ? 'end' : 'start'} aberto={seletorAberto} aoMudarAberto={setSeletorAberto}>
              <BotaoAcao rotulo="Mais reações"><SmilePlus className="h-4 w-4" /></BotaoAcao>
            </SeletorEmoji>
            <BotaoAcao rotulo="Responder" aoClicar={p.aoResponder}><Reply className="h-4 w-4" /></BotaoAcao>
            <DropdownMenu open={menuAberto} onOpenChange={setMenuAberto}>
              <DropdownMenuTrigger asChild>
                <BotaoAcao rotulo="Mais ações"><MoreHorizontal className="h-4 w-4" /></BotaoAcao>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={minha ? 'end' : 'start'} className="min-w-40">
                <DropdownMenuItem onSelect={p.aoResponder}><Reply /> Responder</DropdownMenuItem>
                {m.corpo && <DropdownMenuItem onSelect={() => void copiar()}><Copy /> Copiar texto</DropdownMenuItem>}
                {minha && (
                  <>
                    <DropdownMenuItem onSelect={p.aoEditar}><Pencil /> Editar</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={p.aoApagar}><Trash2 /> Apagar</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(BolhaMensagem)

function BotaoAcao({ rotulo, aoClicar, children, ...resto }: {
  rotulo: string
  aoClicar?: () => void
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      onClick={aoClicar}
      {...resto}
      className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}

function Citacao({ citada, nomeDe, minha, aoIrPara }: {
  citada:   MensagemChat | null | undefined
  nomeDe:   (id: string) => string
  minha:    boolean
  aoIrPara: (id: string) => void
}) {
  const texto = citada === undefined
    ? 'Carregando…'
    : citada === null
      ? 'Mensagem indisponível'
      : resumo(citada)
  return (
    <button
      type="button"
      disabled={!citada}
      onClick={() => citada && aoIrPara(citada.id)}
      className={`mb-1 mt-0.5 block w-full min-w-40 rounded-lg border-l-[3px] px-2 py-1 text-left text-xs transition-colors ${
        minha
          ? 'border-white/70 bg-white/15 hover:bg-white/20'
          : 'border-cyan-600 bg-background/70 hover:bg-background'
      }`}
    >
      {citada && <span className="block font-semibold">{nomeDe(citada.autor_id)}</span>}
      <span className={`line-clamp-2 ${minha ? 'text-white/85' : 'text-muted-foreground'}`}>{texto}</span>
    </button>
  )
}

/** Uma linha que represente a mensagem: na citação e na faixa "Respondendo a". */
export function resumo(m: MensagemChat): string {
  if (m.apagada_em) return 'Mensagem apagada'
  if (m.corpo.trim()) return semFormatacao(m.corpo)
  if (m.anexos.length) return `📎 ${m.anexos[0].nome}${m.anexos.length > 1 ? ` e mais ${m.anexos.length - 1}` : ''}`
  return ''
}

function juntar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
