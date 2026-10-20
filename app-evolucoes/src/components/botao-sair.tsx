import { Pressable } from 'react-native';

import { Icone } from '@/components/icone';
import { Spacing } from '@/constants/theme';
import { useSessao } from '@/providers/session-provider';

/** "Sair" no cabeçalho das áreas logadas: só o ícone, com o nome para leitor de tela. */
export function BotaoSair() {
  const { sair } = useSessao();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sair da conta"
      hitSlop={12}
      onPress={sair}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: Spacing.one })}>
      <Icone nome="sair" tamanho={20} cor="textSecondary" />
    </Pressable>
  );
}
