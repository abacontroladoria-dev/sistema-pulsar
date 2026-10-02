import type { RoboExecucao } from '@/types/roboSharepoint'

/**
 * As execuções que as telas do robô usam como referência, a partir da lista
 * (mais recente primeiro). Um lugar só para o painel do robô e a tela PEP.
 */
export function execucoesDeReferencia(execucoes: RoboExecucao[]) {
  const ultima = execucoes[0] ?? null
  return {
    ultima,
    executando: ultima?.status === 'executando',
    ultimaConcluida: execucoes.find(e => e.status !== 'executando') ?? null,
    // A "situação de agora" do reconhecimento é a da última execução que gravou (não simulada).
    idUltimaGravada: execucoes.find(e => e.status === 'concluido' && e.modo !== 'simulacao')?.id ?? null,
    // Última leitura do site inteiro já registrada arquivo por arquivo (robô 0.2+).
    ultimaCompleta: execucoes.find(e => e.status === 'concluido'
      && (e.etapas.find(x => x.etapa === 'listar')?.detalhe as { leitura?: string } | null)?.leitura === 'completa'
      && !/^0\.[01]\./.test(e.versao ?? '0.0.')) ?? null,
  }
}

/**
 * "O que está na pasta agora" (migration 20261003100000): no lugar do id de
 * uma execução, as leituras do painel recebem este marcador e passam a ler o
 * estado atual (sp_pep_arquivos) em vez do registro daquela execução.
 */
export const ESTADO_ATUAL = 'estado-atual'

export const ehEstadoAtual = (execucaoId: string | null | undefined) => execucaoId === ESTADO_ATUAL

/**
 * Uma "execução" de mentira que representa o estado atual, para o detalhe
 * "O que o robô leu" abrir com os mesmos componentes. Data e quem pediu vêm
 * da última leitura que gravou (é dela o retrato).
 */
export function execucaoEstadoAtual(base: RoboExecucao | null, pastas: number): RoboExecucao {
  return {
    id: ESTADO_ATUAL,
    maquina_id: base?.maquina_id ?? '',
    gatilho: base?.gatilho ?? 'agenda',
    modo: 'producao',
    status: 'concluido',
    etapa_atual: null,
    etapas: [{ etapa: 'listar', status: 'concluida', detalhe: { leitura: 'atual', pastas } }],
    resumo: {},
    metricas: {},
    erro: null,
    versao: base?.versao ?? null,
    certificado: null,
    solicitado_por_nome: null,
    iniciado_em: base?.concluido_em ?? base?.iniciado_em ?? new Date().toISOString(),
    concluido_em: base?.concluido_em ?? null,
    duracao_ms: null,
  }
}
