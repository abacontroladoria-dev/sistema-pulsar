import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import { analisarDocumentosPep } from './analisar'

// Começa a auditar logo depois do clique em "Auditar", sem esperar o cron
// (até 1 min). Em processo, no molde de despacharFilaReauditoria
// (lib/auditoria/filaReauditoria.ts): um despacho por processo, até a fila
// esvaziar. O tique do cron é a rede de segurança — e os dois podem se cruzar
// sem ler o mesmo documento duas vezes (reserva em analisar.ts).

let emCurso = false

export function despacharAuditoriaDocumentos(): void {
  if (emCurso) return
  emCurso = true
  const timer = setTimeout(async () => {
    try {
      for (let volta = 0; volta < 100; volta++) {
        const r = await analisarDocumentosPep(supabaseService, { limite: 12, orcamentoMs: 40_000 })
        if (!r.restantes && r.analisados + r.falhas === 0) break
        if (!r.restantes) break
      }
    } catch (e) {
      // Aceleração, não o caminho garantido: o cron recupera. Exceção solta num
      // setTimeout derrubaria o processo Node inteiro.
      console.error('[auditoria documentos] despacho falhou; o cron recupera', e instanceof Error ? e.message : e)
    } finally {
      emCurso = false
    }
  }, 0)
  timer.unref?.()
}
