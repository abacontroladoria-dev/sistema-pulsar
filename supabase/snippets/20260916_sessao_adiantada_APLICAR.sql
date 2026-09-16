-- =============================================================================
-- APLICAR: sessão adiantada (Davi Lucas, 16/09) — 6 blocos, nesta ordem
-- =============================================================================
-- Gerado de supabase/migrations/20260916120*.sql. Conteúdo idêntico; aqui só
-- estão juntos e numerados para colar no SQL Editor.
--
-- COMO RODAR
-- Um BLOCO por vez, na ordem. Não cole o arquivo inteiro de uma vez: o SQL
-- Editor derruba comando longo e o "Failed to fetch" vem do navegador, não do
-- banco — você não saberia o que entrou.
--
-- A ordem importa: o bloco 3 usa a coluna que o bloco 1 cria, e os blocos 2 e 3
-- são cópias fiéis da mesma CTE. Parar no meio deixa a tela oferecendo candidata
-- que a gravação recusa.
--
-- VALIDADO em Postgres 15 efêmero antes de você receber: as 6 aplicam, o caso do
-- Davi resolve ponta a ponta, e as guardas recusam papel sem permissão,
-- justificativa curta, data igual à agendada, data a mais de 14 dias, dupla
-- marcação e desfazer com guia vinculada.
--
-- DEPOIS DE APLICAR, confira (deve devolver 1 linha, nenhuma):
--   select count(*) from fila_autorizacoes where data_atendimento_real is not null;
--   -- 0 antes de a Luana usar a tela; 1 depois do primeiro caso.
--
-- E o statement_timeout que o bloco 4 repõe:
--   select proname, proconfig from pg_proc
--    where proname in ('get_candidatas_vinculo','vincular_autorizacao');
--   -- as duas devem mostrar statement_timeout=55s
-- =============================================================================




-- ##########################################################################
-- BLOCO 1/6 — a coluna do fato e as duas RPCs (marcar / desfazer)
-- origem: 20260916120000_sessao_adiantada.sql
-- ##########################################################################

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


-- ##########################################################################
-- BLOCO 2/6 — fn_blocos_assim enxerga a sessão adiantada
-- origem: 20260916120100_fn_blocos_assim_data_real.sql
-- ##########################################################################

-- =============================================================================
-- fn_blocos_assim passa a enxergar a sessão adiantada
-- =============================================================================
-- Continuação de 20260916120000. Duas mudanças, e só duas:
--
--   1. A exceção nomeada no anti-join de falta: `f.data_atendimento_real is
--      null`. Sessão com data real registrada não é falta — houve atendimento,
--      em outro dia —, então ela não deve ser removida. O filtro segue intacto
--      para todas as outras faltas.
--
--   2. A função devolve `data_atendimento_real`, porque a guarda 6 de
--      vincular_autorizacao (20260821000000:628-632) lê o registro que vem
--      daqui. Sem a coluna, a exceção do item 1 traria o bloco de volta à tela e
--      a gravação continuaria recusando — a pior falha possível aqui é a tela
--      oferecer o que a escrita rejeita.
--
-- O bloco_id NÃO muda: continua montado sobre data_atendimento (a data da
-- AGENDA). Ele é a identidade da sessão na grade, referenciado por
-- autorizacoes_vinculos e auditoria_situacao_overrides. Trocá-lo pela data real
-- órfãria todo vínculo e todo override já gravados.
--
-- A CTE agenda_sem_falta é cópia fiel da de get_auditoria_assim_periodo por
-- desenho (20260821000000:156-168). A migration irmã 20260916120200 aplica a
-- MESMA exceção lá. As duas mudam juntas ou divergem.
--
-- O cast `f.paciente_id = a.paciente_id::text` é preservado como está: ele é a
-- correção medida de 20260824020000 (48.850 ms → sondagem de índice). Não
-- unificar com o cast oposto de get_auditoria_assim_periodo aqui; é outra
-- decisão, já anotada naquele arquivo (linhas 78-85).
-- =============================================================================

drop function if exists public.fn_blocos_assim(date, date);

create or replace function public.fn_blocos_assim(p_de date, p_ate date)
returns table (
  bloco_id              text,
  paciente_id           bigint,
  paciente_nome         text,
  empresa               text,
  matricula             text,
  dep                   text,
  data_atendimento      date,
  data_atendimento_real date,
  hora_inicial          time without time zone,
  codigo_tuss           text,
  convenio_nome         text,
  terapias              text,
  profissionais         text,
  quantidade_sessoes    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with agenda_tita_tuss as (
    select
      at.paciente_id,
      at.paciente_nome,
      at.data_atendimento,
      at.hora_inicial,
      at.terapia_nome,
      at.terapia_exibicao_nome,
      at.profissional_nome,
      at.convenio_nome,
      substring(at.numero_carteirinha, 1, 6)                         as empresa,
      substring(at.numero_carteirinha, 7, 7)                         as matricula,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2) as dep,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) as codigo_tuss
    from public.agenda_tita at
    where at.data_atendimento between p_de and p_ate
      and at.ativo = true
      and at.convenio_nome ilike '%assim%'
      and at.paciente_nome <> all (array['Horário Administrativo','Notificação Prévia'])
  ),
  agenda_filtrada as (
    select a.* from agenda_tita_tuss a
    where a.codigo_tuss is not null
      and not exists (
        select 1 from public.config_regras_terapias r
        where r.categoria = 'BLACKLIST_AUTORIZACAO'
          and r.ativo = true
          and a.terapia_nome ilike ('%' || r.terapia_nome || '%')
      )
  ),
  agenda_sem_falta as (
    select a.* from agenda_filtrada a
    where not exists (
      select 1 from public.fila_autorizacoes f
      -- O cast está sobre a coluna da AGENDA, não sobre a da fila. Invertido, o
      -- planner perde `paciente_id` como chave de junção, sobra só
      -- `data_atendimento` (7 valores distintos numa semana), e o merge join
      -- rebobina o lado interno 19 vezes — 119.712 linhas para descartar 114.012.
      -- Deste lado, as três igualdades casam com unique_fila_agendamento.
      where f.paciente_id = a.paciente_id::text
        and f.data_atendimento = a.data_atendimento
        and f.horario = a.hora_inicial
        -- Sessão adiantada não é falta: houve atendimento, em outra data. Ela
        -- volta à Conferência para poder receber o vínculo da guia órfã
        -- (20260916120000).
        and f.data_atendimento_real is null
        and (
          -- Linha em 'glosa' não é falta: o motivo por extenso pode conter a
          -- palavra FALTA ("FALTA DE COBERTURA CONTRATUAL") e a sessão sumiria
          -- da tela justamente quando mais precisa ser vista. Guarda idêntica à
          -- da RPC (20260820150000:211-218).
          (f.status is distinct from 'glosa'
           and upper(coalesce(f.status_assim, '')) like '%FALTA%')
          or upper(coalesce(f.tipo_falta, '')) like '%PACIENTE%'
          or upper(coalesce(f.tipo_falta, '')) like '%TERAPEUTA%'
        )
    )
      and a.terapia_nome not ilike '%Aplicador ABA Escola%'
      and a.terapia_nome not ilike '%Aplicador ABA Casa%'
      and a.terapia_nome not ilike '%Aplicador Suporte%'
      and a.terapia_nome not ilike '%Supervisão ABA%'
  )
  select
    concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) as bloco_id,
    asf.paciente_id,
    asf.paciente_nome,
    asf.empresa,
    asf.matricula,
    asf.dep,
    asf.data_atendimento,
    -- A data real da linha daquela sessão. Lateral porque a fila pode ter mais
    -- de uma linha para o mesmo horário quando o TUSS difere; pega a mais
    -- recente, como faz get_candidatas_vinculo (20260821000000:506-515).
    dr.data_atendimento_real,
    asf.hora_inicial,
    asf.codigo_tuss,
    asf.convenio_nome,
    string_agg(distinct asf.terapia_exibicao_nome, ' | ' order by asf.terapia_exibicao_nome) as terapias,
    string_agg(distinct asf.profissional_nome,     ' | ' order by asf.profissional_nome)     as profissionais,
    count(*) as quantidade_sessoes
  from agenda_sem_falta asf
  left join lateral (
    select f.data_atendimento_real
    from public.fila_autorizacoes f
    where f.paciente_id      = asf.paciente_id::text
      and f.data_atendimento = asf.data_atendimento
      and f.horario          = asf.hora_inicial
      and f.data_atendimento_real is not null
    order by coalesce(f.updated_at, f.created_at) desc
    limit 1
  ) dr on true
  group by asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
           asf.data_atendimento, dr.data_atendimento_real, asf.hora_inicial,
           asf.codigo_tuss, asf.convenio_nome
