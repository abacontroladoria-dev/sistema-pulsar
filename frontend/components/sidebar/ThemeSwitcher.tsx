'use client'

import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

import type { ReactNode } from 'react'

/** `dica`: quem tem dica própria (Connect) a desenha no lugar do title nativo. */
export function ThemeSwitcher({ compacto = false, dica }: { compacto?: boolean; dica?: (rotulo: string) => ReactNode }) {
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
        title={dica ? undefined : rotulo}
        aria-label={rotulo}
        className="group relative flex w-full items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
      >
        <Icone className="h-5 w-5 shrink-0" />
        {dica?.(rotulo)}
      </button>
    )
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center rounded-lg p-0.5 bg-sidebar-accent/50 border border-sidebar-border">
        <button
          type="button"
          aria-pressed={theme === 'light'}
          onClick={() => setTheme('light')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer
            ${theme === 'light'
              ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
        >
          <Sun size={13} aria-hidden />
          <span>Claro</span>
        </button>
        <button
          type="button"
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme('dark')}
          className={`flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer
            ${theme === 'dark'
              ? 'bg-slate-700 text-white shadow-sm'
              : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
            }`}
        >
          <Moon size={13} aria-hidden />
          <span>Escuro</span>
        </button>
      </div>
    </div>
  )
}
