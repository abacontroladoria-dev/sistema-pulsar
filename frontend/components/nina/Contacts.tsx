'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Search, MessageSquare, Loader2, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { ContatoPainel } from './ContatoPainel'
import type { Contact, ContactType } from '@/modules/atendimento/types/central.types'
import { toast } from 'sonner'

const POR_PAGINA = 50

const ROTULO_TIPO: Record<ContactType, string> = {
  guardian:  'Responsável',
  patient:   'Paciente',
  therapist: 'Terapeuta',
  physician: 'Médico',
  employee:  'Colaborador',
  lead:      'Lead',
  supplier:  'Fornecedor',
  other:     'Outro',
}

// Fichas de filtro: só os tipos que aparecem no atendimento.
const FILTROS: { valor: ContactType | null; rotulo: string }[] = [
  { valor: null,       rotulo: 'Todos' },
  { valor: 'lead',     rotulo: 'Leads' },
  { valor: 'patient',  rotulo: 'Pacientes' },
  { valor: 'guardian', rotulo: 'Responsáveis' },
  { valor: 'other',    rotulo: 'Outro' },
]

const COR_TIPO: Partial<Record<ContactType, string>> = {
  patient:  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  guardian: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  lead:     'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
}

function iniciais(c: Contact) {
  const base = (c.name || c.display_phone || '?').trim()
  const partes = base.split(/\s+/)
  return (partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : base.slice(0, 2)).toUpperCase()
}

function Avatar({ c }: { c: Contact }) {
  const [falhou, setFalhou] = useState(false)
  if (c.avatar_url && !falhou) {
    // eslint-disable-next-line @next/next/no-img-element -- foto vem do WhatsApp, domínio variável
    return <img src={c.avatar_url} alt="" onError={() => setFalhou(true)} className="w-10 h-10 rounded-full object-cover shrink-0 bg-muted" />
  }
  return (
    <div className="w-10 h-10 rounded-full bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 flex items-center justify-center text-sm font-semibold shrink-0">
      {iniciais(c)}
    </div>
  )
}

