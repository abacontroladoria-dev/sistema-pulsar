import { Pressable } from 'react-native';

import { Icone } from '@/components/icone';
import { Spacing, Toque } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { escolherTema } from '@/lib/preferencia-tema';

/**
 * Troca entre claro e escuro. O ícone mostra o tema para onde vai (lua no
 * claro, sol no escuro). A escolha fica gravada no aparelho; antes de tocar,
 * o app segue o tema do celular.
 */
export function BotaoTema() {
  const escuro = useColorScheme() === 'dark';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      hitSlop={8}
      onPress={() => escolherTema(escuro ? 'light' : 'dark')}
      style={({ pressed }) => ({
        minWidth: Toque.minimo - Spacing.two,
        minHeight: Toque.minimo - Spacing.two,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}>
      <Icone nome={escuro ? 'temaClaro' : 'temaEscuro'} tamanho={20} cor="textSecondary" />
    </Pressable>
  );
}
