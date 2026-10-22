'use client'

import React, { useState } from 'react'
import { MessageSquare, MessagesSquare, Users, LayoutDashboard, Kanban, Calendar, Settings as SettingsIcon, LogOut, ArrowLeft, ChevronLeft, Inbox as InboxIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/nina/useAuth'
import { useUsuarioAtual } from '@/hooks/useUsuarioAtual'
import { useChatEquipe, useContadoresChatEquipe } from '@/contexts/ChatEquipeContext'
import BolinhaNaoLidas from '@/components/chat-equipe/BolinhaNaoLidas'
import { useConversasAbertas } from '@/hooks/nina/useConversasAbertas'
import Link from 'next/link'
import { toast } from 'sonner'
import { ThemeSwitcher } from '@/components/sidebar/ThemeSwitcher'

const menuItems = [
  { id: 'crm',       label: 'Dashboard',     icon: LayoutDashboard },
  { id: 'inbox',     label: 'Inbox',         icon: MessageSquare },
  { id: 'atendimentos', label: 'Atendimentos', icon: InboxIcon },
  { id: 'contacts',  label: 'Contatos',      icon: Users },
  { id: 'pipeline',  label: 'Funil',         icon: Kanban },
  { id: 'analytics', label: 'Agendamentos',  icon: Calendar },
  { id: 'settings',  label: 'Configurações', icon: SettingsIcon },
]

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
      title={collapsed ? (n > 0 ? `${rotulo} (${rotuloN} não lidas)` : rotulo) : undefined}
      aria-label={n > 0 ? `${rotulo}, ${rotuloN} não lidas` : undefined}
      // Sem o fundo de "página atual": o painel aberto não é página, e com ele
      // o item da tela em que a pessoa está e o do chat apareciam os dois marcados.
      className={`relative flex w-full items-center gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-sidebar-accent/60 ${
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

  const handleLogout = async () => {
    try {
      await signOut()
      toast.success('Logout realizado com sucesso')
      window.location.href = '/auth'
    } catch {
      toast.error('Erro ao fazer logout')
    }
  }

  const inicial = usuario.primeiroNome.charAt(0).toUpperCase() || 'U'

  return (
    <>
      {/* Nav items */}
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden px-2">
        <nav className="flex flex-col gap-0.5">
          {menuItems.map((item) => {
            const isActive = currentPath.startsWith(item.id)
            const contagem = item.id === 'atendimentos' ? abertas : 0
            const rotuloContagem = contagem > 0 ? ` (${contagem > 99 ? '99+' : contagem} em aberto)` : ''
            return (
              <Link
                key={item.id}
                href={`/connect/${item.id}`}
                title={collapsed ? `${item.label}${rotuloContagem}` : undefined}
                aria-label={contagem > 0 ? `${item.label}${rotuloContagem}` : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && (
                  <span className="text-sm font-medium truncate">{item.label}</span>
                )}
                <BolinhaNaoLidas n={contagem} compacta={collapsed} />
              </Link>
            )
          })}

          {/* Chat da equipe: não navega — abre o painel lateral do layout raiz,
              o mesmo que o item do sidebar do Pulsar abre. "Menções a mim"
              (/connect/mencoes) era um item de página aqui; a página continua
              existindo para quem tem o link salvo. */}
          <ItemChatEquipe collapsed={collapsed} naoLidas={naoLidas} aberto={chat.aberto} aoClicar={chat.alternar} />
        </nav>
      </div>

      {/* Voltar ao Pulsar — Link, e não window.location: recarregar a página
          desmontaria o layout raiz e fecharia o Chat da equipe aberto. */}
      <div className="px-2">
        <Link
          href="/"
          title={collapsed ? 'Voltar ao Pulsar' : undefined}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
        >
          <ArrowLeft className="w-5 h-5 shrink-0" />
          {!collapsed && (
            <span className="text-sm font-medium">Voltar ao Pulsar</span>
          )}
        </Link>
      </div>

      {/* User footer — mesma identidade do sidebar do Pulsar: nome e papel.
          O e-mail sai da linha de baixo e vira title, para o papel ocupar o
          lugar que informa mais. */}
      <div className="border-t border-sidebar-border pt-3 px-2">
        {/* O seletor de tema fica acima do usuário, como no sidebar do Pulsar:
            mesmo componente, mesma posição relativa, para quem alterna entre os
            dois lados do sistema não precisar procurar. */}
        <ThemeSwitcher />
        <div
          className="flex items-center gap-3 p-2 rounded-xl hover:bg-sidebar-accent/60 transition-colors group"
          title={collapsed ? (usuario.gruposLabel ? `${usuario.primeiroNome} — ${usuario.gruposLabel}` : usuario.primeiroNome) : usuario.email}
        >
          <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold text-sidebar-accent-foreground border border-sidebar-border shrink-0">
            {inicial}
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
                <p className="text-[11px] text-amber-500/80 truncate">
                  Sem acesso à Central
                </p>
              )}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
            title="Sair"
          >
            <LogOut className="w-4 h-4 text-sidebar-foreground/50 hover:text-red-500 transition-colors" />
          </button>
        </div>
      </div>
    </>
  )
}

const AppSidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`relative h-full bg-sidebar border-r border-sidebar-border flex flex-col justify-between gap-6 py-4 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className="h-20 flex items-center justify-center px-4 border-b border-sidebar-border shrink-0">
        <img
          src="/logo-universo-aba.png"
          className={`object-contain transition-all duration-300 ${collapsed ? 'h-10 w-10' : 'h-20'}`}
        />
      </div>

      <SidebarContent collapsed={collapsed} />

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-sidebar border border-sidebar-border flex items-center justify-center hover:bg-sidebar-accent transition-colors shadow-md z-9999"
        title={collapsed ? 'Expandir menu' : 'Ocultar menu'}
      >
        <ChevronLeft
          className={`w-3 h-3 text-sidebar-foreground/60 transition-transform duration-300 ${
            collapsed ? 'rotate-180' : ''
          }`}
        />
      </button>
    </aside>
  )
}

export default AppSidebar