$$;

comment on function public.fn_blocos_assim(date, date) is
  'Blocos da Conferência ASSIM (cópia fiel da CTE blocos_auditoria de get_auditoria_assim_periodo). Existe porque a RPC completa estoura o statement_timeout em janelas largas e a reconciliação só precisa contar sessões por partição. A checagem de falta compara paciente_id com o cast do lado da agenda (a.paciente_id::text), e não sobre f.paciente_id: assim as três igualdades casam com unique_fila_agendamento e o anti-join vira sondagem de índice. Sessão com data_atendimento_real não é removida como falta e devolve a data efetiva, que é a que vincular_autorizacao usa na janela.';

grant execute on function public.fn_blocos_assim(date, date) to authenticated;


-- ##########################################################################
-- BLOCO 3/6 — get_auditoria_assim_periodo, a cópia irmã (a MAIOR: ~445 linhas)
-- origem: 20260916120200_auditoria_periodo_data_real.sql
-- ##########################################################################

-- =============================================================================
-- get_auditoria_assim_periodo passa a enxergar a sessão adiantada
-- =============================================================================
-- Migration irmã de 20260916120100, que fez o mesmo em fn_blocos_assim. As duas
-- mudam JUNTAS: a CTE agenda_sem_falta é cópia fiel entre elas por desenho
-- (20260821000000:156-168), e divergir faz a tela oferecer candidata que a
-- gravação recusa — a pior falha possível na reconciliação.
--
-- Corpo idêntico a 20260911120000 exceto por duas exceções nomeadas:
--
--   1. agenda_sem_falta: `AND f.data_atendimento_real IS NULL` no anti-join.
--      Sessão com data real registrada não é falta — houve atendimento, em
--      outro dia — então não deve ser removida da base.
--
--   2. fila_operacional: a mesma exceção, na forma negada. Sem ela a sessão
--      voltaria como bloco mas sem a linha da fila, e apareceria como
--      NAO_SOLICITADA em vez de trazer seu status real.
--
-- O cast `f.paciente_id::bigint = a.paciente_id` é preservado como está. Ele é o
-- lado errado para o índice (20260824020000:78-85 mede e documenta), mas trocá-lo
-- aqui é outra decisão, com outra medição; esta migration não se aproveita da
-- vizinhança para mudar o que não veio verificar.
--
-- A função é LANGUAGE sql STABLE sem proconfig — não há statement_timeout a
-- preservar neste CREATE OR REPLACE (ao contrário de get_candidatas_vinculo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_auditoria_assim_periodo(p_data_inicio date, p_data_fim date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, biofacial text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  WITH avulsas AS (
    SELECT guia, horario_autorizacao FROM public.guias_avulsas(p_data_inicio, p_data_fim)
  ),
  blocos_auditoria AS (
    WITH agenda_tita_tuss AS (
      SELECT
        at.paciente_id,
        at.paciente_nome,
        at.data_atendimento,
        at.hora_inicial,
        at.terapia_nome,
        at.terapia_exibicao_nome,
        at.profissional_nome,
        at.convenio_nome,
        at.numero_carteirinha,
        substring(at.numero_carteirinha, 1, 6)                                   AS empresa,
        substring(at.numero_carteirinha, 7, 7)                                   AS matricula,
        right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)           AS dep,
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
      FROM agenda_tita at
      WHERE at.data_atendimento BETWEEN p_data_inicio AND p_data_fim
        AND at.ativo = true
        AND at.convenio_nome ILIKE '%assim%'
        AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo','Notificação Prévia'])
    ),
    agenda_filtrada AS (
      SELECT a.*
      FROM agenda_tita_tuss a
      WHERE a.codigo_tuss IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM config_regras_terapias r
          WHERE r.categoria = 'BLACKLIST_AUTORIZACAO'
            AND r.ativo = true
            AND a.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
        )
    ),
    agenda_sem_falta AS (
      SELECT a.*
      FROM agenda_filtrada a
      WHERE NOT EXISTS (
        SELECT 1 FROM fila_autorizacoes f
        WHERE f.paciente_id::bigint = a.paciente_id
          AND f.data_atendimento = a.data_atendimento
          AND f.horario = a.hora_inicial
          -- Sessao adiantada nao e falta: houve atendimento, em outra data
          -- (20260916120000). Ela volta a Conferencia com a data efetiva.
          AND f.data_atendimento_real IS NULL
          AND (
            (f.status IS DISTINCT FROM 'glosa'
             AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
          )
      )
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Escola%'
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Casa%'
        AND a.terapia_nome NOT ILIKE '%Aplicador Suporte%'
        AND a.terapia_nome NOT ILIKE '%Supervisão ABA%'
    )
    SELECT
      concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) AS bloco_id,
      asf.paciente_id::text,
      asf.paciente_nome,
      asf.empresa,
      asf.matricula,
      asf.dep,
      concat_ws('.', asf.empresa, asf.matricula, asf.dep) AS carteirinha,
      asf.data_atendimento,
      asf.hora_inicial,
      asf.codigo_tuss,
      asf.convenio_nome,
      string_agg(DISTINCT asf.terapia_exibicao_nome, ' | ' ORDER BY asf.terapia_exibicao_nome) AS terapias,
      string_agg(DISTINCT asf.profissional_nome,     ' | ' ORDER BY asf.profissional_nome)     AS profissionais,
      count(*) AS quantidade_sessoes
    FROM agenda_sem_falta asf
    GROUP BY asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
             asf.data_atendimento, asf.hora_inicial, asf.codigo_tuss, asf.convenio_nome
  ),
  fila_operacional AS (
    SELECT DISTINCT ON (f.paciente_id, f.data_atendimento, f.horario, f.tuss)
      f.empresa, f.matricula, f.dep, f.paciente_id, f.data_atendimento, f.horario,
      f.tuss AS codigo_tuss,
      COALESCE(f.updated_at, f.created_at) AS ultimo_updated_at,
      f.criado_por,
      f.forma_autorizacao,
      f.horario_autorizacao,
      f.status,
      f.status_assim,
      f.numero_autorizacao,
      f.numero_autorizacao_origem,
      f.error_message,
      CASE
        WHEN f.status = 'glosa' AND f.status_assim ~ '^\s*\d{3,5}\s*-'
          THEN btrim(split_part(f.status_assim, '-', 1))
      END AS glosa_codigo,
      CASE
        WHEN f.status = 'glosa'
          THEN nullif(btrim(regexp_replace(f.status_assim, '^\s*\d{3,5}\s*-\s*', '')), '')
      END AS glosa_descricao
    FROM fila_autorizacoes f
    WHERE f.data_atendimento BETWEEN p_data_inicio AND p_data_fim
      AND NOT (
        f.data_atendimento_real IS NULL
        AND (
          (f.status IS DISTINCT FROM 'glosa'
           AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
          OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
          OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
        )
      )
    ORDER BY f.paciente_id, f.data_atendimento, f.horario, f.tuss,
             COALESCE(f.updated_at, f.created_at) DESC
  ),
  match_temporal AS (
    WITH sessoes AS (
      SELECT
        b1.bloco_id, b1.paciente_id, b1.paciente_nome, b1.empresa, b1.matricula, b1.dep,
        b1.carteirinha, b1.data_atendimento, b1.hora_inicial, b1.codigo_tuss,
        b1.convenio_nome, b1.terapias, b1.profissionais, b1.quantidade_sessoes,
        row_number() OVER (
          PARTITION BY b1.empresa, b1.matricula, b1.dep, b1.data_atendimento, b1.codigo_tuss
          ORDER BY b1.hora_inicial
        ) AS ordem_sessao
      FROM blocos_auditoria b1
    ),
    autorizacoes AS (
      SELECT
        aa.guia, aa.matricula, aa.paciente_nome, aa.data_execucao, aa.data_autorizacao,
        aa.status, aa.codigo_tuss, aa.codigo_erro, aa.descricao_erro,
        aa.teve_token, aa.updated_at, aa.token, aa.status_tratado, aa.matricula_limpa, aa.paciente_id,
        aa.biofacial,
        split_part(aa.matricula, '.', 1)               AS empresa,
        split_part(aa.matricula, '.', 2)               AS matricula_base,
        split_part(aa.matricula, '.', 3)               AS dep,
        row_number() OVER (
          PARTITION BY split_part(aa.matricula,'.',1), split_part(aa.matricula,'.',2),
                       split_part(aa.matricula,'.',3), date(aa.data_execucao), aa.codigo_tuss
          -- A AVULSA por último: ela não corresponde a sessão nenhuma
          -- (20260825130000:54), então não pode disputar posição com quem
          -- corresponde. `false` ordena antes de `true`. Mesma ordem de
          -- get_guias_orfas, obrigatoriamente (20260910130000).
          ORDER BY (av.guia IS NOT NULL), aa.data_execucao
        ) AS ordem_autorizacao
      FROM autorizacoes_assim aa
      -- Marca sem EXCLUIR: tirar a avulsa da partição renumeraria as outras.
      -- Por guia + tempo, porque o número da guia recicla.
      LEFT JOIN avulsas av
        ON  av.guia = aa.guia
        AND av.horario_autorizacao BETWEEN aa.data_execucao - interval '5 minutes'
                                       AND aa.data_execucao + interval '5 minutes'
      WHERE date(aa.data_execucao) BETWEEN p_data_inicio AND p_data_fim
        AND NOT EXISTS (
          SELECT 1 FROM public.autorizacoes_vinculos v
          WHERE v.guia = aa.guia AND v.desfeito_em IS NULL
        )
    )
    SELECT DISTINCT ON (s.bloco_id)
      s.bloco_id,
      a.guia, a.status, a.codigo_erro, a.descricao_erro, a.data_execucao, a.updated_at,
      a.teve_token, a.token, a.biofacial,
      EXTRACT(epoch FROM a.data_execucao::time - s.hora_inicial) / 60 AS diferenca_minutos
    FROM sessoes s
    LEFT JOIN autorizacoes a
      ON  a.empresa        = s.empresa
      AND a.matricula_base  = s.matricula
      AND a.dep            = s.dep
      AND date(a.data_execucao) = s.data_atendimento
      AND a.codigo_tuss    = s.codigo_tuss
      AND a.ordem_autorizacao = s.ordem_sessao
    ORDER BY s.bloco_id, a.updated_at DESC
  )
  SELECT
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.empresa,
    b.matricula,
    b.dep,
    b.carteirinha,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.convenio_nome,
    b.terapias,
    b.profissionais,
    b.quantidade_sessoes,
    COALESCE(mt.guia, fo.numero_autorizacao)               AS guia,
    COALESCE(mt.status, fo.status_assim)                   AS status_assim,
    er.codigo                                              AS codigo_erro,
    ed.descricao                                           AS descricao_erro,
    mt.data_execucao AT TIME ZONE 'America/Sao_Paulo'     AS data_execucao,
    mt.updated_at    AT TIME ZONE 'America/Sao_Paulo'     AS autorizacao_updated_at,
    mt.diferenca_minutos,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL               THEN ovr.situacao_nova
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'  THEN 'GLOSA_RESOLVIDA'
      WHEN vin.guia IS NOT NULL                        THEN 'LIBERADA'
      ELSE sb.base
    END                                                   AS situacao,
    CASE
      WHEN ovr.situacao_nova IN ('FALTA', 'FALTA_TERAPEUTA') THEN 7
      WHEN ovr.situacao_nova = 'CANCELADA'            THEN 5
      WHEN ovr.situacao_nova = 'NAO_SOLICITADA'       THEN 1
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA' THEN 6
      WHEN vin.guia IS NOT NULL                       THEN 6
      WHEN sb.base = 'GLOSA'                          THEN 2
      WHEN sb.base = 'CANCELADA'                      THEN 5
      WHEN sb.base = 'LIBERADA'                       THEN 6
      WHEN sb.base = 'SOLICITACAO_CANCELADA'          THEN 1
      WHEN sb.base = 'SINCRONIZANDO'                  THEN 4
      WHEN sb.base = 'RETORNO_NAO_CONFIRMADO'         THEN 3
      WHEN sb.base = 'NAO_SOLICITADA'                 THEN 1
      ELSE 1
    END                                                   AS prioridade,
    (CURRENT_DATE - b.data_atendimento)::integer          AS dias_atraso,
    ((mt.status = 'Liberado')
      OR (fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL)
      OR vin.guia IS NOT NULL)                            AS possui_autorizacao,
    (fo.paciente_id IS NOT NULL)                          AS possui_solicitacao,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL
        THEN concat(ob.base, ' · Reclassificado de ', ovr.situacao_anterior,
                    ' para ', ovr.situacao_nova, ' por ', ovr.reclassificado_por,
                    ' em ', to_char(ovr.reclassificado_em AT TIME ZONE 'America/Sao_Paulo',
                                    'DD/MM/YYYY HH24:MI'),
                    ' — ', ovr.justificativa)
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'
        THEN concat(ob.base, ' · Coberta pela guia ', vin.guia,
                    ' de ', to_char(vin.data_execucao, 'DD/MM/YYYY HH24:MI'),
                    ' — vínculo por ', vin.vinculado_por)
      WHEN vin.guia IS NOT NULL
        THEN concat('Autorização confirmada pela ASSIM (guia ', vin.guia,
                    ', vínculo por ', vin.vinculado_por, ')')
      ELSE ob.base
    END                                                   AS observacao,
    agm.motivo_glosa,
    mt.teve_token,
    mt.token,
    -- ── `biofacial`, para a tela poder ver o `8-` ──────────────────────────
    -- Já resolvido pela precedência vínculo → posicional, como `guia` e
    -- `status_assim` também chegam: a regra de precedência mora aqui, não
    -- duplicada em TypeScript. O frontend compara por PREFIXO (o extrato trunca
    -- o rótulo em 25 chars e o vocabulário não é fechado) e nunca pelo texto de
    -- `forma_validacao_do_biofacial`, que devolve 'Token' quando o `8-` veio com
    -- token — casar pelo rótulo perderia 97 dos 106 casos medidos.
    COALESCE(vin.vin_biofacial, mt.biofacial)             AS biofacial,
    fo.criado_por,
    -- ── Ordem do COALESCE: a RESPOSTA da ASSIM antes da INTENÇÃO da recepção ──
    -- Mesma precedência que 20260903010000 estabeleceu e que get_tokens_mensal
    -- roda em produção desde 03/09 (20260910130000:1031-1039). Aqui ela nunca
    -- chegou: a RPC diária ficou com `fo` na frente, e `fo.forma_autorizacao`
    -- nunca é nulo quando a sessão foi solicitada pelo Pulsar — então o ramo do
    -- biofacial jamais era avaliado e a tela mostrava o clique da recepção como
    -- se fosse a resposta da ASSIM.
    --
    -- Caso real: ADRIAN ARAUJO NERY, 01/09/2026 10:00, guia 5665, biofacial
    -- '8-DISPOSITIVO INDISPONIVEL', SEM token, status Liberado. O modal lia
    -- FORMA = 'Token' numa sessão que não teve token nenhum.
    --
    -- `fo` continua como último degrau: quando a ASSIM não respondeu
    -- (RETORNO_NAO_CONFIRMADO, `mt` todo nulo), o registro da recepção é a única
    -- evidência que existe. O degrau do meio só é alcançável porque
    -- `forma_validacao_do_biofacial` devolve NULL — e não uma string — para
    -- biofacial nulo ou código desconhecido (20260821080000:109-111).
    COALESCE(
      public.forma_validacao_do_biofacial(vin.vin_biofacial, vin.vin_teve_token),
      public.forma_validacao_do_biofacial(mt.biofacial,      mt.teve_token),
      fo.forma_autorizacao
    )                                                     AS forma_autorizacao,
    fo.horario_autorizacao,
    CASE
      WHEN fo.numero_autorizacao IS NOT NULL THEN fo.numero_autorizacao_origem
      WHEN mt.guia               IS NOT NULL THEN 'relatorio'
      ELSE NULL
    END                                                   AS guia_origem,
    -- ── Metadados crus da reclassificação, para o modal montar sua própria
    -- seção em vez de depender só da frase concatenada em `observacao`.
    -- NULL em todo bloco sem reclassificação ativa.
    ovr.situacao_anterior                                 AS reclassificacao_situacao_anterior,
    ovr.justificativa                                      AS reclassificacao_justificativa,
    ovr.reclassificado_por                                 AS reclassificacao_por,
    ovr.reclassificado_em                                  AS reclassificacao_em
  FROM blocos_auditoria b
  LEFT JOIN match_temporal mt        ON mt.bloco_id = b.bloco_id
  LEFT JOIN fila_operacional fo
    ON  fo.paciente_id      = b.paciente_id
    AND fo.data_atendimento = b.data_atendimento
    AND fo.codigo_tuss      = b.codigo_tuss
    AND fo.horario          = b.hora_inicial
  LEFT JOIN auditoria_glosa_motivos agm ON agm.bloco_id = b.bloco_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        mt.codigo_erro,
        CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
             THEN btrim(split_part(mt.status, '-', 1)) END,
        fo.glosa_codigo
      ) AS codigo,
      CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
           THEN nullif(btrim(regexp_replace(
                  regexp_replace(mt.status, '^\s*\d{3,5}\s*-\s*', ''),
                  '\s*\*\s*$', '')), '')
      END AS descricao_relatorio
  ) er ON true
  LEFT JOIN public.glosa_codigos gc ON gc.codigo = er.codigo
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      mt.descricao_erro,
      gc.descricao,
      fo.glosa_descricao,
      er.descricao_relatorio,
      fo.error_message
    ) AS descricao
  ) ed ON true
  LEFT JOIN LATERAL (
    SELECT v.guia, v.guia_original, v.vinculado_por, v.vinculado_em, aa2.data_execucao,
           -- ── As colunas que faltavam para o vínculo poder opinar ───────────
           -- O `vin` de get_tokens_mensal já as projeta (20260910130000:1051).
           -- Sem elas, o ramo do vínculo em `forma_autorizacao` era literalmente
           -- inescrevível — foi assim que ele sumiu entre 20260827000004 e hoje.
           --
           -- Alias `vin_*` porque `teve_token` é nome de COLUNA DE SAÍDA desta
           -- função; get_tokens_mensal não precisa disso porque lá esse nome não
           -- é emitido. `aa2.token` fica de fora: `token` continua saindo cru de
           -- `mt` (ver a dívida no cabeçalho), então projetá-lo aqui seria peso
           -- morto — e mudar isso é o outro assunto, não este.
           aa2.teve_token AS vin_teve_token,
           aa2.biofacial  AS vin_biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia
    WHERE v.bloco_id = b.bloco_id
      AND v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
    LIMIT 1
  ) vin ON true
  LEFT JOIN LATERAL (
    SELECT o.situacao_anterior, o.situacao_nova, o.justificativa,
           o.reclassificado_por, o.reclassificado_em
    FROM public.auditoria_situacao_overrides o
    WHERE o.bloco_id = b.bloco_id
      AND o.desfeito_em IS NULL
    LIMIT 1
  ) ovr ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
                                                              THEN 'GLOSA'
          WHEN mt.status = 'Liberado *'                      THEN 'CANCELADA'
          WHEN mt.status = 'Liberado'                        THEN 'LIBERADA'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
                                                              THEN 'LIBERADA'
          WHEN fo.status = 'glosa'                            THEN 'GLOSA'
          WHEN fo.status IN ('erro', 'cancelado')             THEN 'SOLICITACAO_CANCELADA'
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
                                                              THEN 'SINCRONIZANDO'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
                                                              THEN 'RETORNO_NAO_CONFIRMADO'
          ELSE                                                     'NAO_SOLICITADA'
    END AS base
  ) sb ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
            THEN concat('Glosa: ',
                   COALESCE(er.codigo, mt.status, 'Erro não identificado'),
                   CASE WHEN ed.descricao IS NOT NULL THEN concat(' - ', ed.descricao) ELSE '' END)
          WHEN mt.status = 'Liberado' AND mt.teve_token = true
            THEN concat('TOKEN - ', mt.token)
          WHEN mt.status = 'Liberado'    THEN 'Autorização confirmada pela ASSIM'
          WHEN mt.status = 'Liberado *'  THEN 'Autorização cancelada'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
            THEN 'Autorização confirmada pela ASSIM'
          WHEN fo.status = 'glosa'
            THEN concat('Glosa: ',
                   COALESCE(
                     nullif(concat_ws(' - ', er.codigo, ed.descricao), ''),
                     fo.error_message,
                     'Erro não identificado'))
          WHEN fo.status = 'erro'
            THEN COALESCE(fo.error_message, 'A solicitação não chegou ao fim na ASSIM.')
          WHEN fo.status = 'cancelado'
            THEN COALESCE(fo.error_message, 'Solicitação cancelada antes da conclusão.')
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
            THEN 'Solicitação enviada.'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
            THEN 'Solicitação enviada, mas o retorno da ASSIM ainda não foi confirmado.'
          ELSE 'Nenhuma solicitação encontrada'
    END AS base
  ) ob ON true
  WHERE COALESCE(b.terapias, '') NOT ILIKE '%Equoterapia%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Fisioterapia Aquática%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Avaliação Neuropsicológica%'
  ORDER BY prioridade, hora_inicial
