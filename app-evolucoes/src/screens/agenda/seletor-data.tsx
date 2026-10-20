import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { StyleSheet } from 'react-native';

import { Botao } from '@/components/botao';
import { Cartao } from '@/components/cartao';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** Na web o seletor nativo não existe: lá a data só muda pelas setas. */
export const TEM_SELETOR_DATA = process.env.EXPO_OS !== 'web';

/** "AAAA-MM-DD" ↔ Date local ao meio-dia (longe da virada do dia em qualquer fuso). */
const paraDate = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d, 12);
};
const paraIso = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

type SeletorDataProps = {
  dia: string;
  onEscolher: (dia: string) => void;
  onFechar: () => void;
};

/**
 * Calendário para pular direto para uma data. Montar só enquanto estiver
 * aberto: no Android é a janela de calendário do sistema (abre ao montar); no
 * iOS, o calendário dentro da tela, com "Fechar".
 */
export function SeletorData({ dia, onEscolher, onFechar }: SeletorDataProps) {
  const theme = useTheme();
  const escuro = useColorScheme() === 'dark';
  const escolher = (dt: Date) => {
    onEscolher(paraIso(dt));
    onFechar();
  };

  if (process.env.EXPO_OS === 'android') {
    return (
      <DateTimePicker
        value={paraDate(dia)}
        mode="date"
        presentation="dialog"
        accentColor={theme.accent}
        positiveButton={{ label: 'Ir para a data' }}
        negativeButton={{ label: 'Cancelar' }}
        onValueChange={(_, dt) => escolher(dt)}
        onDismiss={onFechar}
      />
    );
  }

  return (
    <Cartao style={styles.cartao}>
      <DateTimePicker
        value={paraDate(dia)}
        mode="date"
        display="inline"
        locale="pt_BR"
        accentColor={theme.accent}
        themeVariant={escuro ? 'dark' : 'light'}
        onValueChange={(_, dt) => escolher(dt)}
      />
      <Botao titulo="Fechar" variante="texto" onPress={onFechar} />
    </Cartao>
  );
}

const styles = StyleSheet.create({
  cartao: {
    paddingVertical: 0,
  },
});
