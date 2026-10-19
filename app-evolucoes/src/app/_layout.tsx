import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Colors, Fonte } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOpcoesCabecalho } from '@/hooks/use-opcoes-cabecalho';
import { SessionProvider, useSessao } from '@/providers/session-provider';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, retry: 1 },
  },
});

/** Cabeçalhos e fundo da navegação nas cores e na fonte do Pulsar. */
function temaNavegacao(escuro: boolean): Theme {
  const base = escuro ? DarkTheme : DefaultTheme;
  const c = Colors[escuro ? 'dark' : 'light'];
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.background,
      card: c.background,
      text: c.text,
      border: c.border,
    },
    fonts: {
      regular: { fontFamily: Fonte.regular, fontWeight: 'normal' },
      medium: { fontFamily: Fonte.medium, fontWeight: 'normal' },
      bold: { fontFamily: Fonte.semibold, fontWeight: 'normal' },
      heavy: { fontFamily: Fonte.bold, fontWeight: 'normal' },
    },
  };
}

export default function RootLayout() {
  const escuro = useColorScheme() === 'dark';
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={temaNavegacao(escuro)}>
          <StatusBar style={escuro ? 'light' : 'dark'} />
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
  const { session, segundoFatorPendente, perfil, pronto } = useSessao();
  const cabecalho = useOpcoesCabecalho();
  // Fonte que falha ao carregar não segura o app: cai na fonte do sistema.
  const [fontesProntas, erroFontes] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold });

  // Só a PRIMEIRA resolução segura o app no splash (sem piscar a tela de login
  // para quem já estava logado). Depois disso o Stack fica montado: no login
  // seguinte, enquanto o perfil chega, `index` mostra o carregando — desmontar o
  // Stack ali deixava a tela em branco e perdia a navegação.
  const [hidratado, setHidratado] = useState(false);
  if (pronto && (fontesProntas || erroFontes) && !hidratado) setHidratado(true);

  useEffect(() => {
    if (hidratado) SplashScreen.hide();
  }, [hidratado]);

  if (!hidratado) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
        <Stack.Screen
          name="verificar-codigo"
          options={{ ...cabecalho, headerShown: true, title: 'Código de acesso' }}
        />
      </Stack.Protected>

      <Stack.Protected guard={segundoFatorPendente}>
        <Stack.Screen name="segundo-fator" />
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
