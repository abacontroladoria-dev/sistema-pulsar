"use client"

import { Loader2, Save } from "lucide-react"

interface SalvarTudoBarProps {
  dirtyCount: number
  saving: boolean
  onSave: () => void
}

export function SalvarTudoBar({ dirtyCount, saving, onSave }: SalvarTudoBarProps) {
  return (
    <div className="flex items-center gap-3 shrink-0">
      {dirtyCount > 0 && (
        <span className="text-xs font-semibold text-[var(--status-atencao)] whitespace-nowrap">
          {dirtyCount} {dirtyCount === 1 ? "alteração não salva" : "alterações não salvas"}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={dirtyCount === 0 || saving}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Salvar tudo
      </button>
    </div>
  )
}
