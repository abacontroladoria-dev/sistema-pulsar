// ─── TIPOS: MÓDULO OCUPAÇÃO DE SALAS ──────────────────────────────────────────
// Cadastro estrutural de salas (tabela cronograma_salas) cruzado com dados de
// agendamento já existentes em csv_grades_profissionais. Ver plano em
// docs internos: "Portar Ocupação de Salas + Dashboards".

export type SalaCapacidade = "unico" | "duplo" | "multiplo"

/**
 * Código de status de sala — CRUD livre em `cronograma_status_labels`
 * (tabela própria, FK de `cronograma_salas.status`), não é mais um union
 * fixo. "operacional" é o único código especial (ver capacidadeProjetadaSala
 * abaixo) — qualquer outro código, seja "bloqueada"/"adm"/"nti" (seed
 * original) ou um status novo criado pelo usuário, é tratado genericamente
 * como "fora de operação" pelo motor de ocupação (ver statusDoSlot em
 * salas.ts). Rótulo/rótulo curto/cor exibidos vêm de `listarStatusLabels()` —
 * ver hook `useStatusLabels`.
 */
export type SalaStatus = string

/** Rótulo curto de capacidade — usado em badges/filtros (formulário de cadastro usa uma versão mais descritiva). */
export const CAPACIDADE_LABEL_CURTO: Record<SalaCapacidade, string> = {
  unico: "Único",
  duplo: "Duplo",
  multiplo: "Múltiplo",
}

/** Fallback estático pros 4 códigos originais (seed) — usado só onde não há como buscar `listarStatusLabels()` (ex.: formatação síncrona de auditoria). Status criados depois disso não têm entrada aqui; quem usa deve cair pro código bruto. */
export const STATUS_LABEL_CURTO: Record<string, string> = {
  operacional: "Operacional",
  bloqueada: "Bloqueada",
  adm: "Adm",
  nti: "NTI",
}

/** Linha de `cronograma_salas` */
export interface Sala {
  id: string
  unidade_nome: string
  nucleo: string | null
  andar: string | null
  numero_sala: string
  nome_exibicao: string
  capacidade: SalaCapacidade
  status: SalaStatus
  sala_nome_referencia: string | null
  observacoes: string | null
  /** Dias/turnos em que a sala atende. Padrão = Seg-Sex, Manhã+Tarde (DIAS_DISPONIVEIS_PADRAO) — qualquer outro conjunto tira a sala da grade principal e a coloca numa seção separada (ver calcularSlotsDaSala em salas.ts). */
  dias_disponiveis: DiaDisponivelSala[]
  /** Override opcional de horários por dia/turno, chave `chaveHorarioCustomizado(dow,turno)` (ex.: "6-Manhã") — só quando a duração/janela de sessão desse turno for diferente do padrão do sistema (40min, HORAS_GRID). Ausência de chave = usa o grid padrão. */
  horarios_customizados: Record<string, string[]>
  created_at: string
  updated_at: string
}

/** Chave de `horarios_customizados` pra um dia/turno — único formato usado em toda leitura/escrita, pra não divergir entre form e motor de ocupação. */
export function chaveHorarioCustomizado(dow: number, turno: "Manhã" | "Tarde"): string {
  return `${dow}-${turno}`
}

/** Um dia da semana em que a sala atende, com os turnos específicos desse dia (ex.: sábado só "Manhã"). */
export interface DiaDisponivelSala {
  dow: number
  turnos: ("Manhã" | "Tarde")[]
}

/** Payload de criação/edição de sala (sem campos gerados pelo banco) */
export interface SalaInput {
  unidade_nome: string
  nucleo?: string | null
  andar?: string | null
  numero_sala: string
  nome_exibicao: string
  capacidade: SalaCapacidade
  status?: SalaStatus
  sala_nome_referencia?: string | null
  observacoes?: string | null
  dias_disponiveis?: DiaDisponivelSala[]
  horarios_customizados?: Record<string, string[]>
}

/** Padrão Seg-Sex, dia inteiro (Manhã+Tarde) — usado como default de `dias_disponiveis` sempre que a sala não tiver o campo preenchido (ex.: linhas antigas do banco antes da coluna existir). */
export const DIAS_DISPONIVEIS_PADRAO: DiaDisponivelSala[] = [1, 2, 3, 4, 5].map(dow => ({ dow, turnos: ["Manhã", "Tarde"] as ("Manhã" | "Tarde")[] }))

