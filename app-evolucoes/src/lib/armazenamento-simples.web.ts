/** Na web as preferências ficam no localStorage (pode estar bloqueado: vira "sem preferência"). */
export function lerPreferencia(chave: string): string | null {
  try {
    return globalThis.localStorage?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}

export function gravarPreferencia(chave: string, valor: string | null) {
  try {
    if (valor === null) globalThis.localStorage?.removeItem(chave);
    else globalThis.localStorage?.setItem(chave, valor);
  } catch {
    // Sem gravar: a escolha vale só até fechar a aba.
  }
}
