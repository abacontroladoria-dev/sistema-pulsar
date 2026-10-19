import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { COR_STATUS, SELO_STATUS, type InfoStatus } from '@/utils/status-sessao';

/** Selo de status da sessão: as cores da Grade web, com o texto sempre escrito. */
export function SeloStatus({ status }: { status: InfoStatus }) {
  const escuro = useColorScheme() === 'dark';
  const { fundo, texto } = SELO_STATUS[status.codigo][escuro ? 'escuro' : 'claro'];
  return (
    <View style={[styles.selo, { backgroundColor: fundo }]}>
      <View style={[styles.ponto, { backgroundColor: COR_STATUS[status.codigo] }]} />
      <ThemedText type="label" style={{ color: texto }} numberOfLines={1}>
        {status.rotulo}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  selo: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    gap: Spacing.one + Spacing.half,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.twoHalf - Spacing.half,
    paddingVertical: Spacing.one,
  },
  ponto: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },
});
