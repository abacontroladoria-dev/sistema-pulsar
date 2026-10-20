import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icone, type NomeIcone } from '@/components/icone';
import { ThemedText } from '@/components/themed-text';
import { Fonte, Radius, Spacing, Toque } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CampoTextoProps = TextInputProps & {
  rotulo: string;
  /** Ícone à esquerda, dentro do campo. */
  icone?: NomeIcone;
};

/** Campo do Pulsar: fundo branco, contorno fino, anel azul-petróleo no foco. */
export function CampoTexto({ rotulo, icone, style, onFocus, onBlur, multiline, ...rest }: CampoTextoProps) {
  const theme = useTheme();
  const [focado, setFocado] = useState(false);

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary">
        {rotulo}
      </ThemedText>
      <View
        style={[
          styles.moldura,
          multiline && styles.molduraMultilinha,
          {
            backgroundColor: theme.surface,
            borderColor: focado ? theme.accentIcon : theme.border,
            boxShadow: focado ? `0 0 0 3px ${theme.backgroundSelected}` : undefined,
          },
        ]}>
        {icone && (
          <View style={multiline ? styles.iconeTopo : undefined}>
            <Icone nome={icone} tamanho={20} cor="textMuted" />
          </View>
        )}
        <TextInput
          accessibilityLabel={rotulo}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.accentIcon}
          cursorColor={theme.accent}
          multiline={multiline}
          onFocus={(e) => {
            setFocado(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocado(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.inputMultilinha, { color: theme.text }, style]}
          {...rest}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  moldura: {
    minHeight: Toque.botao,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.three,
  },
  molduraMultilinha: {
    alignItems: 'flex-start',
    paddingVertical: Spacing.twoHalf,
  },
  iconeTopo: {
    paddingTop: Spacing.half,
  },
  input: {
    flex: 1,
    minHeight: Toque.botao - 2,
    fontFamily: Fonte.regular,
    fontSize: 16,
  },
  inputMultilinha: {
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});
