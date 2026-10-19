import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { EstadoTela } from '@/components/estado-tela';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buscarProfissionaisApp, mensagemErroBanco } from '@/lib/agenda';
import { escolherProfissional, useProfissionalEscolhido } from '@/lib/profissional-escolhido';

/** Busca sem acento e sem caixa: "joao" acha "João". */
const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function EscolherProfissional() {
  const theme = useTheme();
  const atual = useProfissionalEscolhido();
  const [busca, setBusca] = useState('');
  const consulta = useQuery({ queryKey: ['profissionais-app'], queryFn: buscarProfissionaisApp, staleTime: 1000 * 60 * 10 });

  const filtrados = useMemo(() => {
    const q = normalizar(busca.trim());
    const lista = consulta.data ?? [];
    return q ? lista.filter((p) => normalizar(p.nome).includes(q)) : lista;
  }, [busca, consulta.data]);

  if (consulta.data === undefined) {
    return consulta.error ? (
      <EstadoTela
        titulo="Não foi possível carregar os profissionais"
        mensagem={mensagemErroBanco(consulta.error)}
        acoes={<Botao titulo="Tentar de novo" onPress={() => consulta.refetch()} />}
      />
    ) : (
      <EstadoTela carregando />
    );
  }

  return (
    <ThemedView style={styles.tela}>
      <FlatList
        data={filtrados}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.lista}
        ListHeaderComponent={
          <View style={styles.busca}>
            <CampoTexto
              rotulo="Buscar profissional"
              value={busca}
              onChangeText={setBusca}
              placeholder="Digite para buscar..."
              autoCorrect={false}
              autoFocus
            />
          </View>
        }
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.vazio}>
            Nenhum profissional com esse nome. Confira a grafia ou apague a busca.
          </ThemedText>
        }
        renderItem={({ item }) => {
          const selecionado = item.id === atual?.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selecionado }}
              onPress={() => {
                escolherProfissional(item);
                router.back();
              }}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: selecionado ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
              ]}>
              <ThemedText type={selecionado ? 'smallBold' : 'default'}>{item.nome}</ThemedText>
            </Pressable>
          );
        }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  lista: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.one,
  },
  busca: {
    marginBottom: Spacing.two,
  },
  item: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  vazio: {
    textAlign: 'center',
    paddingVertical: Spacing.five,
  },
});
