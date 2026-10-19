import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useSessao } from '@/providers/session-provider';

/** "Sair" no cabeçalho das áreas logadas. */
export function BotaoSair() {
  const { sair } = useSessao();
  return (
    <Pressable accessibilityRole="button" hitSlop={12} onPress={sair}>
      <ThemedText type="small" themeColor="textSecondary">
        Sair
      </ThemedText>
    </Pressable>
  );
}
