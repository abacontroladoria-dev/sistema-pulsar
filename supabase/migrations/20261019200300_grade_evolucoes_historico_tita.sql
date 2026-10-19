-- grade_evolucoes vira A tabela de evoluções do Pulsar, inclusive o histórico
-- do TiTa (decisão do usuário, 19/10/2026: "estender a grade_evolucoes").
--
-- Antes: cada linha era 1:1 com uma sessão da Grade (agendamento_id, chave
-- primária). A Grade só tem sessões a partir de outubro/2026, então as
-- evoluções do TiTa de janeiro a setembro não tinham onde ficar — e a cópia
-- csv_grades_profissionais só guarda o texto dos últimos ~45 dias (medido:
-- texto só a partir de 27/07/2026; de jan a mai nem o status).
--
-- Agora:
--   - chave primária própria (`id`); `agendamento_id` passa a ser opcional e
--     continua ÚNICO quando existe (os `on conflict (agendamento_id)` da Grade
--     seguem valendo);
--   - linha SEM sessão na Grade = evolução arquivada do TiTa
--     (origem = 'tita_importacao'), com os dados da sessão na própria linha
--     (data, horário, paciente, profissional, terapia, convênio) e uma chave
--     estável `chave_tita` ('ag:<id do agendamento no TiTa>' ou 'sem:…' para a
--     evolução "Sem agendamento");
--   - toda evolução que chega do TiTa na csv_grades_profissionais é arquivada
--     por gatilho; a carga de 01/01/2026 até a cópia começar vem do script
--     scripts/carga-evolucoes-tita.mjs, pela mesma função.
--
-- O que NÃO muda: a Grade, a RP e a Central de Pacientes leem grade_evolucoes
-- sempre a partir de grade_agendamentos (join por agendamento_id) — linha sem
-- sessão não aparece para elas. As linhas espelhadas pela Grade
-- (sp_grade_espelhar_evolucoes_tita, com agendamento_id) ficam como estão.
--
-- Idempotente: pode rodar de novo.

do $$
begin
  if to_regclass('public.grade_evolucoes') is null then
    raise exception 'Aplique antes a 20261016180000_grade_evolucoes_terapeuticas.sql.';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Estrutura
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.grade_evolucoes
  add column if not exists id                             bigint generated always as identity,
  add column if not exists chave_tita                     text,
  add column if not exists data                           date,
  add column if not exists hora_inicio                    time,
  add column if not exists hora_fim                       time,
  add column if not exists tita_paciente_id               bigint,
  add column if not exists paciente_nome                  text,
  add column if not exists tita_profissional_id           bigint,
  add column if not exists profissional_nome              text,
  add column if not exists tita_tratativa_profissional_id bigint,
  add column if not exists terapia_nome                   text,
  add column if not exists terapia_exibicao_nome          text,
  add column if not exists convenio_nome                  text,
  add column if not exists unidade_id                     bigint,
  add column if not exists status_tita                    text,
  add column if not exists arquivado_em                   timestamptz;

comment on column public.grade_evolucoes.chave_tita is
  'Só nas evoluções arquivadas do TiTa sem sessão na Grade: ''ag:<tita_agendamento_id>'' ou ''sem:<paciente>:<data>:<hora>:<profissional>:<criação>'' (evolução "Sem agendamento").';
comment on column public.grade_evolucoes.tita_tratativa_profissional_id is
  'Arquivo do TiTa: id no TiTa de quem executou (o substituto, quando houve troca). tita_profissional_id é o agendado.';
comment on column public.grade_evolucoes.status_tita is
  'Arquivo do TiTa: o status como veio (Realizado, Em Conflito, vazio…). status_execucao fica Realizado.';

-- Chave primária: agendamento_id → id. agendamento_id continua único.
do $$
declare
  v_pk text;
