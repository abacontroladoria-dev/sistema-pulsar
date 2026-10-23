import type { Message, MessageAttachment } from '../types/central.types'

// ============================================================================
// O que o contato disse, em texto — inclusive quando disse por áudio
//
// O `body` de uma mensagem de áudio é o aviso '[áudio de voz]' que o
// normalizador escreve. Desde 23/10 o áudio recebido ganha transcrição
// (message_attachments.transcricao); este é o ÚNICO lugar que decide como ela
// chega à Maia, à classificação e à extração da ficha. Espalhar a regra por
// worker faria a Maia ler o texto num caminho e o aviso no outro.
//
// O texto vai MARCADO, não cru: '[áudio transcrito] quero remarcar'. Dois
// motivos:
//   • transcrição erra (nome próprio, número de telefone, data falada) — o
//     modelo precisa saber que aquilo não foi digitado, para confirmar o dado
//     crítico antes de agir sobre ele;
//   • o prompt (§22) distingue áudio transcrito de áudio que não pôde ser
//     transcrito — este continua chegando como '[áudio de voz]'.
//
// O texto vem do contato e é tão não confiável quanto uma mensagem digitada:
// quem chama o põe SEMPRE no papel `user` (ver contexto.ts).
// ============================================================================

export const MARCA_AUDIO_TRANSCRITO = '[áudio transcrito]'
export const AUDIO_SEM_FALA = '[áudio sem fala]'

export type MensagemComAnexos = Pick<Message, 'direction' | 'body'> & {
  attachments?: Pick<MessageAttachment, 'transcricao' | 'transcricao_status'>[]
}

export function falaDaMensagem(m: MensagemComAnexos): string {
  if (m.direction === 'inbound') {
    for (const a of m.attachments ?? []) {
      const texto = a.transcricao?.trim()
      if (texto) return `${MARCA_AUDIO_TRANSCRITO} ${texto}`
      if (a.transcricao_status === 'completed') return AUDIO_SEM_FALA
    }
  }
  return m.body ?? ''
}
