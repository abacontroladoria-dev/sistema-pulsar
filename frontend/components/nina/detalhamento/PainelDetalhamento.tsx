'use client'

import React from 'react'
import { X, Loader2, Phone, Mail } from 'lucide-react'
import type { DetalheConversa } from '@/hooks/nina/useCentralInbox'
import type { Appointment, Task, TagDefinition } from '@/modules/atendimento/types/central.types'
import { rotuloTipoContato } from '../adapters/centralToNina'
import { Avatar } from '../Avatar'
import { BlocoCanal }        from './BlocoCanal'
import { BlocoOrigem }       from './BlocoOrigem'
import { BlocoResponsavel, type UsuarioAtribuivel } from './BlocoResponsavel'
import { BlocoTags }         from './BlocoTags'
import { BlocoAgendamento }  from './BlocoAgendamento'
import { BlocoTarefas }      from './BlocoTarefas'

// ----------------------------------------------------------------------------
// DETALHAMENTO — a ficha da pessoa, ao lado da conversa.
//
// Recebe o `DetalheConversa` CRU, não o NinaConversation: o painel fala o
// vocabulário do `central` (canal, origem, responsável, tags), que o adapter da
// tela do Nina não carrega de propósito. Ver centralToNina.ts.
//
// Nenhum bloco guarda cópia do que o servidor mandou. Eles recebem prop e
// chamam de volta; quem grava é o dono do painel, que recarrega o detalhe
// depois. É o que faz o painel continuar certo quando a conversa muda de dono
// por fora dele — respondendo no chat, ou religando a Maia.
// ----------------------------------------------------------------------------

export interface DadosPainel {
  catalogoTags: TagDefinition[]
  usuarios:     UsuarioAtribuivel[]
  agendamentos: Appointment[]
  tarefas:      Task[]
  carregandoListas: boolean
}

export interface AcoesPainel {
  salvarOrigem?:  (valor: string | null) => Promise<void>
  salvarTags?:    (chaves: string[]) => Promise<void>
  trocarResponsavel?: (userId: string | null) => Promise<void>
  salvandoResponsavel?: boolean
  agendarRetorno?: () => void
  designarTarefa?: () => void
  concluirTarefa?: (id: string) => Promise<void>
}

export const PainelDetalhamento: React.FC<{
  detalhe:    DetalheConversa | null
  maiaAtendendo: boolean
  dados:      DadosPainel
  acoes:      AcoesPainel
  aoFechar:   () => void
}> = ({ detalhe, maiaAtendendo, dados, acoes, aoFechar }) => {
  const contato = detalhe?.contact ?? null
  const nome    = contato?.name?.trim() || 'Contato sem nome'

  return (
    <div className="w-80 border-l border-border bg-card flex-shrink-0 flex flex-col overflow-hidden">
      <div className="h-16 flex items-center justify-between px-6 border-b border-border flex-shrink-0">
        <span className="font-semibold text-foreground tracking-wide text-sm uppercase">Detalhamento</span>
        <button
          onClick={aoFechar}
          title="Fechar o detalhamento"
          aria-label="Fechar o detalhamento"
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Enquanto o detalhe não chegou, um spinner. Desenhar os seis blocos
          vazios diria "esta pessoa não tem nada" — que é uma afirmação, e ela
          seria falsa. */}
      {!detalhe ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/70" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-7">
          <header className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full p-1 bg-gradient-to-tr from-cyan-500 to-teal-600 shadow-xl mb-3">
              <div className="w-full h-full rounded-full overflow-hidden border-2 border-border">
                <Avatar url={contato?.avatar_url ?? ''} nome={nome} />
              </div>
            </div>
            <h3 className="text-base font-bold text-foreground leading-tight">{nome}</h3>
            {/* contact_type do banco: quem de fato está escrevendo
                (responsável, paciente, primeiro contato). */}
            <p className="text-xs text-muted-foreground mt-0.5">
              {rotuloTipoContato(contato)}
            </p>

            <div className="mt-3 space-y-1 text-xs">
              {contato?.display_phone && (
                <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Phone className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                  {contato.display_phone}
                </p>
              )}
              {contato?.display_email && (
                <p className="flex items-center justify-center gap-1.5 text-muted-foreground break-all">
                  <Mail className="w-3 h-3 text-muted-foreground/70 shrink-0" />
                  {contato.display_email}
                </p>
              )}
            </div>
          </header>

          <BlocoCanal canal={detalhe.channel} inbox={detalhe.inbox} />

          <BlocoOrigem
            origem={contato?.source ?? null}
            aoSalvar={contato ? acoes.salvarOrigem : undefined}
          />

          <BlocoResponsavel
            responsavelId={detalhe.assigned_user_id}
            usuarios={dados.usuarios}
            maiaAtendendo={maiaAtendendo}
            salvando={acoes.salvandoResponsavel}
            aoTrocar={acoes.trocarResponsavel}
          />

          <BlocoTags
            tags={contato?.tags ?? null}
            catalogo={dados.catalogoTags}
            aoSalvar={contato ? acoes.salvarTags : undefined}
          />

          <BlocoAgendamento
            agendamentos={dados.agendamentos}
            carregando={dados.carregandoListas}
            // Sem contato não há a quem agendar, e chamar a rota sem contactId
            // listaria/criaria fora de qualquer pessoa.
            aoAgendar={contato ? acoes.agendarRetorno : undefined}
          />

          <BlocoTarefas
            tarefas={dados.tarefas}
            carregando={dados.carregandoListas}
            aoDesignar={contato ? acoes.designarTarefa : undefined}
            aoConcluir={acoes.concluirTarefa}
          />
        </div>
      )}
    </div>
  )
}

export default PainelDetalhamento