begin
  select pg_get_constraintdef(c.oid) into v_pk
    from pg_constraint c
   where c.conrelid = 'public.grade_evolucoes'::regclass and c.contype = 'p';

  if v_pk is not null and v_pk like '%agendamento_id%' then
    alter table public.grade_evolucoes drop constraint grade_evolucoes_pkey;
    v_pk := null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.grade_evolucoes'::regclass and conname = 'grade_evolucoes_agendamento_id_key'
  ) then
    alter table public.grade_evolucoes add constraint grade_evolucoes_agendamento_id_key unique (agendamento_id);
  end if;
  if v_pk is null then
    alter table public.grade_evolucoes add constraint grade_evolucoes_pkey primary key (id);
  end if;
end $$;

alter table public.grade_evolucoes alter column agendamento_id drop not null;

-- Linha sem sessão na Grade só pode ser arquivo do TiTa, e completo.
alter table public.grade_evolucoes drop constraint if exists grade_evol_sem_sessao_check;
alter table public.grade_evolucoes add constraint grade_evol_sem_sessao_check check (
  agendamento_id is not null
  or (origem = 'tita_importacao' and chave_tita is not null and data is not null)
);

create unique index if not exists uq_grade_evolucoes_chave_tita
  on public.grade_evolucoes (chave_tita) where agendamento_id is null;
create index if not exists idx_grade_evolucoes_arquivo_data
  on public.grade_evolucoes (data) where agendamento_id is null;

comment on table public.grade_evolucoes is
  'Evoluções do Pulsar. Com agendamento_id: execução de uma sessão da Grade (evolução ou falta; origem pulsar ou espelho do TiTa). Sem agendamento_id: evolução do TiTa arquivada (desde 01/01/2026), com os dados da sessão na linha. A Grade, a RP e a Central leem só as linhas com sessão.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Arquivar evoluções do TiTa