$function$
;

comment on function public.get_auditoria_assim_periodo(date, date) is
  'Conferência ASSIM por período. Considera public.autorizacoes_vinculos e public.auditoria_situacao_overrides. Devolve guia_origem e os metadados crus da reclassificação ativa (reclassificacao_situacao_anterior, reclassificacao_justificativa, reclassificacao_por, reclassificacao_em), para o detalhamento mostrar a decisão em vez de só a situação final.';

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim_periodo(date, date) TO anon, authenticated;


-- ##########################################################################
-- BLOCO 4/6 — a janela do vínculo passa a usar a data real
-- origem: 20260916120300_vinculo_usa_data_real.sql
-- ##########################################################################

-- =============================================================================
-- A janela do vínculo passa a comparar contra a data REAL do atendimento
-- =============================================================================
-- Fecha o trio de 20260916120000/120100/120200. Duas funções mudam.
--
-- A JANELA CONTINUA RETROATIVA
-- Não se abre `exec + N`. A regra segue sendo "a sessão é anterior ou igual à
-- data_execucao da guia", que é a semântica do domínio: a autorização ASSIM é
-- tirada no atendimento ou depois dele, nunca antes.
--
-- O que muda é CONTRA O QUE se compara. Até aqui a guarda olhava
-- data_atendimento — a data da AGENDA. Quando a sessão foi adiantada, essa data
-- é justamente a que NÃO descreve o atendimento. Passa a olhar
-- coalesce(data_atendimento_real, data_atendimento): para 100% das sessões
-- normais nada muda, e para a sessão adiantada a comparação passa a usar o dia
-- em que o atendimento de fato ocorreu.
--
-- No caso que originou (Davi Lucas): bloco de 16/09 com data real 15/09, guia
-- com data_execucao 15/09 08:26. Data efetiva 15/09 <= 15/09 → dentro da janela.
-- Sem a data real registrada, 16/09 > 15/09 → fora, como sempre foi.
--
-- POR QUE O generate_series PRECISA DE UM DIA A MAIS
-- get_candidatas_vinculo varre dia a dia por data de AGENDA, e o bloco adiantado
-- mora na data agendada (16/09), fora de [exec-7, exec]. Sem estender a varredura
-- ele nunca seria encontrado — a guarda estaria certa e a tela continuaria vazia.
--
-- A extensão é de 1 dia e só serve para ALCANÇAR o bloco; quem decide se ele
-- entra é o filtro pela data efetiva, logo abaixo. Uma sessão de 16/09 sem data
-- real registrada é varrida e descartada no mesmo statement.
--
-- Custo: 9 fatias em vez de 8 (+12,5%), sob o mesmo statement_timeout de 55s. Foi
-- o menor incremento que resolve o caso; 14 dias (o teto de
-- marcar_sessao_adiantada) custaria 22 fatias e não foi medido.
--
-- O statement_timeout de get_candidatas_vinculo é reposto explicitamente:
-- CREATE OR REPLACE FUNCTION descarta proconfig, e sem o SET a função voltaria ao
-- default e penduraria a tela na fatia patológica.
-- =============================================================================

