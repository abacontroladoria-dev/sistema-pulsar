// Agregação para "PDI - Painel por Analista" — dashboard por Coordenador de
// Caso ("Analista", no jargão da clínica), pedido do usuário (04/09/2026),
// espelhando a aba "Dashboard" da planilha Excel original
// (`Controle_Prazos_PDI pronto 2.0`).
//
// Módulo PURO — mesmo padrão de lib/pdi/filtros.ts: sem fetch/supabase,
// opera sobre `ItemPdi[]` já pronto (o mesmo produzido por `juntarPdi`).
//
// ─── Diferença da planilha original ──────────────────────────────────────
//
// A planilha tinha uma coluna "Coordenador" digitada à mão, sem ligação com
// nenhum sistema. Aqui o Coordenador de Caso é 100% derivado da agenda
// sincronizada da TiTa (`ItemPdi.coordenadores`, ver
// lib/pdi/agenda.ts::coordenadoresDetalhados) — cada paciente pode ter 0, 1
// ou >1 coordenador (irregular, ver `coordenadorIrregular` em filtros.ts).
//
// ─── Paciente com 2 coordenadores (irregular) ────────────────────────────
//
// Decisão desta etapa: um paciente com mais de um Coordenador de Caso conta
// PARA CADA UM deles, não só para um "principal" escolhido arbitrariamente
// — a nomeação em disputa é justamente o problema que `coordenador_irregular`
// (em filtros.ts) já sinaliza à parte; escolher um dos dois aqui esconderia
// a duplicidade em vez de expor as duas pontas. Consequência: a SOMA de
// `total` de todos os analistas pode ser MAIOR que `totalPacientes` do
// resumo executivo (um mesmo paciente contado duas vezes) — isso é
// intencional, não um bug de dupla contagem.
//
// ─── Paciente SEM coordenador ─────────────────────────────────────────────
//
// `agruparPorAnalista` só itera `item.coordenadores` — um paciente com
// `coordenadores: []` não aparece em nenhuma linha desta função (não há
// "analista" para agrupar). Ele ainda entra no `ResumoExecutivoPdi`
// (contagem por status, independente de coordenador). A tela
// (`PainelAnalistaShell.tsx`) é responsável por somar esses pacientes numa
// linha "Sem Coordenador de Caso" à parte — decisão de manter essa conta
// fora deste módulo: `agruparPorAnalista` fala de ANALISTAS reais
// (profissional_id + nome), "sem coordenador" não é um analista, é a
// ausência de um.

import type { ItemPdi } from "@/lib/pdi/filtros"

/**
 * A população do "PDI - Painel por Analista" inteiro (Painel Executivo,
 * Semáforo, PDIs por Coordenador): os pacientes de ABA ativos — pedido do
 * usuário (05/09/2026), "precisa ser o total com autorização ABA de pacientes
 * ativos".
 *
 * UM critério, desde a correção de 11/09/2026: ter terapia de ABA agendada na
 * primeira semana do mês seguinte (`temAbaNaAgenda`, ver
 * lib/pdi/agenda.ts::temTerapiaAbaPrimeiraSemanaMesSeguinte).
 *
 * A versão anterior usava `elegivel && temAgendamentoPrimeiraSemanaMesSeguinte`
 * — ABA pelo LAUDO (relatório Órbita) e atividade pela AGENDA. Duas fontes
 * que precisam concordar e não concordam: o painel mostrava paciente com
 * laudo ABA sem nenhuma sessão de ABA (aparecendo eternamente em "Sem
 * Coordenador", problema de ninguém) e escondia paciente em atendimento ABA
 * cujo laudo não dizia exatamente "Psicologia ABA" (roubando pacientes da
 * lista do próprio coordenador). O bloco de comentário em lib/pdi/agenda.ts
 * traz a medição dos dois casos.
 *
 * O critério de "ativo" não sumiu, foi absorvido: `temAbaNaAgenda` olha a
 * mesma janela e uma sessão de ABA já é uma sessão, então quem não tem agenda
 * não passa. `elegivel` continua no `ItemPdi` — é o sinal de LAUDO, útil para
 * cruzar autorização × execução, mas não define mais a população daqui.
 *
 * Aplicado no CHAMADOR (`PainelAnalistaShell.tsx`) antes de passar `itens`
 * para `calcularResumoExecutivo`/`agruparPorAnalista`/`calcularSemaforo` — as
 * três continuam genéricas, operando sobre qualquer `ItemPdi[]`.
 */
