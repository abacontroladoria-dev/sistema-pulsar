import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { EstadoTela } from '@/components/estado-tela';
import { SeloStatus } from '@/components/selo-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAgora } from '@/hooks/use-agora';
import { useTheme } from '@/hooks/use-theme';
import {
  buscarDetalheEvolucao,
  mensagemErroBanco,
  registrarEvolucao,
  registrarFalta,
  type SessaoAgenda,
} from '@/lib/agenda';
import { useSessao } from '@/providers/session-provider';
import { formatarData, horario, statusDaSessao } from '@/utils/status-sessao';

type Acao = 'nenhuma' | 'evoluir' | 'falta';

/** A sessão vem da agenda já carregada (a lista é a fonte; aqui só se detalha). */
function useSessaoDaAgenda(id: string): SessaoAgenda | undefined {
  const queryClient = useQueryClient();
  return useMemo(() => {
    for (const [, lista] of queryClient.getQueriesData<SessaoAgenda[]>({ queryKey: ['agenda'] })) {
      const achada = lista?.find((s) => s.agendamento_id === id);
      if (achada) return achada;
    }
    return undefined;
  }, [queryClient, id]);
}

export function Sessao({ id }: { id: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const agora = useAgora();
  const { perfil } = useSessao();
  const base = useSessaoDaAgenda(id);
  const [acao, setAcao] = useState<Acao>('nenhuma');
  const [descricao, setDescricao] = useState('');

  const ehGestao = perfil?.tipo === 'gestao';
  const ehAdmin = ehGestao && !!perfil?.podeEvoluir;
  // Detalhe (texto, autoria) só onde a pessoa tem alcance: quem atende, ou a gestão.
  const podeVerDetalhe = !!base && (base.efetivo || ehGestao);

  const detalhe = useQuery({
    queryKey: ['detalhe', id],
    queryFn: () => buscarDetalheEvolucao(id),
    enabled: podeVerDetalhe,
  });

  const aposGravar = async () => {
    setAcao('nenhuma');
    setDescricao('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['agenda'] }),
      queryClient.invalidateQueries({ queryKey: ['detalhe', id] }),
    ]);
  };
  const evoluir = useMutation({ mutationFn: () => registrarEvolucao(id, descricao.trim()), onSuccess: aposGravar });
  const falta = useMutation({
    mutationFn: (tipo: 'paciente' | 'terapeuta') => registrarFalta(id, tipo),
    onSuccess: aposGravar,
  });

  if (!base) {
    return (
      <EstadoTela
        titulo="Sessão não encontrada"
        mensagem="Volte para a agenda e abra a sessão de novo."
      />
    );
  }

  // O detalhe, quando chega, é mais novo que a lista (ex.: logo depois de evoluir).
  const d = detalhe.data;
  const sessao: SessaoAgenda = d
    ? {
        ...base,
        registrado: d.registrado,
        status_execucao: d.status_execucao,
        tipo_falta: d.tipo_falta,
        possui_tratativa: d.possui_tratativa,
        tratativa_profissional_nome: d.tratativa_profissional_nome,
        falta_recepcao: d.falta_recepcao,
      }
    : base;
  const status = statusDaSessao(sessao, ehAdmin, agora);

  // Mesmas regras do banco (sp_grade_exigir_evoluir); o banco é quem decide.
  const podeAgir =
    !!perfil?.podeEvoluir &&
    (ehAdmin
      ? status.codigo === 'futuro' || status.codigo === 'sem_registro_passado'
      : sessao.efetivo && status.codigo === 'sem_registro_passado');
  const gravando = evoluir.isPending || falta.isPending;
  const erroGravar = evoluir.error ?? falta.error;

  return (
    <ThemedView style={styles.tela}>
      <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.rolagem}
          keyboardShouldPersistTaps="handled">
          <View style={styles.conteudo}>
            <ThemedText type="small" themeColor="textSecondary">
              Planejamento do dia {formatarData(sessao.data)} · {horario(sessao)} · {sessao.terapia_nome}
            </ThemedText>
            <ThemedText type="subtitle">{sessao.paciente_nome}</ThemedText>
            <SeloStatus status={status} />
            <ThemedText themeColor="textSecondary">{status.descricaoCurta}</ThemedText>

            <ThemedView type="backgroundElement" style={styles.bloco}>
              <Linha rotulo="Profissional agendado" valor={sessao.profissional_nome} />
              {sessao.cobertura_profissional_nome && (
                <Linha rotulo="Cobertura" valor={sessao.cobertura_profissional_nome} />
              )}
              <Linha rotulo="Local" valor={[sessao.sala_nome, sessao.unidade_nome].filter(Boolean).join(' · ') || '—'} />
            </ThemedView>

            {!sessao.efetivo && !ehGestao && (
              <ThemedText themeColor="textSecondary">
                Esta sessão está com {sessao.cobertura_profissional_nome ?? 'outro profissional'}: o registro é dele.
              </ThemedText>
            )}

            {d && d.registrado && (
              <ThemedView type="backgroundElement" style={styles.bloco}>
                {d.possui_tratativa ? (
                  <>
                    <Linha
                      rotulo="Realizado por"
                      valor={`${d.tratativa_profissional_nome ?? '—'}${d.substituicao ? ' (Substituição)' : ''}`}
                    />
                    {d.tratativa_criada_em_brasilia && <Linha rotulo="Evoluído em" valor={d.tratativa_criada_em_brasilia} />}
                    {d.descricao_evolucao && (
                      <View style={styles.descricao}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Descrição
                        </ThemedText>
                        <ThemedText selectable>{d.descricao_evolucao}</ThemedText>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {d.registrado_por_nome && <Linha rotulo="Registrado por" valor={d.registrado_por_nome} />}
                    {d.atualizado_em_brasilia && <Linha rotulo="Em" valor={d.atualizado_em_brasilia} />}
                  </>
                )}
              </ThemedView>
            )}

            {detalhe.error && (
              <ThemedText style={{ color: theme.danger }}>{mensagemErroBanco(detalhe.error)}</ThemedText>
            )}

            {podeAgir && acao === 'nenhuma' && (
              <View style={styles.acoes}>
                <ThemedText type="smallBold">Qual ação deseja fazer?</ThemedText>
                <Botao titulo="Evoluir" onPress={() => setAcao('evoluir')} />
                <Botao titulo="Marcar falta" variante="secundario" onPress={() => setAcao('falta')} />
              </View>
            )}

            {podeAgir && acao === 'evoluir' && (
              <View style={styles.acoes}>
                <Linha rotulo="Realizado por" valor={perfil?.nome || 'Você'} />
                <CampoTexto
                  rotulo="Descrição *"
                  value={descricao}
                  onChangeText={setDescricao}
                  multiline
                  textAlignVertical="top"
                  maxLength={20000}
                  style={styles.areaTexto}
                  editable={!gravando}
                />
                <Botao
                  titulo="Salvar"
                  carregando={evoluir.isPending}
                  disabled={descricao.trim().length < 3 || gravando}
                  onPress={() => evoluir.mutate()}
                />
                <Botao titulo="Cancelar" variante="texto" disabled={gravando} onPress={() => setAcao('nenhuma')} />
              </View>
            )}

            {podeAgir && acao === 'falta' && (
              <View style={styles.acoes}>
                <ThemedText type="smallBold">Confirmar falta</ThemedText>
                <Botao
                  titulo="Falta do paciente"
                  carregando={falta.isPending && falta.variables === 'paciente'}
                  disabled={gravando}
                  onPress={() => falta.mutate('paciente')}
                />
                {/* Terapeuta registra só falta do paciente (decisão de 19/10/2026). */}
                {ehAdmin && (
                  <Botao
                    titulo="Falta do profissional"
                    variante="secundario"
                    carregando={falta.isPending && falta.variables === 'terapeuta'}
                    disabled={gravando}
                    onPress={() => falta.mutate('terapeuta')}
                  />
                )}
                <Botao titulo="Cancelar" variante="texto" disabled={gravando} onPress={() => setAcao('nenhuma')} />
              </View>
            )}

            {erroGravar && (
              <ThemedText accessibilityRole="alert" style={{ color: theme.danger }}>
                {mensagemErroBanco(erroGravar)}
              </ThemedText>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={styles.linha}>
      <ThemedText type="small" themeColor="textSecondary">
        {rotulo}
      </ThemedText>
      <ThemedText>{valor}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  rolagem: {
    padding: Spacing.three,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  bloco: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  linha: {
    gap: Spacing.half,
  },
  descricao: {
    gap: Spacing.one,
  },
  acoes: {
    gap: Spacing.two,
  },
  areaTexto: {
    minHeight: 160,
    paddingVertical: Spacing.two,
  },
});
