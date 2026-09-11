// Filtro, ordenação e contagem da tela Controle de Prazos do PDI. Espelha
// lib/laudos/filtros.ts na estrutura: os KPIs SÃO o filtro
// (`PREDICADO_RECORTE` compartilhado entre `contarKpis` e `filtrar`/`aplicar`,
// para o card e a lista nunca divergirem), e o módulo é puro — testável sem
// montar React.
//
// `ItemPdi` é o formato de linha que a junção (`lib/pdi/juntar.ts`, fora do
// escopo desta etapa — ver o plano) vai produzir a partir de
// `pdi_controle_prazos` + elegibilidade + agenda. Decisão desta etapa: como
// aquele módulo de junção ainda não existe, o tipo é declarado AQUI (em vez de
// num arquivo `types/pdi.ts` novo) porque é `filtros.ts` quem primeiro precisa
// dele para operar — mesmo papel que `types/laudosAcompanhamento.ts` cumpre
// para `lib/laudos/filtros.ts`, só que ainda não há consumidor de UI para
// justificar puxar o tipo para fora deste módulo.

import type { PrioridadePdi, StatusPdi } from "@/lib/pdi/status"
import type { AplicadorPdi, CoordenadorPdi, TurnoClinico } from "@/lib/pdi/agenda"

/** Recorte da tela — o que os cards de KPI escrevem e o que a lista mostra. */
export type RecortePdi =
  | "todos"
  | "em_andamento"
  | "aguardando_implementacao"
  | "atrasado"
  | "proximo_prazo"
  // Coordenador de Caso ausente ou duplicado na 1ª semana do mês seguinte —
  // ver lib/pdi/agenda.ts::coordenadorDoCaso. Não é um `StatusPdi`: cruza com
  // qualquer status, por isso é um recorte à parte, não um quinto valor de
  // `StatusPdi`.
  | "coordenador_irregular"

/** As três opções do filtro secundário "Atividade" — ver `FiltrosPdi.atividade`. */
export type AtividadePdi = "todos" | "ativos" | "inativos"

/**
 * `profissional_id` reais de Amanda Ribeiro Campos e Gracielle Rayane Faria
 * Miranda no TiTa — confirmados ao vivo em 04/09/2026 via PostgREST contra
 * `vw_grade_base` (`profissional_nome ilike '%Amanda Ribeiro%'` → 8648 em toda
 * linha; `%Gracielle%` → 8649 em toda linha), e batem com o comentário já
 * existente em lib/cronograma/constants.ts
 * (`PROFISSIONAIS_SEM_CAPACIDADE_LIVRE`, linhas 88-90). Vive aqui, puro, e não
 * em `services/tita/especialistas.ts` (citado no plano para a etapa de
 * integração) porque esta etapa não cria services — o filtro por especialista
 * só precisa dos IDs, não de uma consulta ao banco.
 */
export const ESPECIALISTAS_PDI = {
  AMANDA: 8648,
  GRACIELLE: 8649,
} as const

export type EspecialistaPdiId = (typeof ESPECIALISTAS_PDI)[keyof typeof ESPECIALISTAS_PDI]

/** O corte de dados que esta tela precisa por paciente, já calculado. */
export interface ItemPdi {
  /**
   * = `idFavorecido` = `tita_paciente_id` = "ID Favorecido" do relatório =
   * `paciente_id` na grade E em `public.pdi_controle_prazos` (mesmo espaço de
   * identidade — ver 20260817190000_pacientes_canonica.sql). NÃO é
   * `public.pacientes.id_paciente`: desde a correção de 04/09/2026,
   * `pdi_controle_prazos` não tem FK para `pacientes` (ver
   * 20260904120000_pdi_controle_prazos.sql), porque esse cadastro não é 100%
   * adotado — ver lib/pdi/juntar.ts.
   */
  pacienteId: number
  /**
   * Igual a `pacienteId` — mantido como campo próprio por rastreabilidade
   * (mesmo raciocínio de `idFavorecido` em `types/laudosAcompanhamento.ts`),
   * já que os dois eram números DIFERENTES antes da correção de 04/09/2026.
   */
  idFavorecido: number
  nome: string
  /** PATH no bucket privado, não URL — mesma convenção de `ItemAcompanhamentoLaudo.fotoPath`. `null` sem cadastro Pulsar. */
  fotoPath: string | null
  /** `null` quando não há cadastro em `public.pacientes` — ver `semCadastroPulsar`. Ausência de cadastro NÃO é "inativo". */
  ativo: boolean | null
  /** `true` quando o paciente elegível não tem linha em `public.pacientes` — ver o cabeçalho de lib/pdi/juntar.ts. Badge informativo, nunca filtro. */
  semCadastroPulsar: boolean