export function filtrarAtivosComAutorizacaoAba(itens: ItemPdi[]): ItemPdi[] {
  return itens.filter((i) => i.temAbaNaAgenda)
}

/** Uma linha da tabela "PDIs por Coordenador" — um Coordenador de Caso (Analista) distinto. */
export interface LinhaAnalista {
  profissionalId: number
  nome: string
  atrasados: number
  proximoPrazo: number
  emAndamento: number
  aguardandoImplementacao: number
  total: number
}

/**
 * Agrupa os pacientes por Coordenador de Caso, contando por status. Um
 * paciente com N coordenadores distintos soma 1 em CADA um dos N (ver o
 * cabeçalho acima) — nunca escolhe um "principal". Ordenado por `atrasados`
 * desc, desempate por nome (pt-BR).
 */
export function agruparPorAnalista(itens: ItemPdi[]): LinhaAnalista[] {
  const porId = new Map<number, LinhaAnalista>()

  for (const item of itens) {
    for (const coordenador of item.coordenadores) {
      const atual = porId.get(coordenador.profissionalId) ?? {
        profissionalId: coordenador.profissionalId,
        nome: coordenador.nome,
        atrasados: 0,
        proximoPrazo: 0,
        emAndamento: 0,
        aguardandoImplementacao: 0,
        total: 0,
      }

      atual.total += 1
      if (item.status === "Atrasado") atual.atrasados += 1
      else if (item.status === "Próximo do prazo") atual.proximoPrazo += 1
      else if (item.status === "Dentro do prazo") atual.emAndamento += 1
      else if (item.status === "Aguardando Implementação") atual.aguardandoImplementacao += 1

      porId.set(coordenador.profissionalId, atual)
    }
  }

  return [...porId.values()].sort((a, b) => {
    if (a.atrasados !== b.atrasados) return b.atrasados - a.atrasados
    return a.nome.localeCompare(b.nome, "pt-BR")
  })
}

/** Os quatro números do "PAINEL EXECUTIVO" e do "Resumo Geral" — mesmos status de `StatusPdi`. */
export interface ResumoExecutivoPdi {
  totalPacientes: number
  atrasados: number
  proximoPrazo: number
  emAndamento: number
  aguardandoImplementacao: number
}

/**
 * Totais gerais, por PACIENTE (não por par paciente×coordenador) — ao
 * contrário de `agruparPorAnalista`, aqui cada paciente conta uma única vez,
 * incluindo quem não tem Coordenador de Caso. É o "Total de Pacientes" (206
 * na planilha original) e os totais por status do "PAINEL EXECUTIVO"/"Resumo
 * Geral".
 */
export function calcularResumoExecutivo(itens: ItemPdi[]): ResumoExecutivoPdi {
  const resumo: ResumoExecutivoPdi = {
    totalPacientes: itens.length,
    atrasados: 0,
    proximoPrazo: 0,
    emAndamento: 0,
    aguardandoImplementacao: 0,
  }

  for (const item of itens) {
    if (item.status === "Atrasado") resumo.atrasados += 1
    else if (item.status === "Próximo do prazo") resumo.proximoPrazo += 1
    else if (item.status === "Dentro do prazo") resumo.emAndamento += 1
    else if (item.status === "Aguardando Implementação") resumo.aguardandoImplementacao += 1
  }

  return resumo
}

export type Semaforo = "verde" | "amarelo" | "vermelho"

/**
 * "Indicador Geral (Semáforo)" — fórmula EXATA extraída da planilha:
 * `=IF(totalAtrasados=0,"VERDE",IF(totalAtrasados<=5,"AMARELO","VERMELHO"))`.
 * Limites fixos (0 e 5), não configuráveis — replica a planilha 1:1.
 */
export function calcularSemaforo(totalAtrasados: number): Semaforo {
  if (totalAtrasados === 0) return "verde"
  if (totalAtrasados <= 5) return "amarelo"
  return "vermelho"
}
