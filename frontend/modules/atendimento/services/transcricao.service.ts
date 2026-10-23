import type { MessageAttachment } from '../types/central.types'
import type { MessageRepository } from '../repositories/message.repository'
import type { AuditRepository } from '../repositories/audit.repository'
import type { TranscricaoProvider } from '../llm/tipos'
import type { MessageService } from './message.service'
import {
  AnexoNaoEncontradoError,
  TranscricaoRecusadaError,
  TranscricaoEmAndamentoError,
} from '../types/errors.types'
import {
  LlmRateLimitError,
  LlmBudgetExceededError,
  LlmConfiguracaoError,
} from '../llm/erros'

// ============================================================================
// TranscricaoService — o texto do áudio recebido
//
// Dois caminhos chegam aqui, e diferem só em quem reivindica:
//
//   • o worker do tique (workers/transcricao.worker.ts), para todo áudio que
//     chega — a atendente abre a conversa e o texto já está lá;
//   • o botão da bolha (POST /api/central/anexos/[id]/transcrever), para o
//     áudio antigo, o que falhou, ou o que alguém quer refazer.
//
// O ÁUDIO CONTINUA SENDO O REGISTRO. A transcrição fica ao lado, no anexo, e
// nunca substitui o `body` da mensagem: o placeholder '[áudio de voz]' segue lá,
// e a Maia continua vendo só ele. Pôr o texto no contexto da Maia é outra
// decisão — o prompt (§22) manda pedir que escrevam, e precisaria mudar junto.
//
// O QUE NÃO VIRA "FALHOU"
//
// Rate limit, saldo esgotado e chave ausente valem para a organização inteira
// e não dizem nada sobre ESTE áudio. Marcá-lo como falho tiraria o áudio do
// alcance do worker (que só pega quem nunca foi tentado) por um defeito que
// alguém vai consertar daqui a uma hora. Nesses casos a reivindicação é
// desfeita e o áudio volta para a fila implícita.
// ============================================================================

// Quanto tempo um 'processing' é respeitado antes de outro poder retomá-lo. A
// chamada tem teto de 60s; 2 minutos cobrem download + transcrição + folga.
export const LEASE_TRANSCRICAO_MS = 120_000

export type Origem = 'auto' | 'manual'

export type DesfechoTranscricao =
  | { tipo: 'transcrita'; texto: string }
  | { tipo: 'pulada' }               // outro processo já tinha pegado
  | { tipo: 'falhou'; motivo: string }

export function ehAudio(a: Pick<MessageAttachment, 'file_type'>): boolean {
  return (a.file_type ?? '').toLowerCase().startsWith('audio/')
}

// Erros que não são do áudio, e sim da conta/instalação. Ver o cabeçalho.
function ehErroDaOrganizacao(err: unknown): boolean {
  return err instanceof LlmRateLimitError
    || err instanceof LlmBudgetExceededError
    || err instanceof LlmConfiguracaoError
}

export class TranscricaoService {
  constructor(
    // Leitura com o client de quem pede (a RLS do anexo é o portão), escrita
    // com service role — message_attachments não tem UPDATE para
    // `authenticated`. Ver o construtor de MessageRepository.
    private readonly msg:       MessageRepository,
    private readonly mensagens: MessageService,
    private readonly provider:  TranscricaoProvider,
    private readonly audit:     AuditRepository,
  ) {}

  // O botão. Lê o anexo com o client do usuário: se a RLS não o mostra, é 404,
  // igual a abrir o arquivo. Pode refazer uma transcrição pronta.
  async transcreverPorPedido(anexoId: string, orgId: string, userId: string): Promise<string> {
    const anexo = await this.msg.buscarAnexo(anexoId)
    if (!anexo || anexo.organization_id !== orgId) throw new AnexoNaoEncontradoError(anexoId)
    if (!ehAudio(anexo)) {
      throw new TranscricaoRecusadaError(anexoId, 'Só áudio pode ser transcrito.')
    }

    const reivindicou = await this.msg.reivindicarTranscricao(anexo.id, LEASE_TRANSCRICAO_MS, true)
    if (!reivindicou) throw new TranscricaoEmAndamentoError(anexoId)

    // No pedido manual a falha SOBE: a tela mostra o motivo na hora.
    const r = await this.executar(anexo, orgId, 'manual', userId)
    if (!r.ok) throw r.erro
    return r.texto
  }

  // O worker. Nunca refaz um áudio já tentado — isso é decisão de gente.
  // Lança só os erros da organização (o worker para a varredura por eles).
  async transcreverAutomatico(
    anexo: MessageAttachment,
    orgId: string,
    timeoutMs?: number,
  ): Promise<DesfechoTranscricao> {
    const reivindicou = await this.msg.reivindicarTranscricao(anexo.id, LEASE_TRANSCRICAO_MS, false)
    if (!reivindicou) return { tipo: 'pulada' }

    const r = await this.executar(anexo, orgId, 'auto', undefined, timeoutMs)
    return r.ok ? { tipo: 'transcrita', texto: r.texto } : { tipo: 'falhou', motivo: r.motivo }
  }

  // Falha do áudio vira desfecho; falha da organização é relançada depois de
  // devolver o áudio à fila.
  private async executar(
    anexo:      MessageAttachment,
    orgId:      string,
    origem:     Origem,
    userId:     string | undefined,
    timeoutMs?: number,
  ): Promise<{ ok: true; texto: string } | { ok: false; motivo: string; erro: unknown }> {
    // Só para amarrar a auditoria à conversa. Falhar aqui não impede nada.
    const mensagem = await this.msg.findById(anexo.message_id).catch(() => null)
    const conversationId = mensagem?.conversation_id

    try {
      const { bytes, mimeType } = await this.mensagens.bytesDoAnexo(anexo, orgId)
      // A Evolution às vezes devolve 'application/octet-stream' no download;
      // o MIME do webhook (audio/ogg…) é o que diz o formato nesse caso.
      const mime = mimeType.toLowerCase().startsWith('audio/') ? mimeType : (anexo.file_type || mimeType)
      const r = await this.provider.transcrever({ bytes, mimeType: mime, timeoutMs })

      await this.msg.concluirTranscricao(anexo.id, { texto: r.texto, modelo: r.modelo, ms: r.latenciaMs })

      void this.audit.insert({
        organization_id: orgId,
        conversation_id: conversationId,
        event_type:      'audio.transcribed',
        performed_by:    userId,
        payload: {
          messageId:  anexo.message_id,
          anexoId:    anexo.id,
          origem,
          modelo:     r.modelo,
          ms:         r.latenciaMs,
          caracteres: r.texto.length,
          duracaoSecs: anexo.duration_secs,
        },
      })

      return { ok: true, texto: r.texto }
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err)

      if (ehErroDaOrganizacao(err)) {
        await this.msg.liberarTranscricao(anexo.id).catch(() => {})
        throw err
      }

      await this.msg.falharTranscricao(anexo.id, motivo).catch(() => {})

      void this.audit.insert({
        organization_id: orgId,
        conversation_id: conversationId,
        event_type:      'audio.transcription_failed',
        performed_by:    userId,
        payload: { messageId: anexo.message_id, anexoId: anexo.id, origem, motivo: motivo.slice(0, 300) },
      })

      return { ok: false, motivo, erro: err }
    }
  }
}
