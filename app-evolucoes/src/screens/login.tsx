import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Aviso } from '@/components/aviso';
import { Botao } from '@/components/botao';
import { BotaoTema } from '@/components/botao-tema';
import { CampoTexto } from '@/components/campo-texto';
import { Cartao } from '@/components/cartao';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadow, Spacing, Toque } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { mensagemErroAuth } from '@/utils/mensagem-erro-auth';
import { celularParaE164 } from '@/utils/telefone';

type Modo = 'responsavel' | 'equipe';

export function Login() {
  const theme = useTheme();
  const escuro = useColorScheme() === 'dark';
  // Equipe primeiro: o acesso do responsável só abre na Fase 3.
  const [modo, setModo] = useState<Modo>('equipe');
  const [celular, setCelular] = useState('');
  const [usuarioOuEmail, setUsuarioOuEmail] = useState('');
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
    const identificacao = usuarioOuEmail.trim();
    if (!identificacao || !senha) {
      setErro('Preencha usuário (ou e-mail) e senha.');
      return;
    }
    setErro(null);
    setEnviando('senha');

    // Igual ao login do Pulsar web: sem "@" é nome de usuário, traduzido para o
    // e-mail pela RPC email_por_username (roda antes do login, como anon).
    let email = identificacao;
    if (!identificacao.includes('@')) {
      const { data, error } = await supabase.rpc('email_por_username', { p_username: identificacao });
      if (error || typeof data !== 'string' || !data) {
        setEnviando(null);
        setErro(error ? mensagemErroAuth(error) : 'Usuário não encontrado. Confira e tente de novo.');
        return;
      }
      email = data;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setEnviando(null);
    // Sucesso não navega daqui: a sessão nova troca as rotas protegidas no _layout
    // (com app autenticador, passa antes pela tela do código).
    if (error) setErro(mensagemErroAuth(error));
  };

  return (
    <ThemedView style={styles.tela}>
      <SafeAreaView style={styles.tela}>
        <View style={styles.topo}>
          <BotaoTema />
        </View>
        <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.rolagem} keyboardShouldPersistTaps="handled">
            <View style={styles.conteudo}>
              <View style={styles.marca}>
                <Image
                  source={escuro ? LOGO_ESCURO : LOGO_CLARO}
                  style={styles.logo}
                  contentFit="contain"
                  accessibilityLabel="Pulsar"
                />
                <ThemedText type="small" themeColor="textSecondary">
                  Clínica Universo ABA
                </ThemedText>
              </View>

              <View style={[styles.abas, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
                {(['equipe', 'responsavel'] as const).map((m) => {
                  const ativo = modo === m;
                  return (
                    <Pressable
                      key={m}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: ativo }}
                      onPress={() => trocarModo(m)}
                      style={[styles.aba, ativo && [styles.abaAtiva, { backgroundColor: theme.surfaceRaised }]]}>
                      <ThemedText type="smallBold" themeColor={ativo ? 'accent' : 'textSecondary'}>
                        {m === 'responsavel' ? 'Sou responsável' : 'Sou da equipe'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <Cartao style={styles.formulario}>
                {modo === 'responsavel' ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Use o celular cadastrado na clínica. Enviaremos um código de acesso por WhatsApp ou SMS.
                    </ThemedText>
                    <CampoTexto
                      rotulo="Celular com DDD"
                      icone="celular"
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
                  </>
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Use o mesmo login do Pulsar.
                    </ThemedText>
                    <CampoTexto
                      rotulo="Usuário ou e-mail"
                      icone="pessoa"
                      value={usuarioOuEmail}
                      onChangeText={setUsuarioOuEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="username"
                      textContentType="username"
                    />
                    <CampoTexto
                      rotulo="Senha"
                      icone="cadeado"
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
                  </>
                )}

                {erro && <Aviso tom="erro" texto={erro} />}
              </Cartao>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const LOGO_CLARO = require('@/assets/images/pulsar-lockup.png');
const LOGO_ESCURO = require('@/assets/images/pulsar-lockup-escuro.png');

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  topo: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  rolagem: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
  conteudo: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: Spacing.four,
  },
  marca: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  logo: {
    width: 196,
    // Proporção do arquivo recortado (720 × 294).
    aspectRatio: 720 / 294,
  },
  abas: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    padding: Spacing.one,
    gap: Spacing.one,
  },
  aba: {
    flex: 1,
    minHeight: Toque.minimo,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md - Spacing.one,
    borderCurve: 'continuous',
  },
  abaAtiva: {
    boxShadow: Shadow.card,
  },
  formulario: {
    gap: Spacing.three,
    padding: Spacing.four - Spacing.one,
  },
});
