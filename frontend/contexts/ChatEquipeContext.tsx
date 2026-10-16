'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { EVENTO_MENCOES_ALTERADAS } from '@/lib/central/mencoes-evento'
import {
  EVENTO_CHAT_ALTERADO, EVENTO_CHAT_LEITURA, EVENTO_CHAT_MENSAGEM, EVENTO_CHAT_MENSAGEM_ALTERADA,
  contarNaoLidas, normalizarMensagem, type LeituraChat, type MensagemChat,
} from '@/lib/chat/cliente'
import { definirOnline } from '@/lib/chat/presenca'
import { getSupabaseClient } from '@/lib/supabase/client'

// ============================================================================
// Chat da equipe — estado que atravessa o Pulsar e o Connect
//
// (dashboard) e connect são route groups IRMÃOS, cada um com o seu layout:
// passar de um para o outro remonta tudo o que está dentro deles. Por isso o
// provider vive no layout RAIZ (app/layout.tsx), o único que os dois têm em
// comum — o painel aberto continua aberto quando a pessoa troca de lado. Só
// vale para navegação do Next (Link/router); um `window.location` recarrega a
// página e zera tudo.
//
// DUAS FONTES, UM NÚMERO NO MENU
//   conversas  chat_nao_lidas() (todo usuário logado), com tempo real e a
//              presença (quem está online — lib/chat/presenca.ts)
//   menções    /api/central/mencoes/contagem/ (notas internas do Connect)
//
// Quem mostra um número chama useContadoresChatEquipe({ conversas, menções })
// dizendo quais das duas a pessoa tem. Enquanto houver alguém montado pedindo
// uma fonte, o provider a consulta (30s, aba visível) — uma vez por aba, não
// uma por componente. Ninguém pedindo (página pública, a /tv, quem não tem
// acesso) = nenhuma consulta e nenhum canal de tempo real aberto.
// ============================================================================

const INTERVALO_MS = 30_000
const DEBOUNCE_MS  = 500

// Telas sem login (as `publicRoutes` do proxy.ts, mais as de link aberto).
const ROTA_PUBLICA = /^\/(login|definir-senha|auth|sem-permissao|tv|ficha-escolar|disponibilidade-)/

type Fonte = 'conversas' | 'mencoes'

interface ChatEquipeCtx {
  aberto:        boolean
  abrir:         () => void
  fechar:        () => void
  alternar:      () => void
  naoLidas:      Record<Fonte, number>
  /** Quais fontes a pessoa tem — o painel decide as abas por aqui. */
  fontes:        Record<Fonte, boolean>
  registrar:     (fonte: Fonte) => () => void
}

const Ctx = createContext<ChatEquipeCtx | null>(null)

