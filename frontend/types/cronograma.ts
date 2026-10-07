// ─── TIPOS CENTRAIS DO MÓDULO CRONOGRAMA ─────────────────────────────────────

/** Linha bruta da grade CSV (grade de profissionais do Apptita) */
export interface CsvRow {
  "Nome Favorecido": string
  "Dia da Semana": string
  "Hora Inicial": string
  "Terapia": string
  "Profissional": string
  "Status do Agendamento": "Agendado" | "Livre" | string
  "Convênio"?: string
  "Sala"?: string
  "Data"?: string
  /** UUID da linha em csv_grades_profissionais (coluna id) — identifica o registro de origem. */
  CsvGradeId?: string
  /** Chave estável do paciente (csv_grades_profissionais.paciente_id) — nome pode mudar/repetir, o ID não. Usado pra casar exceções de valor por paciente (ver resolverValorSessao). */
  PacienteId?: number | null
  /** Chave estável do profissional (csv_grades_profissionais.profissional_id) — mesmo motivo do PacienteId, e aqui é obrigatório: o TiTa grava o mesmo id com grafias diferentes no nome ("Nicolly Christine da Silva Alcantara" × "Nicolly Alcantara") e prefixa desligados com "INATIVO-". Usado pra cruzar com grade_profissionais_tita (ver gradeTitaOcupacao.ts). */
  ProfissionalId?: number | null
  [key: string]: string | number | null | undefined
}

/** Linha bruta do laudo (Excel de laudos/autorizações) */
export interface LaudoRow {
  "Paciente": string
  "Especialidade": string
  "Qtd autorizada": string | number
  "Situação": string
  "Plano"?: string
  "Data nasc."?: string
  "Comp. agressivo"?: string
  "Alta"?: string
  "ALTA"?: string
  "alta"?: string
  "Data alta"?: string
  "DATA ALTA"?: string
  "Data Alta"?: string
  [key: string]: string | number | undefined
}

/**
 * De onde veio o relatório de laudos que está na tela.
 *
 * Vive aqui, e não em services/laudos/relatorio.ts (que produz o valor), porque
 * o badge do header é componente CLIENTE e aquele módulo é `server-only` —
 * importar o tipo de lá arrastaria o módulo de servidor para o bundle.
 *
 * `null` no estado do layout significa "não vem do relatório automático": ou
 * nada carregado, ou arquivo enviado à mão. Nesse caso não há frescor a exibir.
 */
export interface MetaImportacaoLaudos {
  importacaoId: string
  arquivoNome: string
  concluidoEm: string | null
  /** O que o robô diz ter gravado. Nulo quando o metadado não foi preenchido. */
  totalLinhas: number | null
  /** O que a leitura de fato trouxe. Divergir de `totalLinhas` é erro. */
  linhasLidas: number
}

/** Linha da disponibilidade (CSV do Órbita) */
export interface DispRow {
  "Nome Paciente": string
  "Seg Início"?: string
  "Seg Fim"?: string
  "Ter Início"?: string
  "Ter Fim"?: string
  "Qua Início"?: string
  "Qua Fim"?: string
  "Qui Início"?: string
  "Qui Fim"?: string
  "Sex Início"?: string
  "Sex Fim"?: string
  "Sab Início"?: string
  "Sab Fim"?: string
  "Escola Início"?: string
  "Escola Fim"?: string
  [key: string]: string | undefined
}

/** Versão enriquecida de CsvRow após processamento (campos calculados) */
export interface CsvRowProcessada extends CsvRow {
  Unidade: string
  HI: number | null
  HI_str: string
  HF?: number | null
  HF_str?: string
  [key: string]: string | number | null | undefined
}

/** Mapa de status WhatsApp: chave = "pac|||prof|||dia|||hora", valor = status */
export type WaMap = Record<string, WaStatus>

export type WaStatus =
  | "aguardando"
  | "aceito"
  | "resolvido"
  | "recusado"
  | "inviavel"
  | "pendente"
  | string

/** Mapa de status da saída de profissional (localStorage SK_SAIDA) */
export type StatusMap = Record<string, StatusEntry>

export type StatusSaida = "pendente" | "aguardando" | "resolvido" | "recusado" | "sem_solucao"

/** Opção de estratégia E1 / E3 / E4 — shape real do que é persistido */
export interface OpcaoEstrategia {
  prof: string
  dia: string
  hora: string
  unidade: string
  terapia: string
  esp?: string
}

export interface StatusEntry {
  status: StatusSaida
  obs?: string
  /** Texto registrado na confirmação/recusa/inviabilidade (Confirmou/Recusou = opcional; Inviável = obrigatório) */
  obsAceite?: string
  estrategiaSel?: string | null
  opcaoSel?: number
  opcao?: OpcaoEstrategia | null
  /** Movimentos para estratégias de swap (E2/E5) e migração de dia (E6/E7) */
  movimentos?: MovimentoSessao[] | null
  /** "prof|||dia|||hora" — serializado para localStorage */
  slotReservado?: string | null
  /** Date.now() timestamp */
  atualizadoEm?: number
  /** Snapshot da sessão afetada — persistido para exibição em AcompanhamentoTab */
  afetada?: AfetadaItem
  /** Snapshot da agenda do paciente — persistido para exibição em AcompanhamentoTab */
  sessPac?: SessPacItem[]
}

// ─── SUGESTÃO (saída do runAlgorithm) ────────────────────────────────────────

