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
