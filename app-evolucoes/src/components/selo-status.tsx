import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { COR_STATUS, type InfoStatus } from '@/utils/status-sessao';

/** Selo de status da sessão, nas cores da Grade web. */
export function SeloStatus({ status }: { status: InfoStatus }) {
  const cor = COR_STATUS[status.codigo];
  return (
    <View style={[styles.selo, { backgroundColor: `${cor}1A`, borderColor: cor }]}>
      <View style={[styles.ponto, { backgroundColor: cor }]} />
      <ThemedText type="smallBold" style={{ color: cor }}>
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
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  ponto: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
