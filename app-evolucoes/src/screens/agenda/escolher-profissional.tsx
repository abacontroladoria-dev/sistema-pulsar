import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { EstadoTela } from '@/components/estado-tela';
import { Icone } from '@/components/icone';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, Toque } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { buscarProfissionaisApp, mensagemErroBanco } from '@/lib/agenda';
import { escolherProfissional, useProfissionalEscolhido } from '@/lib/profissional-escolhido';

import { Iniciais } from './iniciais';

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
        icone="aviso"
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
              icone="buscar"
              value={busca}
              onChangeText={setBusca}
              placeholder="Digite o nome"
              autoCorrect={false}
              autoFocus
            />
            <ThemedText type="caption">
              {filtrados.length === 1 ? '1 profissional' : `${filtrados.length} profissionais`}
            </ThemedText>
          </View>
        }
        ItemSeparatorComponent={() => <View style={[styles.separador, { backgroundColor: theme.border }]} />}
        ListEmptyComponent={
          <View style={styles.vazio}>
            <ThemedText type="smallBold">Nenhum profissional com esse nome</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
              Confira a grafia ou apague a busca.
            </ThemedText>
            {busca.length > 0 && <Botao titulo="Limpar busca" variante="texto" onPress={() => setBusca('')} />}
          </View>
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
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.backgroundSelected }]}>
              <Iniciais nome={item.nome} />
              <ThemedText type={selecionado ? 'smallBold' : 'small'} style={styles.nome} numberOfLines={2}>
                {item.nome}
              </ThemedText>
              {selecionado && <Icone nome="ok" tamanho={20} cor="accent" />}
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
  centro: {
    textAlign: 'center',
  },
  lista: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
  },
  busca: {
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  item: {
    minHeight: Toque.minimo + Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    paddingVertical: Spacing.two,
  },
  nome: {
    flex: 1,
  },
  separador: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 40 + Spacing.twoHalf,
  },
  vazio: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.five,
  },
});
