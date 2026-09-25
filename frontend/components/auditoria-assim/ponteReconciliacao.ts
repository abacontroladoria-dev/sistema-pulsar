import type { AlvoAnalise } from './types'

/**
 * A ponte de OUTRA rota para a Reconciliação, aberta na semana de um paciente.
 *
 * Dentro de /auditoria-assim a ponte é estado do Shell (ver `irParaAnalise`),
 * e não query string, para o nome do paciente não ir parar no histórico do
 * navegador. Vindo de fora — a Conferência de Guias — o Shell é outro
 * componente montado do zero e o estado não atravessa. `sessionStorage` mantém
 * a mesma promessa: nada de paciente na URL, e o pulo não sobrevive ao reload
 * (o dado é lido na montagem e apagado em seguida).
 */
const CHAVE = 'pulsar:alvo-reconciliacao'

export function gravarAlvoReconciliacao(alvo: AlvoAnalise): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(alvo))
  } catch {
    // Storage bloqueado: a Reconciliação abre na lista, como abriria de qualquer jeito.
  }
}

/**
 * Lê SEM apagar: o inicializador de `useState` pode rodar duas vezes (StrictMode)
 * e a segunda leitura não pode achar vazio. Quem lê chama
 * `descartarAlvoReconciliacao` num efeito, depois de montado.
 */
export function lerAlvoReconciliacao(): AlvoAnalise | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    if (!bruto) return null
    const alvo = JSON.parse(bruto) as Partial<AlvoAnalise>
    if (typeof alvo?.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(alvo.data)) return null
    return {
      data: alvo.data,
      pacienteNome: typeof alvo.pacienteNome === 'string' ? alvo.pacienteNome : null,
      carteirinha: typeof alvo.carteirinha === 'string' ? alvo.carteirinha : null,
    }
  } catch {
    return null
  }
}

export function descartarAlvoReconciliacao(): void {
  try {
    sessionStorage.removeItem(CHAVE)
  } catch {
    // nada a limpar
  }
}
