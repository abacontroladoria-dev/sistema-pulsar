import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonte, Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  /**
   * title: tela sem cabeçalho (login) · subtitle: nome em destaque (paciente) ·
   * heading: título de bloco · default: texto corrido · small / smallBold: linhas
   * de cartão e rótulos · label: selo · caption: carimbo de autoria · code: códigos.
   */
  type?: 'default' | 'title' | 'subtitle' | 'heading' | 'small' | 'smallBold' | 'label' | 'caption' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const corPadrao = type === 'caption' ? 'textMuted' : 'text';

  return <Text style={[{ color: theme[themeColor ?? corPadrao] }, styles[type], style]} {...rest} />;
}

// Peso pela família (um arquivo por peso), sem fontWeight: senão o Android
// sintetiza o negrito ou cai na fonte do sistema.
const styles = StyleSheet.create({
  title: {
    fontFamily: Fonte.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: Fonte.semibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  heading: {
    fontFamily: Fonte.semibold,
    fontSize: 17,
    lineHeight: 22,
  },
  default: {
    fontFamily: Fonte.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: Fonte.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  smallBold: {
    fontFamily: Fonte.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily: Fonte.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  caption: {
    fontFamily: Fonte.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
