// Conferência do conteúdo das evidências da PEP (14/10/2026). Três
// indicações por documento, decididas pelo usuário:
//
//   bom                → passou em todas as conferências
//   pode_conter_erros  → algo suspeito que precisa de olho humano (tudo o
//                        que depende de julgamento, inclusive tudo da IA)
//   errado             → erro comprovável, mostrado com o trecho
//   ilegivel           → "Não foi possível ler": conferência humana
//
// Só fica "errado" o que dá para provar com o trecho. Ninguém perde dinheiro
// por causa disso: é indicação, não desconto.

export type Nivel = 'errado' | 'atencao'

export type Familia = 'preenchimento' | 'coerencia' | 'copia' | 'qualidade'

export type Achado = {
  /** Código estável (rotulos.ts → texto). */
  codigo: string
  familia: Familia
  nivel: Nivel
  /** Frase curta do que está errado. */
  titulo: string
  /** Explicação ou o que fazer, quando ajuda. */
  descricao?: string
  /** O trecho do documento que prova (até ~200 caracteres). */
  trecho?: string
  /** Seção do documento, quando dá para saber. */
  secao?: string
  /** 'regra' = conferência fixa; 'ia' = leitura pela IA (nunca passa de atenção). */
  origem: 'regra' | 'ia'
}

export type Veredito = 'bom' | 'pode_conter_erros' | 'errado' | 'ilegivel'

export type ExtracaoStatus =
  | 'ok' | 'sem_texto' | 'protegido' | 'corrompido' | 'formato_nao_suportado' | 'grande_demais' | 'erro'

export type RevisaoStatus = 'pendente' | 'problema_confirmado' | 'falso_positivo' | 'corrigido'

/** O que a regra precisa saber sobre o documento além do texto. */
export type ContextoDocumento = {
  sigla: string
  tipoRegistro: 'GERAL' | 'POR_PACIENTE' | null
  /** AAAA-MM do nome do arquivo (ou da data de envio). */
  competencia: string | null
  pacienteNome: string | null
  /** Nome da pasta do paciente no SharePoint (às vezes abreviado). */
  pastaPaciente: string | null
  prestadorNome: string | null
  /** Outros pacientes do mesmo prestador: citar um deles é sinal de cópia. */
  outrosPacientes?: string[]
  /** Reprogramação (REP-): título e conteúdo são outros. */
  reprogramacao?: boolean
  /** "Hoje" para datas no futuro (testes fixam). */
  hoje?: string
}

/** Linha de sp_pep_documentos que a tela lê (sem o texto). */
export type DocumentoPep = {
  sp_id: string
  e_tag: string | null
  sha256: string | null
  extensao: string | null
  tamanho: number | null
  paginas: number | null
  caracteres: number | null
  extracao_status: ExtracaoStatus
  extracao_detalhe: string | null
  extraido_em: string
  analise_status: 'pendente' | 'concluida' | 'erro'
  analise_erro: string | null
  analisado_em: string | null
  achados: Achado[]
  ia_status: 'nao_se_aplica' | 'pendente' | 'concluida' | 'erro'
  ia_achados: Achado[]
  ia_resumo: string | null
  ia_erro: string | null
  ia_modelo: string | null
  ia_regua: string | null
  veredito: Veredito | null
  revisao_status: RevisaoStatus
  revisao_obs: string | null
  revisao_por_nome: string | null
  revisao_em: string | null
  historico: { em: string; por: string | null; acao: string; obs?: string | null }[]
}

export type RelacaoSemelhanca =
  | 'outro_paciente' | 'mesmo_paciente_outro_mes' | 'mesmo_mes' | 'outro_mes' | 'outro_prestador' | 'outro_item'

/** Linha de sp_pep_documentos_semelhancas (a_sp_id < b_sp_id). */
export type SemelhancaPep = {
  a_sp_id: string
  b_sp_id: string
  tipo: 'identico' | 'parecido'
  similaridade: number
  relacao: RelacaoSemelhanca
  nivel: Nivel
  revisao_status: 'pendente' | 'problema_confirmado' | 'falso_positivo'
  revisao_obs: string | null
  revisao_por_nome: string | null
  revisao_em: string | null
  detectado_em: string
}
