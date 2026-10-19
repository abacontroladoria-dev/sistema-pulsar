import { Stack } from 'expo-router/stack';

import { BotaoSair } from '@/components/botao-sair';
import { useSessao } from '@/providers/session-provider';

export default function AgendaLayout() {
  const { perfil } = useSessao();
  const titulo = perfil?.tipo === 'gestao' ? 'Agendas' : 'Minha agenda';

  return (
    <Stack screenOptions={{ headerLargeTitleEnabled: true, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: titulo, headerRight: () => <BotaoSair /> }} />
    </Stack>
  );
}
