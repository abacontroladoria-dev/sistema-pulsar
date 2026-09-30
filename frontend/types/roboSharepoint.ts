// Tabelas sp_pep_* (migration 20261001120000_robo_pep_sharepoint.sql).

export type RoboEtapaNome = 'autenticar' | 'listar' | 'classificar' | 'planilhas' | 'enviar'

export type RoboEtapa = {
  etapa: RoboEtapaNome
  status: 'executando' | 'concluida' | 'erro'
  inicio?: string
  duracao_ms?: number | null
  detalhe?: Record<string, unknown> | null
}

export type RoboExecucao = {
  id: string
  maquina_id: string
  gatilho: 'agenda' | 'manual' | 'demo' | 'inventario'
  modo: 'producao' | 'homologacao' | 'simulacao'
  status: 'executando' | 'concluido' | 'erro'
  etapa_atual: RoboEtapaNome | null
  etapas: RoboEtapa[]
  resumo: {
    sugeridos?: number
    nao_reconhecidos?: number
    confirmados?: number
    novos?: number
    removidos?: number
    ms_banco?: number
    prestadores_total?: number
    prestadores_reconhecidos?: number
    pacientes_total?: number
    pacientes_reconhecidos?: number
    motivos?: Record<string, number>
  }
  metricas: {
    duracao_ms?: number
    chamadas_graph?: number
    bytes_graph?: number
    chamadas_banco?: number
    ms_banco?: number | null
    ms_rede_banco?: number
    ms_maior_chamada_banco?: number
    esperas_graph?: number
  }
  erro: string | null
  versao: string | null
  certificado: { assunto?: string; diasRestantes?: number; validoAte?: string } | null
  solicitado_por_nome: string | null
  iniciado_em: string
  concluido_em: string | null
  duracao_ms: number | null
}

export type SpItemStatus = 'sugerido' | 'nao_reconhecido' | 'confirmado' | 'ignorado' | 'removido'

export type SpItem = {
  sp_id: string
  nome: string
  caminho: string | null
  web_url: string | null
  criado_em_sp: string | null
  criado_por: string | null
  tipo: 'evidencia' | 'fora_padrao'
  prestador_pasta_id: string | null
  paciente_pasta_id: string | null
  sigla: string | null
  item_id: string | null
  competencia: string | null
  competencia_fonte: 'nome' | 'envio' | null
  prestador_nome: string | null
  paciente_nome: string | null
  paciente_cpf: string | null
  status: SpItemStatus
  motivo: string | null
  sinais: Record<string, boolean | null>
  removido_em: string | null
  resolvido_por_nome: string | null
  resolvido_em: string | null
  registro_entrega_id: string | null
}

export type SpPendenciaPasta = {
  pasta_id: string
  tipo: 'prestador' | 'paciente'
  nome_pasta: string
  prestador_pasta_nome: string | null
  motivo: string | null
  arquivos: number
}

// ── "O que o robô leu" (migration 20261001130000) ────────────────────────────

export type TipoArquivoLido = 'evidencia' | 'planilha' | 'ignorado' | 'fora_padrao' | 'removido'

export type DetalhePlanilha =
  | {
      usada: true
      ilegivel?: boolean
      razao_social?: string | null
      cnpj_valido?: boolean
      cnpj_informado?: boolean
      pacientes?: { nome: string; cpfValido: boolean; cpfInformado?: boolean }[]
      planejamento_linhas?: number
      /** Linhas da aba Planejamento (robô 0.3+), sem CPF. */
      planejamento?: { paciente: string; documento: string | null; sigla: string | null; competencia: string | null }[]
      avisos?: string[]
    }
  | { usada: false; motivo: string }

export type ArquivoLido = {
  execucao_id: string
  sp_id: string
  nome: string
  caminho: string | null
  web_url: string | null
  tipo: TipoArquivoLido
  motivo: string | null
  sigla: string | null
  prestador_pasta_id: string | null
  paciente_pasta_id: string | null
  tamanho: number | null
  criado_em_sp: string | null
  criado_por: string | null
  competencia: string | null
  detalhe: DetalhePlanilha | null
}

export type ResumoPrestadorLido = {
  pasta_id: string
  nome: string
  arquivos: number
  evidencias: number
  planilhas: number
  ignorados: number
  pastas_paciente: number
  tem_planilha: boolean
}

