import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CartaoProps = Omit<PressableProps, 'children' | 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * O cartão do Pulsar: branco sobre o fundo azulado, contorno fino e a sombra
 * mínima. Com `onPress` (ou dentro de `<Link asChild>`) vira tocável.
 */
export function Cartao({ children, style, onPress, ...rest }: CartaoProps) {
  const theme = useTheme();
  const base = [styles.cartao, { backgroundColor: theme.surface, borderColor: theme.border }];

  if (!onPress) {
    return <View style={[base, style]}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: theme.backgroundSelected }, style]}
      {...rest}>
      {children}
    </Pressable>
  );
}

/** Linha divisória interna (zona de identidade × zona de ação). */
export function DivisorCartao() {
  const theme = useTheme();
  return <View style={[styles.divisor, { backgroundColor: theme.divider }]} />;
}

const styles = StyleSheet.create({
  cartao: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    boxShadow: Shadow.card,
    padding: Spacing.three,
    gap: Spacing.twoHalf,
  },
  divisor: {
    height: 1,
    marginHorizontal: -Spacing.three,
  },
});
