'use client'

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MessageSquare, MessagesSquare, Users, LayoutDashboard, Funnel, Calendar, Settings as SettingsIcon, LogOut, ArrowLeft, ChevronLeft, Inbox as InboxIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { SeletorArea } from '@/components/sidebar/SeletorArea'
import { BuscaMestre } from '@/components/busca/BuscaMestre'
import { guardarArea, useAreasVisiveis } from '@/hooks/useAreaDoMenu'
import { MENU_AREA_POR_ID, type AreaId } from '@/lib/permissions/menu'
import { useAuth } from '@/hooks/nina/useAuth'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import { useChatEquipe, useContadoresChatEquipe } from '@/contexts/ChatEquipeContext'
import BolinhaNaoLidas from '@/components/chat-equipe/BolinhaNaoLidas'
import { useConversasAbertas } from '@/hooks/nina/useConversasAbertas'
import Link from 'next/link'
import { toast } from 'sonner'
import { ThemeSwitcher } from '@/components/sidebar/ThemeSwitcher'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Dois grupos: as conversas (onde a atendente passa o dia) primeiro, e a
// gestão depois. O Chat da equipe entra no fim do grupo de conversas.
const conversaItems = [
  { id: 'inbox',     label: 'Inbox',         icon: MessageSquare },
  { id: 'atendimentos', label: 'Atendimentos', icon: InboxIcon },
]
const gestaoItems = [
  { id: 'crm',       label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'contacts',  label: 'Contatos',      icon: Users },
  { id: 'pipeline',  label: 'Funil',         icon: Funnel },
  { id: 'analytics', label: 'Agendamentos',  icon: Calendar },
  { id: 'settings',  label: 'Configurações', icon: SettingsIcon },
]

// Altura dos itens encolhe em telas baixas para tudo caber sem rolagem.
// Só com mouse: no toque o item mantém a altura cheia, que é a área de toque.
const ITEM = 'px-3 py-2.5 [@media(max-height:760px)_and_(pointer:fine)]:py-1.5 [@media(max-height:620px)_and_(pointer:fine)]:py-1'

// Nome do item ao lado do menu recolhido. O Tooltip de ui/ é casca vazia, e
// title nativo demora e não aparece no foco por teclado — daí este, em CSS.
const Dica = ({ texto, ativa }: { texto: string; ativa: boolean }) =>
  ativa ? (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-sidebar-border bg-sidebar px-2 py-1 text-xs font-medium text-sidebar-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-has-focus-visible:opacity-100 motion-reduce:transition-none"
    >
      {texto}
    </span>
  ) : null

const ItemChatEquipe = ({ collapsed, naoLidas: n, aberto, aoClicar }: {
  collapsed: boolean
  naoLidas: number
  aberto: boolean
  aoClicar: () => void
}) => {
  const rotuloN = n > 99 ? '99+' : String(n)
  const rotulo = 'Chat da equipe'
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-expanded={aberto}
      aria-label={n > 0 ? `${rotulo}, ${rotuloN} não lidas` : undefined}
      // Sem o fundo de "página atual": o painel aberto não é página, e com ele
      // o item da tela em que a pessoa está e o do chat apareciam os dois marcados.
      className={`group relative flex w-full items-center gap-3 ${ITEM} rounded-lg transition-colors hover:bg-sidebar-accent/60 ${
        aberto
          ? 'text-sidebar-primary'
          : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
      }`}
    >
      <MessagesSquare className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <span className="text-sm font-medium truncate">{rotulo}</span>
      )}
      {/* Canto superior direito do item, aberto ou recolhido (menor). */}
      <BolinhaNaoLidas n={n} compacta={collapsed} />
      <Dica texto={n > 0 ? `${rotulo} (${rotuloN} não lidas)` : rotulo} ativa={collapsed} />
    </button>
  )
}

