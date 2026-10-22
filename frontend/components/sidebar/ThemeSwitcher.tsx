'use client'

import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

export function ThemeSwitcher({ compacto = false }: { compacto?: boolean }) {
  const { theme, setTheme } = useTheme()

  // Sidebar recolhido (64px): os dois botões com texto não cabem. Vira um
  // botão só, no formato dos itens do menu, que alterna o tema e mostra o
  // ícone do tema para onde vai.
  if (compacto) {
    const proximo = theme === 'dark' ? 'light' : 'dark'
    const rotulo = proximo === 'dark' ? 'Mudar para tema escuro' : 'Mudar para tema claro'
    const Icone = proximo === 'dark' ? Moon : Sun
    return (
      <button
        type="button"
        onClick={() => setTheme(proximo)}
        title={rotulo}
        aria-label={rotulo}
        className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
      >
        <Icone className="h-5 w-5 shrink-0" />
      </button>
    )
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center rounded-lg p-0.5 bg-sidebar-accent/50 border border-sidebar-border">
        <button
          onClick={() => setTheme('light')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer
            ${theme === 'light'
              ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
        >
          <Sun size={13} />
          <span>Light</span>
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer
            ${theme === 'dark'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
        >
          <Moon size={13} />
          <span>Dark</span>
        </button>
      </div>
    </div>
  )
}
