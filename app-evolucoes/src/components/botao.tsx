import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Toque } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type BotaoProps = Omit<PressableProps, 'children'> & {
  titulo: string;
  /**
   * primario: a ação da tela (azul-petróleo cheio) · secundario: ação de apoio
   * (contorno, como o "brand outline" do Pulsar) · perigo: ação que desfaz ou
   * marca ausência · texto: link discreto.
   */
  variante?: 'primario' | 'secundario' | 'perigo' | 'texto';
  icone?: NomeIcone;
  carregando?: boolean;
};

export function Botao({ titulo, variante = 'primario', icone, carregando, disabled, style, ...rest }: BotaoProps) {
  const theme = useTheme();
  const inativo = disabled || carregando;

  const fundo = {
    primario: theme.accent,
    secundario: theme.surface,
    perigo: theme.dangerSurface,
    texto: 'transparent',
  }[variante];
  const corTexto = {
    primario: theme.onAccent,
    secundario: theme.accent,
    perigo: theme.danger,
    texto: theme.accent,
  }[variante];
  const borda = variante === 'secundario' ? theme.border : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={titulo}
      accessibilityState={{ disabled: !!inativo, busy: !!carregando }}
      disabled={inativo}
      style={(estado) => [
        styles.base,
        variante === 'texto' && styles.texto,
        { backgroundColor: fundo, borderColor: borda, opacity: inativo ? 0.5 : estado.pressed ? 0.75 : 1 },
        typeof style === 'function' ? style(estado) : style,
      ]}
      {...rest}>
      {carregando ? (
        <ActivityIndicator color={corTexto} />
      ) : (
        <View style={styles.conteudo}>
          {icone && <Icone nome={icone} tamanho={20} corLivre={corTexto} />}
          <ThemedText type="smallBold" style={[styles.rotulo, { color: corTexto }]} numberOfLines={1}>
            {titulo}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Toque.botao,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: {
    minHeight: Toque.minimo,
    paddingHorizontal: Spacing.two,
  },
  conteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rotulo: {
    fontSize: 15,
  },
});
