-- Revisão de segurança do arquivo de evoluções e da exportação (19/10/2026).
-- Complementa 20261019200300 (arquivo do TiTa na grade_evolucoes) e
-- 20261019200400 (exportação lê a grade_evolucoes). Achados corrigidos aqui:
--
--   1. Sessão que o TiTa cancela, marca como não realizada ou exclui DEPOIS de
--      arquivada continuava saindo no PDF/CSV como "Realizado". Agora a linha do
--      arquivo ganha `removido_tita_em` e some da exportação (volta se o TiTa
--      voltar a mostrá-la evoluída). Só marca quando NENHUMA linha ativa da
--      cópia com o mesmo id ainda é evolução (a cópia tem duplicatas).
--   2. Evolução do TiTa com mais de 20.000 caracteres era recusada pelo check e
--      se perdia (a cópia esquece o texto depois de ~45 dias). O limite segue
--      valendo para o que se digita no Pulsar.
--   3. Falha do arquivamento ficava só num WARNING do log: agora vai para
--      grade_evolucoes_arquivo_falhas (só admin lê).
--   4. O gatilho era por LINHA, com um bloco de exceção (subtransação) por
--      linha — num lote grande do sync isso pesa no banco. Agora é por COMANDO
--      (tabelas de transição), com um único bloco.
--   5. A chave das evoluções "Sem agendamento" dependia do fuso da sessão e
--      juntava campos vazios; agora é estável (UTC, marcador fixo para vazio).
--      As chaves existentes são recalculadas.
--   6. A listagem (nome do paciente, terapia, convênio de um período) passa a
--      ficar no registro também (finalidade 'listagem').
--
-- Primeira tentativa (19/10, SQL Editor) não entrou: estourou o tempo na parte
-- E, que conferia cada evolução varrendo a cópia inteira (não havia índice em
-- csv_grades_profissionais.tita_agendamento_id) e segurava a grade_evolucoes
-- travada nesse meio-tempo. Agora: índice, parte E num único UPDATE só na
-- janela que a cópia ainda atualiza, e trava curta (lock_timeout).
--
-- E a regra de "desfeita" ficou mais estrita: nos meses antigos a cópia não
-- tem dado de execução, e uma linha antiga inativada (sessão remarcada) não
-- pode desmentir o que o TiTa confirmou na carga. Só marca quando a cópia
-- conhece a sessão e NENHUMA linha ativa dela fica como evoluída ou "ainda não
-- capturada".
--
-- Idempotente: pode rodar de novo.

set lock_timeout = '10s';
set statement_timeout = '5min';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'grade_evolucoes' and column_name = 'chave_tita'
  ) or to_regprocedure('public.sp_exportar_evolucoes_fonte(date, date, bigint[], uuid[])') is null then
    raise exception 'Aplique antes a 20261019200300 e a 20261019200400.';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Estrutura
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_evolucoes add column if not exists removido_tita_em timestamptz;
comment on column public.grade_evolucoes.removido_tita_em is
  'Arquivo do TiTa: quando o TiTa deixou de mostrar a sessão como evoluída (cancelou, não realizada, excluiu). Linha marcada não sai na exportação.';

alter table public.grade_evolucoes drop constraint if exists grade_evol_descricao_check;
alter table public.grade_evolucoes add constraint grade_evol_descricao_check
  check (origem = 'tita_importacao' or coalesce(length(descricao_evolucao), 0) <= 20000);

create table if not exists public.grade_evolucoes_arquivo_falhas (
  id        bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem    text not null,
  mensagem  text not null,
  linhas    integer not null default 0
);
comment on table public.grade_evolucoes_arquivo_falhas is
  'Falhas ao arquivar evoluções do TiTa na grade_evolucoes (gatilho da cópia). Rodar scripts/carga-evolucoes-tita.mjs no período cobre o que faltou.';
