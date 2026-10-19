import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** "Ana Paula Souza" → "AS". */
function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

/** Avatar do profissional, como no cartão do Pulsar: fundo azul claro e iniciais em azul-petróleo. */
export function Iniciais({ nome }: { nome: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="label" themeColor="accent">
        {iniciaisDe(nome)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
