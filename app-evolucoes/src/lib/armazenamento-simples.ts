import * as SecureStore from 'expo-secure-store';

/**
 * Preferências pequenas do aparelho (não são segredo), lidas na hora da
 * renderização — por isso a versão síncrona do SecureStore. Falha de leitura
 * vira "sem preferência".
 */
export function lerPreferencia(chave: string): string | null {
  try {
    return SecureStore.getItem(chave);
  } catch {
    return null;
  }
}

export function gravarPreferencia(chave: string, valor: string | null) {
  try {
    if (valor === null) void SecureStore.deleteItemAsync(chave);
    else SecureStore.setItem(chave, valor);
  } catch {
    // Sem gravar: a escolha vale só até fechar o app.
  }
}