alter table public.grade_evolucoes_arquivo_falhas enable row level security;
alter table public.grade_evolucoes_arquivo_falhas force row level security;
revoke all on table public.grade_evolucoes_arquivo_falhas from public, anon, authenticated;
grant select on table public.grade_evolucoes_arquivo_falhas to authenticated;
grant all on table public.grade_evolucoes_arquivo_falhas to service_role;
drop policy if exists grade_evolucoes_arquivo_falhas_admin on public.grade_evolucoes_arquivo_falhas;
create policy grade_evolucoes_arquivo_falhas_admin on public.grade_evolucoes_arquivo_falhas
  for select to authenticated using (public.is_admin());

alter table public.exportar_evolucoes_registro drop constraint if exists exportar_evolucoes_registro_finalidade_check;
alter table public.exportar_evolucoes_registro add constraint exportar_evolucoes_registro_finalidade_check
  check (finalidade in ('listagem', 'visualizacao', 'pdf', 'csv'));

create index if not exists idx_csv_grades_tita_agendamento
  on public.csv_grades_profissionais (tita_agendamento_id) where tita_agendamento_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Chave estável do arquivo
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_grade_evolucoes_chave_tita(
  p_tita_ag bigint, p_paciente bigint, p_data date, p_hora time, p_executor bigint, p_criada_em timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tita_ag is not null then 'ag:' || p_tita_ag
    else 'sem:' || coalesce(p_paciente::text, '-')
             || ':' || coalesce(to_char(p_data, 'YYYY-MM-DD'), '-')
             || ':' || coalesce(to_char(p_hora, 'HH24MI'), '-')
             || ':' || coalesce(p_executor::text, '-')
             || ':' || coalesce(to_char(p_criada_em at time zone 'UTC', 'YYYYMMDDHH24MISS'), '-')
  end
$$;
revoke all on function public.sp_grade_evolucoes_chave_tita(bigint, bigint, date, time, bigint, timestamptz) from public, anon, authenticated;

-- Recalcula as chaves "sem:" já gravadas (a de colisão, se houver, é a cópia
-- de outra linha: fica a mais recente).
with nova as (
  select e.id,
         public.sp_grade_evolucoes_chave_tita(null, e.tita_paciente_id, e.data, e.hora_inicio,
                                              e.tita_tratativa_profissional_id, e.tratativa_criada_em) as chave,
         row_number() over (
           partition by public.sp_grade_evolucoes_chave_tita(null, e.tita_paciente_id, e.data, e.hora_inicio,
                                                             e.tita_tratativa_profissional_id, e.tratativa_criada_em)
           order by e.arquivado_em desc nulls last, e.id desc) as n
    from public.grade_evolucoes e
   where e.agendamento_id is null and e.chave_tita like 'sem:%'
)
delete from public.grade_evolucoes e using nova
 where e.id = nova.id and nova.n > 1;

update public.grade_evolucoes e
   set chave_tita = public.sp_grade_evolucoes_chave_tita(null, e.tita_paciente_id, e.data, e.hora_inicio,
                                                         e.tita_tratativa_profissional_id, e.tratativa_criada_em)
 where e.agendamento_id is null and e.chave_tita like 'sem:%'
   and e.chave_tita is distinct from public.sp_grade_evolucoes_chave_tita(null, e.tita_paciente_id, e.data, e.hora_inicio,
                                                                          e.tita_tratativa_profissional_id, e.tratativa_criada_em);

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Arquivar: guarda o que é evolução e marca o que deixou de ser
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_grade_evolucoes_arquivar_tita(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd     integer := 0;
  v_marcadas integer := 0;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    return 0;
  end if;

  create temp table if not exists pg_temp.arq_linhas (
    tita_ag bigint, pac bigint, pac_nome text, data date, hi time, hf time, prof bigint, prof_nome text,
    trat bigint, trat_nome text, trat_em timestamptz, trat_orig text, vinc text, ter text, ter_ex text,
    conv text, uni bigint, st text, possui boolean, descr text, ativo boolean, chave text,
    evolucao boolean, deixou boolean
  ) on commit drop;
  truncate pg_temp.arq_linhas;

  insert into pg_temp.arq_linhas
  select l.*,
         public.sp_grade_evolucoes_chave_tita(l.tita_ag, l.pac, l.data, l.hi, coalesce(l.trat, l.prof), l.trat_em),
         -- é evolução
         (l.ativo and l.possui is true and coalesce(l.uni, 280) = 280 and l.data is not null
          and length(btrim(coalesce(l.descr, ''))) > 0
          and lower(coalesce(l.st, '')) !~ '(cancel|nao realizad|não realizad)'),
         -- deixou de ser, com certeza (vazio/"não capturado" não conta)
         (coalesce(l.uni, 280) = 280 and (
            not l.ativo
            or l.possui is false
            or lower(coalesce(l.st, '')) ~ '(cancel|nao realizad|não realizad)'
            or (l.possui is true and length(btrim(coalesce(l.descr, ''))) = 0)))
    from (
      select
        nullif(x->>'tita_agendamento_id', '')::bigint        as tita_ag,
        nullif(x->>'paciente_id', '')::bigint                as pac,
        nullif(btrim(x->>'paciente_nome'), '')               as pac_nome,
        nullif(x->>'data', '')::date                         as data,
        nullif(x->>'hora_inicial', '')::time                 as hi,
        nullif(x->>'hora_final', '')::time                   as hf,
        nullif(x->>'profissional_id', '')::bigint            as prof,
        nullif(btrim(x->>'profissional_nome'), '')           as prof_nome,
        nullif(x->>'tratativa_profissional_id', '')::bigint  as trat,
        nullif(btrim(x->>'tratativa_profissional_nome'), '') as trat_nome,
        nullif(x->>'tratativa_criada_em', '')::timestamptz   as trat_em,
        nullif(btrim(x->>'tratativa_origem'), '')            as trat_orig,
        x->>'evolucao_vinculo'                               as vinc,
        nullif(btrim(x->>'terapia_nome'), '')                as ter,
        nullif(btrim(x->>'terapia_exibicao_nome'), '')       as ter_ex,
        nullif(btrim(x->>'convenio_nome'), '')               as conv,
        nullif(x->>'unidade_id', '')::bigint                 as uni,
        nullif(btrim(x->>'status_execucao'), '')             as st,
        (x->>'possui_tratativa')::boolean                    as possui,
        x->>'descricao_evolucao'                             as descr,
        coalesce((x->>'ativo')::boolean, true)               as ativo
      from jsonb_array_elements(p_linhas) x
    ) l;

  with q as (
    select distinct on (a.chave) a.*
      from pg_temp.arq_linhas a
     where a.evolucao
     order by a.chave, a.trat_em desc nulls last
  )
  insert into public.grade_evolucoes as e (
    chave_tita, tita_agendamento_id, status_execucao, status_tita, possui_tratativa,
    tratativa_profissional_id, tratativa_profissional_nome, tratativa_criada_em, tratativa_origem,
    evolucao_vinculo, descricao_evolucao, tratativas, tratativas_distintas, origem,
    data, hora_inicio, hora_fim, tita_paciente_id, paciente_nome, tita_profissional_id, profissional_nome,
    tita_tratativa_profissional_id, terapia_nome, terapia_exibicao_nome, convenio_nome, unidade_id,
    registrado_por_nome, arquivado_em, removido_tita_em
  )
  select
    q.chave, q.tita_ag, 'Realizado', q.st, true,
    pr.id, coalesce(q.trat_nome, q.prof_nome), q.trat_em, coalesce(q.trat_orig, 'Prontuario'),
    case when q.vinc in ('Agendamento ativo', 'Agendamento excluído', 'Sem agendamento') then q.vinc
         when q.tita_ag is null then 'Sem agendamento'
         else 'Agendamento ativo' end,
    q.descr, 1, 1, 'tita_importacao',
    q.data, q.hi, q.hf, q.pac, q.pac_nome, q.prof, q.prof_nome,
    coalesce(q.trat, q.prof), q.ter, q.ter_ex, q.conv, coalesce(q.uni, 280),
    'TiTa', now(), null
  from q
  left join public.profissionais pr on pr.tita_profissional_id = coalesce(q.trat, q.prof)
  on conflict (chave_tita) where agendamento_id is null do update set
    tita_agendamento_id            = excluded.tita_agendamento_id,
    status_tita                    = excluded.status_tita,
    tratativa_profissional_id      = excluded.tratativa_profissional_id,
    tratativa_profissional_nome    = excluded.tratativa_profissional_nome,
    tratativa_criada_em            = excluded.tratativa_criada_em,
    tratativa_origem               = excluded.tratativa_origem,
    evolucao_vinculo               = excluded.evolucao_vinculo,
    descricao_evolucao             = excluded.descricao_evolucao,
    data                           = excluded.data,
    hora_inicio                    = excluded.hora_inicio,
    hora_fim                       = excluded.hora_fim,
    tita_paciente_id               = excluded.tita_paciente_id,
    paciente_nome                  = excluded.paciente_nome,
    tita_profissional_id           = excluded.tita_profissional_id,
    profissional_nome              = excluded.profissional_nome,
    tita_tratativa_profissional_id = excluded.tita_tratativa_profissional_id,
    terapia_nome                   = excluded.terapia_nome,
    terapia_exibicao_nome          = excluded.terapia_exibicao_nome,
    convenio_nome                  = excluded.convenio_nome,
    unidade_id                     = excluded.unidade_id,
    arquivado_em                   = now(),
    removido_tita_em               = null
  where e.removido_tita_em is not null
     or (e.descricao_evolucao, e.status_tita, e.tratativa_profissional_id, e.tratativa_criada_em, e.data,
         e.hora_inicio, e.hora_fim, e.tita_paciente_id, e.paciente_nome, e.tita_profissional_id,
         e.tita_tratativa_profissional_id, e.terapia_nome, e.terapia_exibicao_nome, e.convenio_nome,
         e.evolucao_vinculo)
        is distinct from
        (excluded.descricao_evolucao, excluded.status_tita, excluded.tratativa_profissional_id,
         excluded.tratativa_criada_em, excluded.data, excluded.hora_inicio, excluded.hora_fim,
         excluded.tita_paciente_id, excluded.paciente_nome, excluded.tita_profissional_id,
         excluded.tita_tratativa_profissional_id, excluded.terapia_nome, excluded.terapia_exibicao_nome,
         excluded.convenio_nome, excluded.evolucao_vinculo);
  get diagnostics v_qtd = row_count;

  -- Deixou de ser evolução no TiTa: marca, pelo id do agendamento, só se a
  -- cópia conhece a sessão e nenhuma linha ATIVA dela segue evoluída ou "ainda
  -- não capturada" (status e tratativa vazios = não sei, não é "desfeita").
  update public.grade_evolucoes e
     set removido_tita_em = now()
    from (
      select distinct a.tita_ag
        from pg_temp.arq_linhas a
       where a.deixou and a.tita_ag is not null
         and not exists (select 1 from pg_temp.arq_linhas b where b.evolucao and b.tita_ag = a.tita_ag)
    ) d
   where e.agendamento_id is null
     and e.chave_tita = 'ag:' || d.tita_ag
     and e.removido_tita_em is null
     and exists (select 1 from public.csv_grades_profissionais g where g.tita_agendamento_id = d.tita_ag)
     and not exists (
       select 1 from public.csv_grades_profissionais g
        where g.tita_agendamento_id = d.tita_ag
          and g.ativo is true
          and not (
            g.possui_tratativa is false
            or lower(coalesce(g.status_execucao, '')) ~ '(cancel|nao realizad|não realizad)'
            or (g.possui_tratativa is true and length(btrim(coalesce(g.descricao_evolucao, ''))) = 0)
          )
     );
  get diagnostics v_marcadas = row_count;

  return v_qtd + v_marcadas;
end $$;

revoke all on function public.sp_grade_evolucoes_arquivar_tita(jsonb) from public, anon, authenticated;
grant execute on function public.sp_grade_evolucoes_arquivar_tita(jsonb) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Gatilho por comando (substitui os dois por linha da 200300)
-- ═════════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_csv_grade_arquivar_evolucao_ins on public.csv_grades_profissionais;
drop trigger if exists trg_csv_grade_arquivar_evolucao_upd on public.csv_grades_profissionais;
drop function if exists public.sp_csv_grade_arquivar_evolucao();

-- Falhar aqui NÃO derruba o sync (que alimenta remuneração e outras telas): a
-- falha vai para grade_evolucoes_arquivo_falhas e a linha da cópia entra.
create or replace function public.sp_csv_grade_arquivar_evolucoes_cmd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linhas jsonb;
begin
  if tg_op = 'INSERT' then
    select jsonb_agg(to_jsonb(n)) into v_linhas
      from novas n
     where n.possui_tratativa is not null or n.status_execucao is not null;
  else
    select jsonb_agg(to_jsonb(n)) into v_linhas
      from novas n
      join antigas o on o.id = n.id
     where (o.descricao_evolucao, o.possui_tratativa, o.status_execucao, o.ativo,
            o.tratativa_profissional_id, o.tratativa_criada_em)
           is distinct from
           (n.descricao_evolucao, n.possui_tratativa, n.status_execucao, n.ativo,
            n.tratativa_profissional_id, n.tratativa_criada_em);
  end if;

  if v_linhas is null then
    return null;
  end if;

  begin
    perform public.sp_grade_evolucoes_arquivar_tita(v_linhas);
  exception when others then
    begin
      insert into public.grade_evolucoes_arquivo_falhas (origem, mensagem, linhas)
      values ('gatilho ' || lower(tg_op), sqlerrm, jsonb_array_length(v_linhas));
    exception when others then
      raise warning '[arquivo de evoluções] falha não registrada: %', sqlerrm;
    end;
  end;
  return null;
end $$;

revoke all on function public.sp_csv_grade_arquivar_evolucoes_cmd() from public, anon, authenticated;

drop trigger if exists trg_csv_grade_arquivar_evolucoes_ins on public.csv_grades_profissionais;
create trigger trg_csv_grade_arquivar_evolucoes_ins
  after insert on public.csv_grades_profissionais
  referencing new table as novas
  for each statement execute function public.sp_csv_grade_arquivar_evolucoes_cmd();

drop trigger if exists trg_csv_grade_arquivar_evolucoes_upd on public.csv_grades_profissionais;
create trigger trg_csv_grade_arquivar_evolucoes_upd
  after update on public.csv_grades_profissionais
  referencing old table as antigas new table as novas
  for each statement execute function public.sp_csv_grade_arquivar_evolucoes_cmd();

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Marca, de uma vez, o que já está no arquivo e a cópia mostra desfeito.
--    Só nos últimos 60 dias: é a janela que o sync atualiza (45 dias); antes
--    disso a cópia está congelada e quem vale é a carga feita direto do TiTa.
-- ═════════════════════════════════════════════════════════════════════════════
update public.grade_evolucoes e
   set removido_tita_em = now()
 where e.agendamento_id is null
   and e.tita_agendamento_id is not null
   and e.removido_tita_em is null
   and e.data >= current_date - 60
   and exists (select 1 from public.csv_grades_profissionais g where g.tita_agendamento_id = e.tita_agendamento_id)
   and not exists (
     select 1 from public.csv_grades_profissionais g
      where g.tita_agendamento_id = e.tita_agendamento_id
        and g.ativo is true
        and not (
          g.possui_tratativa is false
          or lower(coalesce(g.status_execucao, '')) ~ '(cancel|nao realizad|não realizad)'
          or (g.possui_tratativa is true and length(btrim(coalesce(g.descricao_evolucao, ''))) = 0)
        )
   );

-- ═════════════════════════════════════════════════════════════════════════════
-- F) Exportação: fonte ignora o que o TiTa desfez; listagem fica registrada
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_exportar_evolucoes_fonte(
  p_de         date,
  p_ate        date,
  p_tita_ids   bigint[] default null,
  p_pulsar_ids uuid[] default null
)
returns table (
  chave               text,
  origem              text,
  agendamento_id      text,
  data                date,
  hora_inicio         time,
  hora_fim            time,
  paciente_id         bigint,
  paciente_nome       text,
  paciente_cpf        text,
  paciente_nascimento date,
  convenio            text,
  terapia             text,
  profissional_id     bigint,
  profissional_nome   text,
  tipo_registro       text,
  uf_registro         text,
  codigo_registro     text,
  assinatura_path     text,
  substituicao        boolean,
  registrado_por_nome text,
  descricao           text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- TiTa: o arquivo (linhas sem sessão na Grade).
  select
    'tita:' || e.id::text,
    'tita',
    e.tita_agendamento_id::text,
    e.data,
    e.hora_inicio,
    e.hora_fim,
    pac.id_paciente,
    coalesce(nullif(btrim(pac.nome), ''), e.paciente_nome),
    pac.cpf,
    pac.data_nascimento,
    coalesce(nullif(btrim(e.convenio_nome), ''), pac.convenio_nome),
    coalesce(nullif(btrim(e.terapia_exibicao_nome), ''), e.terapia_nome),
    pe.id,
    coalesce(nullif(btrim(pe.nome), ''), e.tratativa_profissional_nome, e.profissional_nome),
    pe.tipo_registro,
    pe.uf_registro,
    pe.codigo_registro,
    pe.assinatura_path,
    (e.tita_tratativa_profissional_id is distinct from e.tita_profissional_id),
    null::text,
    e.descricao_evolucao
  from public.grade_evolucoes e
  left join public.pacientes pac on pac.tita_paciente_id = e.tita_paciente_id
  left join public.profissionais pe on pe.tita_profissional_id = e.tita_tratativa_profissional_id
  where e.agendamento_id is null
    and e.origem = 'tita_importacao'
    and length(btrim(coalesce(e.descricao_evolucao, ''))) > 0
    -- O TiTa desfez (cancelou, não realizada, excluiu): não vai ao convênio.
    and e.removido_tita_em is null
    and lower(coalesce(e.status_tita, '')) !~ '(cancel|nao realizad|não realizad)'
    and (p_tita_ids is null or e.id = any (p_tita_ids))
    and (p_de is null or e.data >= p_de)
    and (p_ate is null or e.data <= p_ate)
    -- Havendo registro do Pulsar para o mesmo atendimento, vale o do Pulsar.
    and not (
      e.tita_agendamento_id is not null
      and (
        exists (
          select 1 from public.grade_evolucoes gp
           where gp.origem = 'pulsar' and gp.tita_agendamento_id = e.tita_agendamento_id
        )
        or exists (
          select 1
            from public.grade_evolucoes gp
            join public.grade_agendamentos ga on ga.id = gp.agendamento_id
           where gp.origem = 'pulsar' and ga.tita_agendamento_id = e.tita_agendamento_id
        )
      )
    )

  union all

  select
    'pulsar:' || ge.agendamento_id::text,
    'pulsar',
    coalesce(ga.tita_agendamento_id::text, ge.tita_agendamento_id::text, ga.id::text),
    ga.data,
    ga.hora_inicio,
    ga.hora_fim,
    pac.id_paciente,
    coalesce(nullif(btrim(pac.nome), ''), ga.paciente_nome),
    pac.cpf,
    pac.data_nascimento,
    pac.convenio_nome,
    coalesce(nullif(btrim(ct.nome), ''), nullif(btrim(ga.terapia_exibicao_nome), ''), ga.terapia_nome),
    pe.id,
    -- Nome do cadastro pelo id; tratativa_profissional_nome NÃO (é o admin que digitou).
    coalesce(nullif(btrim(pe.nome), ''), ga.profissional_nome),
    pe.tipo_registro,
    pe.uf_registro,
    pe.codigo_registro,
    pe.assinatura_path,
    (ge.tratativa_profissional_id is not null and ge.tratativa_profissional_id is distinct from ga.profissional_id),
    ge.registrado_por_nome,
    ge.descricao_evolucao
  from public.grade_evolucoes ge
  join public.grade_agendamentos ga on ga.id = ge.agendamento_id
  left join public.pacientes pac on pac.id_paciente = ga.paciente_id
  left join public.cadastro_terapias ct on ct.id = ga.terapia_exibicao_id
  left join public.profissionais pe on pe.id = coalesce(ge.tratativa_profissional_id, ga.profissional_id)
  where ge.origem = 'pulsar'
    and ge.status_execucao = 'Realizado'
    and length(btrim(coalesce(ge.descricao_evolucao, ''))) > 0
    and (p_pulsar_ids is null or ge.agendamento_id = any (p_pulsar_ids))
    and (p_de is null or ga.data >= p_de)
    and (p_ate is null or ga.data <= p_ate)
$$;

revoke all on function public.sp_exportar_evolucoes_fonte(date, date, bigint[], uuid[]) from public, anon, authenticated, service_role;

drop function if exists public.exportar_evolucoes_listar(date, date, bigint[], text[]);

create or replace function public.exportar_evolucoes_listar(
  p_de          date,
  p_ate         date,
  p_paciente_ids bigint[] default null,
  p_terapias    text[] default null,
  p_usuario_id   uuid default null,
  p_usuario_nome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      jsonb;
  v_pacs bigint[];
begin
  if p_de is null or p_ate is null then
    raise exception 'Informe o período.' using errcode = '22023';
  end if;
  if p_ate < p_de then
    raise exception 'A data final é anterior à inicial.' using errcode = '22023';
  end if;
  if p_ate > (p_de + interval '12 months' - interval '1 day')::date then
    raise exception 'O período pode ter no máximo 12 meses.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', f.chave,
           'origem', f.origem,
           'agendamento_id', f.agendamento_id,
           'data', f.data,
           'hora_inicio', to_char(f.hora_inicio, 'HH24:MI'),
           'hora_fim', to_char(f.hora_fim, 'HH24:MI'),
           'paciente_id', f.paciente_id,
           'paciente_nome', f.paciente_nome,
           'convenio', f.convenio,
           'terapia', f.terapia,
           'profissional_id', f.profissional_id,
           'profissional_nome', f.profissional_nome,
           'tem_assinatura', f.assinatura_path is not null,
           'substituicao', f.substituicao
         ) order by lower(f.paciente_nome), f.paciente_id, f.data, f.hora_inicio, f.chave), '[]'::jsonb)
    into v
    from public.sp_exportar_evolucoes_fonte(p_de, p_ate, null, null) f
   where (p_paciente_ids is null or cardinality(p_paciente_ids) = 0 or f.paciente_id = any (p_paciente_ids))
     and (p_terapias is null or cardinality(p_terapias) = 0 or f.terapia = any (p_terapias));

  select coalesce(array_agg(distinct (x->>'paciente_id')::bigint) filter (where x->>'paciente_id' is not null), '{}')
    into v_pacs
    from jsonb_array_elements(v) x;

  insert into public.exportar_evolucoes_registro (
    usuario_id, usuario_nome, finalidade, quantidade, periodo_de, periodo_ate, paciente_ids, chaves
  ) values (
    p_usuario_id, coalesce(nullif(btrim(p_usuario_nome), ''), 'Usuário do Pulsar'),
    'listagem', jsonb_array_length(v), p_de, p_ate, v_pacs, '{}'
  );

  return v;
end $$;

revoke all on function public.exportar_evolucoes_listar(date, date, bigint[], text[], uuid, text) from public, anon, authenticated;
grant execute on function public.exportar_evolucoes_listar(date, date, bigint[], text[], uuid, text) to service_role;