-- =============================================================================
-- 1. get_candidatas_vinculo — alcança e filtra pela data efetiva
-- =============================================================================
-- DROP antes do CREATE porque o retorno ganha `data_atendimento_real`, e
-- CREATE OR REPLACE não muda tipo de retorno (42P13). Só esta função e as outras
-- duas cujo retorno mudou levam DROP; `vincular_autorizacao`, abaixo, mantém a
-- assinatura e é substituída em REPLACE.
drop function if exists public.get_candidatas_vinculo(text, integer);

create or replace function public.get_candidatas_vinculo(
  p_guia         text,
  p_janela_dias  integer default 7
)
returns table (
  bloco_id           text,
  paciente_id        text,
  paciente_nome      text,
  data_atendimento   date,
  hora_inicial       time without time zone,
  codigo_tuss        text,
  terapias           text,
  profissionais      text,
  quantidade_sessoes bigint,
  situacao           text,
  guia_atual         text,
  status_assim       text,
  motivo_glosa_codigo    text,
  motivo_glosa_descricao text,
  observacao         text,
  fila_id            uuid,
  distancia_horas    numeric,
  ja_vinculado       boolean,
  elegivel           boolean,
  data_atendimento_real date
)
language plpgsql
stable
security definer
set search_path = public
-- Abaixo do limite do gateway REST do Supabase. O caso típico são ~9 fatias de
-- 1-3s; o teto existe para a fatia patológica não pendurar a tela.
set statement_timeout = '55s'
as $$
declare
  v_g       record;
  v_empresa text;
  v_matric  text;
  v_dep     text;
  v_de      date;
  v_ate     date;