function SeloTipo({ c }: { c: Contact }) {
  return (
    <>
      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${COR_TIPO[c.contact_type] ?? 'bg-muted text-muted-foreground'}`}>
        {ROTULO_TIPO[c.contact_type] ?? 'Outro'}
      </span>
      {c.is_provisional && (
        <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
          A conferir
        </span>
      )}
    </>
  )
}

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [tipo, setTipo] = useState<ContactType | null>(null)
  const [aberto, setAberto] = useState<Contact | null>(null)
  const [abrindoConversa, setAbrindoConversa] = useState<string | null>(null)
  const router = useRouter()
  // Filtro vigente: descarta o "Carregar mais" que volta depois de a busca mudar.
  const filtroAtual = useRef('')
  filtroAtual.current = `${tipo ?? ''}|${searchTerm}`

  // A busca roda no servidor (nome e telefone); a lista local é só uma página.
  const buscar = async (termo: string, filtroTipo: ContactType | null, offset: number) => {
    const qs = new URLSearchParams({ limit: String(POR_PAGINA), offset: String(offset) })
    if (termo.trim()) qs.set('search', termo.trim())
    if (filtroTipo) qs.set('contactType', filtroTipo)
    const res = await fetch(`/api/central/contacts?${qs}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    return { data: (body.data ?? []) as Contact[], total: (body.pagination?.total ?? 0) as number }
  }

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await buscar(searchTerm, tipo, 0)
        if (cancelado) return
        setContacts(r.data)
        setTotal(r.total)
      } catch (error) {
        console.error('Erro ao carregar contatos', error)
        if (!cancelado) toast.error('Não foi possível carregar os contatos. Recarregue a página.')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }, 300)
    return () => { cancelado = true; clearTimeout(t) }
  }, [searchTerm, tipo])

  const carregarMais = async () => {
    const chave = filtroAtual.current
    setCarregandoMais(true)
    try {
      const r = await buscar(searchTerm, tipo, contacts.length)
      if (filtroAtual.current !== chave) return
      setContacts(prev => [...prev, ...r.data])
      setTotal(r.total)
    } catch (error) {
      console.error('Erro ao carregar contatos', error)
      toast.error('Não foi possível carregar mais contatos.')
    } finally {
      setCarregandoMais(false)
    }
  }

  // O inbox abre a conversa por `?c=<id>`; aqui só se acha a mais recente do contato.
  const abrirConversa = async (contact: Contact) => {
    setAbrindoConversa(contact.id)
    try {
      const res = await fetch(`/api/central/conversations?contactId=${contact.id}&limit=1`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const conversa = (body.data ?? [])[0] as { id: string } | undefined
      if (!conversa) { toast.info('Ainda não há conversa com este contato.'); return }
      router.push(`/connect/inbox?c=${conversa.id}`)
    } catch (error) {
      console.error('Erro ao abrir conversa', error)
      toast.error('Não foi possível abrir a conversa. Tente de novo.')
    } finally {
      setAbrindoConversa(null)
    }
  }

  const aoSalvar = (c: Contact) => {
    setContacts(prev => prev.map(x => (x.id === c.id ? c : x)))
    setAberto(null)
  }

  const filtrando = Boolean(searchTerm.trim() || tipo)

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-8 sm:py-8">
        <header className="mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Contatos</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Quem fala com a clínica pelo WhatsApp entra aqui sozinho.
            {!loading && (
              <> {total === 1 ? '1 contato' : `${total.toLocaleString('pt-BR')} contatos`}{filtrando ? ' neste filtro' : ''}.</>
            )}
          </p>
        </header>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar contato"
            placeholder="Buscar por nome ou telefone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-muted-foreground/70"
          />
        </div>

        <div role="group" aria-label="Filtrar por tipo" className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-4 px-4 sm:mx-0 sm:px-0">
          {FILTROS.map(f => {
            const ativo = tipo === f.valor
            return (
              <button
                key={f.rotulo}
                type="button"
                aria-pressed={ativo}
                onClick={() => setTipo(f.valor)}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
                  ativo
                    ? 'bg-cyan-600 border-cyan-600 text-white'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {f.rotulo}
              </button>
            )
          })}
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center gap-2 h-64 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando contatos
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 px-6 text-center text-muted-foreground">
              <Users className="w-10 h-10 mb-3 opacity-40" />
              <p className="font-medium text-foreground">
                {filtrando ? 'Nenhum contato com esse filtro' : 'Ainda não há contatos'}
              </p>
              <p className="text-sm mt-1 max-w-sm">
                {filtrando
                  ? 'Confira o nome ou o número, ou volte para Todos.'
                  : 'O primeiro aparece assim que alguém mandar mensagem para a clínica.'}
              </p>
              {filtrando && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchTerm(''); setTipo(null) }}>
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-4 px-5 py-3 border-b border-border text-xs font-medium text-muted-foreground">
                <span>Contato</span>
                <span>Tipo</span>
                <span>Atualizado em</span>
                <span className="w-11" aria-hidden />
              </div>
              <ul className="divide-y divide-border">
                {contacts.map(contact => (
                  <li
                    key={contact.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver cadastro de ${contact.name || contact.display_phone || 'contato'}`}
                    onClick={() => setAberto(contact)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto(contact) } }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500/60 grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-4 px-4 md:px-5 py-3 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar c={contact} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{contact.name || 'Sem nome'}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {contact.display_phone ?? 'Sem telefone'}
                          {contact.display_email && <span className="hidden sm:inline">, {contact.display_email}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1 md:hidden">
                          <SeloTipo c={contact} />
                        </div>
                      </div>
                    </div>
                    <div className="hidden md:flex flex-wrap gap-1.5">
                      <SeloTipo c={contact} />
                    </div>
                    <div className="hidden md:block text-sm text-muted-foreground">
                      {new Date(contact.updated_at).toLocaleDateString('pt-BR')}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 w-11 p-0 rounded-lg"
                      title="Abrir conversa"
                      aria-label={`Abrir conversa com ${contact.name || contact.display_phone || 'contato'}`}
                      disabled={abrindoConversa === contact.id}
                      onClick={(e) => { e.stopPropagation(); void abrirConversa(contact) }}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {abrindoConversa === contact.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                    </Button>
                  </li>
                ))}
              </ul>
              {contacts.length < total && (
                <div className="flex justify-center p-4 border-t border-border">
                  <Button variant="outline" size="sm" onClick={carregarMais} disabled={carregandoMais}>
                    {carregandoMais && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Carregar mais ({contacts.length} de {total})
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ContatoPainel
        contato={aberto}
        rotulos={ROTULO_TIPO}
        abrindo={aberto !== null && abrindoConversa === aberto.id}
        onFechar={() => setAberto(null)}
        onSalvo={aoSalvar}
        onAbrirConversa={(c) => void abrirConversa(c)}
      />
    </div>
  )
}

export default Contacts
