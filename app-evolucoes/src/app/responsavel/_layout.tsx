import { Stack } from 'expo-router/stack';

import { BotaoSair } from '@/components/botao-sair';

export default function ResponsavelLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: 'Agendamentos', headerRight: () => <BotaoSair /> }} />
    </Stack>
  );
}
