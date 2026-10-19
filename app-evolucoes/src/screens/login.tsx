import { router } from 'expo-router';
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
import { mensagemErroAuth } from '@/utils/mensagem-erro-auth';
import { celularParaE164 } from '@/utils/telefone';

type Modo = 'responsavel' | 'equipe';

export function Login() {
  const theme = useTheme();
  const [modo, setModo] = useState<Modo>('responsavel');
  const [celular, setCelular] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState<'codigo' | 'senha' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const trocarModo = (novo: Modo) => {
    setModo(novo);
    setErro(null);
  };

  const pedirCodigo = async () => {
    if (enviando) return;
    const telefone = celularParaE164(celular);
    if (!telefone) {
      setErro('Digite o celular com DDD, por exemplo (11) 98765-4321.');
      return;
    }
    setErro(null);
    setEnviando('codigo');
    // shouldCreateUser: false — só entra quem a clínica já liberou; o app não cria conta.
    // O canal (WhatsApp ou SMS) quem escolhe é o Send SMS Hook no servidor.
    const { error } = await supabase.auth.signInWithOtp({
      phone: telefone,
      options: { shouldCreateUser: false },
    });
    setEnviando(null);
    if (error) {
      setErro(mensagemErroAuth(error));
      return;
    }
    router.push({ pathname: '/verificar-codigo', params: { telefone } });
  };

  const entrarComSenha = async () => {
    if (enviando) return;
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }
    setErro(null);
    setEnviando('senha');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(null);
    // Sucesso não navega daqui: a sessão nova troca as rotas protegidas no _layout.
    if (error) setErro(mensagemErroAuth(error));
  };

  return (
    <ThemedView style={styles.tela}>
      <SafeAreaView style={styles.tela}>
        <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.rolagem} keyboardShouldPersistTaps="handled">
            <View style={styles.conteudo}>
              <ThemedText type="subtitle">Entrar</ThemedText>

              <View style={[styles.abas, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
                {(['responsavel', 'equipe'] as const).map((m) => {
                  const ativo = modo === m;
                  return (
                    <Botao
                      key={m}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: ativo }}
                      titulo={m === 'responsavel' ? 'Sou responsável' : 'Sou da equipe'}
                      variante={ativo ? 'primario' : 'texto'}
                      onPress={() => trocarModo(m)}
                      style={styles.aba}
                    />
                  );
                })}
              </View>

              {modo === 'responsavel' ? (
                <View style={styles.formulario}>
                  <ThemedText themeColor="textSecondary">
                    Use o celular cadastrado na clínica. Enviaremos um código de acesso por WhatsApp ou SMS.
                  </ThemedText>
                  <CampoTexto
                    rotulo="Celular com DDD"
                    value={celular}
                    onChangeText={setCelular}
                    placeholder="(11) 98765-4321"
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                  />
                  <Botao
                    titulo="Receber código"
                    carregando={enviando === 'codigo'}
                    disabled={!!enviando}
                    onPress={pedirCodigo}
                  />
                </View>
              ) : (
                <View style={styles.formulario}>
                  <ThemedText themeColor="textSecondary">Use o mesmo login do Pulsar.</ThemedText>
                  <CampoTexto
                    rotulo="E-mail"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="username"
                  />
                  <CampoTexto
                    rotulo="Senha"
                    value={senha}
                    onChangeText={setSenha}
                    secureTextEntry
                    autoComplete="current-password"
                    textContentType="password"
                    onSubmitEditing={entrarComSenha}
                  />
                  <Botao
                    titulo="Entrar"
                    carregando={enviando === 'senha'}
                    disabled={!!enviando}
                    onPress={entrarComSenha}
                  />
                </View>
              )}

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
    gap: Spacing.four,
  },
  abas: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  aba: {
    flex: 1,
    paddingHorizontal: Spacing.two,
  },
  formulario: {
    gap: Spacing.three,
  },
});
