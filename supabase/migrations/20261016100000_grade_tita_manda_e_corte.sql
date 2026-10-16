-- Grade × TiTa — Etapa 2 do plano de independência do TiTa.
--
-- Decisão do usuário (15/10/2026): enquanto o botão "Importar do TiTa" existir,
-- O TiTa MANDA nas sessões que vieram dele. GARANTIA exigida: sessão criada no
-- Pulsar nunca é apagada nem alterada por causa do TiTa — nem antes nem depois
-- do corte.
--
-- 1. Trava do corte (sistema_tita_corte). Preenchida só pelo SQL de corte (com
--    trava, aplicado à mão). Depois dela nenhuma importação do TiTa roda: os
--    logs de pacientes, profissionais/disponibilidade e Grade recusam gravação,
--    e nenhuma sessão nova nasce com id do TiTa. A repetição automática das
--    séries continua (não lê o TiTa).
--
-- 2. Proteção da sessão criada no Pulsar, em 3 camadas:
--    a) fim da classe "vínculo" sobre sessão do Pulsar: o id do TiTa só é
--       gravado em sessão de ORIGEM TiTa (projeção da repetição automática).
--       Vínculos antigos em sessão do Pulsar são soltos (o id vai para
--       tita_ref_historica, só referência).
--    b) toda operação "TiTa manda" filtra origem = 'tita_importacao'.
--    c) gatilho de guarda: durante a importação (pulsar.contexto =
--       'importacao_tita') qualquer UPDATE em linha de origem 'pulsar' é
--       recusado; exclusão com escopo 'importacao_tita' em linha do Pulsar é
--       recusada sempre; linha do Pulsar nunca recebe id/chave do TiTa.
--
-- 3. Regra "TiTa manda" (só de hoje em diante; o passado continua congelado):
--      alterado   — mesma sessão do TiTa (id) com data/hora/profissional/
--                   paciente/terapia/sala diferente: a antiga sai (escopo
--                   importacao_tita, "Alterado no TiTa") e a nova entra.
--      restaurado — excluída no Pulsar e ainda "Agendado" no TiTa: volta.
--      sumido     — não está mais no TiTa num dia que o sync cobriu: sai.
--                   Sempre (a caixa deixa de existir).
--      ja_no_pulsar — o TiTa tem uma sessão igual a uma criada no Pulsar:
--                   é do Pulsar, nada é gravado.
--    Bloqueios do TiTa que sumiram também saem. Série do TiTa encerrada no
--    Pulsar não impede mais a sessão: nasce uma série nova (os índices únicos
--    passam a valer só entre as ativas).
--
-- 4. Frescor obrigatório: com o TiTa mandando, cópia velha excluiria sessão
--    viva. Aplicar é recusado se algum dia da janela (de hoje em diante) foi
--    conferido pelo sync há mais de 30 horas (o sync diário roda às 02:00).
--
-- 5. grade_importacoes_itens: o que cada importação fez, sessão a sessão,
--    para o relatório "Sincronização do TiTa".
--
-- Depende de 20261008100000–100300 e 20261015190000. Idempotente.

set lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Trava do corte
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.sistema_tita_corte (
  id                boolean     primary key default true,
  cortado_em        timestamptz not null default now(),
  cortado_por_nome  text        not null,
  observacao        text,
  constraint sistema_tita_corte_unica check (id)
);

comment on table public.sistema_tita_corte is
  'Uma linha = o TiTa foi desligado. Gravada SÓ pelo SQL de corte (docs/CORTE_TITA.sql). Depois dela nenhuma importação do TiTa roda.';

alter table public.sistema_tita_corte enable row level security;
revoke all on public.sistema_tita_corte from public, anon, authenticated;
grant select on public.sistema_tita_corte to service_role;

create or replace function public.tita_cortado_em()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select c.cortado_em from public.sistema_tita_corte c where c.id
$$;

comment on function public.tita_cortado_em() is
  'Quando o TiTa foi desligado (null = ainda não). Usado pelas telas e pelas travas.';

