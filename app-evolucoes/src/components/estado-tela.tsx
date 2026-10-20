import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type EstadoTelaProps = {
  titulo?: string;
  mensagem?: string;
  carregando?: boolean;
  /** Ícone acima do título (ex.: "aviso" num erro, "agenda" num vazio). */
  icone?: NomeIcone;
  /** Botões de ação (tentar de novo, sair...). */
  acoes?: ReactNode;
};

/** Tela inteira de carregando / erro / vazio, centralizada. */
export function EstadoTela({ titulo, mensagem, carregando, icone, acoes }: EstadoTelaProps) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.container}>
      <View style={styles.conteudo}>
        {carregando && <ActivityIndicator size="large" color={theme.accentIcon} />}
        {icone && (
          <View style={[styles.selo, { backgroundColor: theme.backgroundSelected }]}>
            <Icone nome={icone} tamanho={24} />
          </View>
        )}
        {titulo && (
          <ThemedText type="heading" style={styles.centro}>
            {titulo}
          </ThemedText>
        )}
        {mensagem && (
          <ThemedText themeColor="textSecondary" style={styles.centro} selectable>
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
    gap: Spacing.twoHalf,
  },
  selo: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centro: {
    textAlign: 'center',
  },
  acoes: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
});
