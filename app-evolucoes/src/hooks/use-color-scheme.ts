import { useColorScheme as useRNColorScheme } from 'react-native';

import { usePreferenciaTema } from '@/lib/preferencia-tema';

/** O tema em uso: o escolhido no app (botão de tema) ou, sem escolha, o do celular. */
export function useColorScheme() {
  const preferencia = usePreferenciaTema();
  const sistema = useRNColorScheme();
  return preferencia === 'auto' ? sistema : preferencia;
}
