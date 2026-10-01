// Tipos da PEP (Parcela por Entregas por Paciente) — Analista do Comportamento.
// Vocabulário conforme PRD "Sistema de Faturamento de Prestadores (PA/PEP) v2.7".

export type PepClasseItem = "recorrente" | "semestral"
export type PepTipoRegistro = "GERAL" | "POR_PACIENTE"
export type PepStatusEntrega = "pendente" | "entregue"
export type PepOrigemPlanejamento = "inicial" | "reprogramacao_antecipada" | "reprogramacao_impedimento" | "manual"

// Referência à evidência (caminho + nome do arquivo no diretório da
// clínica) — nunca um upload. PRD Seção 6/12.3: "nada é anexado nem enviado
// ao Pulsar". Uma por unidade entregue (ex.: 2 unidades de TAP = 2 entradas).
//
// `origem`/`sp_id` (20261002100000): a unidade marcada pelo robô SharePoint
// carrega origem 'robo' e o id do arquivo. Sem origem = pessoa. A cor da
// unidade na tela (roxo robô, azul pessoa) sai daqui.
export type PepOrigemEntrega = "robo" | "humano"
export type PepEvidencia = { caminho: string; nome: string | null; origem?: PepOrigemEntrega; sp_id?: string }

export interface PepCatalogoItem {
  id: string
  codigo: string
  sigla: string
  nome: string
  classe: PepClasseItem
  tipo_registro: PepTipoRegistro
  periodicidade: "semanal" | "quinzenal" | "mensal" | "semestral"
  qtd_referencia_mes: number | null
  peso_mensal: number
  ativo: boolean
}

export interface PepPlanejamentoSemestral {
  id: string
  paciente_nome: string
  paciente_cpf: string | null
  prestador_nome: string
  item_id: string
  competencia_planejada: string // 'YYYY-MM'
  // Data acordada no Planejamento das periódicas (PRD §2.6/§12.6) — a
  // competência acima é sempre derivada dela, nunca o contrário. Sem hora.
  data_planejada: string | null // 'YYYY-MM-DD'
  origem: PepOrigemPlanejamento
  planejamento_anterior_id: string | null
  ativo: boolean
  // Só quando origem = 'reprogramacao_impedimento' — motivos e justificativas
  // técnicas do relatório de reprogramação (REP-), PRD Seção 9.7.
  motivo: string | null
  evidencias: PepEvidencia[]
  criado_em: string
}

export interface PepRegistroEntrega {
  id: string
  paciente_nome: string | null
  paciente_cpf: string | null
  prestador_nome: string
  item_id: string
  competencia: string // 'YYYY-MM'
  status: PepStatusEntrega
  // Só para itens recorrentes — quantas unidades foram entregues na
  // competência (ex.: 2 de 4 supervisões). NULL para semestrais, que usam
  // apenas "status".
  quantidade_entregue: number | null
  // Quantas dessas unidades o robô marcou (derivado das evidências por
  // trigger; pessoa = quantidade_entregue − quantidade_robo). Semestral: 0/1.
  quantidade_robo: number
  evidencias: PepEvidencia[]
  observacao: string | null
  // Data própria do documento entregue (PRD §2.2 — "documentos de evidência
  // podem ter data própria"). NÃO é registro de atividade/jornada (§2.1); a
  // apuração continua por competência (§3), derivada desta data. Sem hora.
  // Só usada nas semestrais — recorrentes seguem só por competência.
  data_entrega: string | null // 'YYYY-MM-DD'
  entregue_em: string | null
  created_at: string
  updated_at: string
}

export type PepAjusteLinha = { itemCodigo: string; percentual: number; valor: number; devolvido?: boolean }

// Resultado apurado da PEP para um paciente numa competência — snapshot
// permanente, independente do prestador seguir ativo (Seção 9 do PRD).
// Base do indicador "potencial × alcançado" e do histórico mensal.
export interface PepApuracaoMensal {
  id: string
  paciente_nome: string
  paciente_cpf: string | null
  prestador_nome: string
  competencia: string // 'YYYY-MM'
  valor_bruto: number // potencial (V, 100%)
  ajuste_recorrentes: PepAjusteLinha[]
  ajuste_semestrais: PepAjusteLinha[]
  ajuste_recorrentes_valor: number
  ajuste_semestrais_valor: number
  saldo_remanescente_anterior: number
  devolucao_valor: number
  valor_liquido: number // alcançado
  // Valor das entregas recorrentes creditado a quem marcou cada unidade
  // (20261002100000). robo + humano = V − ajuste_recorrentes_valor.
  valor_robo: number
  valor_humano: number
  saldo_remanescente_novo: number
  modo_teste: boolean
  calculado_em: string
  // PRD Seção 11 — "Até dia 5: Clínica confere e informa o Faturamento
  // Liberado." Liberado = apuração fechada para aquela competência/prestador.
  estado: "apurado" | "liberado"
  liberado_em: string | null
  liberado_por: string | null
}
