'use client'

import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Loader2 } from 'lucide-react'

// ============================================================================
// Salvar contato / editar o nome
//
// "Salvo" é `contacts.is_provisional = false`. Todo contato que chega pelo
// WhatsApp nasce provisório, com o nome do PERFIL (o que a pessoa pôs no
// próprio WhatsApp — apelido, emoji, nome da empresa) ou sem nome nenhum.
// Salvar é a atendente dizer quem é: grava o nome e tira o "não confirmado".
//
// Por isso as duas ações são a mesma escrita. Editar o nome de um contato
// provisório também o salva — dar nome a alguém é confirmar quem ele é.
//
// O detalhe da conversa recarrega a cada 5s. O rascunho é semeado UMA vez, ao
// abrir, e o prop não volta a tocá-lo — um tique no meio da digitação apagaria
// o que a pessoa escreveu.
// ============================================================================

interface Props {
  // Nome atual do contato, sem o fallback para o telefone: semear o campo com
  // o número faria "salvar" gravar o telefone como nome.
  nome:      string | null
  telefone:  string | null
  provisorio: boolean
  aoSalvar:  (nome: string) => Promise<void>
  // O gatilho (botão "Salvar contato" do cabeçalho, lápis do painel).
  children:  React.ReactElement
  align?:    'start' | 'center' | 'end'
}

export function NomeContatoPopover({ nome, telefone, provisorio, aoSalvar, children, align = 'end' }: Props) {
  const [aberto, setAberto]     = useState(false)
  const [rascunho, setRascunho] = useState('')
  const [salvando, setSalvando] = useState(false)

  function trocarAberto(abrir: boolean) {
    if (salvando) return
    if (abrir) setRascunho(nome?.trim() ?? '')   // semeado UMA vez, aqui
    setAberto(abrir)
  }

  const limpo  = rascunho.trim()
  const mudou  = limpo !== (nome?.trim() ?? '')
  // Provisório com o nome do perfil já bom: salvar sem mexer é legítimo.
  const podeSalvar = limpo !== '' && (provisorio || mudou) && !salvando

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!podeSalvar) return
    setSalvando(true)
    try {
      await aoSalvar(limpo)
      setAberto(false)
    } catch {
      // Quem chamou já avisou no toast. O campo fica aberto com o texto
      // digitado — fechar depois de falhar faria a pessoa redigitar.
    } finally {
      setSalvando(false)
    }
  }

  const acao = provisorio ? 'Salvar contato' : 'Salvar nome'

  return (
    <Popover.Root open={aberto} onOpenChange={trocarAberto}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className="z-100 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
        >
          <form onSubmit={salvar} className="p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {provisorio ? 'Salvar contato' : 'Editar nome'}
              </p>
              {telefone && (
                <p className="text-xs text-cyan-600 dark:text-cyan-400 tabular-nums mt-0.5">{telefone}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="nome-contato" className="block text-xs font-medium text-muted-foreground">
                Nome
              </label>
              <input
                id="nome-contato"
                autoFocus
                value={rascunho}
                onChange={e => setRascunho(e.target.value)}
                placeholder="Como a equipe vai reconhecer"
                maxLength={120}
                autoComplete="off"
                disabled={salvando}
                className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-60"
              />
              {/* Diz de onde veio o que está no campo: sem isso o nome do perfil
                  ("Mãe do Davi 💙") parece algo que alguém da equipe digitou. */}
              {provisorio && nome?.trim() && !mudou && (
                <p className="text-[11px] text-muted-foreground">Nome do perfil do WhatsApp. Corrija se precisar.</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => trocarAberto(false)}
                disabled={salvando}
                className="px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!podeSalvar}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {acao}
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
