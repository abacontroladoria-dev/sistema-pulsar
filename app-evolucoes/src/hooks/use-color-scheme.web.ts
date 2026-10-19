import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const semAssinatura = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * `useSyncExternalStore` returns the server snapshot (false) during hydration and true after it.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    semAssinatura,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