/**
 * Tolerante ao formato antigo de `dias_disponiveis` (smallint[] — só o dow,
 * dia inteiro implícito), pré-migration 20260908092832: enquanto o banco
 * ainda não tiver rodado essa migration (ou durante o intervalo entre deploy
 * do frontend e aplicação manual do APLICAR_*.sql), a coluna pode chegar como
 * `[1,2,3,4,5]` em vez de `[{dow,turnos}]`. Sem isso, `calcularSlotsDaSala`
 * quebra tentando desestruturar `turnos` de um number (ver incidente
 * 2026-09-08: "turnos is not iterable"). Aplica-se em toda leitura de sala
 * vinda do banco — ver `listarSalas`/`criarSala`/`atualizarSala` em
 * salas.service.ts.
 */
export function normalizarDiasDisponiveis(raw: unknown): DiaDisponivelSala[] {
  if (!Array.isArray(raw) || raw.length === 0) return DIAS_DISPONIVEIS_PADRAO
  return raw.map(item => {
    if (typeof item === "number") return { dow: item, turnos: ["Manhã", "Tarde"] as ("Manhã" | "Tarde")[] }
    const dow = Number((item as { dow?: unknown })?.dow)
    const turnosRaw = (item as { turnos?: unknown })?.turnos
    const turnos = Array.isArray(turnosRaw) ? turnosRaw.filter((t): t is "Manhã" | "Tarde" => t === "Manhã" || t === "Tarde") : []
    return { dow, turnos: turnos.length ? turnos : (["Manhã", "Tarde"] as ("Manhã" | "Tarde")[]) }
  }).filter(d => Number.isFinite(d.dow))
}

/** Tolerante a `null`/formato inesperado de `horarios_customizados` — mesmo cuidado defensivo de normalizarDiasDisponiveis (coluna nova, pode não existir ainda no banco no momento da leitura). */
export function normalizarHorariosCustomizados(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string[]> = {}
  for (const [chave, horarios] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(horarios)) out[chave] = horarios.filter((h): h is string => typeof h === "string")
  }
  return out
}

/** Capacidade projetada (nº de profissionais/pacientes simultâneos esperados) */
export function capacidadeProjetadaSala(capacidade: SalaCapacidade, status: SalaStatus): number {
  if (status !== "operacional") return 0
  if (capacidade === "multiplo") return 3
  if (capacidade === "duplo") return 2
  return 1
}

/** 'obrigatoria' = a terapia só pode ser agendada nas salas exclusivas listadas. 'preferencial' = prioriza essas salas, mas pode cair em qualquer sala não-reservada por outra terapia. */
export type ModoExclusividadeTerapia = "obrigatoria" | "preferencial"

/** Linha de `cronograma_salas_terapias_exclusivas` — restringe (ou prioriza) uma sala a uma terapia específica, usado tanto pela grade de Ocupação de Salas quanto pela recomendação de sala em Solicitações › Simulação (ver encontrarSalaLivre em sugestaoContratacao.ts). */
export interface SalaTerapiaExclusiva {
  id: string
  sala_id: string
  /** Chave estável da terapia (constants.ts TERAPIA_ID) — não há tabela `tipos_terapia` no banco. */
  terapia_id: number
  terapia_nome: string
  modo: ModoExclusividadeTerapia
  created_at: string
  updated_at: string
}

/** Payload de criação/edição de uma exclusividade sala×terapia */
export interface SalaTerapiaExclusivaInput {
  sala_id: string
  terapia_id: number
  terapia_nome: string
  modo: ModoExclusividadeTerapia
}

/** Linha de `cronograma_salas_alocacoes` — quem é o "dono" recorrente de uma sala/dia/turno (planejamento, não agendamento real) */
export interface AlocacaoSala {
  id: string
  sala_id: string
  dow: number
  turno: "Manhã" | "Tarde"
  profissional_nome: string
  /** Chave estável do profissional (csv_grades_profissionais.profissional_id) — nome pode mudar na TiTa, o ID não. Null em alocações antigas sem correspondência encontrada no backfill. */
  profissional_id: number | null
  terapia_nome: string | null
  /** Chave estável da terapia (constants.ts TERAPIA_ID) — nome pode mudar, ID não. Null em alocações antigas sem correspondência encontrada no backfill. */
  terapia_id: number | null
  created_at: string
  updated_at: string
}

/** Payload de criação/edição de alocação */
export interface AlocacaoInput {
  sala_id: string
  dow: number
  turno: "Manhã" | "Tarde"
  profissional_nome: string
  profissional_id?: number | null
  terapia_nome?: string | null
  terapia_id?: number | null
}

/**
 * "bloqueado" continua com contador próprio (slotsBloqueados) porque
 * `sala.status === "bloqueada"` é um dos códigos originais do seed e o
 * dashboard já distingue esse caso das demais salas fora de operação.
 * "inativo" é o bucket genérico pra QUALQUER outro status não-operacional
 * (adm/nti do seed, ou um status novo criado pelo usuário) — ver
 * statusDoSlot em salas.ts.
 */
