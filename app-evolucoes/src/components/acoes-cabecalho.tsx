import { View } from 'react-native';

import { BotaoSair } from '@/components/botao-sair';
import { BotaoTema } from '@/components/botao-tema';
import { Spacing } from '@/constants/theme';

/** Canto direito do cabeçalho das áreas logadas: tema e sair. */
export function AcoesCabecalho() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <BotaoTema />
      <BotaoSair />
    </View>
  );
}
