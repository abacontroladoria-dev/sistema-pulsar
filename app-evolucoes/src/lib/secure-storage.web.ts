/**
 * Na web não existe Keychain/Keystore (expo-secure-store não roda no navegador).
 * A web aqui é só para desenvolvimento; o app publicado é Android e iOS.
 * `localStorage` não existe na renderização do servidor, daí a checagem.
 */
const disponivel = () => typeof window !== 'undefined' && !!window.localStorage;

export const secureStorage = {
  async getItem(chave: string): Promise<string | null> {
    return disponivel() ? window.localStorage.getItem(chave) : null;
  },
  async setItem(chave: string, valor: string): Promise<void> {
    if (disponivel()) window.localStorage.setItem(chave, valor);
  },
  async removeItem(chave: string): Promise<void> {
    if (disponivel()) window.localStorage.removeItem(chave);
  },
};