  /** `profissional_id` do especialista responsável — Amanda ou Gracielle (ver `ESPECIALISTAS_PDI`), ou `null` se ainda não atribuído. */
  especialistaTitaId: number | null

  dataAvaliacao: string | null
  dataValidade: string | null
  /** Texto livre digitado pela Amanda/Gracielle — coluna `observacoes` de `pdi_controle_prazos`. */
  observacoes: string | null
  prazoRelatorio: string | null
  dataImplementacaoPic: string | null
  prazoFechamento: string | null

  status: StatusPdi
  prioridade: PrioridadePdi
  diasRestantes: number | null

  /** `profissional_id` distintos como Coordenador de Caso na janela relevante — ver `coordenadorDoCaso`. 0 = ausente, 1 = ok, >1 = duplicado. */
  coordenadorIds: number[]
  /**
   * Igual a `coordenadorIds`, mas com nome — ver
   * `lib/pdi/agenda.ts::coordenadoresDetalhados`. Pedido do "PDI - Painel por
   * Analista" (05/09/2026): agrupar por analista exige o NOME, não só o ID.
   * `coordenadorIds = coordenadores.map(c => c.profissionalId)` — os dois
   * convivem, `coordenadorIrregular` continua lendo `coordenadorIds`.
   */
  coordenadores: CoordenadorPdi[]

  autorizadoAmbienteNatural: boolean

  /**
   * `true` quando o paciente está elegível HOJE pelo relatório Órbita
   * (Especialidade "Psicologia ABA" — ver `lib/pdi/elegibilidade.ts`). `false`
   * para um paciente TRACKED-só (já tem linha em `pdi_controle_prazos`, mas
   * caiu do relatório de hoje — ver o cabeçalho de `juntar.ts`). Usado pelo
   * NÃO é mais o critério do "PDI - Painel por Analista": desde 11/09/2026 o
   * painel pergunta "é de ABA?" à AGENDA (`temAbaNaAgenda` abaixo), a mesma
   * fonte que define o coordenador — ver o bloco de comentário em
   * `lib/pdi/agenda.ts` sobre a divergência laudo × agenda. Continua
   * calculado e exposto: é o sinal de laudo, usado pela tela de Controle de
   * Prazos e útil para cruzar autorização × execução.
   */
  elegivel: boolean
  /**
   * Existe alguma terapia de ABA agendada na primeira semana do mês SEGUINTE
   * a hoje — ver `lib/pdi/agenda.ts::temTerapiaAbaPrimeiraSemanaMesSeguinte`
   * e o bloco de comentário que explica por que a agenda substituiu o laudo
   * como critério de "paciente de ABA" (correção de 11/09/2026).
   *
   * É o filtro de população do "PDI - Painel por Analista"
   * (`lib/pdi/painelAnalista.ts::filtrarAtivosComAutorizacaoAba`). Implica
   * `temAgendamentoPrimeiraSemanaMesSeguinte`: uma sessão de ABA é uma sessão.
   */
  temAbaNaAgenda: boolean
  /**
   * Existe QUALQUER sessão agendada (de qualquer terapia) na primeira semana
   * do mês SEGUINTE a hoje — ver
   * `lib/pdi/agenda.ts::temAgendamentoPrimeiraSemanaMesSeguinte`. Critério de
   * "ativo" pedido pelo usuário (05/09/2026) especificamente para o "PDI -
   * Painel por Analista" — DISTINTO de `ativoNaGrade` abaixo (janela de ~45
   * dias, usado pela tela de Controle de Prazos). Os dois convivem.
   */
  temAgendamentoPrimeiraSemanaMesSeguinte: boolean

  /**
   * `true` quando o nome deste paciente (normalizado) aparece no relatório
   * Órbita associado a mais de um "ID Favorecido" distinto — ver
   * `lib/pdi/duplicidade.ts::calcularCadastroDuplicadoTita` para a heurística
   * e sua limitação conhecida (falso positivo em homônimos reais). Badge
   * informativo, nunca filtro automático — ver o comentário de
   * `semCadastroPulsar` acima para o mesmo raciocínio.
   */
  cadastroDuplicadoTita: boolean

