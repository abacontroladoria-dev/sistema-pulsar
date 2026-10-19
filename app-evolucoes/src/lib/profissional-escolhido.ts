import { useSyncExternalStore } from 'react';

import type { ProfissionalApp } from '@/lib/agenda';

/**
 * Profissional cuja agenda a gestão (admin, diretoria) está vendo. Vive só na
 * memória do app: a tela de escolha grava aqui e volta, a agenda lê.
 */
let atual: ProfissionalApp | null = null;
const ouvintes = new Set<() => void>();

export function escolherProfissional(p: ProfissionalApp | null) {
  atual = p;
  ouvintes.forEach((ouvir) => ouvir());
}

export function useProfissionalEscolhido(): ProfissionalApp | null {
  return useSyncExternalStore(
    (ouvir) => {
      ouvintes.add(ouvir);
      return () => ouvintes.delete(ouvir);
    },
    () => atual,
    () => atual,
  );
}
