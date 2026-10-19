import { ScrollView, StyleSheet, View } from 'react-native';

import { Cartao } from '@/components/cartao';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSessao } from '@/providers/session-provider';

type AreaEmConstrucaoProps = {
  mensagem: string;
};

/** Conteúdo provisório das áreas enquanto as RPCs do app não existem no banco. */
export function AreaEmConstrucao({ mensagem }: AreaEmConstrucaoProps) {
  const { perfil } = useSessao();
  return (
    <ThemedView style={styles.tela}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.rolagem}>
        <View style={styles.conteudo}>
          {perfil?.nome ? <ThemedText type="heading">Olá, {perfil.nome}</ThemedText> : null}
          <Cartao>
            <ThemedText type="small" themeColor="textSecondary">
              {mensagem}
            </ThemedText>
          </Cartao>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  rolagem: {
    padding: Spacing.three,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
});