export type ResumoExecucao = {
  registrado: boolean
  total: number
  por_tipo: Partial<Record<TipoArquivoLido, number>>
  por_sigla: Record<string, number>
  motivos: { tipo: 'ignorado' | 'fora_padrao'; motivo: string; n: number }[]
  sem_prestador: number
  prestadores: ResumoPrestadorLido[]
  pastas: { total: number; prestadores: number; pacientes: number }
}

export type SituacaoReconhecimento = {
  prestadores: {
    pasta_id: string
    nome_pasta: string
    prestador_nome: string | null
    status: 'reconhecido' | 'nao_reconhecido'
    motivo: string | null
    sinais: Record<string, boolean | number | null>
    planilha_nome: string | null
    planilha_web_url: string | null
  }[]
  pacientes: {
    pasta_id: string
    prestador_pasta_id: string | null
    nome_pasta: string
    paciente_nome: string | null
    status: 'reconhecido' | 'nao_reconhecido'
    motivo: string | null
    origem: 'cadastro' | 'agenda' | 'manual' | null
    sinais: { na_planilha?: boolean; cpf_valido?: boolean; no_cadastro?: boolean; nome_compativel?: boolean }
    arquivos: number
  }[]
  sugestoes: {
    sp_id: string
    nome: string
    web_url: string | null
    sigla: string | null
    paciente_nome: string | null
    prestador_nome: string | null
    competencia: string | null
    criado_em_sp: string | null
  }[]
  itens_por_status: Partial<Record<SpItemStatus, number>>
  itens_motivos: { motivo: string; n: number }[]
}

// ── Itens visuais (migration 20261001140000) ─────────────────────────────────

/** Linha de vw_sp_pep_arquivos_lidos: o arquivo lido + a situação dele no Pulsar. */
export type ArquivoLidoCompleto = ArquivoLido & {
  modificado_em_sp: string | null
  situacao: SpItemStatus | null
  motivo_pulsar: string | null
  paciente_nome: string | null
  prestador_nome: string | null
  competencia_pulsar: string | null
  sinais: Record<string, boolean | null> | null
  resolvido_por_nome: string | null
  resolvido_em: string | null
  visto_primeiro_em: string | null
  novo: boolean | null
}

export type NoPasta = {
  id: string
  nome: string
  papel: 'prestador' | 'paciente' | null
  web_url: string | null
  criado_em_sp: string | null
  subpastas: number
  arquivos: number
  evidencias: number
}

export type ArvorePastas = {
  pastas: NoPasta[]
  arquivos: Pick<ArquivoLido, 'sp_id' | 'nome' | 'web_url' | 'tipo' | 'motivo' | 'sigla' | 'criado_em_sp' | 'criado_por'>[]
}

export type MatrizEvidencias = {
  prestadores: { pasta_id: string; nome: string; web_url: string | null; prestador_nome: string | null; status: string | null }[]
  pacientes: { pasta_id: string; prestador_pasta_id: string; nome: string; web_url: string | null; paciente_nome: string | null; status: string; motivo: string | null }[]
  celulas: { prestador_pasta_id: string | null; paciente_pasta_id: string | null; sigla: string; situacao: SpItemStatus; n: number }[]
}

export type PacienteDetalhe = {
  prestador_pasta_id: string | null
  prestador_nome_pasta: string | null
  nome: string
  na_planilha: boolean
  cpf_valido: boolean | null
  cpf_informado: boolean | null
  pasta_id: string | null
  nome_pasta: string | null
  web_url: string | null
  paciente_nome: string | null
  status: 'reconhecido' | 'nao_reconhecido'
  motivo: string | null
  origem: 'cadastro' | 'agenda' | 'manual' | null
  sinais: { na_planilha?: boolean; cpf_valido?: boolean; no_cadastro?: boolean; nome_compativel?: boolean } | null
  arquivos_por_sigla: Record<string, number>
  planejamento: { sigla: string | null; competencia: string | null }[]
}

export type RoboSaude = {
  configurado: boolean
  online?: boolean
  executando?: boolean
  proxima?: string | null
  modo?: 'producao' | 'homologacao'
  erro_fatal?: string | null
  certificado_dias_restantes?: number | null
  versao?: string
}
