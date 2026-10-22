'use client'

import React, { useEffect, useState } from 'react'
import { Building2, Copy, MessageSquare, Phone, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import type { ContatoCompartilhado } from '@/modules/atendimento/utils/contato-compartilhado'
import type { Contact } from '@/modules/atendimento/types/central.types'
import { rotuloTipoContato } from './adapters/centralToNina'
import { Avatar } from './Avatar'

// ============================================================================
// Cartão de contato compartilhado
//
// Antes era o texto "[contato compartilhado: …]", lido como aviso do sistema e
// com o número preso no meio de uma frase. O cartão põe o número à mão (copiar,
// ligar no celular, abrir a conversa) e diz o que o Pulsar sabe dele:
//
//   • Número da clínica — o caso que motivou o cartão (22/10): a pessoa mandou
//     o número da própria clínica dizendo que ninguém atende. É queixa, não
//     contato novo, e precisa ser visto de relance.
//   • Já cadastrado — quem é, e a conversa com ele a um clique.
//
// A consulta é a /api/central/contacts/por-telefone, uma vez por número na
// sessão (o polling remonta a bolha; o cache segura a repetição).
// ============================================================================

interface InfoTelefone {
  daClinica:  string | null
  contato:    Pick<Contact, 'id' | 'name' | 'contact_type' | 'is_provisional'> | null
  conversaId: string | null
}

const consultas = new Map<string, Promise<InfoTelefone | null>>()

function consultar(digitos: string): Promise<InfoTelefone | null> {
  let p = consultas.get(digitos)
  if (!p) {
    p = fetch(`/api/central/contacts/por-telefone/?tel=${digitos}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j?.data ?? null) as InfoTelefone | null)
      .catch(() => null)
    // Falha não fica guardada: a próxima montagem tenta de novo.
    p.then(info => { if (!info) consultas.delete(digitos) })
    consultas.set(digitos, p)
  }
  return p
}

const soDigitos = (t: string) => t.replace(/\D/g, '')

interface Props {
  contatos:         ContatoCompartilhado[]
  claro:            boolean
  conversaAtualId?: string | null
  aoAbrirConversa?: (id: string) => void
}

export const CartaoContato: React.FC<Props> = ({ contatos, claro, conversaAtualId, aoAbrirConversa }) => {
  if (contatos.length === 0) {
    return <span className={claro ? 'text-white/80' : 'text-muted-foreground'}>Contato compartilhado sem dados</span>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {contatos.map((c, i) => (
        <UmContato key={i} contato={c} claro={claro} conversaAtualId={conversaAtualId} aoAbrirConversa={aoAbrirConversa} />
      ))}
    </div>
  )
}

const UmContato: React.FC<{
  contato:          ContatoCompartilhado
  claro:            boolean
  conversaAtualId?: string | null
  aoAbrirConversa?: (id: string) => void
}> = ({ contato, claro, conversaAtualId, aoAbrirConversa }) => {
  const principal = contato.telefones[0] ?? null
  const digitos = principal ? soDigitos(principal) : ''
  const [info, setInfo] = useState<InfoTelefone | null>(null)

  useEffect(() => {
    if (digitos.length < 10) return
    let vivo = true
    void consultar(digitos).then(r => { if (vivo) setInfo(r) })
    return () => { vivo = false }
  }, [digitos])

  const nome = contato.nome ?? principal ?? 'Contato sem nome'
  const moldura = claro ? 'border-white/25 bg-white/10' : 'border-border bg-background/60'
  const secundario = claro ? 'text-white/75' : 'text-muted-foreground'
  // Classes inteiras, nunca montadas por interpolação: o Tailwind só gera o que
  // encontra escrito no código.
  const divisoria = claro
    ? 'border-white/20 [&>*+*]:border-l [&>*+*]:border-white/20'
    : 'border-border [&>*+*]:border-l [&>*+*]:border-border'
  const botao = `flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
    claro ? 'hover:bg-white/15 focus-visible:ring-white/60' : 'text-cyan-700 dark:text-cyan-400 hover:bg-muted focus-visible:ring-cyan-500'
  }`

  const copiar = () => {
    if (!principal) return
    navigator.clipboard?.writeText(principal).then(
      () => toast.success('Número copiado'),
      () => toast.error('Não foi possível copiar o número.'),
    )
  }

  const conversa = info?.conversaId && info.conversaId !== conversaAtualId ? info.conversaId : null

  return (
    <div className={`w-full min-w-56 max-w-xs overflow-hidden rounded-lg border whitespace-normal ${moldura}`}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div className="w-10 h-10 shrink-0">
          <Avatar url="" nome={nome} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{nome}</p>
          {contato.telefones.map(t => (
            <p key={t} className={`text-xs tabular-nums ${secundario}`}>{t}</p>
          ))}
          {info?.daClinica && (
            <p className={`mt-1 flex items-start gap-1 text-[11px] font-medium leading-snug ${claro ? 'text-white' : 'text-amber-700 dark:text-amber-400'}`}>
              <Building2 className="w-3 h-3 mt-px shrink-0" />
              <span>Número da clínica ({info.daClinica})</span>
            </p>
          )}
          {!info?.daClinica && info?.contato && (
            <p className={`mt-1 flex items-start gap-1 text-[11px] font-medium leading-snug ${claro ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'}`}>
              <UserCheck className="w-3 h-3 mt-px shrink-0" />
              <span>
                Já cadastrado: {info.contato.name?.trim() || 'sem nome'} ({rotuloTipoContato(info.contato as Contact)})
              </span>
            </p>
          )}
        </div>
      </div>

      {principal && (
        <div className={`flex border-t ${divisoria}`}>
          <button type="button" onClick={copiar} className={botao}>
            <Copy className="w-3.5 h-3.5" />
            {/* No celular cabem três botões só com rótulo curto. */}
            <span className="pointer-coarse:hidden">Copiar número</span>
            <span className="hidden pointer-coarse:inline">Copiar</span>
          </button>
          {conversa && aoAbrirConversa && (
            <button type="button" onClick={() => aoAbrirConversa(conversa)} className={botao}>
              <MessageSquare className="w-3.5 h-3.5" />
              Abrir conversa
            </button>
          )}
          {/* Ligar só onde há telefone na mão: no computador, tel: abre um
              diálogo de aplicativo que ninguém configurou. */}
          <a href={`tel:+${digitos}`} className={`${botao} hidden pointer-coarse:flex`}>
            <Phone className="w-3.5 h-3.5" />
            Ligar
          </a>
        </div>
      )}
    </div>
  )
}
