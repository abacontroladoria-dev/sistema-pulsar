// ============================================================================
// Há quanto tempo esta conversa está parada
//
// A triagem ordena as filas por espera, e o que decide quem socorrer primeiro é
// a DURAÇÃO, não o instante. "14:32" obriga quem lê a fazer a subtração de
// cabeça, e erra quando vira o dia; "4h02" responde direto.
//
// Fica separado de `horaCurta` (centralToNina.ts) de propósito: aquela responde
// "quando foi", esta responde "há quanto tempo" — perguntas diferentes, e o
// inbox continua precisando da primeira.
// ============================================================================

const MINUTO = 60_000
const HORA   = 60 * MINUTO
const DIA    = 24 * HORA

// `agora` é parâmetro, e não `Date.now()` lá dentro, para a função ser pura e
// testável sem congelar o relógio global.
export function tempoDeEspera(iso: string | null, agora: number = Date.now()): string {
  if (!iso) return '—'

  const ms = agora - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'

  // Relógios discordam: o `last_message_at` vem do Postgres e o `agora` do
  // navegador. Alguns segundos de futuro são normais e viram "agora", não um
  // número negativo na tela.
  if (ms < MINUTO) return 'agora'

  if (ms < HORA) return `${Math.floor(ms / MINUTO)}min`

  if (ms < DIA) {
    const horas   = Math.floor(ms / HORA)
    const minutos = Math.floor((ms % HORA) / MINUTO)
    // Abaixo de 10h o minuto ainda importa para comparar duas linhas vizinhas;
    // acima disso o caso já é grave e o dígito extra só polui.
    return horas < 10 ? `${horas}h${String(minutos).padStart(2, '0')}` : `${horas}h`
  }

  const dias = Math.floor(ms / DIA)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

// A partir de quando a espera vira problema visível na tela. Não é enfeite: numa
// clínica, responsável que mandou mensagem e ficou 1h sem resposta já é queixa.
// Só a coluna "Ninguém" usa isto — nas outras alguém está conduzindo, e o tempo
// é informação, não alarme.
export const ESPERA_CRITICA_MS = HORA

export function esperaCritica(iso: string | null, agora: number = Date.now()): boolean {
  if (!iso) return false
  const ms = agora - new Date(iso).getTime()
  return !Number.isNaN(ms) && ms >= ESPERA_CRITICA_MS
}
