import { useSyncExternalStore } from 'react'

// ============================================================================
// Quem está com o Pulsar aberto agora — a bolinha verde do Chat da equipe.
//
// O provider (ChatEquipeContext) entra no canal de presença do Realtime e
// escreve aqui; quem desenha lê com useOnline(). Fora do contexto de React de
// propósito: a presença muda a todo instante e não deve redesenhar os sidebars,
// que só querem o número de não lidas.
// ============================================================================

let online: ReadonlySet<string> = new Set()
const ouvintes = new Set<() => void>()

export function definirOnline(ids: Iterable<string>): void {
  const novo = new Set(ids)
  if (novo.size === online.size && [...novo].every(id => online.has(id))) return
  online = novo
  ouvintes.forEach(f => f())
}

function assinar(f: () => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

const VAZIO: ReadonlySet<string> = new Set()

export function useOnline(): ReadonlySet<string> {
  return useSyncExternalStore(assinar, () => online, () => VAZIO)
}
