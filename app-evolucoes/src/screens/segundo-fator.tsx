import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useSessao } from '@/providers/session-provider';
import { mensagemErroAuth } from '@/utils/mensagem-erro-auth';
import { fatorTotp } from '@/utils/segundo-fator';

const TAMANHO_CODIGO = 6;

/**
 * Código do app autenticador, depois da senha — o mesmo segundo fator do Pulsar
 * web. Ao confirmar, a sessão sobe para aal2 (evento MFA_CHALLENGE_VERIFIED) e
 * as rotas protegidas do _layout levam à área da pessoa.
 */
export function SegundoFator() {
  const theme = useTheme();
  const { session, sair } = useSessao();
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const verificar = async (valor = codigo) => {
    if (verificando || valor.length !== TAMANHO_CODIGO) return;
    const fator = session ? fatorTotp(session) : undefined;
    if (!fator) return;
    setErro(null);
    setVerificando(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: valor });
    setVerificando(false);
    if (error) {
      setErro(mensagemErroAuth(error));
      setCodigo('');
    }
  };

  const aoDigitar = (texto: string) => {
    const digitos = texto.replace(/\D/g, '').slice(0, TAMANHO_CODIGO);
    setCodigo(digitos);
    if (digitos.length === TAMANHO_CODIGO) void verificar(digitos);
  };

  return (
    <ThemedView style={styles.tela}>
      <SafeAreaView style={styles.tela}>
        <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.rolagem} keyboardShouldPersistTaps="handled">
            <View style={styles.conteudo}>
              <ThemedText type="subtitle">Código de segurança</ThemedText>
              <ThemedText themeColor="textSecondary">
                Sua conta usa app autenticador. Digite o código de {TAMANHO_CODIGO} dígitos que aparece nele agora.
              </ThemedText>

              <CampoTexto
                rotulo="Código do app autenticador"
                value={codigo}
                onChangeText={aoDigitar}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={TAMANHO_CODIGO}
                autoFocus
                style={styles.codigo}
              />

              <Botao
                titulo="Confirmar"
                carregando={verificando}
                disabled={codigo.length !== TAMANHO_CODIGO}
                onPress={() => verificar()}
              />
              <Botao titulo="Usar outra conta" variante="texto" onPress={sair} />

              {erro && (
                <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
                  {erro}
                </ThemedText>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  rolagem: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  codigo: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
});
