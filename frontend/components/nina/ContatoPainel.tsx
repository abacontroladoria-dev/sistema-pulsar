'use client'

import React, { useEffect, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from './Button'
import type { Contact, ContactType } from '@/modules/atendimento/types/central.types'

// Painel lateral de cadastro do contato. Salvar confere o cadastro: o contato
// deixa de ser provisório, como no NomeContatoPopover da conversa.

interface Props {
  contato:       Contact | null
  rotulos:       Record<ContactType, string>
  abrindo:       boolean
  onFechar:      () => void
  onSalvo:       (c: Contact) => void
  onAbrirConversa: (c: Contact) => void
}

const campo = 'w-full px-3 py-2.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50'

export function ContatoPainel({ contato, rotulos, abrindo, onFechar, onSalvo, onAbrirConversa }: Props) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<ContactType>('other')
  const [email, setEmail] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!contato) return
    setNome(contato.name ?? '')
    setTipo(contato.contact_type)
    setEmail(contato.display_email ?? '')
  }, [contato])

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!contato) return
    if (!nome.trim()) { toast.error('Informe o nome do contato.'); return }
    setSalvando(true)
    try {
      const corpo: Record<string, unknown> = { name: nome.trim(), contactType: tipo, isProvisional: false }
      if (email.trim()) corpo.displayEmail = email.trim()
      // Barra final: trailingSlash:true faz o PATCH sem ela virar 308.
      const res = await fetch(`/api/central/contacts/${contato.id}/`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(corpo),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message ?? `A gravação falhou com ${res.status}.`)
      onSalvo(json.data as Contact)
      toast.success(contato.is_provisional ? 'Cadastro conferido.' : 'Contato atualizado.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={contato !== null} onOpenChange={(aberto) => { if (!aberto) onFechar() }}>
      <DialogContent className="top-0 right-0 left-auto h-dvh w-full max-w-full sm:max-w-md translate-x-0 translate-y-0 rounded-none content-start gap-6 p-6 overflow-y-auto">
        {contato && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">{contato.is_provisional ? 'Conferir cadastro' : 'Cadastro do contato'}</DialogTitle>
              <DialogDescription>
                {contato.is_provisional
                  ? 'Este contato foi criado sozinho quando a pessoa mandou mensagem. Confira o nome e diga quem ela é.'
                  : `Telefone ${contato.display_phone ?? 'não informado'}.`}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={salvar} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nome
                <input className={campo} value={nome} onChange={e => setNome(e.target.value)} maxLength={255} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Quem é
                <select className={campo} value={tipo} onChange={e => setTipo(e.target.value as ContactType)}>
                  {(Object.keys(rotulos) as ContactType[]).map(t => (
                    <option key={t} value={t}>{rotulos[t]}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                E-mail <span className="font-normal text-muted-foreground">(opcional)</span>
                <input type="email" className={campo} value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
              </label>
              <div className="text-sm">
                <div className="font-medium">Telefone</div>
                <div className="text-muted-foreground mt-1">{contato.display_phone ?? 'Não informado'}</div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 sm:flex-1"
                  disabled={abrindo}
                  onClick={() => onAbrirConversa(contato)}
                >
                  {abrindo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Abrir conversa
                </Button>
                <Button type="submit" className="h-11 sm:flex-1" disabled={salvando}>
                  {salvando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {contato.is_provisional ? 'Conferir cadastro' : 'Salvar'}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
