import type { Message, MessageAttachment } from '../types/central.types'
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
// nunca substitui o `body` da mensagem: o placeholder '[áudio de voz]' segue lá.
// A Maia lê o texto por agente/fala-do-contato.ts, e os workers dela chamam
// completarTurno antes do turno para o texto existir a tempo.
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

// Quanto o turno da Maia espera um áudio que OUTRO processo está transcrevendo
// (o worker ou alguém que clicou). Áudio de WhatsApp volta em 3–5s; passado
// isso, ela responde com o aviso em vez de deixar a mãe esperando.
const ESPERA_OUTRO_PROCESSO_MS = 8_000

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

  // -------------------------------------------------------------------------
  // completarTurno — a Maia lê o áudio
  //
  // Chamado pelos workers da Maia ANTES do turno, com as mensagens da pessoa
  // que o turno vai responder. O worker de transcrição quase sempre chegou
  // antes (ele roda a cada tique, e o turno espera a pessoa parar de
  // escrever), mas "quase" não serve: sem o texto, a Maia responde a um
  // '[áudio de voz]' e pede para a mãe escrever o que acabou de falar.
  //
  // Por áudio:
  //   • já tem texto ou terminou sem fala → nada a fazer;
  //   • outro processo está transcrevendo (lease vivo) → espera um pouco;
  //   • nunca tentado, ou falhou antes → transcreve aqui, uma tentativa.
  // Nunca lança: sem texto, a mensagem segue com o aviso e o prompt (§22)
  // sabe o que fazer. Devolve as mensagens com os anexos atualizados.
  // -------------------------------------------------------------------------
  async completarTurno<T extends Message>(mensagens: T[], orgId: string, timeoutMs?: number): Promise<T[]> {
    const saida: T[] = []
    for (const m of mensagens) {
      if (m.direction !== 'inbound' || m.message_type !== 'audio') { saida.push(m); continue }
      try {
        // receive() devolve a mensagem recém-criada sem os anexos.
        const anexos = m.attachments?.length
          ? m.attachments
          : (await this.msg.findById(m.id))?.attachments ?? []
        const prontos: MessageAttachment[] = []
        for (const a of anexos) prontos.push(ehAudio(a) ? await this.garantir(a, orgId, timeoutMs) : a)
        saida.push({ ...m, attachments: prontos })
      } catch (err) {
        console.warn('[transcricao] áudio do turno sem texto; segue com o aviso', {
          messageId: m.id, motivo: err instanceof Error ? err.message : String(err),
        })
        saida.push(m)
      }
    }
    return saida
  }

  private async garantir(anexo: MessageAttachment, orgId: string, timeoutMs?: number): Promise<MessageAttachment> {
    if (anexo.transcricao?.trim() || anexo.transcricao_status === 'completed') return anexo

    const iniciada = anexo.transcricao_iniciada_em ? Date.parse(anexo.transcricao_iniciada_em) : 0
    if (anexo.transcricao_status === 'processing' && Date.now() - iniciada < LEASE_TRANSCRICAO_MS) {
      const limite = Date.now() + ESPERA_OUTRO_PROCESSO_MS
      while (Date.now() < limite) {
        await new Promise(r => setTimeout(r, 1_000))
        const atual = await this.msg.buscarAnexo(anexo.id)
        if (!atual || atual.transcricao_status !== 'processing') return atual ?? anexo
      }
      return anexo
    }

    try {
      await this.transcreverAutomatico(anexo, orgId, timeoutMs)
    } catch {
      // Rate limit, saldo, chave: o áudio já foi devolvido à fila; o turno
      // segue sem o texto.
    }
    return (await this.msg.buscarAnexo(anexo.id)) ?? anexo
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