begin
  if p_janela_dias is null or p_janela_dias < 0 or p_janela_dias > 60 then
    raise exception 'Janela inválida: % (esperado 0..60)', p_janela_dias
      using errcode = '22023';
  end if;

  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status
    into v_g
  from public.autorizacoes_assim aa
  where aa.guia = p_guia;

  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia
      using errcode = 'P0002';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS — não é reconciliável', p_guia
      using errcode = '22023';
  end if;

  v_empresa := split_part(v_g.matricula, '.', 1);
  v_matric  := split_part(v_g.matricula, '.', 2);
  v_dep     := split_part(v_g.matricula, '.', 3);
  v_ate     := date(v_g.data_execucao);
  v_de      := v_ate - p_janela_dias;

  return query
  with cand as (
    select
      a.bloco_id, a.paciente_id, a.paciente_nome, a.data_atendimento,
      a.hora_inicial, a.codigo_tuss, a.terapias, a.profissionais,
      a.quantidade_sessoes, a.situacao,
      a.guia         as guia_atual,
      a.status_assim,
      -- motivo_glosa da RPC já vem resolvido pelo de-para glosa_codigos; aqui só
      -- separamos código e texto com a mesma regra de frontend/lib/glosa.ts:27-40
      nullif(btrim(substring(coalesce(a.motivo_glosa, a.descricao_erro, '') from '^\s*(\d{3,5})\s*-')), '') as mg_cod,
      nullif(btrim(regexp_replace(coalesce(a.motivo_glosa, a.descricao_erro, ''), '^\s*\d{3,5}\s*-\s*', '')), '') as mg_desc,
      a.observacao
    -- +1 dia para ALCANÇAR o bloco de uma sessão adiantada, que mora na data
    -- agendada (posterior à execução da guia). Quem decide se ele entra é o
    -- filtro por data efetiva abaixo, não esta varredura.
    from generate_series(v_de, v_ate + 1, interval '1 day') g(dia)
    cross join lateral public.get_auditoria_assim_periodo(g.dia::date, g.dia::date) a
    where a.empresa     = v_empresa
      and a.matricula   = v_matric
      and a.dep         = v_dep
      and a.codigo_tuss = v_g.codigo_tuss
  ),
  cand_efetiva as (
    select c.*, coalesce(dr.data_atendimento_real, c.data_atendimento) as data_efetiva,
           dr.data_atendimento_real
    from cand c
    left join lateral (
      select f.data_atendimento_real
      from public.fila_autorizacoes f
      where f.paciente_id      = c.paciente_id
        and f.data_atendimento = c.data_atendimento
        and f.horario          = c.hora_inicial
        and f.data_atendimento_real is not null
      order by coalesce(f.updated_at, f.created_at) desc
      limit 1
    ) dr on true
  )
  select
    c.bloco_id,
    c.paciente_id,
    c.paciente_nome,
    c.data_atendimento,
    c.hora_inicial,
    c.codigo_tuss,
    c.terapias,
    c.profissionais,
    c.quantidade_sessoes,
    c.situacao,
    c.guia_atual,
    c.status_assim,
    c.mg_cod,
    c.mg_desc,
    c.observacao,
    fa.id as fila_id,
    -- Distância medida da data EFETIVA: numa sessão adiantada é ela que descreve
    -- quando o atendimento ocorreu, e é por ela que a ordenação faz sentido.
    round(extract(epoch from (v_g.data_execucao - (c.data_efetiva + c.hora_inicial))) / 3600.0, 2) as distancia_horas,
    (vin.guia is not null) as ja_vinculado,
    -- Elegível = ainda não coberta e ainda não vinculada. LIBERADA fica visível
    -- de propósito, marcada como não-elegível: é a informação que faz o operador
    -- perceber que a guia é extra e usar "sem sessão correspondente" (39% das
    -- órfãs medidas caem nesse caso).
    (vin.guia is null and c.situacao <> 'LIBERADA') as elegivel,
    c.data_atendimento_real
  from cand_efetiva c
  -- a linha da fila daquela sessão, pelos 4 campos naturais que a RPC usa
  -- (20260820150000:443-447)
  left join lateral (
    select f.id
    from public.fila_autorizacoes f
    where f.paciente_id      = c.paciente_id
      and f.data_atendimento = c.data_atendimento
      and f.tuss             = c.codigo_tuss
      and f.horario          = c.hora_inicial
    order by coalesce(f.updated_at, f.created_at) desc
    limit 1
  ) fa on true
  left join public.autorizacoes_vinculos vin
    on vin.bloco_id = c.bloco_id and vin.desfeito_em is null and vin.tipo = 'vinculo'
  -- A janela, agora sobre a data efetiva. Mesma regra retroativa de sempre: é o
  -- espelho exato da guarda 6 de vincular_autorizacao. Descarta o dia extra que
  -- o generate_series varreu sem ter data real.
  where c.data_efetiva between v_ate - p_janela_dias and v_ate
  order by
    case c.situacao
      when 'GLOSA'                  then 1
      when 'NAO_SOLICITADA'         then 2
      when 'RETORNO_NAO_CONFIRMADO' then 3
      when 'SINCRONIZANDO'          then 4
      when 'CANCELADA'              then 5
      else 6
    end,
    abs(extract(epoch from (v_g.data_execucao - (c.data_efetiva + c.hora_inicial)))),
    c.hora_inicial;
