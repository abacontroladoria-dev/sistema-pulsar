'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AtSign, ArrowRight, Lock, UserRoundCog } from 'lucide-react'

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useTemPermissao } from '@/hooks/useTemPermissao'
import {
  listarMencoes, quandoRelativo, linkDaConversa, type MencaoVista,
} from '@/lib/central/mencoes-cliente'

// ============================================================================
// Janela "marcaram você" na página inicial do Pulsar
//
// Ao abrir a página inicial com menções não lidas em notas internas do
// Connect, abre no centro da tela com as conversas e "Abrir conversa".
//
// UMA VEZ POR SESSÃO: os ids já mostrados ficam no sessionStorage. Voltar à
// página inicial não reabre a janela; uma menção NOVA, sim. Nova aba ou novo
// login começam do zero. Sem storage (aba anônima, bloqueio), aparece uma vez
// por carregamento.
//
// "Fechar" não marca nada como lido — a menção continua em "Menções a mim" até
// a pessoa abrir a conversa.
//
// Só para quem tem a tela do Connect (permissão `connect`): sem ela o link
// cairia numa página bloqueada. Sem papel na Central, a rota responde 401 e a
// janela simplesmente não abre. Falha de rede idem — nunca quebra a página.
// ============================================================================

const CHAVE = 'pulsar.mencoes.mostradas.v1'
const MAX_CONVERSAS = 5

function lerMostradas(): Set<string> {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE)
    const lista = bruto ? JSON.parse(bruto) : []
    return new Set(Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function gravarMostradas(ids: Set<string>): void {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify([...ids]))
  } catch {
    // sem storage: a janela só não se lembra nesta sessão
  }
}

// Várias menções na mesma conversa viram uma linha só, com a mais recente.
interface PorConversa {
  conversationId: string
  ultima:         MencaoVista
  quantas:        number
  delegada:       boolean
}

function agrupar(mencoes: MencaoVista[]): PorConversa[] {
  const mapa = new Map<string, PorConversa>()
  for (const m of mencoes) {
    const atual = mapa.get(m.conversationId)
    if (!atual) {
      mapa.set(m.conversationId, { conversationId: m.conversationId, ultima: m, quantas: 1, delegada: m.delegadaAMim })
    } else {
      atual.quantas += 1
      atual.delegada ||= m.delegadaAMim
      if (m.criadaEm > atual.ultima.criadaEm) atual.ultima = m
    }
  }
  return [...mapa.values()].sort((a, b) => b.ultima.criadaEm.localeCompare(a.ultima.criadaEm))
}

export default function JanelaMencoesPendentes() {
  const { tem: temConnect, carregando } = useTemPermissao('connect')
  const [aberta, setAberta] = useState(false)
  const [mencoes, setMencoes] = useState<MencaoVista[]>([])

  useEffect(() => {
    if (carregando || !temConnect) return
    const controller = new AbortController()
    listarMencoes('nao_lidas', { limit: 50, signal: controller.signal })
      .then(({ mencoes: lista }) => {
        if (lista.length === 0) return
        const mostradas = lerMostradas()
        if (lista.every(m => mostradas.has(m.id))) return
        lista.forEach(m => mostradas.add(m.id))
        gravarMostradas(mostradas)
        setMencoes(lista)
        setAberta(true)
      })
      .catch(() => { /* sem Central, sem rede: sem janela */ })
    return () => controller.abort()
  }, [carregando, temConnect])

  if (mencoes.length === 0) return null

  const conversas = agrupar(mencoes)
  const visiveis  = conversas.slice(0, MAX_CONVERSAS)
  const resto     = conversas.length - visiveis.length

  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15">
              <AtSign className="w-4 h-4" aria-hidden />
            </span>
            {conversas.length === 1
              ? 'Marcaram você numa conversa'
              : `Marcaram você em ${conversas.length} conversas`}
          </DialogTitle>
          <DialogDescription>
            Alguém da equipe mencionou você numa nota interna do Connect. Só a equipe vê essas notas.
          </DialogDescription>
        </DialogHeader>

        <ul className="max-h-[55vh] overflow-y-auto px-5 pb-4 space-y-2">
          {visiveis.map(c => (
            <li key={c.conversationId} className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 dark:border-amber-500/30 dark:bg-amber-500/5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm text-slate-700 dark:text-foreground">
                  {c.ultima.deMim
                    ? <>Você se marcou na conversa com </>
                    : <><strong className="font-semibold">{c.ultima.autor.nome}</strong> marcou você na conversa com </>}
                  <strong className="font-semibold">{c.ultima.contato}</strong>
                  {c.quantas > 1 && <span className="text-slate-500 dark:text-muted-foreground"> ({c.quantas} menções)</span>}
                </p>
                <span className="ml-auto text-xs text-slate-500 dark:text-muted-foreground tabular-nums">
                  {quandoRelativo(c.ultima.criadaEm)}
                </span>
              </div>

              <p className="mt-1.5 flex gap-1.5 text-sm text-slate-600 dark:text-muted-foreground">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0 line-clamp-2 whitespace-pre-wrap break-words">{c.ultima.trecho}</span>
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {c.delegada && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-200/70 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
                    <UserRoundCog className="w-3.5 h-3.5" aria-hidden />
                    Delegada a você
                  </span>
                )}
                <Link
                  href={linkDaConversa(c.conversationId)}
                  onClick={() => setAberta(false)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition-colors"
                >
                  Abrir conversa
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </Link>
              </div>
            </li>
          ))}
          {resto > 0 && (
            <li className="text-center text-xs text-slate-500 dark:text-muted-foreground pt-1">
              E mais {resto} {resto === 1 ? 'conversa' : 'conversas'} em “Menções a mim”.
            </li>
          )}
        </ul>

        <DialogFooter className="mx-0 mb-0 px-5 py-3">
          <Link
            href="/connect/mencoes/"
            onClick={() => setAberta(false)}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
          >
            Ver todas as menções
          </Link>
          <button
            type="button"
            onClick={() => setAberta(false)}
            className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors dark:bg-foreground dark:text-background"
          >
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
