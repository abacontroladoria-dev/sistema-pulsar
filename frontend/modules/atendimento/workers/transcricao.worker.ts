import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createTranscricaoSystemService } from '../services'
import { MessageRepository } from '../repositories/message.repository'

// ============================================================================
// Worker de transcrição — o texto do áudio antes de a atendente abrir a conversa
//
// Roda no tique, logo depois da entrega de mensagens. Antes da leitura de
// status, funil e sentimento: aqueles são para a gestão, este é para quem está
// respondendo agora.
//
// SEM FILA, COMO O SENTIMENTO
//
// A "fila" é a pergunta: áudio recebido nas últimas horas com
// transcricao_status NULL. A reivindicação (UPDATE condicional) é o lock; o
// lease de 2 min devolve ao jogo o que um processo morto largou no meio.
//
// SÓ O RECENTE
//
// A janela é de 24 horas. O histórico de antes da feature não é varrido: seria
// uma conta de uma vez só por áudio que ninguém vai reler, e o media ID da Meta
// já expirou para os de mais de 7 dias. Quem quiser um áudio antigo clica em
// "Transcrever" na bolha.
// ============================================================================

// Áudios por tique. ~3 a cada 10s = teto de ~1000/hora, muito acima do
// movimento da clínica; segura um pico sem virar pico de fatura.
const TETO_POR_TIQUE = 3

const JANELA_HORAS = 24

// O tique tem 60s e divide com agrupamento e envio. Não COMEÇA um áudio depois
// disto; e cada chamada tem teto próprio, menor que o padrão do provider.
// Um áudio de 2 minutos volta em 3–5s; 15s é folga para o dia ruim. O que
// estourar vira 'failed' e a bolha oferece "Tentar de novo" (sem teto de tique).
const ORCAMENTO_MS = 12_000
const TIMEOUT_CHAMADA_MS = 15_000

export interface ResultadoTranscricao {
  candidatos:  number
  transcritos: number
  pulados:     number
  falhados:    number
  interrompido?: string
}

export async function processarTranscricoes(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResultadoTranscricao> {
  const limite = Date.now() + ORCAMENTO_MS
  const repo    = new MessageRepository(supabase)
  const service = createTranscricaoSystemService()

  const desde = new Date(Date.now() - JANELA_HORAS * 3_600_000).toISOString()
  const candidatos = await repo.audiosSemTranscricao(orgId, desde, TETO_POR_TIQUE)
  const r: ResultadoTranscricao = { candidatos: candidatos.length, transcritos: 0, pulados: 0, falhados: 0 }

  for (const anexo of candidatos) {
    if (Date.now() > limite) break

    try {
      const desfecho = await service.transcreverAutomatico(anexo, orgId, TIMEOUT_CHAMADA_MS)
      if (desfecho.tipo === 'transcrita') r.transcritos++
      else if (desfecho.tipo === 'pulada') r.pulados++
      else {
        r.falhados++
        console.error('[worker transcricao] falha no áudio', { anexoId: anexo.id, motivo: desfecho.motivo })
      }
    } catch (err) {
      // Só chega aqui o que vale para a organização inteira (rate limit, saldo,
      // chave). Insistir nos outros áudios reproduz a mesma falha.
      r.interrompido = err instanceof Error ? err.message : String(err)
      break
    }
  }

  return r
}
