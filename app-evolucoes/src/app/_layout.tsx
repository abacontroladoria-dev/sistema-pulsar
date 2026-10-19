import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { SessionProvider, useSessao } from '@/providers/session-provider';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, retry: 1 },
  },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootNavigator />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * Cada pessoa tem UM papel, decidido no banco. Terapeuta e gestão (admin,
 * diretoria) usam a área `agenda`; responsável usa a sua. Os guards deixam
 * disponível só a área do papel; ao entrar ou sair, o Stack cai em `index`,
 * que redireciona para a área certa.
 */
function RootNavigator() {
  const { session, perfil, pronto } = useSessao();

  useEffect(() => {
    // Splash só sai com sessão e perfil resolvidos: sem piscar a tela de login
    // para quem já estava logado.
    if (pronto) SplashScreen.hide();
  }, [pronto]);

  if (!pronto) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
        <Stack.Screen
          name="verificar-codigo"
          options={{ headerShown: true, title: 'Código de acesso', headerBackTitle: 'Voltar' }}
        />
      </Stack.Protected>

      <Stack.Protected guard={perfil?.tipo === 'terapeuta' || perfil?.tipo === 'gestao'}>
        <Stack.Screen name="agenda" />
      </Stack.Protected>

      <Stack.Protected guard={perfil?.tipo === 'responsavel'}>
        <Stack.Screen name="responsavel" />
      </Stack.Protected>
    </Stack>
  );
}
