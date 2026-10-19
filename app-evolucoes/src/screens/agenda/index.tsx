import { useQuery } from '@tanstack/react-query';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Botao } from '@/components/botao';
import { Cartao } from '@/components/cartao';
import { EstadoTela } from '@/components/estado-tela';
import { Icone } from '@/components/icone';
import { SeloStatus } from '@/components/selo-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Spacing, Toque } from '@/constants/theme';
import { useAgora } from '@/hooks/use-agora';
import { useTheme } from '@/hooks/use-theme';
import { buscarAgenda, mensagemErroBanco, type SessaoAgenda } from '@/lib/agenda';
import { useProfissionalEscolhido } from '@/lib/profissional-escolhido';
import { useSessao } from '@/providers/session-provider';
import { agoraBrasilia, formatarDiaLongo, somarDias, statusDaSessao } from '@/utils/status-sessao';

import { Iniciais } from './iniciais';
import { SeletorData, TEM_SELETOR_DATA } from './seletor-data';

/** Agenda de UM dia: a do terapeuta logado, ou a do profissional escolhido pela gestão. */
export function Agenda() {
  const theme = useTheme();
  const { perfil } = useSessao();
  const agora = useAgora();
  const hoje = agoraBrasilia(agora).data;
  const [dia, setDia] = useState(hoje);
  const [calendarioAberto, setCalendarioAberto] = useState(false);
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

  const sessoes = consulta.data;
  const paraEvoluir =
    sessoes?.filter((s) => s.efetivo && statusDaSessao(s, ehAdmin, agora).codigo === 'sem_registro_passado').length ?? 0;
  const longo = formatarDiaLongo(dia);
  // Outro ano (pulando pelo calendário) leva o ano no título.
  const ano = dia.slice(0, 4) === hoje.slice(0, 4) ? '' : ` de ${dia.slice(0, 4)}`;
  const tituloDia = `${dia === hoje ? 'Hoje' : longo.semana}, ${longo.data}${ano}`;

  const cabecalho = (
    <View style={styles.cabecalho}>
      {ehGestao && (
        <Link href="/agenda/escolher-profissional" asChild>
          <Cartao accessibilityLabel={`Profissional: ${escolhido?.nome ?? 'nenhum'}. Trocar`} style={styles.escolha}>
            {escolhido ? (
              <Iniciais nome={escolhido.nome} />
            ) : (
              <View style={[styles.iconeEscolha, { backgroundColor: theme.backgroundSelected }]}>
                <Icone nome="pessoa" />
              </View>
            )}
            <View style={styles.flex}>
              <ThemedText type="caption">Profissional</ThemedText>
              <ThemedText type="smallBold" numberOfLines={1}>
                {escolhido?.nome ?? 'Escolher profissional'}
              </ThemedText>
            </View>
            <Icone nome="abrir" tamanho={16} cor="textMuted" />
          </Cartao>
        </Link>
      )}

      <View style={styles.navDia}>
        <BotaoDia icone="anterior" rotulo="Dia anterior" onPress={() => setDia(somarDias(dia, -1))} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${tituloDia}. Escolher outra data`}
          disabled={!TEM_SELETOR_DATA}
          onPress={() => setCalendarioAberto(true)}
          style={({ pressed }) => [styles.diaAtual, pressed && { opacity: 0.6 }]}>
          <ThemedText type="heading" style={styles.tituloDia}>
            {tituloDia}
          </ThemedText>
          {TEM_SELETOR_DATA && <Icone nome="agenda" tamanho={16} />}
        </Pressable>
        <BotaoDia icone="proximo" rotulo="Próximo dia" onPress={() => setDia(somarDias(dia, 1))} />
      </View>

      {calendarioAberto && (
        <SeletorData dia={dia} onEscolher={setDia} onFechar={() => setCalendarioAberto(false)} />
      )}

      <View style={styles.resumo}>
        {sessoes ? (
          <ThemedText type="small" themeColor="textSecondary">
            {sessoes.length === 1 ? '1 sessão' : `${sessoes.length} sessões`}
            {paraEvoluir > 0 && `, ${paraEvoluir === 1 ? '1 para evoluir' : `${paraEvoluir} para evoluir`}`}
          </ThemedText>
        ) : (
          <View />
        )}
        {dia !== hoje && <Botao titulo="Voltar para hoje" variante="texto" onPress={() => setDia(hoje)} />}
      </View>

      {consulta.error && sessoes && (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>
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
          icone="pessoa"
          titulo="Escolha um profissional"
          mensagem="Para ver a agenda de alguém, escolha o profissional."
          acoes={<Botao titulo="Escolher profissional" onPress={() => router.push('/agenda/escolher-profissional')} />}
        />
      </ThemedView>
    );
  }

  if (sessoes === undefined) {
    return (
      <ThemedView style={styles.tela}>
        <View style={styles.conteudoFixo}>{cabecalho}</View>
        {consulta.error ? (
          <EstadoTela
            icone="aviso"
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
        data={sessoes}
        keyExtractor={(s) => s.agendamento_id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.lista}
        ListHeaderComponent={cabecalho}
        ListEmptyComponent={
          <View style={styles.vazio}>
            <View style={[styles.iconeVazio, { backgroundColor: theme.backgroundSelected }]}>
              <Icone nome="agenda" tamanho={24} />
            </View>
            <ThemedText type="smallBold">Nenhuma sessão neste dia</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
              Use as setas para ver outros dias.
            </ThemedText>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={consulta.isRefetching}
            onRefresh={() => void refetch()}
            tintColor={theme.accentIcon}
            colors={[theme.accent]}
          />
        }
        renderItem={({ item }) => <CartaoSessao sessao={item} ehAdmin={ehAdmin} agora={agora} />}
      />
    </ThemedView>
  );
}

function BotaoDia({ icone, rotulo, onPress }: { icone: 'anterior' | 'proximo'; rotulo: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPress={onPress}
      style={({ pressed }) => [
        styles.botaoDia,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.surface, borderColor: theme.border },
      ]}>
      <Icone nome={icone} tamanho={20} cor="accent" />
    </Pressable>
  );
}

function CartaoSessao({ sessao, ehAdmin, agora }: { sessao: SessaoAgenda; ehAdmin: boolean; agora: Date }) {
  const theme = useTheme();
  const status = statusDaSessao(sessao, ehAdmin, agora);
  const local = [sessao.sala_nome, sessao.unidade_nome].filter(Boolean).join(', ');
  const inicio = sessao.hora_inicio.slice(0, 5);
  const fim = sessao.hora_fim.slice(0, 5);
  const cobertura =
    sessao.cobertura_profissional_id === null
      ? null
      : sessao.efetivo
        ? `Cobrindo ${sessao.profissional_nome}`
        : `Coberta por ${sessao.cobertura_profissional_nome ?? 'outro profissional'}`;

  return (
    <Link href={{ pathname: '/agenda/sessao/[id]', params: { id: sessao.agendamento_id } }} asChild>
      <Cartao
        accessibilityLabel={`${inicio} às ${fim}, ${sessao.paciente_nome}, ${status.rotulo}${cobertura ? `, ${cobertura}` : ''}`}
        style={styles.cartao}>
        <View style={styles.horario}>
          <ThemedText type="heading" themeColor="accent" style={styles.numeros}>
            {inicio}
          </ThemedText>
          <ThemedText type="caption" style={styles.numeros}>
            {fim}
          </ThemedText>
        </View>

        <View style={[styles.trilho, { backgroundColor: theme.divider }]} />

        <View style={styles.corpo}>
          <ThemedText type="heading" numberOfLines={2}>
            {sessao.paciente_nome}
          </ThemedText>
          {!!sessao.terapia_nome && (
            <ThemedText type="small" themeColor="accent" numberOfLines={1}>
              {sessao.terapia_nome}
            </ThemedText>
          )}
          {!!local && (
            <ThemedText type="caption" numberOfLines={1}>
              {local}
            </ThemedText>
          )}
          <View style={styles.rodape}>
            <SeloStatus status={status} />
          </View>
          {cobertura && (
            <View style={styles.cobertura}>
              <Icone nome="cobertura" tamanho={16} cor="textSecondary" />
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
                {cobertura}
              </ThemedText>
            </View>
          )}
        </View>
      </Cartao>
    </Link>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  centro: {
    textAlign: 'center',
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
    paddingBottom: Spacing.five,
    gap: Spacing.twoHalf,
  },
  cabecalho: {
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  escolha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
    paddingVertical: Spacing.twoHalf,
  },
  iconeEscolha: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  botaoDia: {
    width: Toque.minimo,
    height: Toque.minimo,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diaAtual: {
    flex: 1,
    minHeight: Toque.minimo,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + Spacing.half,
  },
  tituloDia: {
    flexShrink: 1,
    textAlign: 'center',
  },
  resumo: {
    minHeight: Toque.minimo,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cartao: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.twoHalf,
  },
  horario: {
    width: 52,
    gap: Spacing.half,
  },
  numeros: {
    fontVariant: ['tabular-nums'],
  },
  trilho: {
    width: 1,
    alignSelf: 'stretch',
  },
  corpo: {
    flex: 1,
    gap: Spacing.one,
  },
  rodape: {
    flexDirection: 'row',
    marginTop: Spacing.one,
  },
  cobertura: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  vazio: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  iconeVazio: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
});