-- Log de importação do TiTa depois do corte: recusa.
create or replace function public.sp_tita_corte_trava_log()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_em timestamptz := public.tita_cortado_em();
begin
  if v_em is not null then
    raise exception 'O TiTa foi desligado em %: importações do TiTa não rodam mais.',
      to_char(v_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_tita_corte on public.grade_importacoes;
create trigger trg_tita_corte
  before insert or update on public.grade_importacoes
  for each row execute function public.sp_tita_corte_trava_log();

drop trigger if exists trg_tita_corte on public.tita_importacoes;
create trigger trg_tita_corte
  before insert or update on public.tita_importacoes
  for each row execute function public.sp_tita_corte_trava_log();

drop trigger if exists trg_tita_corte on public.pacientes_importacoes_log;
create trigger trg_tita_corte
  before insert on public.pacientes_importacoes_log
  for each row execute function public.sp_tita_corte_trava_log();

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Vínculos antigos em sessão do Pulsar: soltos
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_agendamentos add column if not exists tita_ref_historica bigint;

comment on column public.grade_agendamentos.tita_ref_historica is
  'Id do TiTa que a importação antiga grudou numa sessão CRIADA NO PULSAR (classe "vínculo", até 16/10/2026). Só referência: nada lê nem escreve por aqui.';

do $$
declare
  n integer;
begin
  -- A guarda proíbe mudar o id do TiTa depois de gravado; esta é a única
  -- exceção, feita uma vez pela migration.
  alter table public.grade_agendamentos disable trigger trg_grade_agendamentos_guarda;
  update public.grade_agendamentos
     set tita_ref_historica = tita_agendamento_id,
         tita_agendamento_id = null
   where origem = 'pulsar' and tita_agendamento_id is not null;
  get diagnostics n = row_count;
  alter table public.grade_agendamentos enable trigger trg_grade_agendamentos_guarda;
  raise notice '% sessão(ões) criada(s) no Pulsar soltas do id do TiTa.', n;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Índices únicos só entre os ativos (a excluída fica como rastro)
-- ═════════════════════════════════════════════════════════════════════════════
drop index if exists public.uq_grade_agend_tita_id;
create unique index if not exists uq_grade_agend_tita_id_agendado
  on public.grade_agendamentos (tita_agendamento_id)
  where tita_agendamento_id is not null and situacao = 'agendado';
create index if not exists idx_grade_agend_tita_id
  on public.grade_agendamentos (tita_agendamento_id) where tita_agendamento_id is not null;

drop index if exists public.uq_grade_series_tita_chave;
create unique index if not exists uq_grade_series_tita_chave_ativa
  on public.grade_series (tita_chave) where tita_chave is not null and situacao = 'ativa';
create index if not exists idx_grade_series_tita_chave
  on public.grade_series (tita_chave) where tita_chave is not null;

drop index if exists public.uq_grade_bloq_tita_chave;
create unique index if not exists uq_grade_bloq_tita_chave_ativo
  on public.grade_bloqueios (tita_chave) where tita_chave is not null and situacao = 'ativo';
create index if not exists idx_grade_bloq_tita_chave
  on public.grade_bloqueios (tita_chave) where tita_chave is not null;

comment on column public.grade_agendamentos.tita_agendamento_id is
  'Id da sessão no TiTa (só em sessão de origem TiTa). Único entre as agendadas: a excluída guarda o id como rastro e a importação pode trazer a sessão de volta (o TiTa manda).';

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Guarda: o TiTa não toca no que é do Pulsar
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_grade_protecao_tita()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ctx    text := coalesce(current_setting('pulsar.contexto', true), '');
  v_corte  timestamptz := public.tita_cortado_em();
  v_tita   text;
begin
  -- A coluna que liga a linha ao TiTa: id da sessão (agendamentos) ou chave.
  v_tita := case tg_table_name when 'grade_agendamentos' then to_jsonb(new) ->> 'tita_agendamento_id'
                               else to_jsonb(new) ->> 'tita_chave' end;

  if tg_op = 'INSERT' then
    if new.origem = 'pulsar' and v_tita is not null then
      raise exception 'Proteção: registro criado no Pulsar não recebe vínculo com o TiTa.' using errcode = '42501';
    end if;
    if v_corte is not null and v_tita is not null then
      raise exception 'O TiTa foi desligado: nada novo vem dele.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.origem = 'pulsar' then
    if v_ctx = 'importacao_tita' then
      raise exception 'Proteção: a importação do TiTa tentou alterar um registro criado no Pulsar (%). Nada foi gravado.',
        tg_table_name using errcode = '42501';
    end if;
    if v_tita is not null
       and v_tita is distinct from (case tg_table_name when 'grade_agendamentos' then to_jsonb(old) ->> 'tita_agendamento_id'
                                                      else to_jsonb(old) ->> 'tita_chave' end) then
      raise exception 'Proteção: registro criado no Pulsar não recebe vínculo com o TiTa.' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'grade_agendamentos'
     and (to_jsonb(new) ->> 'escopo_exclusao') = 'importacao_tita'
     and (to_jsonb(old) ->> 'situacao') = 'agendado' then
    if old.origem = 'pulsar' then
      raise exception 'Proteção: sessão criada no Pulsar não é excluída pela importação do TiTa.' using errcode = '42501';
    end if;
    if v_corte is not null then
      raise exception 'O TiTa foi desligado: ele não exclui mais nada.' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

revoke all on function public.sp_grade_protecao_tita() from public, anon, authenticated;

drop trigger if exists trg_grade_protecao_tita on public.grade_agendamentos;
create trigger trg_grade_protecao_tita
  before insert or update on public.grade_agendamentos
  for each row execute function public.sp_grade_protecao_tita();

drop trigger if exists trg_grade_protecao_tita on public.grade_series;
create trigger trg_grade_protecao_tita
  before insert or update on public.grade_series
  for each row execute function public.sp_grade_protecao_tita();

drop trigger if exists trg_grade_protecao_tita on public.grade_bloqueios;
create trigger trg_grade_protecao_tita
  before insert or update on public.grade_bloqueios
  for each row execute function public.sp_grade_protecao_tita();

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Log da importação: itens e colunas novas
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_importacoes add column if not exists frescor_pior timestamptz;
alter table public.grade_importacoes add column if not exists pendencias  jsonb not null default '[]'::jsonb;

comment on column public.grade_importacoes.frescor_pior is
  'Dia da janela (de hoje em diante) conferido pelo sync há MAIS tempo. Aplicar recusa se passar de 30 horas.';

create table if not exists public.grade_importacoes_itens (
  id                 bigint      generated always as identity primary key,
  importacao_id      uuid        not null references public.grade_importacoes(id) on delete cascade,
  tipo               text        not null,
  profissional_id    bigint,
  profissional_nome  text,
  paciente_nome      text,
  data               date,
  hora               text,
  terapia            text,
  sala               text,
  -- Alterado: como era ("16/10 08:00–08:40 · Sala 3 · ABA").
  de                 text,
  criado_em          timestamptz not null default now(),
  constraint grade_imp_itens_tipo_check check (tipo in (
    'novo', 'restaurado', 'alterado', 'sumido', 'bloqueio', 'bloqueio_sumido', 'serie_encerrada'
  ))
);

create index if not exists idx_grade_imp_itens on public.grade_importacoes_itens (importacao_id, tipo, profissional_nome);

comment on table public.grade_importacoes_itens is
  'O que cada "Importar do TiTa" da Grade fez, sessão a sessão (novo, restaurado, alterado, sumido, bloqueios). Base do relatório.';

alter table public.grade_importacoes_itens enable row level security;
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'grade_importacoes_itens'
  loop execute format('drop policy %I on public.grade_importacoes_itens', pol.policyname); end loop;
end $$;
create policy "grade_importacoes_itens_select" on public.grade_importacoes_itens
  for select to authenticated using ((select public.usuario_tem_permissao('cronograma_grade')));
revoke all on public.grade_importacoes_itens from public, anon, authenticated;
grant select on public.grade_importacoes_itens to authenticated;
grant select on public.grade_importacoes_itens to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Cálculo v2 (temporárias, descartadas no commit)
-- ═════════════════════════════════════════════════════════════════════════════
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
  c_ficticios constant text[] := array[
    'notificacao previa', 'horario administrativo', 'horario bloqueado',
    'alinhamento sandra', 'alinhamento gracielle', 'alinhamento amanda',
    'supervisora fernanda lima', 'supervisora susane vitoria', 'supervisora michelle brasil',
    'supervisor severino junior', 'supervisora beatriz paiva', 'fonoaudiologia', 'facilitador tecnico'
  ];
begin
  drop table if exists pg_temp.tmp_gt;
  drop table if exists pg_temp.tmp_gt_sumidos;
  drop table if exists pg_temp.tmp_gt_bloq_sumidos;

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
    null::uuid                              as serie_id,
    -- Excluída no Pulsar POR UMA PESSOA (não pela importação) que volta: o
    -- relatório avisa que o TiTa desfez a exclusão.
    false                                   as desfaz_pulsar
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
           when exists (select 1 from public.grade_bloqueios b
                         where b.tita_chave = 'A:' || t.tita_agendamento_id and b.situacao = 'ativo') then 'bloqueio_existente'
           else 'bloqueio' end
   where t.ficticio;

  -- 2. Pendências de cadastro.
  update tmp_gt t
     set classe = 'pendencia'
   where t.classe is null
     and (t.paciente_id is null or t.profissional_id is null or t.terapia_id is null);

  -- 3. Já ligada a uma sessão AGENDADA (pelo id do TiTa). Origem TiTa: igual,
  --    ou alterada no TiTa (de hoje em diante). Origem Pulsar não deveria mais
  --    existir (a migration soltou), mas se existir é do Pulsar.
  update tmp_gt t
     set alvo_id = a.id,
         classe = case
           when a.origem = 'pulsar' then 'ja_no_pulsar'
           when a.data < v_hoje or t.data < v_hoje then 'existente'
           when (a.data, a.hora_inicio, a.hora_fim, a.paciente_id, a.profissional_id, a.terapia_id, coalesce(a.sala_nome, ''))
                is not distinct from
                (t.data, t.hora_inicio, t.hora_fim, t.paciente_id, t.profissional_id, t.terapia_id, coalesce(t.sala_nome, ''))
             then 'existente'
           else 'alterado' end
    from public.grade_agendamentos a
   where t.classe is null
     and a.tita_agendamento_id = t.tita_agendamento_id
     and a.situacao = 'agendado';

  -- 4. Só excluídas com esse id: de origem TiTa, o TiTa manda e ela volta (de
  --    hoje em diante); de origem Pulsar, é do Pulsar.
  update tmp_gt t
     set classe = case
           when exists (select 1 from public.grade_agendamentos a
                         where a.tita_agendamento_id = t.tita_agendamento_id and a.origem = 'pulsar') then 'ja_no_pulsar'
           when t.data >= v_hoje then 'restaurado'
           else 'existente' end,
         desfaz_pulsar = exists (
           select 1 from public.grade_agendamentos a
            where a.tita_agendamento_id = t.tita_agendamento_id and a.origem = 'tita_importacao'
              and a.situacao = 'excluido' and a.escopo_exclusao <> 'importacao_tita')
   where t.classe is null
     and exists (select 1 from public.grade_agendamentos a where a.tita_agendamento_id = t.tita_agendamento_id);

  -- 5. Mesma sessão criada no Pulsar (mesmo paciente, profissional, data e
  --    hora): é do Pulsar. NADA é gravado nela.
  update tmp_gt t
     set classe = 'ja_no_pulsar'
   where t.classe is null
     and exists (
       select 1 from public.grade_agendamentos a
        where a.origem = 'pulsar'
          and a.paciente_id = t.paciente_id and a.profissional_id = t.profissional_id
          and a.data = t.data and a.hora_inicio = t.hora_inicio);

  -- 6. Projeção da repetição automática de série do TiTa (sem id) no mesmo
  --    horário: grava o id nela (vínculo); se o resto mudou no TiTa (fim,
  --    terapia, sala), é alteração.
  with cand as (
    select t.tita_agendamento_id,
           (select a.id from public.grade_agendamentos a
             where a.origem = 'tita_importacao' and a.tita_agendamento_id is null and a.situacao = 'agendado'
               and a.paciente_id = t.paciente_id and a.profissional_id = t.profissional_id
               and a.data = t.data and a.hora_inicio = t.hora_inicio
             order by a.criado_em
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
     set alvo_id = u.alvo,
         classe = case
           when t.data < v_hoje
             or (a.hora_fim, a.terapia_id, coalesce(a.sala_nome, '')) is not distinct from (t.hora_fim, t.terapia_id, coalesce(t.sala_nome, ''))
             then 'vinculo'
           else 'alterado' end
    from unico u
    join public.grade_agendamentos a on a.id = u.alvo
   where u.tita_agendamento_id = t.tita_agendamento_id and u.rn = 1;

  -- 7. Projeção excluída no Pulsar no mesmo horário: o TiTa manda, volta.
  update tmp_gt t
     set classe = 'restaurado',
         desfaz_pulsar = exists (
           select 1 from public.grade_agendamentos a
            where a.origem = 'tita_importacao' and a.situacao = 'excluido' and a.escopo_exclusao <> 'importacao_tita'
              and a.paciente_id = t.paciente_id and a.profissional_id = t.profissional_id
              and a.data = t.data and a.hora_inicio = t.hora_inicio)
   where t.classe is null
     and t.data >= v_hoje
     and exists (
       select 1 from public.grade_agendamentos a
        where a.origem = 'tita_importacao' and a.situacao = 'excluido'
          and a.paciente_id = t.paciente_id and a.profissional_id = t.profissional_id
          and a.data = t.data and a.hora_inicio = t.hora_inicio);

  update tmp_gt t set classe = 'novo' where t.classe is null;

  -- 8. Chave e série ATIVA do que entra (novo, restaurado, alterado).
  update tmp_gt t
     set chave = t.paciente_id || '|' || t.profissional_id || '|' || t.terapia_id || '|'
                 || extract(dow from t.data)::int || '|' || to_char(t.hora_inicio, 'HH24:MI')
   where t.classe in ('novo', 'restaurado', 'alterado');

  update tmp_gt t
     set serie_id = s.id
    from public.grade_series s
   where t.classe in ('novo', 'restaurado', 'alterado')
     and s.tita_chave = t.chave and s.situacao = 'ativa';

  -- Temporária não tem estatística (autovacuum não a vê).
  analyze tmp_gt;

  -- 9. Saem: sumidas do TiTa e a versão antiga das alteradas.
  create temporary table tmp_gt_sumidos on commit drop as
  select a.id, a.serie_id, a.profissional_id, a.profissional_nome, a.paciente_nome, a.data, a.hora_inicio, a.hora_fim,
         coalesce(a.terapia_exibicao_nome, a.terapia_nome) as terapia, a.sala_nome,
         'sumido'::text as motivo
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

  insert into tmp_gt_sumidos
  select a.id, a.serie_id, a.profissional_id, a.profissional_nome, a.paciente_nome, a.data, a.hora_inicio, a.hora_fim,
         coalesce(a.terapia_exibicao_nome, a.terapia_nome), a.sala_nome, 'alterado'
  from tmp_gt t
  join public.grade_agendamentos a on a.id = t.alvo_id
  where t.classe = 'alterado' and a.situacao = 'agendado' and a.origem = 'tita_importacao';

  analyze tmp_gt_sumidos;

  -- 10. Bloqueios do TiTa que sumiram (de hoje em diante, em dia sincronizado).
  create temporary table tmp_gt_bloq_sumidos on commit drop as
  select b.id, b.profissional_id, b.data_inicio, b.hora_inicio, b.hora_fim, b.motivo
  from public.grade_bloqueios b
  where b.origem = 'tita_importacao'
    and b.situacao = 'ativo'
    and b.tita_chave like 'A:%'
    and (p_profissionais is null or b.profissional_id = any(p_profissionais))
    and b.data_inicio between greatest(p_de, v_hoje) and p_ate
    and exists (
      select 1 from public.grade_sync_dia d
      where d.data = b.data_inicio and d.modo = 'grade' and d.unidade_id = 280
    )
    and not exists (select 1 from tmp_gt t where 'A:' || t.tita_agendamento_id = b.tita_chave);
end $$;

-- Contadores e amostras a partir das temporárias (prévia e aplicação).
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
      'restaurados',          (select count(*) from pg_temp.tmp_gt where classe = 'restaurado'),
      'alterados',            (select count(*) from pg_temp.tmp_gt where classe = 'alterado'),
      'desfaz_pulsar',        (select count(*) from pg_temp.tmp_gt where desfaz_pulsar and classe = 'restaurado'),
      'series_novas',         (select count(distinct chave) from pg_temp.tmp_gt
                                where classe in ('novo', 'restaurado', 'alterado') and serie_id is null),
      'vinculos',             (select count(*) from pg_temp.tmp_gt where classe = 'vinculo'),
      'existentes',           (select count(*) from pg_temp.tmp_gt where classe = 'existente'),
      'ja_no_pulsar',         (select count(*) from pg_temp.tmp_gt where classe = 'ja_no_pulsar'),
      'bloqueios_novos',      (select count(*) from pg_temp.tmp_gt where classe = 'bloqueio'),
      'bloqueios_existentes', (select count(*) from pg_temp.tmp_gt where classe = 'bloqueio_existente'),
      'bloqueios_sumidos',    (select count(*) from pg_temp.tmp_gt_bloq_sumidos),
      'pendencias',           (select count(*) from pg_temp.tmp_gt where classe = 'pendencia'),
      'sumidos',              (select count(*) from pg_temp.tmp_gt_sumidos where motivo = 'sumido')
    ),
    -- Quem tem algo a aplicar: a tela divide em lotes.
    'profissionais', coalesce((
      select jsonb_agg(x.id order by x.id)
      from (
        select t.profissional_id as id from pg_temp.tmp_gt t
        where t.classe in ('novo', 'restaurado', 'alterado', 'vinculo', 'bloqueio') and t.profissional_id is not null
        union
        select s.profissional_id from pg_temp.tmp_gt_sumidos s
        union
        select b.profissional_id from pg_temp.tmp_gt_bloq_sumidos b
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
    'restaurados', coalesce((
      select jsonb_agg(x)
      from (
        select t.data, to_char(t.hora_inicio, 'HH24:MI') as hora, t.tita_paciente_nome as paciente,
               t.tita_profissional_nome as profissional, t.tita_terapia_nome as terapia, t.desfaz_pulsar
        from pg_temp.tmp_gt t where t.classe = 'restaurado'
        order by t.desfaz_pulsar desc, t.data, t.hora_inicio limit 100
      ) x
    ), '[]'::jsonb),
    'alterados', coalesce((
      select jsonb_agg(x)
      from (
        select t.data, to_char(t.hora_inicio, 'HH24:MI') as hora, t.tita_paciente_nome as paciente,
               t.tita_profissional_nome as profissional, t.tita_terapia_nome as terapia, t.sala_nome as sala,
               to_char(a.data, 'DD/MM') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || '–' || to_char(a.hora_fim, 'HH24:MI')
                 || coalesce(' · ' || a.sala_nome, '') || ' · ' || a.profissional_nome as de
        from pg_temp.tmp_gt t
        join public.grade_agendamentos a on a.id = t.alvo_id
        where t.classe = 'alterado'
        order by t.data, t.hora_inicio limit 100
      ) x
    ), '[]'::jsonb),
    'sumidos', coalesce((
      select jsonb_agg(x)
      from (
        select s.id, s.data, to_char(s.hora_inicio, 'HH24:MI') as hora, s.paciente_nome as paciente,
               s.profissional_nome as profissional, s.terapia
        from pg_temp.tmp_gt_sumidos s where s.motivo = 'sumido'
        order by s.data, s.hora_inicio limit 200
      ) x
    ), '[]'::jsonb),
    'sem_disponibilidade', coalesce((
      select jsonb_agg(x order by x.sessoes desc)
      from (
        select pr.id, pr.nome, count(*) as sessoes
        from pg_temp.tmp_gt t
        join public.profissionais pr on pr.id = t.profissional_id
        where t.classe in ('novo', 'restaurado', 'alterado', 'vinculo', 'existente')
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

-- Dia da janela (de hoje em diante) conferido há MAIS tempo pelo sync.
create or replace function public.sp_grade_tita_frescor_pior(p_de date, p_ate date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select min(d.sincronizado_em)
  from public.grade_sync_dia d
  where d.modo = 'grade' and d.unidade_id = 280
    and d.data between greatest(p_de, public.hoje_brasilia()) and p_ate
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- G) Prévia
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
  v_pior     timestamptz;
  v_dias     integer;
  v_dias_ok  integer;
begin
  perform public.sp_grade_exigir_permissao();
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 120 then
    raise exception 'Janela inválida (máximo 120 dias).' using errcode = '22023';
  end if;

  perform public.sp_grade_tita_calcular(p_de, p_ate);
  v_resumo := public.sp_grade_tita_resumo(p_de, p_ate);

  -- Só dias úteis, como o total (antes contava sábado e domingo: "50 de 36").
  select max(d.sincronizado_em), count(distinct d.data) filter (where extract(isodow from d.data) between 1 and 5)
    into v_frescor, v_dias_ok
  from public.grade_sync_dia d
  where d.modo = 'grade' and d.unidade_id = 280 and d.data between p_de and p_ate;
  select count(*) into v_dias
  from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') x
  where extract(isodow from x) between 1 and 5;
  v_pior := public.sp_grade_tita_frescor_pior(p_de, p_ate);

  -- Prévia anterior que ninguém aplicou fica descartada.
  update public.grade_importacoes set situacao = 'descartada' where situacao = 'previa';

  insert into public.grade_importacoes
    (janela_inicio, janela_fim, situacao, contadores, frescor, frescor_pior, pendencias, criado_por, criado_por_nome)
  values
    (p_de, p_ate, 'previa', v_resumo -> 'contadores', v_frescor, v_pior, v_resumo -> 'pendencias',
     auth.uid(), public.sp_grade_usuario_nome())
  returning id into v_id;

  return v_resumo || jsonb_build_object(
    'importacao_id', v_id, 'janela_inicio', p_de, 'janela_fim', p_ate,
    'frescor', v_frescor, 'frescor_pior', v_pior,
    'copia_velha', v_pior is not null and v_pior < now() - interval '30 hours',
    'dias_uteis', v_dias, 'dias_sincronizados', v_dias_ok
  );
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- H) Aplicar (um lote de profissionais). p_excluir_sumidos é ignorado: com o
--    TiTa mandando, o que sumiu dele sempre sai. Assinatura mantida para a
--    tela antiga não quebrar entre o deploy do banco e o do site.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.grade_importar_tita_aplicar(
  p_importacao_id    uuid,
  p_excluir_sumidos  boolean default true,
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
  v_de         date;
  v_ate        date;
  v_pior       timestamptz;
  v_vinc       integer := 0;
  v_series     integer := 0;
  v_novos      integer := 0;
  v_bloq       integer := 0;
  v_bloq_sum   integer := 0;
  v_sumidos    integer := 0;
  v_encerradas integer := 0;
  v_alem       integer := 0;
  v_rest       integer := 0;
  v_alt        integer := 0;
  v_hora       text := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
begin
  perform public.sp_grade_exigir_permissao();
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

  -- Cópia velha + "o TiTa manda" = excluir sessão que ainda existe.
  v_pior := public.sp_grade_tita_frescor_pior(v_de, v_ate);
  if v_pior is not null and v_pior < now() - interval '30 hours' then
    raise exception 'A cópia da grade do TiTa está velha (um dia da janela foi conferido em %). Atualize a cópia antes de aplicar.',
      to_char(v_pior at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') using errcode = '22023';
  end if;

  -- A guarda (sp_grade_protecao_tita) recusa qualquer toque em registro do
  -- Pulsar enquanto este contexto estiver ligado (só nesta transação).
  perform set_config('pulsar.contexto', 'importacao_tita', true);

  perform public.sp_grade_tita_calcular(v_de, v_ate, p_profissionais);

  -- 1. Saem: sumidas do TiTa e a versão antiga das alteradas.
  update public.grade_agendamentos a
     set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
         excluido_por_nome = v_nome, escopo_exclusao = 'importacao_tita',
         motivo_exclusao = case su.motivo when 'alterado' then 'Alterado no TiTa (importação de ' || v_hora || ')'
                                          else 'Não está mais no TiTa (importação de ' || v_hora || ')' end,
         lote_id = p_importacao_id
    from pg_temp.tmp_gt_sumidos su
   where a.id = su.id and a.situacao = 'agendado' and a.origem = 'tita_importacao';
  select count(*) filter (where motivo = 'sumido'), count(*) filter (where motivo = 'alterado')
    into v_sumidos, v_alt
  from pg_temp.tmp_gt_sumidos;

  -- 2. Bloqueios do TiTa que sumiram.
  update public.grade_bloqueios b
     set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
         excluido_por_nome = v_nome,
         motivo_exclusao = 'Não está mais no TiTa (importação de ' || v_hora || ')'
    from pg_temp.tmp_gt_bloq_sumidos x
   where b.id = x.id and b.situacao = 'ativo' and b.origem = 'tita_importacao';
  get diagnostics v_bloq_sum = row_count;

  -- 3. Vínculos: grava o id do TiTa na projeção da série do TiTa.
  update public.grade_agendamentos a
     set tita_agendamento_id = t.tita_agendamento_id,
         importacao_id = coalesce(a.importacao_id, p_importacao_id)
    from pg_temp.tmp_gt t
   where t.classe = 'vinculo' and a.id = t.alvo_id
     and a.tita_agendamento_id is null and a.origem = 'tita_importacao';
  get diagnostics v_vinc = row_count;

  -- 4. Séries novas, uma por chave (novo, restaurado, alterado sem série ativa).
  with grupos as (
    select t.chave,
           min(t.data) as primeira,
           max(t.data) as ultima,
           (array_agg(t.paciente_id))[1]                              as paciente_id,
           (array_agg(t.profissional_id))[1]                          as profissional_id,
           (array_agg(t.terapia_id))[1]                               as terapia_id,
           (array_agg(t.terapia_exibicao_id order by t.data desc))[1] as terapia_exibicao_id,
           (array_agg(t.hora_inicio))[1]                              as hora_inicio,
           (array_agg(t.hora_fim order by t.data desc))[1]            as hora_fim,
           (array_agg(t.sala_nome order by t.data desc))[1]           as sala_nome,
           (array_agg(t.unidade_nome order by t.data desc))[1]        as unidade_nome
    from pg_temp.tmp_gt t
    where t.classe in ('novo', 'restaurado', 'alterado') and t.serie_id is null
    group by t.chave
  ),
  saltos as (
    select x.chave, min(x.salto) as salto
    from (
      select t.chave, (t.data - lag(t.data) over (partition by t.chave order by t.data)) / 7 as salto
      from pg_temp.tmp_gt t
      where t.classe in ('novo', 'restaurado', 'alterado') and t.serie_id is null
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
    on conflict (tita_chave) where tita_chave is not null and situacao = 'ativa' do nothing
    returning id
  )
  select count(*) into v_series from ins;

  update pg_temp.tmp_gt t
     set serie_id = s.id
    from public.grade_series s
   where t.classe in ('novo', 'restaurado', 'alterado') and t.serie_id is null
     and s.tita_chave = t.chave and s.situacao = 'ativa';

  -- Séries que já existiam e ganharam sessões depois do fim: estende.
  update public.grade_series s
     set data_fim = case when x.ultima >= v_ate - 6 then null else greatest(s.data_fim, x.ultima) end,
         materializada_ate = greatest(coalesce(s.materializada_ate, x.ultima),
                                      case when x.ultima >= v_ate - 6 then v_ate else x.ultima end)
    from (
      select t.serie_id, max(t.data) as ultima
      from pg_temp.tmp_gt t
      where t.classe in ('novo', 'restaurado', 'alterado') and t.serie_id is not null
      group by t.serie_id
    ) x
   where s.id = x.serie_id
     and s.situacao = 'ativa'
     and s.origem = 'tita_importacao'
     and s.importacao_id is distinct from p_importacao_id
     and s.data_fim is not null
     and x.ultima > s.data_fim;

  -- 5. Sessões que entram.
  with ins as (
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
    where t.classe in ('novo', 'restaurado', 'alterado') and t.serie_id is not null
    on conflict (tita_agendamento_id) where tita_agendamento_id is not null and situacao = 'agendado' do nothing
    returning tita_agendamento_id
  ),
  itens as (
    insert into public.grade_importacoes_itens
      (importacao_id, tipo, profissional_id, profissional_nome, paciente_nome, data, hora, terapia, sala, de)
    select p_importacao_id, t.classe, t.profissional_id, pr.nome, pa.nome, t.data,
           to_char(t.hora_inicio, 'HH24:MI') || '–' || to_char(t.hora_fim, 'HH24:MI'),
           te.nome, t.sala_nome,
           case when t.classe = 'alterado' then
             (select to_char(a.data, 'DD/MM') || ' ' || to_char(a.hora_inicio, 'HH24:MI') || '–' || to_char(a.hora_fim, 'HH24:MI')
                     || coalesce(' · ' || a.sala_nome, '') || ' · ' || a.profissional_nome
                     || case when a.paciente_id <> t.paciente_id then ' · ' || a.paciente_nome else '' end
                from public.grade_agendamentos a where a.id = t.alvo_id)
           end
    from ins
    join pg_temp.tmp_gt t            on t.tita_agendamento_id = ins.tita_agendamento_id
    join public.pacientes pa         on pa.id_paciente = t.paciente_id
    join public.profissionais pr     on pr.id = t.profissional_id
    join public.cadastro_terapias te on te.id = t.terapia_id
    returning tipo
  )
  select count(*) filter (where tipo = 'novo'), count(*) filter (where tipo = 'restaurado')
    into v_novos, v_rest
  from itens;

  -- 6. Bloqueios novos.
  with ins as (
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
    on conflict (tita_chave) where tita_chave is not null and situacao = 'ativo' do nothing
    returning profissional_id, data_inicio, hora_inicio, hora_fim, motivo
  )
  insert into public.grade_importacoes_itens
    (importacao_id, tipo, profissional_id, profissional_nome, paciente_nome, data, hora)
  select p_importacao_id, 'bloqueio', ins.profissional_id, pr.nome, ins.motivo, ins.data_inicio,
         to_char(ins.hora_inicio, 'HH24:MI') || '–' || to_char(ins.hora_fim, 'HH24:MI')
  from ins join public.profissionais pr on pr.id = ins.profissional_id;
  get diagnostics v_bloq = row_count;

  -- 7. Séries do TiTa cujas sessões somem até o fim da janela, sem nada vivo
  --    depois (contando as que acabaram de entrar): terminaram lá.
  with por_serie as (
    select su.serie_id,
           max(su.data) as ultimo_sumido,
           (select max(a.data) from public.grade_agendamentos a
             where a.serie_id = su.serie_id and a.situacao = 'agendado'
               and a.data between greatest(v_de, v_hoje) and v_ate) as ultimo_vivo
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
      and (p.ultimo_vivo is null or p.ultimo_vivo < p.ultimo_sumido)
  ),
  enc as (
    update public.grade_series s
       set situacao = 'encerrada', encerrada_a_partir = c.a_partir, encerrada_em = now(),
           encerrada_por = auth.uid(), encerrada_por_nome = v_nome,
           motivo_encerramento = 'Série não existe mais no TiTa (importação de ' || v_hora || ')',
           data_fim = case when c.a_partir - 1 >= s.data_inicio
                           then least(coalesce(s.data_fim, c.a_partir - 1), c.a_partir - 1)
                           else s.data_fim end
      from corte c
     where s.id = c.serie_id and c.a_partir is not null and s.origem = 'tita_importacao'
    returning s.id, c.a_partir
  ),
  alem as (
    update public.grade_agendamentos a
       set situacao = 'excluido', excluido_em = now(), excluido_por = auth.uid(),
           excluido_por_nome = v_nome, escopo_exclusao = 'importacao_tita',
           motivo_exclusao = 'Série não existe mais no TiTa', lote_id = p_importacao_id
      from enc e
     where a.serie_id = e.id and a.situacao = 'agendado' and a.data > v_ate and a.data >= e.a_partir
       and a.origem = 'tita_importacao'
    returning 1
  )
  select (select count(*) from enc), (select count(*) from alem) into v_encerradas, v_alem;

  -- 8. Itens do que saiu.
  insert into public.grade_importacoes_itens
    (importacao_id, tipo, profissional_id, profissional_nome, paciente_nome, data, hora, terapia, sala)
  select p_importacao_id, 'sumido', su.profissional_id, su.profissional_nome, su.paciente_nome, su.data,
         to_char(su.hora_inicio, 'HH24:MI') || '–' || to_char(su.hora_fim, 'HH24:MI'), su.terapia, su.sala_nome
  from pg_temp.tmp_gt_sumidos su
  where su.motivo = 'sumido';

  insert into public.grade_importacoes_itens
    (importacao_id, tipo, profissional_id, profissional_nome, paciente_nome, data, hora)
  select p_importacao_id, 'bloqueio_sumido', x.profissional_id, pr.nome, x.motivo, x.data_inicio,
         case when x.hora_inicio is null then 'Dia inteiro'
              else to_char(x.hora_inicio, 'HH24:MI') || '–' || to_char(x.hora_fim, 'HH24:MI') end
  from pg_temp.tmp_gt_bloq_sumidos x
  join public.profissionais pr on pr.id = x.profissional_id;

  -- Soma o lote no acumulado da importação.
  update public.grade_importacoes i
     set situacao = 'aplicando',
         aplicado = (
           select jsonb_object_agg(k.chave, coalesce((i.aplicado ->> k.chave)::integer, 0) + k.valor)
           from (values ('vinculos', v_vinc), ('series_novas', v_series), ('sessoes_novas', v_novos),
                        ('restauradas', v_rest), ('alteradas', v_alt),
                        ('bloqueios', v_bloq), ('bloqueios_excluidos', v_bloq_sum),
                        ('sumidos_excluidos', v_sumidos + v_alem),
                        ('series_encerradas', v_encerradas), ('lotes', 1)) k(chave, valor)
         )
   where i.id = p_importacao_id;

  return jsonb_build_object(
    'importacao_id', p_importacao_id,
    'aplicado', jsonb_build_object(
      'vinculos', v_vinc, 'series_novas', v_series, 'sessoes_novas', v_novos,
      'restauradas', v_rest, 'alteradas', v_alt,
      'bloqueios', v_bloq, 'bloqueios_excluidos', v_bloq_sum,
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
  num     integer;
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
  if imp.situacao not in ('previa', 'aplicando') then
    raise exception 'Esta importação já foi %.', imp.situacao using errcode = '22023';
  end if;

  update public.grade_importacoes
     set situacao = 'aplicada', aplicada_em = now(), aplicada_por = auth.uid(), aplicada_por_nome = v_nome
   where id = p_importacao_id;

  a := imp.aplicado;
  n := imp.contadores;
  num := coalesce((a ->> 'sessoes_novas')::integer, 0) + coalesce((a ->> 'restauradas')::integer, 0);
  insert into public.grade_eventos
    (acao, importacao_id, lote_id, quantidade, depois, resumo, feito_por, feito_por_nome)
  values (
    'importado', p_importacao_id, p_importacao_id, num,
    a || jsonb_build_object('janela_inicio', imp.janela_inicio, 'janela_fim', imp.janela_fim,
                            'pendencias', coalesce((n ->> 'pendencias')::integer, 0)),
    'Importado do TiTa (' || to_char(imp.janela_inicio, 'DD/MM') || ' a ' || to_char(imp.janela_fim, 'DD/MM/YYYY') || '): '
      || coalesce(a ->> 'sessoes_novas', '0') || ' nova(s), '
      || coalesce(a ->> 'restauradas', '0') || ' restaurada(s), '
      || coalesce(a ->> 'alteradas', '0') || ' alterada(s), '
      || coalesce(a ->> 'sumidos_excluidos', '0') || ' excluída(s) por não estarem mais no TiTa, '
      || coalesce(a ->> 'bloqueios', '0') || ' bloqueio(s)'
      || case when coalesce((n ->> 'pendencias')::integer, 0) > 0
              then '; ' || (n ->> 'pendencias') || ' pendência(s) de cadastro' else '' end,
    auth.uid(), v_nome
  );

  return coalesce(a, '{}'::jsonb);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- I) GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.tita_cortado_em()                                     from public, anon;
grant execute on function public.tita_cortado_em()                                  to authenticated;
revoke all on function public.sp_tita_corte_trava_log()                             from public, anon, authenticated;
revoke all on function public.sp_grade_tita_calcular(date, date, bigint[])           from public, anon, authenticated;
revoke all on function public.sp_grade_tita_resumo(date, date)                      from public, anon, authenticated;
revoke all on function public.sp_grade_tita_frescor_pior(date, date)                from public, anon, authenticated;
revoke all on function public.grade_importar_tita_previa(date, date)                from public, anon;
revoke all on function public.grade_importar_tita_aplicar(uuid, boolean, bigint[])  from public, anon;
revoke all on function public.grade_importar_tita_concluir(uuid)                    from public, anon;
grant execute on function public.grade_importar_tita_previa(date, date)               to authenticated;
grant execute on function public.grade_importar_tita_aplicar(uuid, boolean, bigint[]) to authenticated;
grant execute on function public.grade_importar_tita_concluir(uuid)                   to authenticated;
