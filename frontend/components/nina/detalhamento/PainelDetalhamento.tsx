'use client'

import React from 'react'
import { X, Loader2, Phone, Mail, Pencil, UserPlus } from 'lucide-react'
import type { DetalheConversa } from '@/hooks/nina/useCentralInbox'
import type {
  Appointment,
  Task,
  TagDefinition,
  LeituraSentimento,
  FichaPaciente,
  CampoFicha,
} from '@/modules/atendimento/types/central.types'
import { rotuloTipoContato } from '../adapters/centralToNina'
import { Avatar } from '../Avatar'
import { NomeContatoPopover } from '../NomeContatoPopover'
import { BlocoFicha }        from './BlocoFicha'
import { BlocoSentimento }   from './BlocoSentimento'
import { BlocoCanal }        from './BlocoCanal'
import { BlocoOrigem }       from './BlocoOrigem'
import { BlocoAnuncio }      from './BlocoAnuncio'
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
  sentimento:           LeituraSentimento | null
  carregandoSentimento: boolean
  analisandoSentimento: boolean
  erroSentimento:       string | null
  ficha:           FichaPaciente | null
  carregandoFicha: boolean
  erroFicha:       string | null
}

export interface AcoesPainel {
  salvarNome?:    (nome: string) => Promise<void>
  salvarOrigem?:  (valor: string | null) => Promise<void>
  salvarTags?:    (chaves: string[]) => Promise<void>
  trocarResponsavel?: (userId: string | null) => Promise<void>
  salvandoResponsavel?: boolean
  agendarRetorno?: () => void
  designarTarefa?: () => void
  concluirTarefa?: (id: string) => Promise<void>
  reanalisarSentimento?: () => void
  salvarCampoFicha?: (campo: CampoFicha, valor: string | null) => Promise<void>
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
                <Avatar url={contato?.avatar_url ?? ''} nome={nome} ampliavel />
              </div>
            </div>
            <div className="flex items-center justify-center gap-1 max-w-full">
              <h3 className="text-base font-bold text-foreground leading-tight wrap-break-word min-w-0">{nome}</h3>
              {contato && acoes.salvarNome && !contato.is_provisional && (
                <NomeContatoPopover
                  nome={contato.name}
                  telefone={contato.display_phone}
                  provisorio={false}
                  aoSalvar={acoes.salvarNome}
                  align="center"
                >
                  <button
                    type="button"
                    title="Editar nome"
                    aria-label="Editar nome"
                    className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-cyan-400 hover:bg-muted transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </NomeContatoPopover>
              )}
            </div>
            {/* contact_type do banco: quem de fato está escrevendo
                (responsável, paciente, primeiro contato). */}
            <p className="text-xs text-muted-foreground mt-0.5">
              {rotuloTipoContato(contato)}
            </p>
            {/* Provisório = chegou sozinho pelo WhatsApp e ninguém confirmou
                quem é. A ação fica à vista, não escondida num lápis. */}
            {contato && acoes.salvarNome && contato.is_provisional && (
              <NomeContatoPopover
                nome={contato.name}
                telefone={contato.display_phone}
                provisorio
                aoSalvar={acoes.salvarNome}
                align="center"
              >
                <button
                  type="button"
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Salvar contato
                </button>
              </NomeContatoPopover>
            )}

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

          {/* Primeiro de todos: QUEM é o paciente se lê antes de COMO o
              responsável está. Os dois vêm antes de canal, origem e tags, que
              descrevem o cadastro do contato e não o atendimento.
              Vale para todo número: desde 08/10 a Maia atende no Evolution, e
              a ficha é preenchida depois de cada resposta, nos dois modos
              (agente/extracao-ficha.ts). */}
          <BlocoFicha
            ficha={dados.ficha}
            servicos={servicosDeInteresse(contato?.tags ?? null, detalhe.tags, dados.catalogoTags)}
            carregando={dados.carregandoFicha}
            erro={dados.erroFicha}
            // Sem contato não há ficha para corrigir — a rota é por contactId.
            aoSalvar={contato ? acoes.salvarCampoFicha : undefined}
          />

          {/* É o que se lê ANTES de escrever uma resposta, e não mais um campo
              da ficha: descreve o estado da pessoa agora. */}
          <BlocoSentimento
            leitura={dados.sentimento}
            carregando={dados.carregandoSentimento}
            analisando={dados.analisandoSentimento}
            erro={dados.erroSentimento}
            // Sem contato não há quem analisar — a rota é por contactId.
            aoReanalisar={contato ? acoes.reanalisarSentimento : undefined}
          />

          <BlocoCanal canal={detalhe.channel} inbox={detalhe.inbox} />

          <BlocoOrigem
            origem={contato?.source ?? null}
            aoSalvar={contato ? acoes.salvarOrigem : undefined}
          />

          <BlocoAnuncio
            anuncio={detalhe.anuncio}
            catalogo={detalhe.anuncioCatalogo}
            campanha={detalhe.campanha ?? null}
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
            tagsConversa={detalhe.tags}
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

// As terapias que a família procura: as tags do grupo "serviço de interesse",
// da classificação da conversa e do que a equipe marcou no contato.
function servicosDeInteresse(
  doContato: string[] | null,
  daConversa: string[] | null | undefined,
  catalogo: TagDefinition[],
): string[] {
  const chaves = new Set([...(daConversa ?? []), ...(doContato ?? [])])
  return catalogo
    .filter((t) => t.grupo_key === 'servico_de_interesse' && chaves.has(t.key))
    .map((t) => t.label)
}

export default PainelDetalhamento