end;
$$;

comment on function public.get_candidatas_vinculo(text, integer) is
  'Sessões candidatas a receber a cobertura de uma guia órfã: mesmo beneficiário, mesmo TUSS, janela retroativa (default 7 dias, medido na Etapa 0) medida sobre coalesce(data_atendimento_real, data_atendimento). Varre um dia a mais para alcançar sessões adiantadas, que moram na data agendada. Nunca vincula — só ordena por relevância.';

grant execute on function public.get_candidatas_vinculo(text, integer) to authenticated;


-- =============================================================================
-- 2. vincular_autorizacao — a guarda 6 sobre a data efetiva
-- =============================================================================
-- Corpo idêntico a 20260821000000:541-678 exceto pela guarda 6. Recriado inteiro
-- porque é plpgsql: não há como trocar um IF sem reescrever a função.
create or replace function public.vincular_autorizacao(
  p_guia        text,
  p_bloco_id    text,
  p_fila_id     uuid    default null,
  p_observacao  text    default null,
  p_janela_dias integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
set statement_timeout = '55s'
as $$
declare
  v_role   text := public.fn_usuario_role();
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_g      record;
  v_b      record;
  v_pac    bigint;
  v_data   date;
  v_tuss   text;
  v_hora   time;
  v_gorig  text;
  v_id     uuid;
  v_efetiva date;
begin
  if v_role is null or v_role not in ('admin', 'autorizacao', 'recepcao') then
    raise exception 'Sem permissão para vincular autorizações'
      using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = v_uid;

  -- 1) a guia existe, está liberada e não foi triada
  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status
    into v_g
  from public.autorizacoes_assim aa where aa.guia = p_guia;
  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia using errcode = 'P0002';
  end if;
  if v_g.status is distinct from 'Liberado' then
    raise exception 'Guia % não está liberada (status: %). Só autorização liberada cobre sessão.',
      p_guia, coalesce(v_g.status, '(nulo)') using errcode = '22023';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS', p_guia using errcode = '22023';
  end if;
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.guia = p_guia and v.desfeito_em is null) then
    raise exception 'Guia % já foi triada. Desfaça o vínculo atual antes de refazer.', p_guia
      using errcode = '23505';
  end if;

  -- 2) o bloco_id é bem formado. Formato: pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS
  begin
    v_pac  := split_part(p_bloco_id, '_', 1)::bigint;
    v_data := split_part(p_bloco_id, '_', 2)::date;
    v_tuss := split_part(p_bloco_id, '_', 3);
    v_hora := split_part(p_bloco_id, '_', 4)::time;
  exception when others then
    raise exception 'bloco_id malformado: % (esperado pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS)', p_bloco_id
      using errcode = '22023';
  end;

  -- 3) o bloco existe de fato na Conferência daquele dia
  select * into v_b
  from public.fn_blocos_assim(v_data, v_data) b
  where b.bloco_id = p_bloco_id;
  if not found then
    raise exception 'Bloco % não existe na Conferência de % (sessão inativa, reagendada ou fora do recorte ASSIM)',
      p_bloco_id, v_data using errcode = 'P0002';
  end if;

  -- 4) mesmo beneficiário
  if v_b.empresa   is distinct from split_part(v_g.matricula, '.', 1)
  or v_b.matricula is distinct from split_part(v_g.matricula, '.', 2)
  or v_b.dep       is distinct from split_part(v_g.matricula, '.', 3) then
    raise exception 'Beneficiário divergente: guia % é de %, bloco é de %.%.%',
      p_guia, v_g.matricula, v_b.empresa, v_b.matricula, v_b.dep using errcode = '22023';
  end if;

  -- 5) mesmo TUSS. A v.1 não reconcilia entre TUSS diferentes.
  if v_b.codigo_tuss is distinct from v_g.codigo_tuss then
    raise exception 'TUSS divergente: guia % é %, bloco é %',
      p_guia, v_g.codigo_tuss, v_b.codigo_tuss using errcode = '22023';
  end if;

  -- 6) dentro da janela retroativa permitida, medida sobre a data EFETIVA do
  --    atendimento. Numa sessão adiantada (20260916120000) a data da agenda não
  --    descreve quando o atendimento ocorreu; a data real, sim. A regra segue
  --    retroativa: não existe cobrir sessão que ainda não aconteceu.
  v_efetiva := coalesce(v_b.data_atendimento_real, v_b.data_atendimento);
  if v_efetiva > date(v_g.data_execucao)
  or v_efetiva < date(v_g.data_execucao) - p_janela_dias then
    raise exception 'Sessão de % fora da janela de % dias da autorização (%)',
      v_efetiva, p_janela_dias, date(v_g.data_execucao) using errcode = '22023';
  end if;

  -- 7) o bloco ainda não está coberto por outra guia
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.bloco_id = p_bloco_id and v.desfeito_em is null and v.tipo = 'vinculo') then
    raise exception 'Sessão % já está coberta por outra guia', p_bloco_id
      using errcode = '23505';
  end if;

  -- 8) se veio fila_id, ela tem de ser a linha DAQUELE bloco. Sem esta guarda o
  --    rastro apontaria para a solicitação de outra sessão.
  if p_fila_id is not null then
    if not exists (
      select 1 from public.fila_autorizacoes f
      where f.id = p_fila_id
        and f.paciente_id::bigint = v_pac
        and f.data_atendimento    = v_data
        and f.tuss                = v_tuss
        and f.horario             = v_hora
    ) then
      raise exception 'fila_id % não corresponde ao bloco %', p_fila_id, p_bloco_id
        using errcode = '22023';
    end if;
  end if;

  -- guia_original: congelada agora, porque é o histórico da glosa que dá sentido
  -- ao vínculo e numero_autorizacao pode ser sobrescrito depois pelo sync.
  select f.numero_autorizacao into v_gorig
  from public.fila_autorizacoes f
  where f.paciente_id::bigint = v_pac
    and f.data_atendimento    = v_data
    and f.tuss                = v_tuss
    and f.horario             = v_hora
  order by coalesce(f.updated_at, f.created_at) desc
  limit 1;

  insert into public.autorizacoes_vinculos
    (guia, tipo, bloco_id, fila_id, guia_original, observacao,
     vinculado_por, vinculado_por_id)
  values
    (p_guia, 'vinculo', p_bloco_id, p_fila_id, v_gorig, nullif(btrim(p_observacao), ''),
     coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.vincular_autorizacao(text, text, uuid, text, integer) is
  'Vincula uma guia ASSIM órfã à sessão que ela cobre. Valida beneficiário, TUSS, janela e unicidade no servidor. A janela é retroativa e medida sobre coalesce(data_atendimento_real, data_atendimento). Não escreve em fila_autorizacoes nem em autorizacoes_assim.';

grant execute on function public.vincular_autorizacao(text, text, uuid, text, integer) to authenticated;


-- ##########################################################################
-- BLOCO 5/6 — get_faltas_auditoria_assim devolve fila_id
-- origem: 20260916120400_faltas_auditoria_expoe_fila_id.sql
-- ##########################################################################

-- =============================================================================
-- get_faltas_auditoria_assim devolve o id da fila e some com a adiantada
-- =============================================================================
-- Duas mudanças, ambas exigidas por 20260916120000.
--
--   1. `fila_id`. A tela monta o cartão de falta como bloco sintético
--      (`falta_<paciente>_<data>_<hora>_<tuss>`, auditoria-assim.service.ts:38),
--      que não tem contraparte no banco. Para chamar marcar_sessao_adiantada o
--      frontend precisa da linha exata. Resolver por (paciente, data, horário,
--      tuss) no cliente é como nascem as divergências — a RPC já sabe qual linha
--      é, então ela devolve.
--
--   2. `AND f.data_atendimento_real IS NULL`. Sem isto a sessão adiantada
--      apareceria DUAS vezes na grade: como cartão de falta (por esta RPC) e como
--      bloco real (por get_auditoria_assim_periodo, que 20260916120200 ensinou a
--      trazê-la de volta). O operador veria a mesma sessão em dois estados
--      contraditórios no mesmo horário.
--
-- Corpo idêntico a 20260819100000:246-280 no resto. DROP antes do CREATE porque a
-- assinatura de retorno muda (coluna nova); CREATE OR REPLACE recusaria.
-- =============================================================================

drop function if exists public.get_faltas_auditoria_assim(date);

CREATE OR REPLACE FUNCTION public.get_faltas_auditoria_assim(p_data date)
 RETURNS TABLE(fila_id uuid, paciente_id text, paciente_nome text, data_atendimento date, hora_inicial time without time zone, tuss text, terapia_nome text, tipo_falta text, profissional_nome text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    f.id AS fila_id,
    f.paciente_id::text,
    f.paciente_nome,
    f.data_atendimento,
    f.horario AS hora_inicial,
    f.tuss,
    f.terapia_nome,
    f.tipo_falta,
    (SELECT string_agg(DISTINCT at2.profissional_nome, ' | ' ORDER BY at2.profissional_nome)
     FROM public.agenda_tita at2
     WHERE at2.paciente_id = f.paciente_id::bigint
       AND at2.data_atendimento = f.data_atendimento
       AND at2.hora_inicial = f.horario) AS profissional_nome
  FROM public.fila_autorizacoes f
  WHERE f.data_atendimento = p_data
    AND (f.tipo_falta ILIKE '%paciente%' OR f.tipo_falta ILIKE '%terapeuta%')
    -- Sessão adiantada já voltou como bloco real na Conferência; se continuasse
    -- aqui, a grade mostraria a mesma sessão duas vezes, em estados opostos.
    AND f.data_atendimento_real IS NULL
    AND f.terapia_nome NOT ILIKE '%Equoterapia%'
    AND f.terapia_nome NOT ILIKE '%Fisioterapia Aquática%'
    AND f.terapia_nome NOT ILIKE '%Avaliação Neuropsicológica%'
    AND NOT EXISTS (
      SELECT 1 FROM public.agenda_tita at
      JOIN public.config_regras_terapias r
        ON at.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
      WHERE r.categoria = 'BLACKLIST_AUTORIZACAO' AND r.ativo = true
        AND at.paciente_id = f.paciente_id::bigint
        AND at.data_atendimento = f.data_atendimento
        AND at.hora_inicial = f.horario
    )
$function$
;

comment on function public.get_faltas_auditoria_assim(date) is
  'Faltas do dia na Conferência ASSIM. Devolve fila_id para que a tela possa marcar a sessão como adiantada (20260916120000). Sessão com data_atendimento_real não aparece aqui: ela já volta como bloco real.';

GRANT EXECUTE ON FUNCTION public.get_faltas_auditoria_assim(date) TO anon, authenticated;


-- ##########################################################################
-- BLOCO 6/6 — vw_faltas_pacientes respeita a reversão
-- origem: 20260916120500_vw_faltas_pacientes_respeita_reversao.sql
-- ##########################################################################

-- =============================================================================
-- vw_faltas_pacientes passa a respeitar a reversão
-- =============================================================================
-- Achado colateral da auditoria de 20260916120000, e um bug pré-existente: a
-- view conta como falta qualquer linha com status='falta' e tipo_falta='paciente',
-- sem olhar falta_revertida_em. A definição canônica de assiduidade
-- (contar_faltas_do_paciente, 20260908100200:81-110) olha:
--
--     and status = 'falta' and tipo_falta = 'paciente' and falta_revertida_em is null
--
-- As duas divergem hoje para toda falta revertida. Na prática o caminho de
-- reversão (central-pacientes/page.tsx:300 e reverter_falta_em_lote) também muda
-- status para 'cancelado' e zera tipo_falta, então a linha sai da view por
-- consequência — mas por consequência, não por leitura. Uma reversão futura que
-- preservasse o status já contaria a falta duas vezes em lugares diferentes.
--
-- Alinhar custa uma linha e tira a divergência do caminho.
--
-- CREATE OR REPLACE VIEW, nunca DROP: DROP VIEW perde reloptions, e com elas
-- security_invoker, que morre calado e abre a view ao anon
-- (reference_drop_view_perde_reloptions). A lista de colunas é idêntica à de
-- 20260703173820:72-91, na mesma ordem — CREATE OR REPLACE exige isso.
-- =============================================================================

create or replace view "public"."vw_faltas_pacientes" as  SELECT id,
    paciente_id,
    paciente_nome,
    data_atendimento,
    horario,
    data_horario,
    terapia_falta,
    terapia_nome,
    justificativa_falta,
    tipo_falta,
    nome_medico,
    crm,
    machine_id,
    tita_agendamento_id,
    status_assim,
    assim_updated_at,
    created_at,
    updated_at
   FROM public.fila_autorizacoes
  WHERE ((status = 'falta'::text) AND (tipo_falta = 'paciente'::text)
     AND (falta_revertida_em IS NULL));

comment on view public.vw_faltas_pacientes is
  'Faltas de paciente ainda válidas. Alinhada a contar_faltas_do_paciente: falta revertida não conta (20260916120500).';