  /** Dias da semana com sessão clínica, ordenados — ver `lib/pdi/agenda.ts::diasClinicos`. */
  diasClinicos: string[]
  turnoClinico: TurnoClinico
  temAgendamentoAmbienteNatural: boolean
  /**
   * Aplicadores ABA distintos na agenda do paciente, com nome e dias — ver
   * `lib/pdi/agenda.ts::aplicadoresDetalhados`. Pedido do usuário (05/09/2026):
   * o modal de detalhe mostra QUEM são, não só a contagem.
   */
  aplicadores: AplicadorPdi[]
  /** = `aplicadores.length`. Mantido como campo próprio (não recalculado na UI) pelo mesmo motivo de `idFavorecido`. */
  quantidadeAplicadores: number
  /**
   * `true` quando há QUALQUER agendamento (`status = 'Agendado'`, qualquer
   * terapia) na janela de grade buscada — ver
   * `lib/pdi/agenda.ts::temAgendamentoFuturo`. É o sinal de "Ativo" desta
   * tela, DISTINTO de `ativo` acima (que vem de `pacientes.ativo`, o cadastro
   * Pulsar — outro fato, outra fonte). Um paciente pode estar `ativo: true`
   * no cadastro e `ativoNaGrade: false` (fechou o PDI, saiu da agenda, mas o
   * cadastro nunca foi desativado) — os dois campos não se substituem. Ver o
   * cabeçalho de lib/pdi/juntar.ts (correção de 04/09/2026).
   */
  ativoNaGrade: boolean
}

export interface FiltrosPdi {
  recorte: RecortePdi
  /** Nome ou ID do paciente. Casa sem acento e sem caixa. */
  busca: string
  /** `null` de `ESPECIALISTAS_PDI`, ou "todos" para não filtrar. */
  especialistaId: EspecialistaPdiId | "todos"
  /**
   * Filtro secundário por `ativoNaGrade` — pedido do usuário (05/09/2026):
   * tirado do grupo de KPI/recorte (crescia sem parar e competia visualmente
   * com os avisos de verdade) e virou um seletor na barra do cabeçalho, ao
   * lado de Especialista/Limpar/Histórico — mesmo tratamento de
   * `especialistaId`. "todos" continua mostrando ativos e inativos juntos.
   */
  atividade: AtividadePdi
  /**
   * Filtro por `status` — pedido do usuário (05/09/2026). Redundante com os
   * cards "Dentro do prazo"/"Aguardando Implementação"/"Atrasado"/"Próximo do
   * prazo" do `recorte` (é a mesma informação), mas o usuário pediu um
   * seletor dedicado além dos cards — os dois convivem, e escolher um valor
   * aqui não mexe em `recorte` (nem vice-versa).
   */
  status: StatusPdi | "todos"
  /**
   * Filtro por `prioridade` — pedido do usuário (05/09/2026). `prioridade` é
   * DERIVADA 1:1 de `status` (ver `lib/pdi/status.ts::calcularPrioridade`:
   * Atrasado→Alta, Próximo do prazo→Média, senão→Neutra), então este filtro é
   * estritamente redundante com `status` acima — mas é um seletor
   * independente porque o usuário pensa nos dois separadamente (o rótulo que
   * aparece no card é "Prioridade", nem sempre "Status").
   */
  prioridade: PrioridadePdi | "todos"
  /**
   * Dias da semana selecionados (valores de `DIAS_LIST`,
   * lib/cronograma/constants.ts) — filtro "em formato calendário" pedido pelo
   * usuário (05/09/2026): mostra pacientes com sessão clínica em QUALQUER UM
   * dos dias marcados (união, não interseção — "o paciente comparece
   * segunda OU quinta" é o caso de uso, não "comparece nos dois"). Array
   * vazio = sem filtro (mostra todos os dias).
   */
  dias: string[]
}

/**
 * Estado inicial: "todos" de recorte/especialista/status/prioridade, sem
 * busca nem dias — MAS `atividade: "ativos"`, pedido do usuário (05/09/2026):
 * a tela sempre abre mostrando só quem está em atendimento agora; ver os
 * inativos é uma escolha explícita no seletor "Atividade", não o padrão.
 */
export function filtrosIniciais(): FiltrosPdi {
  return {
    recorte: "todos",
    busca: "",
    especialistaId: "todos",
    atividade: "ativos",
    status: "todos",
    prioridade: "todos",
    dias: [],
  }
}

export function filtrosAlterados(f: FiltrosPdi): boolean {
  const inicial = filtrosIniciais()
  if (f.recorte !== inicial.recorte) return true
  if (f.busca.trim() !== "") return true
  if (f.especialistaId !== inicial.especialistaId) return true
  if (f.atividade !== inicial.atividade) return true
  if (f.status !== inicial.status) return true
  if (f.prioridade !== inicial.prioridade) return true
  if (f.dias.length > 0) return true
  return false
}