const SidebarContent = ({ collapsed }: { collapsed: boolean }) => {
  const { signOut } = useAuth()
  const usuario = useUsuarioAtual()
  // Quem está no Connect tem as duas: as menções e as conversas (todo usuário).
  const naoLidas = useContadoresChatEquipe({ conversas: true, mencoes: true }).total
  const chat = useChatEquipe()
  // Conversas em Aberto: a Maia passou e ninguém da equipe pegou. Vai no item
  // Atendimentos, onde está a coluna delas.
  const abertas = useConversasAbertas()
  const pathname = usePathname()
  const currentPath = pathname.replace('/connect/', '')
  const router = useRouter()
  const areas = useAreasVisiveis()

  // Outra área no seletor: volta ao Pulsar com o menu já nela.
  const escolherArea = (id: AreaId) => {
    if (id === 'connect') return
    guardarArea(id)
    router.push('/')
  }

  const handleLogout = async () => {
    try {
      await signOut()
      toast.success('Logout realizado com sucesso')
      window.location.href = '/auth'
    } catch {
      toast.error('Erro ao fazer logout')
    }
  }

  const renderItem = (item: (typeof gestaoItems)[number]) => {
    // Segmento inteiro: um id que seja prefixo de outro não marca os dois.
    const isActive = currentPath === item.id || currentPath.startsWith(`${item.id}/`)
    const contagem = item.id === 'atendimentos' ? abertas : 0
    const rotuloContagem = contagem > 0 ? ` (${contagem > 99 ? '99+' : contagem} em aberto)` : ''
    return (
      <Link
        key={item.id}
        href={`/connect/${item.id}`}
        aria-label={contagem > 0 ? `${item.label}${rotuloContagem}` : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`group relative flex items-center gap-3 ${ITEM} rounded-lg transition-colors ${
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
        }`}
      >
        <item.icon className="h-5 w-5 shrink-0" />
        {!collapsed && (
          <span className="text-sm font-medium truncate">{item.label}</span>
        )}
        {/* Atendimentos recolhido: só um ponto — o número berrava num
            menu de ícones; aberto, o contador volta. */}
        {collapsed && item.id === 'atendimentos' ? (
          contagem > 0 && <span aria-hidden className="pointer-events-none absolute right-2 top-1.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar" />
        ) : (
          <BolinhaNaoLidas n={contagem} compacta={collapsed} />
        )}
        <Dica texto={`${item.label}${rotuloContagem}`} ativa={collapsed} />
      </Link>
    )
  }

  const [confirmarSaida, setConfirmarSaida] = useState(false)

  const inicial = usuario.primeiroNome.charAt(0).toUpperCase() || 'U'

  return (
    <>
      {/* Área + busca mestre — os mesmos do sidebar do Pulsar, para quem passa
          de um lado ao outro achar no mesmo lugar. */}
      <div className={`flex flex-col gap-2 px-2 pb-3 [@media(max-height:620px)]:pb-2 border-b border-sidebar-border shrink-0 ${collapsed ? 'items-center' : ''}`}>
        <span className="group relative">
          <SeletorArea area="connect" areas={areas} onEscolher={escolherArea} compacto={collapsed} semTitle />
          <Dica texto={`Área: ${MENU_AREA_POR_ID.connect.nome}`} ativa={collapsed} />
        </span>
        <span className="group relative">
          <BuscaMestre compacto={collapsed} semTitle />
          <Dica texto="Buscar (Ctrl K)" ativa={collapsed} />
        </span>
      </div>

      {/* Nav items */}
      {/* Sem overflow: a altura cabe (itens encolhem em tela baixa) e a dica
          do menu recolhido precisa sair para fora da coluna. */}
      {/* Abaixo de 560px de altura não há encolhimento que baste: aí, e só aí,
          a lista rola, para nenhum item ficar por baixo do rodapé. */}
      <div className="flex flex-col flex-1 min-h-0 px-2 [@media(max-height:560px)]:overflow-y-auto [@media(max-height:560px)]:overflow-x-hidden">
        <nav aria-label="Módulos do Connect" className="flex flex-col gap-0.5">
          <div role="group" aria-labelledby="menu-grupo-conversas" className="flex flex-col gap-0.5">
          <p id="menu-grupo-conversas" className={`px-3 pb-1 text-xs font-medium text-sidebar-foreground/45 ${collapsed ? 'sr-only' : ''}`}>Conversas</p>
          {conversaItems.map(renderItem)}


          {/* Chat da equipe: não navega — abre o painel lateral do layout raiz,
              o mesmo que o item do sidebar do Pulsar abre. "Menções a mim"
              (/connect/mencoes) era um item de página aqui; a página continua
              existindo para quem tem o link salvo. */}
          <ItemChatEquipe collapsed={collapsed} naoLidas={naoLidas} aberto={chat.aberto} aoClicar={chat.alternar} />
          </div>

          <div role="separator" className="my-2 mx-3 border-t border-sidebar-border/70 [@media(max-height:620px)]:my-1" />
          <div role="group" aria-labelledby="menu-grupo-gestao" className="flex flex-col gap-0.5">
          <p id="menu-grupo-gestao" className={`px-3 pb-1 text-xs font-medium text-sidebar-foreground/45 ${collapsed ? 'sr-only' : ''}`}>Gestão</p>
          {gestaoItems.map(renderItem)}
          </div>
        </nav>
      </div>

      {/* Voltar ao Pulsar — Link, e não window.location: recarregar a página
          desmontaria o layout raiz e fecharia o Chat da equipe aberto. */}
      <div className="border-t border-sidebar-border pt-2 px-2 shrink-0">
        <Link
          href="/"
          className={`group relative flex items-center gap-3 ${ITEM} rounded-lg transition-colors w-full text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60`}
        >
          <ArrowLeft className="w-5 h-5 shrink-0" />
          {!collapsed && (
            <span className="text-sm font-medium">Voltar ao Pulsar</span>
          )}
          <Dica texto="Voltar ao Pulsar" ativa={collapsed} />
        </Link>
      </div>

      {/* User footer — mesma identidade do sidebar do Pulsar: nome e papel.
          O e-mail sai da linha de baixo e vira title, para o papel ocupar o
          lugar que informa mais. */}
      <div className="px-2 shrink-0">
        {/* O seletor de tema fica acima do usuário, como no sidebar do Pulsar:
            mesmo componente, mesma posição relativa, para quem alterna entre os
            dois lados do sistema não precisar procurar. */}
        <ThemeSwitcher compacto={collapsed} dica={(r) => <Dica texto={r} ativa />} />
        <div
          className="relative flex items-center gap-3 p-2 rounded-xl hover:bg-sidebar-accent/60 transition-colors"
          title={collapsed ? undefined : usuario.email}
        >
          <div
            tabIndex={collapsed ? 0 : undefined}
            aria-label={collapsed ? (usuario.gruposLabel ? `${usuario.primeiroNome}, ${usuario.gruposLabel}` : usuario.primeiroNome) : undefined}
            className="group relative w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold text-sidebar-accent-foreground border border-sidebar-border shrink-0 focus-visible:outline-2 focus-visible:outline-sidebar-ring"
          >
            <span aria-hidden={collapsed || undefined}>{inicial}</span>
            <Dica texto={usuario.gruposLabel ? `${usuario.primeiroNome} — ${usuario.gruposLabel}` : usuario.primeiroNome} ativa={collapsed} />
          </div>
          {!collapsed && (
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {usuario.primeiroNome}
              </p>
              {usuario.gruposLabel && (
                <p className="text-xs text-sidebar-foreground/60 truncate">
                  {usuario.gruposLabel}
                </p>
              )}
              {/* Sem central_role toda chamada a /api/central/* responde 401.
                  Dizer isso é mais útil que exibir só o papel do Pulsar e
                  deixar a pessoa concluir que a Central está quebrada.
                  Exige perfilLido: se a leitura do perfil falhou, o que não se
                  sabe é se há acesso — afirmar que não há seria inventar. */}
              {usuario.perfilLido && !usuario.temAcessoCentral && (
                <p
                  className="text-[11px] text-amber-700 dark:text-amber-400 truncate"
                  title="Sem acesso à Central. Peça a um administrador para liberar."
                >
                  Sem acesso à Central. Peça a um admin.
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            // Confirma antes: no celular o botão fica a um toque do perfil, e sair
            // sem querer derruba a atendente no meio de uma conversa.
            onClick={() => setConfirmarSaida(true)}
            aria-label="Sair"
            title="Sair"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-2 focus-visible:outline-sidebar-ring"
          >
            <LogOut aria-hidden className="w-4 h-4" />
          </button>
        </div>
      </div>

      <AlertDialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do sistema?</AlertDialogTitle>
            <AlertDialogDescription>Para voltar, será preciso entrar de novo com e-mail e senha.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar no sistema</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>Sair</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Sem hover (toque): o menu aberto vira gaveta por cima da conversa, em vez de
// espremê-la, e fecha ao tocar fora ou ao trocar de tela.
// No servidor responde false: a primeira pintura é a do desktop recolhido.
const useMidia = (consulta: string) =>
  useSyncExternalStore(
    (aviso) => {
      const mq = window.matchMedia(consulta)
      mq.addEventListener('change', aviso)
      return () => mq.removeEventListener('change', aviso)
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  )

const AppSidebar: React.FC = () => {
  // Abre recolhido; não há preferência guardada (nunca houve).
  const [collapsed, setCollapsed] = useState(true)
  const toque = useMidia('(hover: none)')
  // Celular: recolhido, a coluna some e fica só a aba do botão na borda —
  // 64px de 360 é largura demais tirada da conversa. Abre como gaveta.
  const celular = useMidia('(max-width: 767px)')
  const gaveta = (toque || celular) && !collapsed
  const escondido = celular && collapsed
  const asideRef = useRef<HTMLElement>(null)
  const botaoRef = useRef<HTMLButtonElement>(null)

  // Gaveta aberta: foco no primeiro item, Esc fecha e o foco volta ao botão.
  useEffect(() => {
    if (!gaveta) return
    const aside = asideRef.current
    aside?.querySelector<HTMLElement>('nav a, nav button')?.focus()
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) setCollapsed(true)
    }
    document.addEventListener('keydown', aoTeclar)
    const botao = botaoRef.current
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      if (aside?.contains(document.activeElement) || document.activeElement === document.body) botao?.focus()
    }
  }, [gaveta])
  const pathname = usePathname()
  // Trocou de tela pela gaveta: fecha. Ajuste na renderização, sem efeito.
  const [telaVista, setTelaVista] = useState(pathname)
  if (pathname !== telaVista) {
    setTelaVista(pathname)
    if (toque || celular) setCollapsed(true)
  }

  return (
    // Na gaveta a coluna de 64px continua reservando o lugar: a conversa não se mexe.
    <div className={`relative h-full shrink-0 ${escondido || (gaveta && celular) ? 'w-0' : gaveta ? 'w-16' : ''}`}>
    {gaveta && (
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={() => setCollapsed(true)}
        className="fixed inset-0 z-40 bg-black/50 motion-safe:animate-in motion-safe:fade-in-0"
      />
    )}
    <aside
      ref={asideRef}
      aria-label="Menu do Connect"
      className={`group/menu h-full bg-sidebar border-r border-sidebar-border flex flex-col gap-3 py-3 [@media(max-height:620px)]:gap-2 [@media(max-height:620px)]:py-2 transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        escondido ? 'w-0 border-r-0' : collapsed ? 'w-16' : 'w-64'
      } ${gaveta ? 'absolute inset-y-0 left-0 z-50 shadow-xl' : 'relative'}`}
    >
      {!escondido && (<>
      {/* Logo */}
      <div className="h-20 [@media(max-height:760px)]:h-14 [@media(max-height:560px)]:h-11 flex items-center justify-center px-4 pb-3 [@media(max-height:620px)]:pb-2 border-b border-sidebar-border shrink-0">
        <img
          src="/logo-universo-aba.png"
          className={`object-contain transition-[width,height] duration-200 ease-out motion-reduce:transition-none ${collapsed ? 'h-10 w-10' : 'h-full'}`}
          alt="Universo ABA"
        />
      </div>

      <SidebarContent collapsed={collapsed} />
      </>)}

      {/* Collapse toggle */}
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        // Some até o mouse entrar no menu; o foco por teclado e telas sem
        // hover (toque) mostram sempre. Opacidade, não display: segue clicável.
        className={`absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 [@media(pointer:coarse)]:w-9 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:-right-4.5 ${escondido ? '-right-9! rounded-l-none opacity-100!' : ''} rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center hover:bg-sidebar-accent transition-[opacity,background-color] shadow-md z-9999 opacity-0 group-hover/menu:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-sidebar-ring [@media(hover:none)]:opacity-100 motion-reduce:transition-none`}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        <ChevronLeft
          className={`w-3 h-3 text-sidebar-foreground/60 transition-transform duration-300 motion-reduce:transition-none ${
            collapsed ? 'rotate-180' : ''
          }`}
        />
      </button>
    </aside>
    </div>
  )
}

export default AppSidebar
