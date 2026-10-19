import { StyleSheet, View } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AvisoProps = {
  /** erro: o que deu errado (anunciado ao leitor de tela) · info: contexto da tela. */
  tom: 'erro' | 'info';
  texto: string;
  icone?: NomeIcone;
};

/** Faixa de aviso dentro do conteúdo: ícone + texto, no tom do recado. */
export function Aviso({ tom, texto, icone }: AvisoProps) {
  const theme = useTheme();
  const erro = tom === 'erro';
  return (
    <View
      accessibilityRole={erro ? 'alert' : undefined}
      accessibilityLiveRegion={erro ? 'polite' : undefined}
      style={[styles.aviso, { backgroundColor: erro ? theme.dangerSurface : theme.backgroundSelected }]}>
      <Icone nome={icone ?? (erro ? 'aviso' : 'cobertura')} tamanho={20} cor={erro ? 'danger' : 'accentIcon'} />
      <ThemedText type="small" selectable style={[styles.texto, erro && { color: theme.danger }]}>
        {texto}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  aviso: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.twoHalf,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    padding: Spacing.twoHalf,
  },
  texto: {
    flex: 1,
  },
});
