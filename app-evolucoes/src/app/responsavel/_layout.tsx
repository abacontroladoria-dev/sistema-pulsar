import { Stack } from 'expo-router/stack';

import { AcoesCabecalho } from '@/components/acoes-cabecalho';
import { useOpcoesCabecalho } from '@/hooks/use-opcoes-cabecalho';

export default function ResponsavelLayout() {
  const cabecalho = useOpcoesCabecalho();
  return (
    <Stack screenOptions={{ ...cabecalho, headerLargeTitleEnabled: true }}>
      <Stack.Screen name="index" options={{ title: 'Agendamentos', headerRight: () => <AcoesCabecalho /> }} />
    </Stack>
  );
}