-- ═════════════════════════════════════════════════════════════════════════════
-- Recebe linhas no formato da csv_grades_profissionais (jsonb, uma lista) e
-- guarda as que são evolução: tratativa = sim, texto preenchido, unidade 280,
-- linha ativa e status que não seja de não realização ("Em Conflito" e o vazio
-- dos "Sem agendamento" entram — a sessão foi evoluída). Mesma regra medida no
-- plano (seção 14). Reenviar a mesma linha só atualiza o que mudou.
create or replace function public.sp_grade_evolucoes_arquivar_tita(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd integer;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    return 0;
  end if;

  with l as (
    select
      nullif(x->>'tita_agendamento_id', '')::bigint       as tita_ag,
      nullif(x->>'paciente_id', '')::bigint               as pac,
      nullif(btrim(x->>'paciente_nome'), '')              as pac_nome,
      nullif(x->>'data', '')::date                        as data,
      nullif(x->>'hora_inicial', '')::time                as hi,
      nullif(x->>'hora_final', '')::time                  as hf,
      nullif(x->>'profissional_id', '')::bigint           as prof,
      nullif(btrim(x->>'profissional_nome'), '')          as prof_nome,
      nullif(x->>'tratativa_profissional_id', '')::bigint as trat,
      nullif(btrim(x->>'tratativa_profissional_nome'), '') as trat_nome,
      nullif(x->>'tratativa_criada_em', '')::timestamptz  as trat_em,
      nullif(btrim(x->>'tratativa_origem'), '')           as trat_orig,
      x->>'evolucao_vinculo'                              as vinc,
      nullif(btrim(x->>'terapia_nome'), '')               as ter,
      nullif(btrim(x->>'terapia_exibicao_nome'), '')      as ter_ex,
      nullif(btrim(x->>'convenio_nome'), '')              as conv,
      nullif(x->>'unidade_id', '')::bigint                as uni,
      nullif(btrim(x->>'status_execucao'), '')            as st,
      (x->>'possui_tratativa')::boolean                   as possui,
      x->>'descricao_evolucao'                            as descr,
      coalesce((x->>'ativo')::boolean, true)              as ativo
    from jsonb_array_elements(p_linhas) x
  ),
  q as (
    select distinct on (s.chave) s.*
      from (
        select l.*,
               case when l.tita_ag is not null then 'ag:' || l.tita_ag
                    else 'sem:' || concat_ws(':', l.pac, l.data, l.hi, coalesce(l.trat, l.prof), l.trat_em)
               end as chave
          from l
         where l.ativo
           and l.possui is true
           and coalesce(l.uni, 280) = 280
           and l.data is not null
           and length(btrim(coalesce(l.descr, ''))) > 0
           and lower(coalesce(l.st, '')) !~ '(cancel|nao realizad|não realizad)'
      ) s
     order by s.chave, s.trat_em desc nulls last
  )
  insert into public.grade_evolucoes as e (
    chave_tita, tita_agendamento_id, status_execucao, status_tita, possui_tratativa,
    tratativa_profissional_id, tratativa_profissional_nome, tratativa_criada_em, tratativa_origem,
    evolucao_vinculo, descricao_evolucao, tratativas, tratativas_distintas, origem,
    data, hora_inicio, hora_fim, tita_paciente_id, paciente_nome, tita_profissional_id, profissional_nome,
    tita_tratativa_profissional_id, terapia_nome, terapia_exibicao_nome, convenio_nome, unidade_id,
    registrado_por_nome, arquivado_em
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
    'TiTa', now()
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
    arquivado_em                   = now()
  -- Sem mudança, sem escrita (o sync reenvia a janela inteira todo dia).
  where (e.descricao_evolucao, e.status_tita, e.tratativa_profissional_id, e.tratativa_criada_em, e.data,
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
  return v_qtd;
end $$;

revoke all on function public.sp_grade_evolucoes_arquivar_tita(jsonb) from public, anon, authenticated;
-- A carga histórica (scripts/carga-evolucoes-tita.mjs) chama pela service_role.
grant execute on function public.sp_grade_evolucoes_arquivar_tita(jsonb) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Todo dia: o que o sync traz do TiTa é arquivado
-- ═════════════════════════════════════════════════════════════════════════════
-- Falhar aqui NÃO pode derrubar o sync da grade (que alimenta remuneração e
-- outras telas): o erro vira aviso no log e a linha da cópia entra do mesmo
-- jeito. Rodar a carga de novo cobre o que faltar.
create or replace function public.sp_csv_grade_arquivar_evolucao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.sp_grade_evolucoes_arquivar_tita(jsonb_build_array(to_jsonb(new)));
  exception when others then
    raise warning '[arquivo de evoluções] linha % da csv_grades_profissionais não arquivada: %', new.id, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.sp_csv_grade_arquivar_evolucao() from public, anon, authenticated;

drop trigger if exists trg_csv_grade_arquivar_evolucao_ins on public.csv_grades_profissionais;
create trigger trg_csv_grade_arquivar_evolucao_ins
  after insert on public.csv_grades_profissionais
  for each row
  when (new.possui_tratativa is true and new.descricao_evolucao is not null)
  execute function public.sp_csv_grade_arquivar_evolucao();

drop trigger if exists trg_csv_grade_arquivar_evolucao_upd on public.csv_grades_profissionais;
create trigger trg_csv_grade_arquivar_evolucao_upd
  after update on public.csv_grades_profissionais
  for each row
  when (
    new.possui_tratativa is true and new.descricao_evolucao is not null
    and (
      old.descricao_evolucao is distinct from new.descricao_evolucao
      or old.possui_tratativa is distinct from new.possui_tratativa
      or old.status_execucao is distinct from new.status_execucao
      or old.ativo is distinct from new.ativo
      or old.tratativa_profissional_id is distinct from new.tratativa_profissional_id
      or old.tratativa_criada_em is distinct from new.tratativa_criada_em
    )
  )
  execute function public.sp_csv_grade_arquivar_evolucao();

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Carga inicial: o que a cópia já tem (texto a partir de 27/07/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- Mês a mês, para não montar um jsonb único de dezenas de MB.
do $$
declare
  m date;
begin
  for m in
    select distinct date_trunc('month', g.data)::date
      from public.csv_grades_profissionais g
     where g.possui_tratativa is true and g.descricao_evolucao is not null and g.data is not null
     order by 1
  loop
    perform public.sp_grade_evolucoes_arquivar_tita(coalesce((
      select jsonb_agg(to_jsonb(g))
        from public.csv_grades_profissionais g
       where g.possui_tratativa is true and g.descricao_evolucao is not null
         and g.data >= m and g.data < (m + interval '1 month')::date
    ), '[]'::jsonb));
  end loop;
end $$;