export type StatusOcupacaoSlot = "livre" | "ocupado" | "parcial" | "bloqueado" | "inativo"

/** Slot statuses que representam sala fora de operação (sem agendamento possível) — excluídos de todo cálculo/contagem de % ocupação. */
export const STATUS_SLOT_EXCLUIDO: readonly StatusOcupacaoSlot[] = ["bloqueado", "inativo"]

/** Uma alocação (profissional/terapia) dentro de um slot, cruzada com sessões reais para exibição informativa */
export interface AlocacaoCardSlot {
  alocacaoId: string
  profissionalNome: string
  terapiaNome: string | null
  /** nº de sessões reais (csv_grades_profissionais) desse profissional nesse sala/dia/turno */
  sessoesReais: number
  /** capacidade em nº de blocos de 40min do turno (6 manhã / 7 tarde) — janela pessoal do profissional alocado */
  sessoesCapacidadeTurno: number
  pctOcupacao: number | null
  /**
   * true se o profissional não tem NENHUM registro na agenda real da TiTa
   * (nem sessão "Agendado", nem horário 'Livre' reservado) nesse dia/turno/
   * unidade — alocação puramente planejada, sem cruzamento nenhum no CSV.
   * Continua false quando o profissional tem 'Livre' mas ainda 0 sessão
   * "Agendado" (agenda aberta esperando paciente, não é pendência) — nesse
   * caso `sessoesReais` é 0 mesmo assim, já que a proporção "X/Y com
   * paciente" conta só atendimento real.
   */
  semCruzamentoCsv: boolean
  /**
   * Preenchido quando esta alocação fere uma regra cadastrada em
   * "Exclusividade de salas com terapias" (ver exclusividadeTerapia.ts) — só
   * pra violações "bloqueado" (obrigatória ferida); "aviso" (preferencial)
   * não conta como inconsistência aqui, é só uma prioridade não seguida.
   */
  violacaoExclusividade: { direcao: "sala_para_terapia" | "terapia_para_sala"; motivo: string } | null
}

/**
 * Um bloco de 40min de uma "cadeira" (vaga simultânea) da sala — a unidade
 * mais granular de ocupação. Uma sala Único tem 1 cadeira, Duplo 2, Múltiplo
 * 3; cada cadeira tem 6 blocos na Manhã / 7 na Tarde (grade HORAS_GRID,
 * constants.ts). `status: "preenchido"` só acontece quando existe uma sessão
 * real "Agendado" nesse horário EXATO (hora_inicial normalizado via `pm()`) —
 * não é aproximação por contagem.
 */
export interface BlocoOcupacaoSlot {
  hora: string
  horaFim: string
  /** null = cadeira sem alocação nenhuma nesse sala/dia/turno */
  profissional: string | null
  terapia: string | null
  /** tita_agendamento_id da sessão real, só quando status é "preenchido" */
  idAgendamento: number | null
  status: "preenchido" | "livre"
}

/** Ocupação de uma sala em um dia da semana × turno específico, guiada pelas alocações (planejamento), não pelos dados brutos da agenda */
export interface SlotOcupacaoSala {
  salaId: string
  dow: number
  turno: "Manhã" | "Tarde"
  /** Capacidade projetada (nº máximo de alocações simultâneas: 1/2/3, 0 se adm/bloqueada) */
  capacidadeProjetada: number
  /** Alocações (profissional/terapia) planejadas para este sala/dia/turno */
  alocacoes: AlocacaoCardSlot[]
  status: StatusOcupacaoSlot
  /** nº de alocações simultâneas ultrapassa a capacidadeProjetada da sala (conflito de planejamento) */
  inconsistente: boolean
  /** true se pelo menos uma alocação deste slot fere "Exclusividade de salas com terapias" (ver AlocacaoCardSlot.violacaoExclusividade) */
  violaExclusividade: boolean
  /** Detalhe bloco a bloco (capacidadeProjetada × blocos do turno) — vazio se adm/bloqueada. */
  blocos: BlocoOcupacaoSlot[]
}

/** Linha "achatada" de auditoria — 1 slot (sala×dia) do drill-down binário (StatCard "X/Y ocupados"). */
export interface SlotDetalhado {
  sala: string
  dow: number
  diaLabel: string
  status: "ocupado" | "parcial" | "livre"
  alocacoes: { profissional: string; terapia: string | null; sessoesReais: number; sessoesCapacidadeTurno: number }[]
}

/** Linha "achatada" de auditoria — 1 bloco de 40min do drill-down granular (StatCard "X/Y preenchidos"). */
export interface BlocoDetalhado extends BlocoOcupacaoSlot {
  sala: string
  dow: number
  diaLabel: string
}

