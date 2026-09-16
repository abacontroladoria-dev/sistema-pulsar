-- =============================================================================
-- Sessão adiantada: o sistema passa a saber que o atendimento mudou de dia
-- =============================================================================
-- CASO QUE ORIGINOU (Davi Lucas, 16/09/2026)
-- A sessão de QUA 16/09 08:00 Psicopedagogia (TUSS 22070435) ia ser perdida e
-- foi ADIANTADA para TER 15/09. A recepção tirou a autorização na ASSIM na terça
-- (data_execucao = 15/09 08:26) e deu FALTA na quarta. O adiantamento não foi
-- lançado no TiTa — a agenda de terça segue sem sessão às 08:00.
--
-- Resultado: a guia de 15/09 ficou órfã e não vincula a nada. Três travas, todas
-- consequência do MESMO buraco — não existe, em lugar nenhum do banco, o fato
-- "esta sessão foi atendida em outra data":
--
--   1. vincular_autorizacao compara a janela contra data_atendimento (16/09) e
--      recusa a guia de 15/09 (20260821000000:628-632).
--   2. agenda_sem_falta apaga a sessão antes de gerar bloco_id, então não há nem
--      alvo para vincular (20260911120000:146-165 e fn_blocos_assim).
--   3. assiduidade, reposição e remuneração leem falta, porque é o que está
--      gravado.
--
-- POR QUE UMA COLUNA, E NÃO UMA SITUAÇÃO NOVA
-- Considerado e rejeitado: (a) ressuscitar o bloco e vincular a guia de terça à
-- sessão de quarta — gravaria em autorizacoes_vinculos que uma guia cobre uma
-- sessão de outro dia, e vínculo é insumo de faturamento; (b) pôr o número da
-- guia na justificativa de uma reclassificação — esconde o fato em texto livre,
-- onde nenhuma query alcança.
--
-- Registrar a data real é o único desenho em que o fato existe UMA vez,
-- estruturado, e todo o resto decorre: a janela compara contra ela, a
-- assiduidade lê presença, a reposição não cobra reposição.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não cria status novo em fila_autorizacoes. presencaReal.ts:105 decide presença
-- por exclusão (`status !== 'falta'`), e 20260908100200:19-26 documenta essa
-- classe de leitura como armadilha, mandando usar coluna auxiliar. É o que se faz
-- aqui.
--
-- Não insere segunda linha na data real: unique_fila_agendamento
-- (paciente_id, data_atendimento, horario) já derrubou tentativa anterior
-- (20260908100100:324-336). A linha continua sendo a da data AGENDADA.
--
-- Não abre janela prospectiva genérica. A guarda segue retroativa; o bloco de
-- 16/09 entra porque sua data EFETIVA passa a ser 15/09. A exceção existe só onde
-- o fato foi registrado e justificado.
--
-- Não remove agenda_sem_falta. A sessão adiantada volta por exceção nomeada
-- (data_atendimento_real is null), preservando o filtro para todas as outras
-- faltas. Blast radius real: só linhas com data real preenchida — hoje, zero.
-- =============================================================================

-- Tabela quente: a fila do robô trava atrás de DDL. Ver
-- reference_alter_table_deadlock_lock_timeout.
set lock_timeout = '3s';

-- =============================================================================
-- 1. As colunas do fato
-- =============================================================================
alter table public.fila_autorizacoes
  add column if not exists data_atendimento_real   date,
  add column if not exists adiantada_justificativa text,
  add column if not exists adiantada_por_nome      text,
  add column if not exists adiantada_em            timestamptz;

comment on column public.fila_autorizacoes.data_atendimento_real is
  'Data em que o atendimento REALMENTE ocorreu, quando difere da agendada (sessão adiantada/remarcada sem relançamento no TiTa). NULL em 100% das linhas normais. data_atendimento continua sendo a data da AGENDA — nada que a lê hoje muda de comportamento.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_data_real_difere') then
    alter table public.fila_autorizacoes
      add constraint chk_data_real_difere
      check (data_atendimento_real is null
             or data_atendimento_real <> data_atendimento) not valid;
    alter table public.fila_autorizacoes validate constraint chk_data_real_difere;
  end if;
end $$;

create index if not exists idx_fila_data_real
  on public.fila_autorizacoes (data_atendimento_real)
  where data_atendimento_real is not null;

reset lock_timeout;


