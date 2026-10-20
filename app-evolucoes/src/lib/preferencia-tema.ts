import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { gravarPreferencia, lerPreferencia } from '@/lib/armazenamento-simples';

/** 'auto' segue o celular; 'light'/'dark' é a escolha da pessoa no app. */
export type PreferenciaTema = 'auto' | 'light' | 'dark';

const CHAVE = 'pulsar.tema';
const ouvintes = new Set<() => void>();

function lerGuardada(): PreferenciaTema {
  const v = lerPreferencia(CHAVE);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

let atual: PreferenciaTema = lerGuardada();

/**
 * Também avisa o sistema (teclado, alertas, barra de status, puxar-para-atualizar
 * seguem o tema). Na web o Appearance não tem setColorScheme: só o app muda.
 */
function aplicarNoSistema(p: PreferenciaTema) {
  try {
    Appearance.setColorScheme?.(p === 'auto' ? 'unspecified' : p);
  } catch {
    // Sem o módulo nativo: o app muda do mesmo jeito.
  }
}
aplicarNoSistema(atual);

export function escolherTema(p: PreferenciaTema) {
  atual = p;
  gravarPreferencia(CHAVE, p === 'auto' ? null : p);
  aplicarNoSistema(p);
  ouvintes.forEach((o) => o());
}

export function usePreferenciaTema(): PreferenciaTema {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => atual,
    () => 'auto',
  );
}
