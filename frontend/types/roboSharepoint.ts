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
