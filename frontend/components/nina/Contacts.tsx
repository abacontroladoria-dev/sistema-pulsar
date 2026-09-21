'use client'

import React, { useEffect, useState } from 'react'
import { Search, Filter, MessageSquare, Loader2, Mail, Phone, Users, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Contact } from '@/types/nina'
import { api } from '@/services/nina/api'
import { toast } from 'sonner'

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const router = useRouter()

  useEffect(() => {
    const loadContacts = async () => {
      try {
        // TODO: Implementar fetch de contatos via api.ts
        setContacts([])
      } catch (error) {
        console.error('Erro ao carregar contatos', error)
        toast.error('Erro ao carregar contatos')
      } finally {
        setLoading(false)
      }
    }
    loadContacts()
  }, [])

  const filteredContacts = contacts.filter(c => {
    const term = searchTerm.toLowerCase()
    return (
      (c.name?.toLowerCase() || '').includes(term) ||
      (c.phone || '').includes(term) ||
      (c.email?.toLowerCase() || '').includes(term)
    )
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'customer':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      case 'lead':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
      case 'churned':
        return 'bg-muted text-muted-foreground border-border'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const handleStartConversation = (contact: Contact) => {
    router.push(`/connect/chat?contact=${encodeURIComponent(contact.phone)}`)
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-background text-foreground">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Contatos</h2>
          <p className="text-sm text-muted-foreground mt-1">Gerencie sua base de leads e clientes com inteligência.</p>
        </div>
        <Button
          className="shadow-lg shadow-cyan-500/20 opacity-50 cursor-not-allowed"
          disabled
          title="Em breve: Adicionar contato"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Novo Contato
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 mb-8 bg-card p-2 rounded-xl border border-border">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
          <input
            type="text"
            placeholder="Buscar por nome, email ou telefone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-muted-foreground/70 transition-all"
          />
        </div>
        <Button
          variant="outline"
          className="w-full sm:w-auto bg-background border-border text-muted-foreground/70 cursor-not-allowed opacity-50"
          disabled
          title="Em breve: Filtros avançados"
        >
          <Filter className="w-4 h-4 mr-2" />
          Filtros Avançados
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card backdrop-blur-sm shadow-xl overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-80">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-500 mb-3" />
            <span className="text-sm text-muted-foreground animate-pulse">Carregando base de dados...</span>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-muted-foreground">
            <Users className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Nenhum contato encontrado</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {searchTerm ? 'Tente buscar por outro termo' : 'Os contatos aparecerão aqui'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-card text-muted-foreground border-b border-border font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Nome / Telefone</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Canais</th>
                  <th className="px-6 py-4">Última Interação</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-muted transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-border flex items-center justify-center text-sm font-bold text-cyan-400 shadow-inner">
                          {(contact.name || contact.phone || '?').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-foreground group-hover:text-cyan-400 transition-colors">
                            {contact.name || 'Sem nome'}
                          </div>
                          <div className="text-xs text-muted-foreground/70">{contact.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${getStatusColor(contact.status)}`}>
                        {contact.status === 'customer' ? 'Cliente Ativo' : contact.status === 'lead' ? 'Lead Qualificado' : 'Churned'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {contact.email && (
                          <div className="flex items-center gap-2 text-muted-foreground text-xs">
                            <Mail className="w-3.5 h-3.5" />
                            {contact.email}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-muted-foreground text-xs">
                          <Phone className="w-3.5 h-3.5" />
                          {contact.phone}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-muted-foreground">{new Date(contact.lastContact).toLocaleDateString('pt-BR')}</span>
                      <div className="text-[10px] text-muted-foreground/70">via WhatsApp</div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                        <Button
                          size="sm"
                          variant="primary"
                          className="h-8 w-8 p-0 rounded-lg shadow-none"
                          title="Iniciar Conversa"
                          onClick={() => handleStartConversation(contact)}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Contacts