/** Sala com seus slots calculados e um resumo semanal agregado */
export interface SalaComOcupacao {
  sala: Sala
  slots: SlotOcupacaoSala[]
  pctOcupacaoSemanal: number | null
}

export interface ResumoTurnoUnidadeSalas {
  turno: "Manhã" | "Tarde"
  slotsTotal: number
  slotsOcupados: number
  slotsLivres: number
  slotsBloqueados: number
  pct: number | null
  /**
   * Ocupação granular (por sessão real, não por slot binário) — cada vaga
   * simultânea da sala (1/2/3 conforme Único/Duplo/Múltiplo) é tratada como
   * uma "cadeira" própria de `sessoesCapacidadeTurno` blocos de 40min (6
   * manhã/7 tarde). Uma sala Único com 1 sessão real de 6 possíveis pesa
   * 1/6 aqui, não "1 slot ocupado inteiro" como no cálculo binário acima —
   * por isso `pctGranular` tende a ser MENOR que `pct`.
   */
  blocosTotal: number
  blocosPreenchidos: number
  pctGranular: number | null
}

/** Resumo agregado por unidade — adaptado de calcularResumoSalas */
export interface ResumoUnidadeSalas {
  unidade: string
  salasTotal: number
  /** nº de salas com status "operacional" — único código com contador dedicado (é o "ativo" do motor de ocupação). */
  salasAtivas: number
  /** nº de salas por status NÃO-operacional, chaveado pelo código (`StatusLabel.codigo`) — cobre tanto os 3 códigos do seed (bloqueada/adm/nti) quanto qualquer status novo criado pelo usuário. */
  porStatus: Record<string, number>
  salasPorCapacidade: Record<SalaCapacidade, number>
  capacidadeSimultanea: number
  slotsTotal: number
  slotsOcupados: number
  slotsLivres: number
  slotsBloqueados: number
  pct: number | null
  porTurno: ResumoTurnoUnidadeSalas[]
  porTerapia: { terapia: string; sessoes: number }[]
  inconsistencias: number
  /** Ver comentário em ResumoTurnoUnidadeSalas.blocosTotal — mesma ideia, agregada pra unidade inteira. */
  blocosTotal: number
  blocosPreenchidos: number
  pctGranular: number | null
}

/** Linha bruta de agendamento usada para cruzar com salas (subconjunto de CsvRow) */
export interface AgendaSalaRow {
  tita_agendamento_id: number | null
  paciente_id: number | null
  paciente_nome: string | null
  convenio_nome: string | null
  unidade_nome: string | null
  sala_nome: string | null
  profissional_nome: string | null
  /** Chave estável do profissional na TiTa — usada para cruzar com `AlocacaoSala.profissional_id` (nome pode mudar, ID não). */
  profissional_id: number | null
  terapia_id: number | null
  terapia_nome: string | null
  terapia_exibicao_id: number | null
  terapia_exibicao_nome: string | null
  dia_semana: string | null
  hora_inicial: string | null
  hora_final: string | null
  status_agendamento: string | null
  data: string | null
}

// ─── DASHBOARD DE PACIENTES ────────────────────────────────────────────────────

export interface ResumoPacientesSalas {
  pacientesUnicos: number
  sessoesTotal: number
  chSemanalTotal: number
  chMediaMensalTotal: number
  mediaSessoesPorPaciente: number
  porConvenio: ResumoPacientesGrupo[]
  porUnidade: ResumoPacientesGrupo[]
  porDia: ResumoPacientesDia[]
}

export interface ResumoPacientesGrupo {
  chave: string
  pacientesUnicos: number
  sessoesTotal: number
  chSemanalTotal: number
  chMediaMensalTotal: number
  mediaSessoesPorPaciente: number
}

/** Uma linha por dia útil (Seg–Sex, sempre nessa ordem, mesmo com 0 sessões). */
export interface ResumoPacientesDia {
  dia: string
  dow: number
  pacientesUnicos: number
  sessoesTotal: number
  chSemanalTotal: number
}

/**
 * Os dois dashboards de indicadores/pacientes, separados POR SESSÃO (não por
 * paciente): "Tratamento Multidisciplinar" (dashboard geral — toda sessão que
 * não é do grupo "Processo Diagnóstico", ver PROCESSO_DIAGNOSTICO_NAMES em
 * constants.ts) e "Processo Diagnóstico" (só as sessões de Avaliação
 * Neuropsicológica / Psiquiatra-Neurologista). Uma sessão dessas duas terapias
 * nunca soma nos números do multidisciplinar, mesmo que o paciente também
 * tenha outras sessões contadas lá.
 */
export interface DashboardPacientesGeral {
  multidisciplinar: ResumoPacientesSalas
  processoDiagnostico: ResumoPacientesSalas
}
