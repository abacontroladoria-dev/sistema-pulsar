import { supabaseService } from '@/lib/supabase/service'
import { processarAgrupamento } from '@/modules/atendimento/workers/agrupamento.worker'
import { processarEnvios } from '@/modules/atendimento/workers/envio.worker'

// ============================================================================
// Despacho do worker logo após o webhook
//
// POR QUE ISTO EXISTE
//
// Sem ele, quem acorda o worker é só o pg_cron. Um cron de 10 segundos põe uma
// espera de 0–10s (média 5s) na frente de CADA resposta, e gasta 8.640 chamadas
// por dia para descobrir que a fila está vazia. Plataformas de atendimento de
// verdade (Chatwoot/Sidekiq, e o mesmo padrão em Intercom e Zendesk) não fazem
// isso: mantêm um consumidor VIVO, bloqueado na fila, que acorda em
// milissegundos quando algo entra.
//
// Não temos Redis nem fila gerenciada nesta infraestrutura, e introduzi-los é um
// projeto de infra. O que dá para fazer com o que existe é aproximar o
// comportamento: a própria entrega da Meta acorda o worker.
//
// POR QUE COM ATRASO, E POR QUE O ATRASO VEM DO BANCO
//
// Chamar o worker no instante da entrega não adiantaria: a linha nasce com
// `process_after` no futuro e `claim_message_grouping_batch` só reivindica
// `process_after <= now()`. Um despacho imediato encontraria a fila vazia.
//
// Esse atraso é DE PROPÓSITO: gente manda "oi", "queria marcar", "pra terça" em
// três mensagens seguidas, e sem o debounce seriam três turnos e três respostas
// atropelando o responsável. O atraso não é desperdício — é o que faz a
// atendente responder como quem esperou a frase terminar.
//
// E a janela DESLIZA (migration 20260915210000): cada mensagem nova empurra o
// prazo das pendentes do mesmo remetente. Por isso o atraso NÃO pode ser uma
// constante daqui — `enqueue_grouping_messages` devolve o `process_after`
// resultante, e é dele que sai o agendamento. Uma constante em Node discordaria
// do banco no primeiro ajuste da janela, e o timer dispararia antes da hora,
// encontraria a fila vazia e deixaria a resposta para o cron.
//
// POR QUE O TIMER É REAGENDADO, E NÃO IGNORADO
//
// A versão anterior tinha um guard `if (despachoPendente) return`: o primeiro
// agendamento vencia, os seguintes eram descartados. Com janela fixa isso
// bastava. Com janela deslizante, não: a mensagem que chega no fim da janela
// empurra o prazo para frente, e o timer antigo — agendado para o prazo ANTIGO
// — dispara cedo, não reivindica nada, se apaga, e ninguém reagenda. A resposta
// ficaria esperando o pg_cron.
//
// Então cada entrega CANCELA o timer pendente e agenda de novo, acompanhando a
// janela. Continua existindo um único timer por organização — o espírito do
// guard (não acumular N timers) se mantém.
//
// POR QUE UM MAPA POR ORGANIZAÇÃO
//
// O timer era um único módulo-global, e `executar(orgId)` usava o orgId do
// PRIMEIRO agendamento: com duas organizações no mesmo processo, a segunda
// ficaria sem despacho. Com reagendamento isso ficaria mais provável ainda.
//
// POR QUE EM PROCESSO, E NÃO HTTP PARA SI MESMO
//
// Uma chamada HTTP à própria rota /workers/tick precisaria da URL pública, do
// segredo, e atravessaria o proxy — três coisas que podem falhar e nenhuma que
// acrescenta. As funções dos workers são as MESMAS que a rota do tique chama.
//
// SEGURANÇA CONTRA CONCORRÊNCIA
//
// Este despacho e o pg_cron podem cair no mesmo item ao mesmo tempo. Já está
// coberto: `claim_*_batch` usa FOR UPDATE SKIP LOCKED e lease. Quem chegar
// segundo não vê o item. Nada a inventar aqui — e por isso este arquivo NÃO tem
// lock próprio.
// ============================================================================

// Folga para o relógio do Postgres não estar meio segundo à frente do nosso e a
// linha ainda não estar elegível quando o timer disparar.
const FOLGA_MS = 1_000

// Rede de segurança para quando a RPC não devolve prazo (nenhuma pendente, ou
// falha ao ler). Fica acima da janela de 8s de propósito: despachar cedo demais
// é um tique perdido; despachar tarde é só latência.
const ATRASO_PADRAO_MS = 10_000

// Teto de sanidade. Um `process_after` absurdamente à frente (relógio errado,
// adiamento por rate limit) não deve prender um timer por horas — o pg_cron
// cobre qualquer coisa além disto.
const ATRASO_MAXIMO_MS = 60_000

// Um timer por organização. Ver "POR QUE UM MAPA POR ORGANIZAÇÃO" acima.
const despachosPendentes = new Map<string, NodeJS.Timeout>()

export function despacharWorkerEmBreve(
  orgId: string,
  processAfterIso: string | null,
): void {
  const atraso = calcularAtraso(processAfterIso)

  // Cancela o agendamento anterior desta organização: o prazo pode ter sido
  // empurrado pela mensagem que acabou de chegar.
  const anterior = despachosPendentes.get(orgId)
  if (anterior) clearTimeout(anterior)

  const timer = setTimeout(() => {
    despachosPendentes.delete(orgId)
    void executar(orgId)
  }, atraso)

  // unref: este timer não deve segurar o processo vivo no encerramento. Se o
  // container estiver descendo, o pg_cron pega o item no próximo tique — melhor
  // que atrasar um shutdown.
  timer.unref?.()

  despachosPendentes.set(orgId, timer)
}

function calcularAtraso(processAfterIso: string | null): number {
  if (!processAfterIso) return ATRASO_PADRAO_MS

  const prazo = Date.parse(processAfterIso)
  if (Number.isNaN(prazo)) return ATRASO_PADRAO_MS

  // Prazo já vencido (a RPC devolveu algo do passado) cai em 0 + folga: despacha
  // quase imediatamente, que é o certo.
  const bruto = Math.max(0, prazo - Date.now()) + FOLGA_MS
  return Math.min(bruto, ATRASO_MAXIMO_MS)
}

async function executar(orgId: string): Promise<void> {
  try {
    // Agrupamento antes de envio, pelo mesmo motivo da rota do tique: o
    // agrupamento ALIMENTA a fila de envio, então a resposta gerada agora sai
    // agora, em vez de esperar o próximo despacho.
    const agrupamento = await processarAgrupamento(supabaseService, orgId)
    const envio = await processarEnvios(supabaseService, orgId)

    // Só registra quando fez alguma coisa. Um log por entrega da Meta poluiria
    // o log a ponto de esconder os erros que importam.
    if (agrupamento.reivindicados > 0 || envio.reivindicados > 0) {
      console.log('[despacho pós-webhook]', { agrupamento, envio })
    }
  } catch (err) {
    // Engolir é deliberado: este despacho é uma ACELERAÇÃO, não o caminho
    // garantido. Se falhar, o pg_cron drena a fila depois. Deixar a exceção
    // subir num setTimeout derrubaria o processo Node inteiro — trocar latência
    // por indisponibilidade seria péssimo negócio.
    console.error('[despacho pós-webhook] falhou; o cron recupera', err)
  }
}