export function ChatEquipeProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const [naoLidas, setNaoLidas] = useState<Record<Fonte, number>>({ conversas: 0, mencoes: 0 })
  const [interesse, setInteresse] = useState<Record<Fonte, number>>({ conversas: 0, mencoes: 0 })

  const abrir    = useCallback(() => setAberto(true), [])
  const fechar   = useCallback(() => setAberto(false), [])
  const alternar = useCallback(() => setAberto(v => !v), [])

  const registrar = useCallback((fonte: Fonte) => {
    setInteresse(i => ({ ...i, [fonte]: i[fonte] + 1 }))
    return () => setInteresse(i => ({ ...i, [fonte]: i[fonte] - 1 }))
  }, [])

  // Tela pública fecha o painel: no Pulsar o logout é router.replace('/login'),
  // que mantém o layout raiz montado — o painel ficaria sobre o login. Pelo
  // caminho, e não por onAuthStateChange: este provider também envolve a /tv,
  // que não cria cliente do Supabase e não deve passar a criar por causa dele.
  const pathname = usePathname()
  if (aberto && ROTA_PUBLICA.test(pathname)) setAberto(false)

  // ── Menções (notas internas do Connect) ──────────────────────────────────
  const querMencoes = interesse.mencoes > 0
  useEffect(() => {
    if (!querMencoes) return
    const controller = new AbortController()

    const contar = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        // Barra final: trailingSlash:true responde 308 sem ela.
        const res = await fetch('/api/central/mencoes/contagem/', { signal: controller.signal, cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json().catch(() => null)
        const n = json?.data?.naoLidas
        if (typeof n === 'number') setNaoLidas(atual => ({ ...atual, mencoes: n }))
      } catch {
        // Rede, sem acesso à Central: o número só não aparece.
      }
    }

    return repetir(contar, EVENTO_MENCOES_ALTERADAS, () => controller.abort())
  }, [querMencoes])

  // ── Conversas (chat entre usuários) ──────────────────────────────────────
  const querConversas = interesse.conversas > 0
  useEffect(() => {
    if (!querConversas) return
    let vivo = true

    const contar = async () => {
      if (document.visibilityState === 'hidden') return
      const n = await contarNaoLidas()
      if (vivo && n !== null) setNaoLidas(atual => ({ ...atual, conversas: n }))
    }

    // Tempo real: a RLS de chat_mensagens e de chat_membros já recorta, por
    // assinante, os fios de cada um. O evento vai para a janela — o fio aberto
    // pega a mensagem dali sem nova consulta — e o contador reconta (com folga,
    // para uma rajada de mensagens virar uma consulta só).
    //   INSERT de mensagem   mensagem nova
    //   UPDATE de mensagem   editou, apagou ou reagiu (apagar muda a contagem)
    //   UPDATE de membro     alguém leu — o "Visto" do fio aberto
    const supabase = getSupabaseClient()
    let espera: ReturnType<typeof setTimeout> | null = null
    const recontar = () => {
      if (espera) clearTimeout(espera)
      espera = setTimeout(contar, DEBOUNCE_MS)
    }
    const avisar = <T,>(evento: string, detail: T) =>
      window.dispatchEvent(new CustomEvent<T>(evento, { detail }))
    const canal = supabase
      .channel('chat-equipe-mensagens')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens' }, (payload) => {
        avisar(EVENTO_CHAT_MENSAGEM, normalizarMensagem(payload.new as MensagemChat))
        recontar()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_mensagens' }, (payload) => {
        avisar(EVENTO_CHAT_MENSAGEM_ALTERADA, normalizarMensagem(payload.new as MensagemChat))
        recontar()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_membros' }, (payload) => {
        avisar(EVENTO_CHAT_LEITURA, payload.new as LeituraChat)
      })
      .subscribe()

    // Presença: quem está com o Pulsar aberto (a bolinha verde). A chave é o id
    // do usuário — duas abas da mesma pessoa contam uma vez.
    let presenca: ReturnType<typeof supabase.channel> | null = null
    void supabase.auth.getSession().then(({ data }) => {
      const eu = data.session?.user.id
      if (!vivo || !eu) return
      presenca = supabase.channel('chat-equipe-presenca', { config: { presence: { key: eu } } })
      presenca
        .on('presence', { event: 'sync' }, () => definirOnline(Object.keys(presenca?.presenceState() ?? {})))
        .subscribe(status => { if (status === 'SUBSCRIBED') void presenca?.track({ desde: new Date().toISOString() }) })
    })

    const parar = repetir(contar, EVENTO_CHAT_ALTERADO)
    return () => {
      vivo = false
      parar()
      if (espera) clearTimeout(espera)
      supabase.removeChannel(canal)
      if (presenca) supabase.removeChannel(presenca)
      definirOnline([])
    }
  }, [querConversas])

  const fontes = useMemo(
    () => ({ conversas: querConversas, mencoes: querMencoes }),
    [querConversas, querMencoes],
  )

  const valor = useMemo(
    () => ({ aberto, abrir, fechar, alternar, naoLidas, fontes, registrar }),
    [aberto, abrir, fechar, alternar, naoLidas, fontes, registrar],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

// Conta agora, a cada 30s, ao voltar à aba e quando `evento` disparar.
function repetir(contar: () => void, evento: string, aoParar?: () => void): () => void {
  contar()
  const t = setInterval(contar, INTERVALO_MS)
  const aoVoltar = () => { if (document.visibilityState === 'visible') contar() }
  window.addEventListener(evento, contar)
  document.addEventListener('visibilitychange', aoVoltar)
  return () => {
    aoParar?.()
    clearInterval(t)
    window.removeEventListener(evento, contar)
    document.removeEventListener('visibilitychange', aoVoltar)
  }
}

export function useChatEquipe(): ChatEquipeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useChatEquipe fora do ChatEquipeProvider (app/layout.tsx)')
  return ctx
}

/**
 * Os números do item "Chat da equipe". Cada fonte só é consultada se a pessoa a
 * tiver: conversas = todo usuário logado; menções = acesso ao Connect (a rota
 * responde 401 a quem não tem papel na Central).
 */
export function useContadoresChatEquipe(tem: Record<Fonte, boolean>): Record<Fonte, number> & { total: number } {
  const { naoLidas, registrar } = useChatEquipe()
  useEffect(() => (tem.conversas ? registrar('conversas') : undefined), [tem.conversas, registrar])
  useEffect(() => (tem.mencoes ? registrar('mencoes') : undefined), [tem.mencoes, registrar])
  const conversas = tem.conversas ? naoLidas.conversas : 0
  const mencoes   = tem.mencoes   ? naoLidas.mencoes   : 0
  return { conversas, mencoes, total: conversas + mencoes }
}

/** Só as menções — "Menções a mim" e a aba Menções do painel. */
export function useMencoesNaoLidas(ativo = true): number {
  return useContadoresChatEquipe({ conversas: false, mencoes: ativo }).mencoes
}
