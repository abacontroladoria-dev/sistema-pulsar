import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Aviso } from '@/components/aviso';
import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonte, MaxContentWidth, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { mensagemErroAuth } from '@/utils/mensagem-erro-auth';
import { formatarCelular } from '@/utils/telefone';

type VerificarCodigoProps = {
  telefone: string;
};

const TAMANHO_CODIGO = 6;

export function VerificarCodigo({ telefone }: VerificarCodigoProps) {
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const verificar = async (valor = codigo) => {
    if (verificando || valor.length !== TAMANHO_CODIGO) return;
    setErro(null);
    setVerificando(true);
    // O tipo é 'sms' mesmo quando o código foi por WhatsApp: é o tipo do fator (telefone).
    const { error } = await supabase.auth.verifyOtp({ phone: telefone, token: valor, type: 'sms' });
    setVerificando(false);
    // Sucesso não navega daqui: a sessão nova troca as rotas protegidas no _layout.
    if (error) setErro(mensagemErroAuth(error));
  };

  const reenviar = async () => {
    if (reenviando) return;
    setErro(null);
    setAviso(null);
    setReenviando(true);
    // O hook manda o reenvio por SMS: se o WhatsApp não chegou, o SMS é a saída.
    const { error } = await supabase.auth.signInWithOtp({
      phone: telefone,
      options: { shouldCreateUser: false },
    });
    setReenviando(false);
    if (error) setErro(mensagemErroAuth(error));
    else setAviso('Enviamos um novo código por SMS.');
  };

  const aoDigitar = (texto: string) => {
    const digitos = texto.replace(/\D/g, '').slice(0, TAMANHO_CODIGO);
    setCodigo(digitos);
    if (digitos.length === TAMANHO_CODIGO) void verificar(digitos);
  };

  return (
    <ThemedView style={styles.tela}>
      <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.rolagem}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled">
          <View style={styles.conteudo}>
            <ThemedText themeColor="textSecondary">
              Digite o código de {TAMANHO_CODIGO} dígitos enviado por WhatsApp ou SMS para{' '}
              <ThemedText type="smallBold">{formatarCelular(telefone)}</ThemedText>.
            </ThemedText>

            <CampoTexto
              rotulo="Código"
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
            <Botao titulo="Não recebi: enviar por SMS" variante="texto" carregando={reenviando} onPress={reenviar} />

            {erro && <Aviso tom="erro" texto={erro} />}
            {aviso && !erro && <Aviso tom="info" icone="ok" texto={aviso} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  rolagem: {
    padding: Spacing.four,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  codigo: {
    fontFamily: Fonte.semibold,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
