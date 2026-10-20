import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { usePreferenciaTema } from '@/lib/preferencia-tema';

const semAssinatura = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * `useSyncExternalStore` returns the server snapshot (false) during hydration and true after it.
 * Depois disso vale o tema escolhido no app; sem escolha, o do navegador.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    semAssinatura,
    () => true,
    () => false,
  );
  const preferencia = usePreferenciaTema();
  const colorScheme = useRNColorScheme();

  if (!hasHydrated) return 'light';
  return preferencia === 'auto' ? colorScheme : preferencia;
}
