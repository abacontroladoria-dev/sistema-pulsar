import * as SecureStore from 'expo-secure-store';

/**
 * Armazenamento da sessão do Supabase no Keychain (iOS) / Keystore (Android).
 *
 * A sessão (access token + refresh token + usuário) passa de 2 KB, e o Keychain
 * de algumas versões do iOS recusa valores acima disso. Por isso o valor é
 * fatiado em pedaços: `<chave>.n` guarda quantos são e `<chave>.0..n-1` os pedaços.
 * 1024 caracteres por pedaço ficam abaixo de 2 KB mesmo com acento (2 bytes em UTF-8).
 */
const TAMANHO_PEDACO = 1024;

const chaveContagem = (chave: string) => `${chave}.n`;
const chavePedaco = (chave: string, i: number) => `${chave}.${i}`;

async function lerContagem(chave: string): Promise<number> {
  const bruto = await SecureStore.getItemAsync(chaveContagem(chave));
  const n = bruto ? Number.parseInt(bruto, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function apagarPedacos(chave: string, aPartirDe: number, ate: number) {
  for (let i = aPartirDe; i < ate; i++) {
    await SecureStore.deleteItemAsync(chavePedaco(chave, i));
  }
}

export const secureStorage = {
  async getItem(chave: string): Promise<string | null> {
    const n = await lerContagem(chave);
    if (n === 0) return null;

    const pedacos: string[] = [];
    for (let i = 0; i < n; i++) {
      const pedaco = await SecureStore.getItemAsync(chavePedaco(chave, i));
      // Pedaço faltando = gravação interrompida no meio; a sessão não é confiável.
      if (pedaco === null) return null;
      pedacos.push(pedaco);
    }
    return pedacos.join('');
  },

  async setItem(chave: string, valor: string): Promise<void> {
    const anterior = await lerContagem(chave);
    const n = Math.max(1, Math.ceil(valor.length / TAMANHO_PEDACO));

    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(
        chavePedaco(chave, i),
        valor.slice(i * TAMANHO_PEDACO, (i + 1) * TAMANHO_PEDACO),
      );
    }
    // Se o app morrer no meio da gravação, o texto remontado vira JSON inválido e o
    // supabase-js o trata como "sem sessão": a pessoa entra de novo, nada pior.
    await SecureStore.setItemAsync(chaveContagem(chave), String(n));
    await apagarPedacos(chave, n, anterior);
  },

  async removeItem(chave: string): Promise<void> {
    const n = await lerContagem(chave);
    await SecureStore.deleteItemAsync(chaveContagem(chave));
    await apagarPedacos(chave, 0, n);
  },
};
