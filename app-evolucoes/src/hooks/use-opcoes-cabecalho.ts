import { Fonte } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Cabeçalho padrão das pilhas: Geist, sem sombra, voltar em azul-petróleo. */
export function useOpcoesCabecalho() {
  const theme = useTheme();
  return {
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerTintColor: theme.accent,
    headerStyle: { backgroundColor: theme.background },
    headerTitleStyle: { fontFamily: Fonte.semibold, color: theme.text },
    headerLargeTitleStyle: { fontFamily: Fonte.bold, color: theme.text },
    contentStyle: { backgroundColor: theme.background },
  } as const;
}
