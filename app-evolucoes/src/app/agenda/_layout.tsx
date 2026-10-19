import { Stack } from 'expo-router/stack';

import { BotaoSair } from '@/components/botao-sair';
import { useSessao } from '@/providers/session-provider';

export default function AgendaLayout() {
  const { perfil } = useSessao();
  const titulo = perfil?.tipo === 'gestao' ? 'Agendas' : 'Minha agenda';

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen
        name="index"
        options={{ title: titulo, headerLargeTitleEnabled: true, headerRight: () => <BotaoSair /> }}
      />
      <Stack.Screen name="sessao/[id]" options={{ title: 'Sessão' }} />
      <Stack.Screen
        name="escolher-profissional"
        options={{ title: 'Escolher profissional', presentation: 'modal' }}
      />
    </Stack>
  );
}