/** Sem acento, minúsculo — para "Joao" casar com "João". Igual a lib/laudos/filtros.ts. */
export function norm(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

// ─── Predicados: uma definição por recorte, usada pelo filtro E pelo KPI ─────

/**
 * `ativoNaGrade` entra na condição — pedido do usuário (05/09/2026): um
 * paciente inativo (sem agendamento futuro) nunca conta aqui, mesmo que o
 * filtro de Atividade esteja em "Todos"/"Inativos" — coordenador ausente só é
 * um problema operacional pra quem ainda está em atendimento.
 */
function coordenadorIrregular(i: ItemPdi): boolean {
  return i.ativoNaGrade && i.coordenadorIds.length !== 1
}

export const PREDICADO_RECORTE: Record<RecortePdi, (i: ItemPdi) => boolean> = {
  todos: () => true,
  em_andamento: (i) => i.status === "Dentro do prazo",
  aguardando_implementacao: (i) => i.status === "Aguardando Implementação",
  atrasado: (i) => i.status === "Atrasado",
  proximo_prazo: (i) => i.status === "Próximo do prazo",
  coordenador_irregular: coordenadorIrregular,
}

/**
 * Os filtros da barra que NÃO são o recorte: busca, especialista e atividade.
 * Extraído à parte porque `contarKpis` precisa aplicá-los SEM aplicar o
 * recorte — mesmo raciocínio de `aplicarFiltrosSecundarios` em
 * lib/laudos/filtros.ts.
 */
function aplicarFiltrosSecundarios(itens: ItemPdi[], f: FiltrosPdi): ItemPdi[] {
  const termo = norm(f.busca)

  return itens.filter((i) => {
    if (f.especialistaId !== "todos" && i.especialistaTitaId !== f.especialistaId) return false
    if (f.atividade === "ativos" && !i.ativoNaGrade) return false
    if (f.atividade === "inativos" && i.ativoNaGrade) return false
    if (f.status !== "todos" && i.status !== f.status) return false
    if (f.prioridade !== "todos" && i.prioridade !== f.prioridade) return false
    if (f.dias.length > 0 && !f.dias.some((d) => i.diasClinicos.includes(d))) return false

    if (termo) {
      const casaNome = norm(i.nome).includes(termo)
      const casaId = String(i.pacienteId).includes(termo)
      if (!casaNome && !casaId) return false
    }

    return true
  })
}

/**
 * Os números dos cards. Aplica os filtros secundários (busca, especialista)
 * ANTES de contar, mas NÃO aplica `f.recorte` — cada card conta pelo SEU
 * PRÓPRIO predicado, senão selecionar um recorte zeraria os outros cards.
 * Mesmo contrato de `contarKpis` em lib/laudos/filtros.ts.
 */
export function contarKpis(itens: ItemPdi[], f: FiltrosPdi): Record<RecortePdi, number> {
  const base = aplicarFiltrosSecundarios(itens, f)
  return {
    todos: base.length,
    em_andamento: base.filter(PREDICADO_RECORTE.em_andamento).length,
    aguardando_implementacao: base.filter(PREDICADO_RECORTE.aguardando_implementacao).length,
    atrasado: base.filter(PREDICADO_RECORTE.atrasado).length,
    proximo_prazo: base.filter(PREDICADO_RECORTE.proximo_prazo).length,
    coordenador_irregular: base.filter(PREDICADO_RECORTE.coordenador_irregular).length,
  }
}

/** A lista que a tela mostra: filtros secundários E o recorte selecionado. */
export function filtrar(itens: ItemPdi[], f: FiltrosPdi): ItemPdi[] {
  return aplicarFiltrosSecundarios(itens, f).filter(PREDICADO_RECORTE[f.recorte])
}

/**
 * Ordena por `prazoFechamento` (mais urgente primeiro; `null` — "Aguardando
 * Implementação", sem prazo ainda — vai para o fim), com desempate por nome.
 */
export function ordenar(itens: ItemPdi[]): ItemPdi[] {
  const porNome = (a: ItemPdi, b: ItemPdi) => a.nome.localeCompare(b.nome, "pt-BR")

  return [...itens].sort((a, b) => {
    const x = a.prazoFechamento
    const y = b.prazoFechamento
    if (x === y) return porNome(a, b)
    if (!x) return 1
    if (!y) return -1
    return x < y ? -1 : 1
  })
}

/** Filtrar + ordenar, na ordem certa. É o que a tela chama. */
export function aplicar(itens: ItemPdi[], f: FiltrosPdi): ItemPdi[] {
  return ordenar(filtrar(itens, f))
}

export const RECORTE_LABEL: Record<RecortePdi, string> = {
  todos: "Todos",
  em_andamento: "Dentro do prazo",
  aguardando_implementacao: "Aguardando Implementação",
  atrasado: "Atrasado",
  proximo_prazo: "Próximo do prazo",
  coordenador_irregular: "Coordenador irregular",
}
