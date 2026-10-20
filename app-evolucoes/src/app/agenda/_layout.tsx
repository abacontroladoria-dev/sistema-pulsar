import { Stack } from 'expo-router/stack';

import { AcoesCabecalho } from '@/components/acoes-cabecalho';
import { useOpcoesCabecalho } from '@/hooks/use-opcoes-cabecalho';
import { useSessao } from '@/providers/session-provider';

export default function AgendaLayout() {
  const { perfil } = useSessao();
  const cabecalho = useOpcoesCabecalho();
  const titulo = perfil?.tipo === 'gestao' ? 'Agendas' : 'Minha agenda';

  return (
    <Stack screenOptions={cabecalho}>
      <Stack.Screen
        name="index"
        options={{ title: titulo, headerLargeTitleEnabled: true, headerRight: () => <AcoesCabecalho /> }}
      />
      <Stack.Screen name="sessao/[id]" options={{ title: 'Sessão' }} />
      <Stack.Screen
        name="escolher-profissional"
        options={{ title: 'Escolher profissional', presentation: 'modal' }}
      />
    </Stack>
  );
}
