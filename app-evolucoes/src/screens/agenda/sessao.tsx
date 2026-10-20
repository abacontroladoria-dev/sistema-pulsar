import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Aviso } from '@/components/aviso';
import { Botao } from '@/components/botao';
import { CampoTexto } from '@/components/campo-texto';
import { Cartao, DivisorCartao } from '@/components/cartao';
import { EstadoTela } from '@/components/estado-tela';
import { Icone, type NomeIcone } from '@/components/icone';
import { SeloStatus } from '@/components/selo-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAgora } from '@/hooks/use-agora';
import {
  buscarDetalheEvolucao,
  mensagemErroBanco,
  registrarEvolucao,
  registrarFalta,
  type SessaoAgenda,
} from '@/lib/agenda';
import { useSessao } from '@/providers/session-provider';
import { formatarDiaLongo, horario, statusDaSessao } from '@/utils/status-sessao';

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
  const queryClient = useQueryClient();
  const agora = useAgora();
  const { perfil } = useSessao();
  const base = useSessaoDaAgenda(id);
  const [acao, setAcao] = useState<Acao>('nenhuma');
  const [descricao, setDescricao] = useState('');

  const ehGestao = perfil?.tipo === 'gestao';
  const ehAdmin = ehGestao && !!perfil?.podeEvoluir;
  // Detalhe (texto, autoria): a agenda só traz sessões da pessoa (agendada ou
  // cobrindo), e o agendado lê também a da sessão coberta — o paciente é dele.
  // O banco filtra o texto (grade_detalhe_evolucao); diretoria vem sem ele.
  const podeVerDetalhe = !!base;

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
        icone="aviso"
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

  const local = [sessao.sala_nome, sessao.unidade_nome].filter(Boolean).join(', ');
  const dia = formatarDiaLongo(sessao.data);
  // A descrição do status só aparece quando acrescenta algo: com o registro na
  // tela (cartão abaixo) ou igual ao selo, ela só repetiria.
  const mostrarDescricao = !d?.registrado && status.descricaoCurta !== status.rotulo;

  return (
    <ThemedView style={styles.tela}>
      <KeyboardAvoidingView style={styles.tela} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.rolagem}
          keyboardShouldPersistTaps="handled">
          <View style={styles.conteudo}>
            <View style={styles.identidade}>
              <View style={styles.quando}>
                <Icone nome="relogio" tamanho={16} cor="textMuted" />
                <ThemedText type="small" themeColor="textSecondary" style={styles.numeros}>
                  {`${dia.semana}, ${dia.data}, das ${horario(sessao)}`}
                </ThemedText>
              </View>
              <ThemedText type="subtitle" selectable>
                {sessao.paciente_nome}
              </ThemedText>
              {!!sessao.terapia_nome && (
                <ThemedText type="smallBold" themeColor="accent">
                  {sessao.terapia_nome}
                </ThemedText>
              )}
              <View style={styles.status}>
                <SeloStatus status={status} />
                {mostrarDescricao && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {status.descricaoCurta}
                  </ThemedText>
                )}
              </View>
            </View>

            {!sessao.efetivo && !ehGestao && (
              <Aviso
                tom="info"
                icone="cobertura"
                texto={`${sessao.cobertura_profissional_nome ?? 'Outro profissional'} pegou esta sessão: só quem cobre pode evoluir.`}
              />
            )}

            <Cartao>
              <Linha icone="pessoa" rotulo="Profissional agendado" valor={sessao.profissional_nome} />
              {sessao.cobertura_profissional_nome && (
                <Linha icone="cobertura" rotulo="Cobertura" valor={sessao.cobertura_profissional_nome} />
              )}
              <Linha icone="local" rotulo="Local" valor={local || '—'} />
            </Cartao>

            {d && d.registrado && (
              <Cartao>
                <View style={styles.tituloBloco}>
                  <Icone nome={d.possui_tratativa ? 'evolucao' : 'falta'} tamanho={20} />
                  <ThemedText type="heading">{d.possui_tratativa ? 'Evolução' : 'Registro'}</ThemedText>
                </View>
                {d.possui_tratativa ? (
                  <>
                    <ThemedText type="caption">
                      {d.tratativa_profissional_nome ?? '—'}
                      {d.substituicao ? ' (substituição)' : ''}
                      {d.tratativa_criada_em_brasilia ? `, em ${d.tratativa_criada_em_brasilia}` : ''}
                    </ThemedText>
                    {d.descricao_evolucao ? (
                      <>
                        <DivisorCartao />
                        <ThemedText selectable>{d.descricao_evolucao}</ThemedText>
                      </>
                    ) : null}
                  </>
                ) : (
                  <ThemedText type="caption">
                    {d.registrado_por_nome ?? '—'}
                    {d.atualizado_em_brasilia ? `, em ${d.atualizado_em_brasilia}` : ''}
                  </ThemedText>
                )}
              </Cartao>
            )}

            {detalhe.error && <Aviso tom="erro" texto={mensagemErroBanco(detalhe.error)} />}

            {podeAgir && acao === 'nenhuma' && (
              <View style={styles.acoes}>
                <Botao titulo="Evoluir" icone="evolucao" onPress={() => setAcao('evoluir')} />
                <Botao titulo="Marcar falta" icone="falta" variante="secundario" onPress={() => setAcao('falta')} />
              </View>
            )}

            {podeAgir && acao === 'evoluir' && (
              <Cartao>
                <View style={styles.tituloBloco}>
                  <Icone nome="evolucao" tamanho={20} />
                  <ThemedText type="heading">Nova evolução</ThemedText>
                </View>
                <ThemedText type="caption">Realizado por {perfil?.nome || 'você'}</ThemedText>
                <CampoTexto
                  rotulo="Descrição da sessão"
                  value={descricao}
                  onChangeText={setDescricao}
                  multiline
                  textAlignVertical="top"
                  maxLength={20000}
                  placeholder="O que foi trabalhado, como o paciente respondeu…"
                  style={styles.areaTexto}
                  editable={!gravando}
                />
                <Botao
                  titulo="Salvar evolução"
                  carregando={evoluir.isPending}
                  disabled={descricao.trim().length < 3 || gravando}
                  onPress={() => evoluir.mutate()}
                />
                <Botao titulo="Cancelar" variante="texto" disabled={gravando} onPress={() => setAcao('nenhuma')} />
              </Cartao>
            )}

            {podeAgir && acao === 'falta' && (
              <Cartao>
                <View style={styles.tituloBloco}>
                  <Icone nome="falta" tamanho={20} />
                  <ThemedText type="heading">Marcar falta</ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  A falta fica registrada nesta sessão. Para corrigir depois, fale com a coordenação.
                </ThemedText>
                <Botao
                  titulo="Falta do paciente"
                  variante="perigo"
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
              </Cartao>
            )}

            {erroGravar && <Aviso tom="erro" texto={mensagemErroBanco(erroGravar)} />}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

function Linha({ icone, rotulo, valor }: { icone: NomeIcone; rotulo: string; valor: string }) {
  return (
    <View style={styles.linha}>
      <Icone nome={icone} tamanho={20} cor="textMuted" />
      <View style={styles.flex}>
        <ThemedText type="caption">{rotulo}</ThemedText>
        <ThemedText type="small" selectable>
          {valor}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tela: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  rolagem: {
    padding: Spacing.three,
    paddingBottom: Spacing.five,
  },
  conteudo: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.three,
  },
  identidade: {
    gap: Spacing.one,
  },
  quando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  numeros: {
    fontVariant: ['tabular-nums'],
  },
  status: {
    gap: Spacing.one + Spacing.half,
    marginTop: Spacing.two,
  },
  tituloBloco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.twoHalf,
  },
  acoes: {
    gap: Spacing.twoHalf,
  },
  areaTexto: {
    minHeight: 160,
  },
});
