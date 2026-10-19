import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type BotaoProps = Omit<PressableProps, 'children'> & {
  titulo: string;
  variante?: 'primario' | 'secundario' | 'texto';
  carregando?: boolean;
};

export function Botao({ titulo, variante = 'primario', carregando, disabled, style, ...rest }: BotaoProps) {
  const theme = useTheme();
  const inativo = disabled || carregando;

  const fundo =
    variante === 'primario' ? theme.accent : variante === 'secundario' ? theme.backgroundElement : 'transparent';
  const corTexto = variante === 'primario' ? theme.onAccent : variante === 'texto' ? theme.accent : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inativo, busy: !!carregando }}
      disabled={inativo}
      style={(estado) => [
        styles.base,
        { backgroundColor: fundo, opacity: inativo ? 0.5 : estado.pressed ? 0.8 : 1 },
        typeof style === 'function' ? style(estado) : style,
      ]}
      {...rest}>
      {carregando ? (
        <ActivityIndicator color={corTexto} />
      ) : (
        <ThemedText type="smallBold" style={{ color: corTexto }}>
          {titulo}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
