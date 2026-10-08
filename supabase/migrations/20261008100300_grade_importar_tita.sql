-- Grade (Cronograma) — Parte 4: "Importar do TiTa" (SOMENTE LEITURA do TiTa).
--
-- Lê a cópia já sincronizada da grade (csv_grades_profissionais, unidade 280,
-- status "Agendado") e traz para a agenda do Pulsar. Nenhuma chamada à API do
-- TiTa, e nada volta para lá. Três passos, como o painel da tela:
--
--   grade_importar_tita_previa(de, ate)        — calcula e devolve contadores,
--     amostras e a lista de profissionais com algo a aplicar; grava a
--     importação como 'previa'. Nada muda na agenda.
--   grade_importar_tita_aplicar(id, excluir_sumidos, profissionais[]) — aplica
--     um LOTE de profissionais (a tela manda de 15 em 15, com barra de
--     progresso). Recalcula a janela só para esse lote: o que entra é o estado
--     do momento. Medido em 07/10/2026: ~3.400 sessões "Agendado" por semana,
--     ~26 mil em dois meses — de uma vez só passaria do statement_timeout do
--     PostgREST. Série é sempre de um profissional só, então o lote nunca corta
--     uma série ao meio.
--   grade_importar_tita_concluir(id)           — fecha a importação ('aplicada')
--     e grava o evento com a soma dos lotes.
--
-- Cada linha do TiTa cai numa classe:
--   existente  — o id da sessão já está no Pulsar (agendada OU excluída aqui).
--                Nada a fazer: O PULSAR MANDA, e o que foi excluído aqui nunca
--                volta.
--   vinculo    — o Pulsar já tem a mesma sessão (paciente, profissional, data,
--                hora) sem id do TiTa: projetada pela repetição automática ou
--                criada à mão. Só grava o id do TiTa nela (mesmo se excluída).
--   novo       — entra na agenda, numa série inferida por paciente ×
--                profissional × terapia × dia × hora (tita_chave). Série nova:
--                contínua se aparece na última semana da janela; senão termina
--                na última data vista. Intervalo = menor salto entre as datas
--                (pega o quinzenal).
--   ignorado   — a série dessa chave foi ENCERRADA no Pulsar antes desta data.
--   bloqueio   — paciente fictício ("Horário Bloqueado", "Horário
--                Administrativo", supervisões, alinhamentos…) → grade_bloqueios.
--   pendencia  — paciente, profissional ou terapia sem cadastro no Pulsar. Não
--                entra; a prévia lista para alguém cadastrar.
--
-- Sumidos: sessões do Pulsar vindas do TiTa, agendadas, de hoje em diante,
-- num dia que o sync do TiTa cobriu (grade_sync_dia), que não aparecem mais
-- lá. Só são excluídas se quem aplica marcar a caixa (desmarcada por padrão).
-- Nesse caso, a série cujas sessões somem até o fim da janela é encerrada.
--
-- Tudo em SQL de conjunto (sem laço por linha): o RPC roda sob o
-- statement_timeout do PostgREST.
--
-- Depende de 20261008100000–100200. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Cálculo (temporárias tmp_gt e tmp_gt_sumidos, descartadas no commit)
-- ═════════════════════════════════════════════════════════════════════════════
-- p_profissionais (ids do Pulsar): null = todos (prévia); senão só o lote.
create or replace function public.sp_grade_tita_calcular(
  p_de             date,
  p_ate            date,
  p_profissionais  bigint[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.hoje_brasilia();
  -- Pacientes fictícios do TiTa (lib/cronograma/constants.ts → PACS_ADMIN, sem
  -- "Ainda não selecionado", que é horário livre). Normalizados.
  c_ficticios constant text[] := array[
    'notificacao previa', 'horario administrativo', 'horario bloqueado',
    'alinhamento sandra', 'alinhamento gracielle', 'alinhamento amanda',
    'supervisora fernanda lima', 'supervisora susane vitoria', 'supervisora michelle brasil',
    'supervisor severino junior', 'supervisora beatriz paiva', 'fonoaudiologia', 'facilitador tecnico'
  ];
begin
  drop table if exists pg_temp.tmp_gt;
  drop table if exists pg_temp.tmp_gt_sumidos;

  create temporary table tmp_gt on commit drop as
  select distinct on (g.tita_agendamento_id)
    g.tita_agendamento_id,
    g.data,
    g.hora_inicial                          as hora_inicio,
    g.hora_final                            as hora_fim,
    g.paciente_id                           as tita_paciente_id,
    btrim(g.paciente_nome)                  as tita_paciente_nome,
    g.profissional_id                       as tita_profissional_id,
    btrim(g.profissional_nome)              as tita_profissional_nome,
    g.terapia_id                            as tita_terapia_id,
    btrim(g.terapia_nome)                   as tita_terapia_nome,
    btrim(g.sala_nome)                      as sala_nome,
    case
      when g.sala_nome ilike '%AT Externo%' then 'AT Externo'
      else nullif(btrim(substring(g.sala_nome from 'Unid\.\s+(.+?)(?:\s*-\s*|$)')), '')
    end                                     as unidade_nome,
    pa.id_paciente                          as paciente_id,
    (coalesce(pa.ficticio, false)
      or public.normalizar_nome_paciente(g.paciente_nome) = any(c_ficticios)) as ficticio,
    pr.id                                   as profissional_id,
    te.id                                   as terapia_id,
    ex.id                                   as terapia_exibicao_id,
    null::text                              as classe,
    null::text                              as chave,
    null::uuid                              as alvo_id,
    null::uuid                              as serie_id
  from public.csv_grades_profissionais g
  left join public.pacientes pa      on pa.tita_paciente_id = g.paciente_id
  left join public.profissionais pr  on pr.tita_profissional_id = g.profissional_id
  left join lateral (
    select c.id from public.cadastro_terapias c
    where c.tita_terapia_id = g.terapia_id
       or c.nome_normalizado = public.normalizar_nome_terapia(g.terapia_nome)
    order by (c.tita_terapia_id is not distinct from g.terapia_id) desc
    limit 1
  ) te on true
  left join lateral (
    select c.id from public.cadastro_terapias c
    where c.tita_terapia_id = g.terapia_exibicao_id
       or c.nome_normalizado = public.normalizar_nome_terapia(g.terapia_exibicao_nome)
    order by (c.tita_terapia_id is not distinct from g.terapia_exibicao_id) desc
    limit 1
  ) ex on true
  where g.ativo
    and g.unidade_id = 280
    and g.data between p_de and p_ate
    and g.status_agendamento = 'Agendado'
    and g.tita_agendamento_id is not null
    and g.hora_inicial is not null and g.hora_final is not null and g.hora_final > g.hora_inicial
    -- Mesmas exclusões de vw_grade_base / profissionais_importar_tita (testes).
    and coalesce(g.profissional_nome, '') not in ('', 'Profissional Teste')
    and g.profissional_nome not ilike 'Testes Técnicos%'
    and g.profissional_nome not ilike 'Combinar Consulta%'
    and (p_profissionais is null or pr.id = any(p_profissionais))
  order by g.tita_agendamento_id, g.updated_at desc nulls last;

  create index on tmp_gt (tita_agendamento_id);
  analyze tmp_gt;

  -- 1. Bloqueios (paciente fictício).
  update tmp_gt t
     set classe = case
           when t.profissional_id is null then 'pendencia'
           when exists (select 1 from public.grade_bloqueios b where b.tita_chave = 'A:' || t.tita_agendamento_id) then 'bloqueio_existente'
           else 'bloqueio' end
   where t.ficticio;

  -- 2. Pendências de cadastro.
  update tmp_gt t
     set classe = 'pendencia'
   where t.classe is null
     and (t.paciente_id is null or t.profissional_id is null or t.terapia_id is null);

  -- 3. Já no Pulsar (pelo id da sessão do TiTa, agendada ou excluída).
  update tmp_gt t
     set classe = 'existente'
   where t.classe is null
     and exists (select 1 from public.grade_agendamentos a where a.tita_agendamento_id = t.tita_agendamento_id);

  -- 4. Mesma sessão no Pulsar sem id do TiTa → vínculo (uma linha do TiTa por sessão).
  with cand as (
    select t.tita_agendamento_id,
           (select a.id from public.grade_agendamentos a
             where a.paciente_id = t.paciente_id and a.profissional_id = t.profissional_id
               and a.data = t.data and a.hora_inicio = t.hora_inicio
               and a.tita_agendamento_id is null
             order by (a.situacao = 'agendado') desc, a.criado_em
             limit 1) as alvo
    from tmp_gt t
    where t.classe is null
  ),
  unico as (
    select c.tita_agendamento_id, c.alvo,
           row_number() over (partition by c.alvo order by c.tita_agendamento_id) as rn
    from cand c
    where c.alvo is not null
  )
  update tmp_gt t
     set classe = 'vinculo', alvo_id = u.alvo
    from unico u
   where u.tita_agendamento_id = t.tita_agendamento_id and u.rn = 1;

  -- 5. Novos: chave da série; série encerrada no Pulsar → ignorado.
  update tmp_gt t
     set chave = t.paciente_id || '|' || t.profissional_id || '|' || t.terapia_id || '|'
                 || extract(dow from t.data)::int || '|' || to_char(t.hora_inicio, 'HH24:MI')
   where t.classe is null;

  update tmp_gt t
     set serie_id = s.id,
         classe = case when s.situacao = 'encerrada' and t.data >= s.encerrada_a_partir then 'ignorado' else 'novo' end
    from public.grade_series s
   where t.classe is null and s.tita_chave = t.chave;

  update tmp_gt t set classe = 'novo' where t.classe is null;

  -- Temporária não tem estatística (autovacuum não a vê): sem isto o
  -- planejador estima 1 linha e cruza séries × saltos em laço aninhado
  -- (medido: 20 s para 1.500 séries).
  analyze tmp_gt;

  -- 6. Sumidos.
  create temporary table tmp_gt_sumidos on commit drop as
  select a.id, a.serie_id, a.profissional_id, a.data, a.hora_inicio, a.paciente_nome, a.profissional_nome,
         coalesce(a.terapia_exibicao_nome, a.terapia_nome) as terapia
  from public.grade_agendamentos a
  where a.situacao = 'agendado'
    and a.origem = 'tita_importacao'
    and (p_profissionais is null or a.profissional_id = any(p_profissionais))
    and a.data between greatest(p_de, v_hoje) and p_ate
    and exists (
      select 1 from public.grade_sync_dia d
      where d.data = a.data and d.modo = 'grade' and d.unidade_id = 280
    )
    and not exists (select 1 from tmp_gt t where t.tita_agendamento_id = a.tita_agendamento_id)
    and not exists (select 1 from tmp_gt t where t.alvo_id = a.id);

  analyze tmp_gt_sumidos;
end $$;

-- Contadores e amostras a partir das temporárias (prévia e aplicação).
-- plpgsql (não sql): corpo SQL é validado na criação, quando as temporárias
-- ainda não existem.
create or replace function public.sp_grade_tita_resumo(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select jsonb_build_object(
    'contadores', jsonb_build_object(
      'lidas',                (select count(*) from pg_temp.tmp_gt),
      'novos',                (select count(*) from pg_temp.tmp_gt where classe = 'novo'),
      'series_novas',         (select count(distinct chave) from pg_temp.tmp_gt where classe = 'novo' and serie_id is null),
      'vinculos',             (select count(*) from pg_temp.tmp_gt where classe = 'vinculo'),
      'existentes',           (select count(*) from pg_temp.tmp_gt where classe = 'existente'),
      'ignorados',            (select count(*) from pg_temp.tmp_gt where classe = 'ignorado'),
      'bloqueios_novos',      (select count(*) from pg_temp.tmp_gt where classe = 'bloqueio'),
      'bloqueios_existentes', (select count(*) from pg_temp.tmp_gt where classe = 'bloqueio_existente'),
      'pendencias',           (select count(*) from pg_temp.tmp_gt where classe = 'pendencia'),
      'sumidos',              (select count(*) from pg_temp.tmp_gt_sumidos)
    ),
    -- Quem tem algo a aplicar: a tela divide em lotes.
    'profissionais', coalesce((
      select jsonb_agg(x.id order by x.id)
      from (
        select t.profissional_id as id from pg_temp.tmp_gt t
        where t.classe in ('novo', 'vinculo', 'bloqueio') and t.profissional_id is not null
        union
        select s.profissional_id from pg_temp.tmp_gt_sumidos s
      ) x
    ), '[]'::jsonb),
    'pendencias', coalesce((
      select jsonb_agg(x order by x.sessoes desc)
      from (
        select motivo, tita_id, nome, count(*) as sessoes
        from (
          select case when t.profissional_id is null then 'profissional_sem_cadastro'
                      when t.paciente_id     is null then 'paciente_sem_cadastro'
                      else 'terapia_sem_catalogo' end as motivo,
                 case when t.profissional_id is null then t.tita_profissional_id
                      when t.paciente_id     is null then t.tita_paciente_id
                      else t.tita_terapia_id end as tita_id,
                 case when t.profissional_id is null then t.tita_profissional_nome
                      when t.paciente_id     is null then t.tita_paciente_nome
                      else t.tita_terapia_nome end as nome
          from pg_temp.tmp_gt t
          where t.classe = 'pendencia'
        ) p
        group by motivo, tita_id, nome
        limit 200
      ) x
    ), '[]'::jsonb),
    'novos', coalesce((
      select jsonb_agg(x)
      from (
        select t.data, to_char(t.hora_inicio, 'HH24:MI') as hora, t.tita_paciente_nome as paciente,
               t.tita_profissional_nome as profissional, t.tita_terapia_nome as terapia
        from pg_temp.tmp_gt t where t.classe = 'novo'
        order by t.data, t.hora_inicio limit 30
      ) x
    ), '[]'::jsonb),
    'ignorados', coalesce((
      select jsonb_agg(x)
      from (
        select t.data, to_char(t.hora_inicio, 'HH24:MI') as hora, t.tita_paciente_nome as paciente,
               t.tita_profissional_nome as profissional, t.tita_terapia_nome as terapia
        from pg_temp.tmp_gt t where t.classe = 'ignorado'
        order by t.data, t.hora_inicio limit 30
      ) x
    ), '[]'::jsonb),
    'sumidos', coalesce((
      select jsonb_agg(x)
      from (
        select s.id, s.data, to_char(s.hora_inicio, 'HH24:MI') as hora, s.paciente_nome as paciente,
               s.profissional_nome as profissional, s.terapia
        from pg_temp.tmp_gt_sumidos s
        order by s.data, s.hora_inicio limit 200
      ) x
    ), '[]'::jsonb),
    -- Profissional com agenda no TiTa e sem disponibilidade no Pulsar na janela:
    -- as sessões entram, mas a Grade não sabe o que é horário livre.
    'sem_disponibilidade', coalesce((
      select jsonb_agg(x order by x.sessoes desc)
      from (
        select pr.id, pr.nome, count(*) as sessoes
        from pg_temp.tmp_gt t
        join public.profissionais pr on pr.id = t.profissional_id
        where t.classe in ('novo', 'vinculo', 'existente')
          and not exists (
            select 1 from public.profissionais_disponibilidade_versoes v
            where v.profissional_id = pr.id and v.substituida_em is null
              and v.vigente_de <= p_ate and (v.vigente_ate is null or v.vigente_ate >= p_de)
          )
        group by pr.id, pr.nome
      ) x
    ), '[]'::jsonb)
  ));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Prévia
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_importar_tita_previa(p_de date, p_ate date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id       uuid;
  v_resumo   jsonb;
  v_frescor  timestamptz;
  v_dias     integer;
  v_dias_ok  integer;
begin
  perform public.sp_grade_exigir_permissao();
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 120 then
    raise exception 'Janela inválida (máximo 120 dias).' using errcode = '22023';
  end if;

  perform public.sp_grade_tita_calcular(p_de, p_ate);
  v_resumo := public.sp_grade_tita_resumo(p_de, p_ate);

  -- Frescor: último sync e quantos dias úteis da janela o sync cobriu.
  select max(d.sincronizado_em), count(distinct d.data) into v_frescor, v_dias_ok
  from public.grade_sync_dia d
  where d.modo = 'grade' and d.unidade_id = 280 and d.data between p_de and p_ate;
  select count(*) into v_dias
  from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') x
  where extract(isodow from x) between 1 and 5;

  insert into public.grade_importacoes
    (janela_inicio, janela_fim, situacao, contadores, frescor, criado_por, criado_por_nome)
  values
    (p_de, p_ate, 'previa', v_resumo -> 'contadores', v_frescor, auth.uid(), public.sp_grade_usuario_nome())
  returning id into v_id;

  return v_resumo || jsonb_build_object(
    'importacao_id', v_id, 'janela_inicio', p_de, 'janela_fim', p_ate,
    'frescor', v_frescor, 'dias_uteis', v_dias, 'dias_sincronizados', v_dias_ok
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Aplicar (um lote de profissionais) e concluir
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_importar_tita_aplicar(
  p_importacao_id    uuid,
  p_excluir_sumidos  boolean default false,
  p_profissionais    bigint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp          record;
  v_nome       text := public.sp_grade_usuario_nome();
  v_hoje       date := public.hoje_brasilia();
  v_resumo     jsonb;
  v_de         date;
  v_ate        date;
  v_vinc       integer := 0;
  v_series     integer := 0;
  v_novos      integer := 0;
  v_bloq       integer := 0;
  v_sumidos    integer := 0;
  v_encerradas integer := 0;
  v_alem       integer := 0;
begin
  perform public.sp_grade_exigir_permissao();
  -- Uma importação por vez (duas abas aplicando juntas duplicariam séries).
  perform pg_advisory_xact_lock(hashtext('grade_importar_tita'));

  select * into imp from public.grade_importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if imp.situacao not in ('previa', 'aplicando') then
    raise exception 'Esta importação já foi %.', imp.situacao using errcode = '22023';
  end if;
  if imp.criado_em < now() - interval '2 hours' then
    raise exception 'A prévia tem mais de 2 horas. Gere outra antes de aplicar.' using errcode = '22023';
  end if;
  if p_profissionais is not null and cardinality(p_profissionais) > 40 then
    raise exception 'Lote grande demais (máximo 40 profissionais por vez).' using errcode = '22023';
  end if;
  v_de := imp.janela_inicio;
  v_ate := imp.janela_fim;

  perform public.sp_grade_tita_calcular(v_de, v_ate, p_profissionais);
  v_resumo := public.sp_grade_tita_resumo(v_de, v_ate);

  -- 1. Vínculos: só grava o id do TiTa na sessão que já existe.
  update public.grade_agendamentos a
     set tita_agendamento_id = t.tita_agendamento_id,
         importacao_id = coalesce(a.importacao_id, p_importacao_id)
    from pg_temp.tmp_gt t
   where t.classe = 'vinculo' and a.id = t.alvo_id and a.tita_agendamento_id is null;
  get diagnostics v_vinc = row_count;

  -- 2. Séries novas, uma por chave.
  with grupos as (
    select t.chave,
           min(t.data) as primeira,
           max(t.data) as ultima,
           (array_agg(t.paciente_id))[1]                                     as paciente_id,
           (array_agg(t.profissional_id))[1]                                 as profissional_id,
           (array_agg(t.terapia_id))[1]                                      as terapia_id,
           (array_agg(t.terapia_exibicao_id order by t.data desc))[1]        as terapia_exibicao_id,
           (array_agg(t.hora_inicio))[1]                                     as hora_inicio,
           (array_agg(t.hora_fim order by t.data desc))[1]                   as hora_fim,
           (array_agg(t.sala_nome order by t.data desc))[1]                  as sala_nome,
           (array_agg(t.unidade_nome order by t.data desc))[1]               as unidade_nome
    from pg_temp.tmp_gt t
    where t.classe = 'novo' and t.serie_id is null
    group by t.chave
  ),
  saltos as (
    select x.chave, min(x.salto) as salto
    from (
      select t.chave, (t.data - lag(t.data) over (partition by t.chave order by t.data)) / 7 as salto
      from pg_temp.tmp_gt t
      where t.classe = 'novo' and t.serie_id is null
    ) x
    where x.salto > 0
    group by x.chave
  ),
  ins as (
    insert into public.grade_series (
      paciente_id, profissional_id, terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome,
      dia_semana, hora_inicio, hora_fim, sala_nome, unidade_nome,
      frequencia, intervalo_semanas, data_inicio, data_fim, materializada_ate,
      origem, importacao_id, tita_chave, criado_por, criado_por_nome
    )
    select
      g.paciente_id, g.profissional_id, g.terapia_id, te.nome, coalesce(ex.id, te.id), coalesce(ex.nome, te.nome),
      extract(dow from g.primeira)::smallint, g.hora_inicio, g.hora_fim, g.sala_nome, g.unidade_nome,
      'semanal', least(greatest(coalesce(s.salto, 1), 1), 8)::smallint, g.primeira,
      case when g.ultima >= v_ate - 6 then null else g.ultima end,
      case when g.ultima >= v_ate - 6 then v_ate else g.ultima end,
      'tita_importacao', p_importacao_id, g.chave, auth.uid(), v_nome
    from grupos g
    join public.cadastro_terapias te on te.id = g.terapia_id
    left join public.cadastro_terapias ex on ex.id = g.terapia_exibicao_id
    left join saltos s on s.chave = g.chave
    on conflict (tita_chave) where tita_chave is not null do nothing
    returning id
  )
  select count(*) into v_series from ins;

  update pg_temp.tmp_gt t
     set serie_id = s.id
    from public.grade_series s
   where t.classe = 'novo' and t.serie_id is null and s.tita_chave = t.chave;

  -- Séries que já existiam e ganharam sessões depois do fim: estende.
  update public.grade_series s
     set data_fim = case when x.ultima >= v_ate - 6 then null else greatest(s.data_fim, x.ultima) end,
         materializada_ate = greatest(coalesce(s.materializada_ate, x.ultima),
                                      case when x.ultima >= v_ate - 6 then v_ate else x.ultima end)
    from (
      select t.serie_id, max(t.data) as ultima
      from pg_temp.tmp_gt t
      where t.classe = 'novo' and t.serie_id is not null
      group by t.serie_id
    ) x
   where s.id = x.serie_id
     and s.situacao = 'ativa'
     and s.importacao_id is distinct from p_importacao_id
     and s.data_fim is not null
     and x.ultima > s.data_fim;

  -- 3. Sessões novas.
  insert into public.grade_agendamentos (
    serie_id, data, hora_inicio, hora_fim,
    paciente_id, paciente_nome, profissional_id, profissional_nome,
    terapia_id, terapia_nome, terapia_exibicao_id, terapia_exibicao_nome,
    sala_nome, unidade_nome, origem,
    tita_agendamento_id, tita_paciente_id, tita_profissional_id, tita_terapia_id, importacao_id,
    criado_por, criado_por_nome
  )
  select
    t.serie_id, t.data, t.hora_inicio, t.hora_fim,
    t.paciente_id, pa.nome, t.profissional_id, pr.nome,
    t.terapia_id, te.nome, coalesce(ex.id, te.id), coalesce(ex.nome, te.nome),
    t.sala_nome, t.unidade_nome, 'tita_importacao',
    t.tita_agendamento_id, t.tita_paciente_id, t.tita_profissional_id, t.tita_terapia_id, p_importacao_id,
    auth.uid(), v_nome
  from pg_temp.tmp_gt t
  join public.pacientes pa         on pa.id_paciente = t.paciente_id
  join public.profissionais pr     on pr.id = t.profissional_id
  join public.cadastro_terapias te on te.id = t.terapia_id
  left join public.cadastro_terapias ex on ex.id = t.terapia_exibicao_id
  where t.classe = 'novo' and t.serie_id is not null
  on conflict (tita_agendamento_id) where tita_agendamento_id is not null do nothing;
  get diagnostics v_novos = row_count;

  -- 4. Bloqueios.
  insert into public.grade_bloqueios (
    profissional_id, data_inicio, data_fim, hora_inicio, hora_fim, tipo, motivo,
    origem, importacao_id, tita_chave, criado_por, criado_por_nome
  )
  select
    t.profissional_id, t.data, t.data, t.hora_inicio, t.hora_fim,
    case when public.normalizar_nome_paciente(t.tita_paciente_nome) = 'horario administrativo' then 'administrativo' else 'bloqueio' end,
    left(coalesce(nullif(t.tita_paciente_nome, ''), 'Bloqueado no TiTa'), 300),
    'tita_importacao', p_importacao_id, 'A:' || t.tita_agendamento_id, auth.uid(), v_nome
  from pg_temp.tmp_gt t
  where t.classe = 'bloqueio'
  on conflict (tita_chave) where tita_chave is not null do nothing;
  get diagnostics v_bloq = row_count;

  -- 5. Sumidos (só com a caixa marcada).
  if p_excluir_sumidos then
    -- Série do TiTa cujas sessões somem até o fim da janela, sem nada vivo
    -- depois: terminou lá. Encerra a partir do primeiro sumido após a última
    -- sessão que continua.
    with por_serie as (
      select su.serie_id,
             max(su.data) as ultimo_sumido,
             (select max(a.data) from public.grade_agendamentos a
               where a.serie_id = su.serie_id and a.situacao = 'agendado'
                 and a.data between greatest(v_de, v_hoje) and v_ate
                 and not exists (select 1 from pg_temp.tmp_gt_sumidos z where z.id = a.id)) as ultimo_vivo
      from pg_temp.tmp_gt_sumidos su
      join public.grade_series gs on gs.id = su.serie_id and gs.situacao = 'ativa' and gs.origem = 'tita_importacao'
      group by su.serie_id
    ),
    corte as (
      select p.serie_id,
             (select min(su.data) from pg_temp.tmp_gt_sumidos su
               where su.serie_id = p.serie_id and (p.ultimo_vivo is null or su.data > p.ultimo_vivo)) as a_partir
      from por_serie p
      where p.ultimo_sumido >= v_ate - 6
    ),
    enc as (
      update public.grade_series s
         set situacao = 'encerrada', encerrada_a_partir = c.a_partir, encerrada_em = now(),
             encerrada_por = auth.uid(), encerrada_por_nome = v_nome,
             motivo_encerramento = 'Série não existe mais no TiTa (importação de ' || to_char(v_hoje, 'DD/MM/YYYY') || ')',
             data_fim = case when c.a_partir - 1 >= s.data_inicio
                             then least(coalesce(s.data_fim, c.a_partir - 1), c.a_partir - 1)
                             else s.data_fim end
        from corte c
       where s.id = c.serie_id and c.a_partir is not null
      returning s.id, c.a_partir
    ),
    -- Sessões dessas séries projetadas além da janela também saem.
    alem as (
      update public.grade_agendamentos a
         set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
             excluido_por_nome = v_nome, escopo_exclusao = 'importacao_tita',
             motivo_exclusao = 'Série não existe mais no TiTa', lote_id = p_importacao_id
        from enc e
       where a.serie_id = e.id and a.situacao = 'agendado' and a.data > v_ate and a.data >= e.a_partir
      returning 1
    )
    select (select count(*) from enc), (select count(*) from alem) into v_encerradas, v_alem;

    update public.grade_agendamentos a
       set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
           excluido_por_nome = v_nome, escopo_exclusao = 'importacao_tita',
           motivo_exclusao = 'Não está mais no TiTa (importação de ' || to_char(v_hoje, 'DD/MM/YYYY') || ')',
           lote_id = p_importacao_id
      from pg_temp.tmp_gt_sumidos su
     where a.id = su.id and a.situacao = 'agendado';
    get diagnostics v_sumidos = row_count;
  end if;

  -- Soma o lote no acumulado da importação.
  update public.grade_importacoes i
     set situacao = 'aplicando',
         aplicado = (
           select jsonb_object_agg(k.chave, coalesce((i.aplicado ->> k.chave)::integer, 0) + k.valor)
           from (values ('vinculos', v_vinc), ('series_novas', v_series), ('sessoes_novas', v_novos),
                        ('bloqueios', v_bloq), ('sumidos_excluidos', v_sumidos + v_alem),
                        ('series_encerradas', v_encerradas), ('lotes', 1)) k(chave, valor)
         ) || jsonb_build_object('excluir_sumidos', p_excluir_sumidos)
   where i.id = p_importacao_id;

  return jsonb_build_object(
    'importacao_id', p_importacao_id,
    'aplicado', jsonb_build_object(
      'vinculos', v_vinc, 'series_novas', v_series, 'sessoes_novas', v_novos, 'bloqueios', v_bloq,
      'sumidos_excluidos', v_sumidos + v_alem, 'series_encerradas', v_encerradas
    )
  );
end $$;

create or replace function public.grade_importar_tita_concluir(p_importacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp     record;
  v_nome  text := public.sp_grade_usuario_nome();
  a       jsonb;
  n       jsonb;
begin
  perform public.sp_grade_exigir_permissao();
  perform pg_advisory_xact_lock(hashtext('grade_importar_tita'));

  select * into imp from public.grade_importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;
  if imp.situacao = 'aplicada' then
    return imp.aplicado;
  end if;
  if imp.situacao <> 'aplicando' then
    raise exception 'Nada foi aplicado nesta importação.' using errcode = '22023';
  end if;

  update public.grade_importacoes
     set situacao = 'aplicada', aplicada_em = now(), aplicada_por = auth.uid(), aplicada_por_nome = v_nome
   where id = p_importacao_id;

  a := imp.aplicado;
  n := imp.contadores;
  insert into public.grade_eventos
    (acao, importacao_id, lote_id, quantidade, depois, resumo, feito_por, feito_por_nome)
  values (
    'importado', p_importacao_id, p_importacao_id, coalesce((a ->> 'sessoes_novas')::integer, 0),
    a || jsonb_build_object('janela_inicio', imp.janela_inicio, 'janela_fim', imp.janela_fim,
                            'pendencias', coalesce((n ->> 'pendencias')::integer, 0)),
    'Importado do TiTa (' || to_char(imp.janela_inicio, 'DD/MM') || ' a ' || to_char(imp.janela_fim, 'DD/MM/YYYY') || '): '
      || coalesce(a ->> 'sessoes_novas', '0') || ' sessão(ões) nova(s) em ' || coalesce(a ->> 'series_novas', '0') || ' série(s) nova(s), '
      || coalesce(a ->> 'vinculos', '0') || ' vinculada(s), ' || coalesce(a ->> 'bloqueios', '0') || ' bloqueio(s)'
      || case when coalesce((a ->> 'excluir_sumidos')::boolean, false)
              then ', ' || coalesce(a ->> 'sumidos_excluidos', '0') || ' excluída(s) por não estarem mais no TiTa' else '' end
      || case when coalesce((n ->> 'pendencias')::integer, 0) > 0
              then '; ' || (n ->> 'pendencias') || ' pendência(s) de cadastro' else '' end,
    auth.uid(), v_nome
  );

  return a;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.sp_grade_tita_calcular(date, date, bigint[])           from public, anon, authenticated;
revoke all on function public.sp_grade_tita_resumo(date, date)                      from public, anon, authenticated;
revoke all on function public.grade_importar_tita_previa(date, date)                from public, anon;
revoke all on function public.grade_importar_tita_aplicar(uuid, boolean, bigint[])  from public, anon;
revoke all on function public.grade_importar_tita_concluir(uuid)                    from public, anon;
grant execute on function public.grade_importar_tita_previa(date, date)               to authenticated;
grant execute on function public.grade_importar_tita_aplicar(uuid, boolean, bigint[]) to authenticated;
grant execute on function public.grade_importar_tita_concluir(uuid)                   to authenticated;
