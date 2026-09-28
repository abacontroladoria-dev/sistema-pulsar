'use client'

import React, { useEffect, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/nina/Button'
import { crmApi } from '@/services/crm/client'
import type { TrilhaNegocio } from '@/modules/comercial/types/crm.types'
import { ROTULO_TRILHA } from './funil'

// ============================================================================
// Cadastro manual de um negócio — para quem chegou por fora do WhatsApp da
// Maia (ligação, indicação, balcão). O que vem pelo WhatsApp entra sozinho
// (trigger crm.criar_negocio_na_conversa_nova).
//
// Contato NOVO nasce contact_type='lead', e o trigger
// crm.auto_create_deal_on_lead() já cria o negócio em "Novo" — criar outro
// bateria em uq_open_deal_per_contact (409). Então: cria o contato, acha o
// negócio que o trigger criou e o completa. Mesmo desenho do CreateDealModal
// que este substitui.
// ============================================================================

interface ContatoLista { id: string; name: string | null; display_phone: string | null }

function paraE164(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '')
  return digitos.startsWith('55') ? `+${digitos}` : `+55${digitos}`
}

export const NovoNegocioModal: React.FC<{
  aberto:      boolean
  aoFechar:    () => void
  aoCriar:     () => void
}> = ({ aberto, aoFechar, aoCriar }) => {
  const [modo, setModo]           = useState<'existente' | 'novo'>('novo')
  const [busca, setBusca]         = useState('')
  const [contatos, setContatos]   = useState<ContatoLista[]>([])
  const [buscando, setBuscando]   = useState(false)
  const [contatoId, setContatoId] = useState<string | null>(null)
  const [nome, setNome]           = useState('')
  const [telefone, setTelefone]   = useState('')
  const [trilha, setTrilha]       = useState<TrilhaNegocio | null>(null)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando]   = useState(false)

  useEffect(() => {
    if (!aberto) return
    setModo('novo'); setBusca(''); setContatos([]); setContatoId(null)
    setNome(''); setTelefone(''); setTrilha(null); setObservacao('')
  }, [aberto])

  // Busca com espera de 300 ms: uma requisição por pausa na digitação, não
  // uma por tecla.
  useEffect(() => {
    if (!aberto || modo !== 'existente') return
    const termo = busca.trim()
    if (termo.length < 2) { setContatos([]); return }
    const controller = new AbortController()
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/central/contacts/?search=${encodeURIComponent(termo)}&limit=20`, { signal: controller.signal })
        const corpo = await r.json()
        setContatos(r.ok ? (corpo?.data ?? []) : [])
      } catch {
        if (!controller.signal.aborted) setContatos([])
      } finally {
        if (!controller.signal.aborted) setBuscando(false)
      }
    }, 300)
    return () => { clearTimeout(t); controller.abort() }
  }, [busca, modo, aberto])

  const telefoneValido = telefone.replace(/\D/g, '').length >= 10
  const pronto = modo === 'existente' ? !!contatoId : (nome.trim().length > 0 && telefoneValido)

  const salvar = async () => {
    if (!pronto) return
    setSalvando(true)
    try {
      let idContato = contatoId
      let titulo = contatos.find(c => c.id === contatoId)?.name?.trim() || 'Contato sem nome'

      if (modo === 'novo') {
        const r = await fetch('/api/central/contacts/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: nome.trim(), displayPhone: paraE164(telefone), contactType: 'lead' }),
        })
        const corpo = await r.json().catch(() => null)
        if (!r.ok) {
          toast.error(r.status === 409
            ? 'Já existe um contato com este telefone. Use “Contato existente”.'
            : corpo?.error?.message ?? 'Não foi possível criar o contato')
          return
        }
        idContato = corpo?.data?.id
        titulo = nome.trim()
      }

      const campos = {
        title:       titulo,
        description: observacao.trim() || null,
        trilha,
      }

      // Negócio que o trigger acabou de criar para o contato novo.
      let doTrigger: { id: string } | null = null
      if (modo === 'novo' && idContato) {
        const r = await fetch('/api/crm/deals/?status=open&limit=1000').then(x => x.json()).catch(() => null)
        doTrigger = (r?.data ?? []).find((d: { contact_id: string }) => d.contact_id === idContato) ?? null
      }

      if (doTrigger) {
        await crmApi.updateDeal(doTrigger.id, campos)
      } else {
        await crmApi.createDeal({ ...campos, contactId: idContato, source: 'manual' })
      }

      toast.success('Negócio criado em “Novo”')
      aoCriar()
      aoFechar()
    } catch (err) {
      // 409 do createDeal: o contato já tem negócio aberto. A mensagem do
      // servidor diz isso.
      toast.error((err as Error).message || 'Não foi possível criar o negócio')
    } finally {
      setSalvando(false)
    }
  }

  const campoClasse = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-cyan-500'

  return (
    <Dialog open={aberto} onOpenChange={(a) => { if (!a) aoFechar() }}>
      <DialogContent className="sm:max-w-[500px] bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Novo negócio</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Para quem chegou por ligação, indicação ou balcão. Quem escreve no WhatsApp da Maia entra sozinho.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5" role="tablist">
            {(['novo', 'existente'] as const).map(m => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={modo === m}
                onClick={() => setModo(m)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
                  modo === m ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'novo' ? 'Contato novo' : 'Contato existente'}
              </button>
            ))}
          </div>

          {modo === 'novo' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Nome do responsável
                <input value={nome} onChange={e => setNome(e.target.value)} className={campoClasse} autoFocus />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                WhatsApp
                <input
                  value={telefone}
                  onChange={e => setTelefone(e.target.value)}
                  inputMode="tel"
                  placeholder="(21) 99999-9999"
                  className={campoClasse}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Nome ou telefone"
                  aria-label="Buscar contato"
                  className={`${campoClasse} pl-9`}
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border custom-scrollbar" role="listbox" aria-label="Contatos">
                {buscando ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : contatos.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {busca.trim().length < 2 ? 'Digite ao menos 2 letras.' : 'Nenhum contato encontrado.'}
                  </p>
                ) : contatos.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={contatoId === c.id}
                    onClick={() => setContatoId(c.id)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${contatoId === c.id ? 'bg-cyan-500/10' : ''}`}
                  >
                    <span className="truncate text-foreground">{c.name || 'Sem nome'}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{c.display_phone}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Trilha</legend>
            <div className="flex rounded-lg border border-border bg-card p-0.5">
              {([null, 'particular', 'convenio'] as (TrilhaNegocio | null)[]).map(t => (
                <button
                  key={t ?? 'nenhuma'}
                  type="button"
                  aria-pressed={trilha === t}
                  onClick={() => setTrilha(t)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
                    trilha === t ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t ? ROTULO_TRILHA[t] : 'A definir'}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Observação (opcional)
            <textarea
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={2}
              placeholder="Como chegou, o que procura…"
              className="resize-none rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-cyan-500"
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={!pronto || salvando}>
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar negócio'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
