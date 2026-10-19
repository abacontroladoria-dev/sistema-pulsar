import { useQuery } from '@tanstack/react-query';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Botao } from '@/components/botao';
import { EstadoTela } from '@/components/estado-tela';
import { SeloStatus } from '@/components/selo-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAgora } from '@/hooks/use-agora';
import { useTheme } from '@/hooks/use-theme';
import { buscarAgenda, mensagemErroBanco, type SessaoAgenda } from '@/lib/agenda';
import { useProfissionalEscolhido } from '@/lib/profissional-escolhido';
import { useSessao } from '@/providers/session-provider';
import { agoraBrasilia, formatarDiaCurto, horario, somarDias, statusDaSessao } from '@/utils/status-sessao';

/** Agenda de UM dia: a do terapeuta logado, ou a do profissional escolhido pela gestão. */
export function Agenda() {
  const theme = useTheme();
  const { perfil } = useSessao();
  const agora = useAgora();
  const hoje = agoraBrasilia(agora).data;
  const [dia, setDia] = useState(hoje);
  const ehGestao = perfil?.tipo === 'gestao';
  const ehAdmin = ehGestao && !!perfil?.podeEvoluir;
  const escolhido = useProfissionalEscolhido();
  const profissionalId = ehGestao ? escolhido?.id : undefined;
  const aguardandoEscolha = ehGestao && !escolhido;

  const consulta = useQuery({
    queryKey: ['agenda', profissionalId ?? 'meu', dia],
    queryFn: () => buscarAgenda(dia, dia, profissionalId),
    enabled: !aguardandoEscolha,
  });

  // Volta da sessão (evoluiu, marcou falta) ou do fundo: confere de novo.
  const { refetch } = consulta;
  useFocusEffect(
    useCallback(() => {
      if (!aguardandoEscolha) void refetch();
    }, [aguardandoEscolha, refetch]),
  );

  const cabecalho = (
    <View style={styles.cabecalho}>
      {ehGestao && (
        <Link href="/agenda/escolher-profissional" asChild>
          <Pressable
            accessibilityRole="button"
            style={[styles.escolha, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Profissional
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {escolhido?.nome ?? 'Escolher'}
            </ThemedText>
          </Pressable>
        </Link>
      )}

      <View style={styles.navDia}>
        <Botao titulo="‹" variante="secundario" accessibilityLabel="Dia anterior" onPress={() => setDia(somarDias(dia, -1))} />
        <View style={styles.diaAtual}>
          <ThemedText type="smallBold">{dia === hoje ? `Hoje · ${formatarDiaCurto(dia)}` : formatarDiaCurto(dia)}</ThemedText>
          {dia !== hoje && <Botao titulo="Voltar para hoje" variante="texto" onPress={() => setDia(hoje)} />}
        </View>
        <Botao titulo="›" variante="secundario" accessibilityLabel="Próximo dia" onPress={() => setDia(somarDias(dia, 1))} />
      </View>

      {consulta.error && consulta.data && (
        <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
          Não foi possível atualizar. Mostrando o que já estava carregado.
        </ThemedText>
      )}
    </View>
  );

  if (aguardandoEscolha) {
    return (
      <ThemedView style={styles.tela}>
        <View style={styles.conteudoFixo}>{cabecalho}</View>
        <EstadoTela
          titulo="Escolha um profissional"
          mensagem="Toque em “Profissional” para ver a agenda de alguém."
          acoes={<Botao titulo="Escolher profissional" onPress={() => router.push('/agenda/escolher-profissional')} />}
        />
      </ThemedView>
    );
  }

  if (consulta.data === undefined) {
    return (
      <ThemedView style={styles.tela}>
        <View style={styles.conteudoFixo}>{cabecalho}</View>
        {consulta.error ? (
          <EstadoTela
            titulo="Não foi possível carregar a agenda"
            mensagem={mensagemErroBanco(consulta.error)}
            acoes={<Botao titulo="Tentar de novo" onPress={() => refetch()} />}
          />
        ) : (
          <EstadoTela carregando />
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.tela}>
      <FlatList
        data={consulta.data}
        keyExtractor={(s) => s.agendamento_id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.lista}
        ListHeaderComponent={cabecalho}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.vazio}>
            Nenhuma sessão neste dia. Use as setas para ver outros dias.
          </ThemedText>
        }
        refreshControl={<RefreshControl refreshing={consulta.isRefetching} onRefresh={() => void refetch()} />}
        renderItem={({ item }) => <CartaoSessao sessao={item} ehAdmin={ehAdmin} agora={agora} />}
      />
    </ThemedView>
  );
}

function CartaoSessao({ sessao, ehAdmin, agora }: { sessao: SessaoAgenda; ehAdmin: boolean; agora: Date }) {
  const theme = useTheme();
  const status = statusDaSessao(sessao, ehAdmin, agora);
  const local = [sessao.sala_nome, sessao.unidade_nome].filter(Boolean).join(' · ');

  return (
    <Link href={{ pathname: '/agenda/sessao/[id]', params: { id: sessao.agendamento_id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${horario(sessao)}, ${sessao.paciente_nome}, ${status.rotulo}`}
        style={({ pressed }) => [
          styles.cartao,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
        ]}>
        <View style={styles.cartaoTopo}>
          <ThemedText type="smallBold">{horario(sessao)}</ThemedText>
          <SeloStatus status={status} />
        </View>
        <ThemedText>{sessao.paciente_nome}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {[sessao.terapia_nome, local].filter(Boolean).join(' · ')}
        </ThemedText>
        {sessao.cobertura_profissional_id !== null && (
          <ThemedText type="small" themeColor="textSecondary">
            {sessao.efetivo
              ? `Cobrindo ${sessao.profissional_nome}`
              : `Coberta por ${sessao.cobertura_profissional_nome ?? 'outro profissional'}`}
          </ThemedText>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  conteudoFixo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
  },
  lista: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cabecalho: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  escolha: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  navDia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  diaAtual: {
    flex: 1,
    alignItems: 'center',
  },
  cartao: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cartaoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  vazio: {
    textAlign: 'center',
    paddingVertical: Spacing.five,
  },
});