export interface Sugestao {
  mod: "Musicoterapia" | "Ocupação" | "Foco Prof."
  regra: string
  prof: string
  esp: string
  tP: string
  unidade: string
  dia: string
  hora: string
  pac: string
  faixa: string
  colegas: string
  vComp: string
  vCompSlots?: VCompSlot[]
  obs: string
  gap: number
  conv: string
  prio: 1 | 2 | 3 | 4 | 5
  isPP?: boolean
  isRem?: boolean
  remDia?: string
  remHora?: string
  remTer?: string
  filaM?: string
}

export interface VCompSlot {
  tP: string
  tE: string
  prof: string
  dia: string
  hora: string
}

/** Gap de autorização por paciente/especialidade */
export interface Gap {
  pac: string
  esp: string
  aut: number
  of: number
  gap: number
  prio: 1 | 2 | 3 | 4 | 5
  isAlta?: boolean
}

/** Resultado completo do runAlgorithm */
export interface AlgorithmResult {
  vagasAgora: Sugestao[]
  filaEspera: Sugestao[]
  allGaps: Gap[]
  cM: Record<string, string>
  fxM: Record<string, string>
  agendRows: CsvRowProcessada[]
  altaCount: number
  semanaRef: string
  tPrioAtivas: string[]
}

/** Config passada ao runAlgorithm */
export interface AlgorithmConfig {
  judicialMap?: Record<string, string>
  waMap?: WaMap
  musicoCap?: Record<string, Record<string, number>>
  terapiasPrio?: string[]
  profsPrioExtras?: string[]
  isolarAssim?: boolean
  confirmedItems?: { prof: string; dia: string; hora: string }[]
}

// ─── SAÍDA DE PROFISSIONAL — análise ─────────────────────────────────────────

export type EstrategiaKey = "e1" | "e2" | "e3" | `e4_${number}` | "e5" | "e6" | "e7"

export interface SessPacItem {
  dia: string
  hora: string
  terapia: string
  terapiaExib?: string
  prof: string
  unidade: string
  isAdmin: boolean
}

export interface Inconsistencia {
  dia: string
  sessao: SessPacItem
  unidCorreta: string
}

/** Descrição de uma única sessão sendo reposicionada (usado em swap e migração de dia) */
export interface MovimentoSessao {
  deDia: string
  deHora: string
  deTerapia: string
  deProf: string
  paraDia: string
  paraHora: string
  paraTerapia: string
  paraProf: string
  paraUnidade: string
  profMudou: boolean
}

/** Opção de swap (E2 / E5): conjunto de movimentos que compõem o rearranjo */
export interface OpcaoSwap {
  movimentos: MovimentoSessao[]
  /** Profissionais originais que deixam de atender o paciente (só E5) */
  profissionaisAlterados: string[]
}

/** Opção de migração de dia (E6 / E7): move todas as sessões de um dia para outro */
export interface OpcaoDiaMigracao {
  diaOrigem: string
  diaDestino: string
  movimentos: MovimentoSessao[]
  /** Profissionais originais substituídos por outros (exceto o prof saindo) */
  profissionaisAlterados: string[]
}

export interface Estrategia {
  tipo: "e1" | "e3" | "e4"
  label: string
  opcoes: OpcaoEstrategia[]
  esp?: string
  gap?: number
}

export interface EstrategiaSwap {
  tipo: "e2" | "e5"
  label: string
  opcoes: OpcaoSwap[]
}

export interface EstrategiaDia {
  tipo: "e6" | "e7"
  label: string
  opcoes: OpcaoDiaMigracao[]
}

export interface AnaliseResult {
  sessPac: SessPacItem[]
  sessDiaClin: SessPacItem[]
  buracoSiRemover: boolean
  min2Violation: boolean
  pacTurno: "manhã" | "tarde" | "ambos"
  pacUnidade: string | null
  inconsistencias: Inconsistencia[]
  e1: Estrategia | null           // #1 Mesma terapia, mesmo horário
  e2: EstrategiaSwap | null       // #2 Swap posições — profissionais mantidos
  e3: Estrategia | null           // #3 Mesma terapia, horário adjacente
  e4: Estrategia[]                // #4 Outra terapia, mesmo horário
  e5: EstrategiaSwap | null       // #5 Swap posições — profissionais alterados
  e6: EstrategiaDia | null        // #6 Alterar dia — mesmos profissionais
  e7: EstrategiaDia | null        // #7 Alterar dia — profissionais diferentes
  semSolucao: boolean
}

export interface AfetadaItem {
  pac: string
  terapia: string
  terapiaExib?: string
  dia: string
  hora: string
  unidade: string
  prof: string
  conv: string
}

export interface ResultItem {
  pac: string
  afetada: AfetadaItem
  analise: AnaliseResult
}

// ─── MÓDULO OCUPAÇÃO CLÍNICA ──────────────────────────────────────────────────

export interface RecItem {
  paciente: string
  profissional: string
  especialidade: string
  unidade: string
  dia: string
  hora: string
  registradoEm: string
  obs?: string
}

export interface InvItem {
  paciente: string
  motivo: string
  dia?: string
  hora?: string
  registradoEm: string
}

export interface CfgState {
  terapiasPrio: string[]
  profsPrioExtras: string[]
  musicoCap: Record<string, Record<string, number>>
  judicialMap: Record<string, string>
  isolarAssim: boolean
  apiToken: string
}
