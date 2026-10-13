'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy, ClipboardCopy } from 'lucide-react'
import toast from 'react-hot-toast'

const SISTEMA_URL = 'https://orbitaautomacao.com.br/'

export default function GeneratedPasswordReveal({
  nome,
  email,
  username,
  password,
  description,
  onClose,
  closeLabel = 'Fechar',
}: {
  nome: string
  email?: string | null
  username?: string | null
  password: string
  description?: ReactNode
  onClose: () => void
  closeLabel?: string
}) {
  const [copied, setCopied] = useState(false)
  const [copiedInfo, setCopiedInfo] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      toast.success('Senha copiada')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar a senha')
    }
  }

  async function handleCopyInfo() {
    const texto = [
      '🔐 **Acesso ao Sistema PULSAR**',
      '',
      `Link: ${SISTEMA_URL}`,
      `Usuário: ${username || email || '-'}`,
      `Senha: ${password}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(texto)
      setCopiedInfo(true)
      toast.success('Informações copiadas')
      setTimeout(() => setCopiedInfo(false), 2000)
    } catch {
      toast.error('Não foi possível copiar as informações')
    }
  }

  return (
    <div>
      <p className="mt-3 text-sm text-slate-500">
        {description ?? (
          <>
            Envie a senha temporária abaixo para <strong>{nome}</strong>. No
            próximo login, será solicitado que ele crie uma nova senha.
          </>
        )}
      </p>

      <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-slate-500">Link</span>
          <span className="truncate text-sm font-medium text-slate-800">{SISTEMA_URL}</span>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-slate-500">Email</span>
          <span className="truncate text-sm font-medium text-slate-800">{email || '-'}</span>
        </div>

        {username && (
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm text-slate-500">Usuário</span>
            <span className="truncate text-sm font-medium text-slate-800">{username}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-slate-500">Senha</span>
          <div className="flex items-center gap-2">
            <code className="text-sm font-medium tracking-wide text-slate-800">{password}</code>
            <button
              onClick={handleCopy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200"
              title="Copiar senha"
              aria-label="Copiar senha"
            >
              {copied ? <Check size={14} className="text-emerald-600" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--status-atencao)]">
        Esta senha não será exibida novamente. Copie-a agora.
      </p>

      <button
        onClick={handleCopyInfo}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        {copiedInfo ? (
          <>
            <Check size={16} className="text-emerald-600" />
            Informações copiadas
          </>
        ) : (
          <>
            <ClipboardCopy size={16} />
            Copiar informações para enviar
          </>
        )}
      </button>

      <button
        onClick={onClose}
        className="mt-2 w-full rounded-2xl bg-brand-fg py-3 text-sm font-medium text-white transition hover:opacity-90"
      >
        {closeLabel}
      </button>
    </div>
  )
}
