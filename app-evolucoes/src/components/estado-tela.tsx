import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type EstadoTelaProps = {
  titulo?: string;
  mensagem?: string;
  carregando?: boolean;
  /** Botões de ação (tentar de novo, sair...). */
  acoes?: ReactNode;
};

/** Tela inteira de carregando / erro / vazio, centralizada. */
export function EstadoTela({ titulo, mensagem, carregando, acoes }: EstadoTelaProps) {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.conteudo}>
        {carregando && <ActivityIndicator size="large" />}
        {titulo && (
          <ThemedText type="subtitle" style={styles.centro}>
            {titulo}
          </ThemedText>
        )}
        {mensagem && (
          <ThemedText themeColor="textSecondary" style={styles.centro}>
            {mensagem}
          </ThemedText>
        )}
        {acoes && <View style={styles.acoes}>{acoes}</View>}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignItems: 'center',
    gap: Spacing.three,
  },
  centro: {
    textAlign: 'center',
  },
  acoes: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
});
