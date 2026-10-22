'use client'

import React from 'react'
import { Globe, MessageCircle, Camera, AlertTriangle } from 'lucide-react'
import type { ChannelStatus, ProviderType } from '@/modules/atendimento/types/central.types'
import { Bloco, Vazio } from './Bloco'

// ----------------------------------------------------------------------------
// Por qual número da clínica esta conversa acontece.
//
// Somente leitura: o canal é uma consequência de quem mandou a mensagem, não
// uma escolha do operador. Um seletor aqui prometeria mudar por onde o paciente
// fala com a clínica, o que ninguém pode fazer desta tela.
//
// O nome do número ("Confirmação de Consulta", "Autorização") vem primeiro:
// é o que distingue uma conversa da outra. "WhatsApp" sozinho vale para todas.
// Canal e caixa de entrada são 1:1 e têm o mesmo nome; a caixa só entra se o
// canal vier sem nome.
//
// O status do canal aparece SÓ quando não está 'active'. Um selo verde em toda
// conversa vira ruído e ensina a ignorar o lugar exato onde um dia vai aparecer
// "desconectado" — que é a única informação acionável deste bloco.
// ----------------------------------------------------------------------------

const ROTULO_PROVIDER: Record<ProviderType, string> = {
  meta_waba: 'WhatsApp',
  evolution: 'WhatsApp',
  instagram: 'Instagram',
}

const ROTULO_STATUS: Record<ChannelStatus, string> = {
  active:       'ativo',
  connecting:   'conectando',
  disconnected: 'desconectado',
  error:        'com erro',
  suspended:    'suspenso',
}

export const BlocoCanal: React.FC<{
  canal: {
    id:           string
    name:         string
    provider:     ProviderType
    channel_type: string
    status:       ChannelStatus
  } | null
  inbox: { id: string; name: string; description: string | null } | null
}> = ({ canal, inbox }) => {
  const plataforma = canal ? (ROTULO_PROVIDER[canal.provider] ?? canal.channel_type) : null
  const numero     = canal?.name?.trim() || inbox?.name?.trim() || null
  const Icone  = canal?.provider === 'instagram' ? Camera : MessageCircle
  const saudavel = canal?.status === 'active'

  return (
    <Bloco titulo="Canal" icone={<Globe className="w-3.5 h-3.5" />}>
      {!canal ? (
        <Vazio>Canal não identificado</Vazio>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-muted border border-border">
            <Icone className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-foreground leading-tight truncate">
                {numero ?? plataforma}
              </p>
              {numero && (
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  {canal.provider === 'instagram' ? 'Conta' : 'Número'} de {plataforma} da clínica
                </p>
              )}
            </div>
          </div>

          {!saudavel && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-400 pl-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Canal {ROTULO_STATUS[canal.status]} — mensagens podem não sair
            </p>
          )}
        </div>
      )}
    </Bloco>
  )
}