-- =============================================================================
-- 2. marcar_sessao_adiantada — a escrita
-- =============================================================================
-- Molde: registrar_falta_em_lote (20260908100100) — guarda de papel, retorno
-- jsonb, idempotência por retorno e não por exceção (dois operadores podem
-- clicar no mesmo cartão no mesmo dia).
create or replace function public.marcar_sessao_adiantada(
  p_fila_id       uuid,
  p_data_real     date,
  p_justificativa text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_f    record;
begin
  -- Mesmo conjunto de vincular_autorizacao (20260821000000:567): quem marca o
  -- adiantamento é quem vincula a guia logo em seguida. Papéis diferentes nas
  -- duas pontas fariam a operação travar no meio.
  select u.nome into v_nome
  from public.usuarios u
  where u.id = auth.uid()
    and u.ativo
    and u.role in ('admin', 'autorizacao', 'recepcao');
  if not found then
    raise exception 'Sem permissão para marcar sessão adiantada'
      using errcode = '42501';
  end if;

  if coalesce(length(btrim(p_justificativa)), 0) < 10 then
    raise exception 'Justificativa obrigatória (mínimo 10 caracteres)'
      using errcode = '22023';
  end if;

  select * into v_f from public.fila_autorizacoes where id = p_fila_id;
  if not found then
    raise exception 'Sessão % não existe na fila', p_fila_id using errcode = 'P0002';
  end if;

  if v_f.status is distinct from 'falta' then
    return jsonb_build_object('marcada', false,
                              'motivo', 'nao_estava_em_falta',
                              'status_atual', v_f.status);
  end if;

  if p_data_real = v_f.data_atendimento then
    raise exception 'A data real deve diferir da data agendada (%)', v_f.data_atendimento
      using errcode = '22023';
  end if;

  -- Adiantamento é de dias, não de meses. O teto também protege a janela do
  -- vínculo, que é de 7 dias.
  if abs(p_data_real - v_f.data_atendimento) > 14 then
    raise exception 'Data real (%) a mais de 14 dias da agendada (%)',
      p_data_real, v_f.data_atendimento using errcode = '22023';
  end if;

  update public.fila_autorizacoes set
    data_atendimento_real   = p_data_real,
    adiantada_justificativa = btrim(p_justificativa),
    adiantada_por_nome      = v_nome,
    adiantada_em            = now(),
    -- A sessão deixa de ser falta: houve atendimento, em outra data.
    -- 'cancelado', NUNCA 'pendente' — em 'pendente' o robô reivindica a linha em
    -- ~1s (robo_buscar_tarefa) e re-solicita a autorização sozinho. Medido em
    -- produção: das 44 faltas revertidas, 34 terminaram em 'concluido'.
    status                  = 'cancelado',
    tipo_falta              = null,
    motivo_falta            = null,
    terapia_falta           = null,
    justificativa_falta     = null,
    falta_lote_id           = null,
    -- Reuso deliberado: os consumidores de falta (useReposicaoFaltas:153,
    -- useVisaoGeralFaltas:44, presencaReal.ts:104, contar_faltas_do_paciente,
    -- snapshot-previsao-receitas:338) já leem falta_revertida_em. Inventar um
    -- marcador novo exigiria tocar os seis.
    falta_revertida_em       = now(),
    falta_revertida_por_nome = v_nome
  where id = p_fila_id
    and status = 'falta';

  return jsonb_build_object('marcada', true,
                            'fila_id', p_fila_id,
                            'data_real', p_data_real,
                            'data_agendada', v_f.data_atendimento);
end;
$$;

comment on function public.marcar_sessao_adiantada(uuid, date, text) is
  'Registra que a sessão agendada para uma data foi atendida em outra (adiantada/remarcada). Tira a linha de falta e devolve a sessão à Conferência ASSIM com a data efetiva, para que a guia órfã possa ser vinculada. Não cria linha nova nem status novo.';

revoke all on function public.marcar_sessao_adiantada(uuid, date, text) from public, anon;
grant execute on function public.marcar_sessao_adiantada(uuid, date, text) to authenticated;


-- =============================================================================
-- 3. desfazer_sessao_adiantada — a volta
-- =============================================================================
create or replace function public.desfazer_sessao_adiantada(
  p_fila_id uuid,
  p_motivo  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_f    record;
begin
  select u.nome into v_nome
  from public.usuarios u
  where u.id = auth.uid()
    and u.ativo
    and u.role in ('admin', 'autorizacao', 'recepcao');
  if not found then
    raise exception 'Sem permissão para desfazer sessão adiantada'
      using errcode = '42501';
  end if;

  select * into v_f from public.fila_autorizacoes where id = p_fila_id;
  if not found then
    raise exception 'Sessão % não existe na fila', p_fila_id using errcode = 'P0002';
  end if;
  if v_f.data_atendimento_real is null then
    return jsonb_build_object('desfeita', false, 'motivo', 'nao_estava_adiantada');
  end if;

  -- O bloco volta a sumir da Conferência, então um vínculo feito sobre ele
  -- ficaria apontando para nada. Mesma precedência de reclassificar_situacao
  -- (20260827000000), que recusa reclassificar bloco vinculado.
  --
  -- A busca é pelo bloco_id, e NÃO por fila_id: `p_fila_id` é opcional em
  -- vincular_autorizacao (20260821000000:543), então o vínculo legítimo pode ter
  -- fila_id nulo. Procurar por ele deixava passar exatamente o caso que esta
  -- guarda existe para barrar. bloco_id é sempre gravado.
  if exists (
    select 1
    from public.autorizacoes_vinculos v
    where v.bloco_id = concat_ws('_', v_f.paciente_id, v_f.data_atendimento,
                                 v_f.tuss, v_f.horario)
      and v.desfeito_em is null
      and v.tipo = 'vinculo'
  ) then
    raise exception 'Desfaça o vínculo da guia antes de desfazer o adiantamento'
      using errcode = '23505';
  end if;

  update public.fila_autorizacoes set
    data_atendimento_real    = null,
    adiantada_justificativa  = null,
    adiantada_por_nome       = null,
    adiantada_em             = null,
    -- Volta a ser a falta que era. tipo_falta 'paciente' é o default do
    -- lançamento individual da recepção (solicitar/page.tsx:1111).
    status                   = 'falta',
    tipo_falta               = 'paciente',
    justificativa_falta      = nullif(btrim(coalesce(p_motivo, '')), ''),
    falta_revertida_em       = null,
    falta_revertida_por_nome = null
  where id = p_fila_id;

  return jsonb_build_object('desfeita', true, 'fila_id', p_fila_id, 'por', v_nome);
end;
$$;

comment on function public.desfazer_sessao_adiantada(uuid, text) is
  'Desfaz o registro de sessão adiantada e devolve a linha a falta. Recusa se a guia já foi vinculada ao bloco — o vínculo ficaria órfão.';

revoke all on function public.desfazer_sessao_adiantada(uuid, text) from public, anon;
grant execute on function public.desfazer_sessao_adiantada(uuid, text) to authenticated;
