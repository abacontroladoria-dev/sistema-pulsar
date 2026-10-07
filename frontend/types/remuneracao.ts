export type FeriadoInfo = {
  nome: string
  tipo: "integral" | "parcial"
  horario_inicio: string
  horario_fim: string
}

export type TaxaEspecialidade = {
  id: string
  especialidade: string
  taxa_pa: number
  diaria: number
  /**
   * Ponto de Equilíbrio (PJ, 1x/semana) — custo mensal fixo do profissional
   * (pra 1 dia/semana COMPLETO) e capacidade de sessões por turno. null pra
   * qualquer especialidade que não use esse modelo ainda (só Fonoaudiologia/
   * Terapia Ocupacional/Musicoterapia por ora — ver lib/remuneracao/pontoEquilibrio.ts).
   */
  be_custo_mensal_pj: number | null
  /** @deprecated não é mais usado pelo cálculo — ver be_capacidade_manha/be_capacidade_tarde. */
  be_capacidade_diaria: number | null
  be_capacidade_manha: number | null
  be_capacidade_tarde: number | null
  created_at: string
  updated_at: string
  updated_by: string | null
}

export type ParametrosGerais = {
  id: string
  cc_pa_default: number
  cc_pe_default: number
  cc_lim_default: number
  eta_bonus_default: number
  presenca_padrao: number
  /** Alíquota de imposto sobre faturamento, em pontos percentuais (20 = 20%) — usada no Ponto de Equilíbrio PJ. */
  imposto_faturamento_pct: number
  /**
   * Capacidade padrão (sessões por turno, num dia completo) usada pelo Ponto
   * de Equilíbrio das especialidades "por atendimento" — só Fono/TO/
   * Musicoterapia têm capacidade própria; as demais usam este padrão único.
   */
  pa_capacidade_manha_padrao: number
  pa_capacidade_tarde_padrao: number
  updated_at: string
  updated_by: string | null
}

export type ContratoAtualItem = {
  numero: string
  funcao: string
  valorPA: number
  vigente: boolean
  /** Ausente/undefined = "atendimento" (comportamento padrão, contratos antigos). */
  modeloFaturamento?: "atendimento" | "banco_horas"
  /**
   * Só relevante quando modeloFaturamento === "banco_horas": valor total pago
   * (mês ou período do contrato). O valor/hora é derivado em tempo de
   * execução (valorTotal ÷ horas agendadas na grade), não é armazenado.
   * Um contrato "antigo" é apenas um item com vigente=false.
   */
  valorTotal?: number
  /**
   * Nota deste contrato específico. Desceu do profissional para o item na
   * migration 20260803120000 — antes era uma nota por profissional, então quem
   * tinha dois contratos tinha uma nota falando de um deles sem dizer qual.
   */
  observacoes?: string | null
  /**
   * Valor mensal da PEP por paciente (PRD "Sistema de Faturamento de
   * Prestadores (PA/PEP)" Seção 6/13.3), só relevante para contrato de
   * Analista do Comportamento. null/undefined = usa o valor de referência
   * (remuneracao_config.cc_pe_default) — ver resolverValorPepMensal em
   * calculo.ts.
   */
  valorPepMensal?: number | null
  /**
   * Terapias marcadas no checkbox de banco de horas quando um único contrato
   * cobre mais de uma (ContratosCadastro.tsx). Null/undefined/[] = terapia
   * única (comportamento de sempre). Metadado do cadastro só — o cálculo em
   * lib/remuneracao/ continua lendo `funcao`, que já vem com o rótulo
   * composto "Contrato único, especialidades múltiplas" quando são 2+.
   */
  especialidadesBancoHoras?: string[] | null
  /**
   * Valor por sessão diferente para terapias específicas DENTRO deste contrato
   * (ex.: R$ 30 geral, Avaliação Neuropsicopedagógica a R$ 45). Null/[] = o
   * `valorPA` vale para tudo. Lido por paDoContrato em lib/remuneracao/calculo.ts.
   */
  valoresPorTerapia?: { terapia: string; valorPA: number }[] | null
}

export type ContratoAtual = {
  id: string
  profissional_nome: string
  documento_tipo: string | null
  cpf: string | null
  cnpj: string | null
  razao_social: string | null
  contratos: ContratoAtualItem[]
  /**
   * BACKUP CONGELADO — não é mais escrito. A observação virou por-contrato em
   * `ContratoAtualItem.observacoes` (migration 20260803120000); a coluna
   * continua existindo e `select('*')` continua trazendo, mas o app parou de
   * gravar aqui de propósito. Não ler como fonte de verdade.
   */
  observacoes: string | null
  created_at: string
  updated_at: string
}
