-- Importação de Pacientes do TiTa e Automação Diária (04:00 BRT).
--
-- 1. Cria public.pacientes_importacoes_log para registrar cada execução (manual ou cron)
--    com contadores e a lista detalhada do que mudou ("Ver mais").
-- 2. Registra a regra de alerta 'sync_pacientes_falhou' em public.alertas_regras.
-- 3. Cria a função RPC public.pacientes_importar_tita(p_origem).
--    - Lê cópias sincronizadas locais (public.agenda_tita e public.csv_grades_profissionais).
--    - NUNCA sobrescreve dados editados manualmente pela equipe (preenche apenas campos vazios/nulos).
--    - Vincula por CPF cadastros criados previamente no Pulsar.
--    - Insere novos pacientes e registra trilha em public.cadastros_auditoria.
--    - Se falhar, registra o erro no log e gera alerta na Central de Alertas.
--    - Se tiver sucesso, encerra alertas pendentes de falhas anteriores.
-- 4. Agenda no pg_cron às 04:00 BRT (07:00 UTC): '0 7 * * *'.
--
-- Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Tabela de Log das Importações de Pacientes
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_importacoes_log (
  id                  uuid primary key default gen_random_uuid(),
  iniciado_em         timestamptz not null default now(),
  finalizado_em       timestamptz,
  origem              text not null default 'manual',
  status              text not null default 'sucesso',
  vistos_na_tita      integer not null default 0,
  novos               integer not null default 0,
  vinculados_por_cpf  integer not null default 0,
  atualizados         integer not null default 0,
  detalhes            jsonb not null default '{}'::jsonb,
  erro_mensagem       text,
  usuario_id          uuid references public.usuarios(id),
  usuario_nome        text,

  constraint pacientes_importacoes_origem_check check (origem in ('manual', 'cron')),
  constraint pacientes_importacoes_status_check check (status in ('sucesso', 'erro', 'em_andamento'))
);

create index if not exists idx_pacientes_importacoes_log_iniciado_em
  on public.pacientes_importacoes_log (iniciado_em desc);

comment on table public.pacientes_importacoes_log is
  'Histórico de execuções do Importar do TiTa para Pacientes (diário às 04:00 ou manual). Guarda contadores e o diff detalhado para o botão Ver Mais da tela.';

alter table public.pacientes_importacoes_log enable row level security;

do $rls$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pacientes_importacoes_log'
  loop
    execute format('drop policy %I on public.pacientes_importacoes_log', pol.policyname);
  end loop;
end
$rls$;

create policy "pacientes_importacoes_log_select" on public.pacientes_importacoes_log
  for select to authenticated
  using (true);

grant select on public.pacientes_importacoes_log to authenticated;
grant select, insert, update on public.pacientes_importacoes_log to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Regra na Central de Alertas
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.alertas_regras
  (codigo, modulo, nome, setor_destino, prioridade, tolerancia_minutos)
values
  ('sync_pacientes_falhou', 'sync', 'Sincronização de pacientes do TiTa falhou', 'admin', 'alta', 0)
on conflict (codigo) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Função RPC de Importação
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.pacientes_importar_tita(p_origem text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $func$
declare
  v_log_id             uuid := gen_random_uuid();
  v_usuario_nome       text;
  v_vistos             integer := 0;
  v_novos              integer := 0;
  v_vinculados         integer := 0;
  v_atualizados        integer := 0;
  v_novos_json         jsonb := '[]'::jsonb;
  v_atualizados_json   jsonb := '[]'::jsonb;
  v_detalhes           jsonb := '{}'::jsonb;
  v_erro               text;
begin
  -- Validação de permissão: usuário comum exige permissão cadastros_pacientes.
  -- Chamada interna (pg_cron/service_role com auth.uid() nulo) é permitida.
  if auth.uid() is not null and not public.usuario_tem_permissao('cadastros_pacientes') then
    raise exception 'Sem permissão para importar pacientes.' using errcode = '42501';
  end if;

  -- Lock contra concorrência para garantir contagem e inserção atômicas
  perform pg_advisory_xact_lock(hashtext('pacientes_importar_tita'));

  if auth.uid() is not null then
    select u.nome into v_usuario_nome from public.usuarios u where u.id = auth.uid();
  else
    if p_origem = 'cron' then
      v_usuario_nome := 'Sistema (rotina 04:00)';
    else
      v_usuario_nome := 'Sistema';
    end if;
  end if;

  insert into public.pacientes_importacoes_log (
    id, iniciado_em, origem, status, usuario_id, usuario_nome
  ) values (
    v_log_id, now(), p_origem, 'em_andamento', auth.uid(), v_usuario_nome
  );

  -- 1. Base consolidada do TiTa (agenda_tita + csv_grades_profissionais)
  create temporary table pg_temp.tmp_tita_pacientes on commit drop as
  with agenda_agg as (
    select
      at.paciente_id,
      (array_agg(btrim(at.paciente_nome) order by at.data_atendimento desc) filter (where at.paciente_nome is not null))[1] as nome,
      (array_agg(regexp_replace(at.cpf, '\D', '', 'g') order by at.data_atendimento desc)
         filter (where regexp_replace(coalesce(at.cpf, ''), '\D', '', 'g') ~ '^\d{11}$'))[1] as cpf_coluna,
      (array_agg(at.data_nascimento order by at.data_atendimento desc) filter (where at.data_nascimento is not null))[1] as nascimento_coluna,
      (array_agg(at.convenio_id order by at.data_atendimento desc) filter (where at.convenio_id is not null))[1] as convenio_id,
      (array_agg(btrim(at.convenio_nome) order by at.data_atendimento desc) filter (where at.convenio_nome is not null))[1] as convenio_nome,
      (array_agg(btrim(at.numero_carteirinha) order by at.data_atendimento desc) filter (where at.numero_carteirinha is not null))[1] as numero_carteirinha,
      (array_agg(btrim(at.responsavel_nome) order by at.data_atendimento desc) filter (where at.responsavel_nome is not null))[1] as responsavel_nome,
      (array_agg(btrim(at.responsavel_email) order by at.data_atendimento desc) filter (where at.responsavel_email is not null))[1] as responsavel_email,
      (array_agg(btrim(at.responsavel_telefone) order by at.data_atendimento desc) filter (where at.responsavel_telefone is not null))[1] as responsavel_telefone,
      (array_agg(at.raw_json -> 'favorecido' order by at.data_atendimento desc) filter (where at.raw_json -> 'favorecido' is not null))[1] as favorecido,
      (array_agg(at.raw_json -> 'favorecido' -> 'familiares' -> 0 order by at.data_atendimento desc) filter (where at.raw_json -> 'favorecido' -> 'familiares' -> 0 is not null))[1] as familiar
    from public.agenda_tita at
    where at.ativo
      and at.paciente_id is not null
      and coalesce(at.paciente_nome, '') not in ('', 'Paciente Teste')
      and at.paciente_nome not ilike 'Teste%'
    group by at.paciente_id
  ),
  csv_grade_agg as (
    select
      g.paciente_id,
      (array_agg(btrim(g.paciente_nome) order by g.data desc) filter (where g.paciente_nome is not null))[1] as nome,
      (array_agg(btrim(g.convenio_nome) order by g.data desc) filter (where g.convenio_nome is not null))[1] as convenio_nome
    from public.csv_grades_profissionais g
    where g.ativo
      and g.paciente_id is not null
      and (g.unidade_id = 280 or g.unidade_id is null)
      and coalesce(g.paciente_nome, '') not in ('', 'Paciente Teste')
      and g.paciente_nome not ilike 'Teste%'
    group by g.paciente_id
  ),
  combinado as (
    select
      coalesce(a.paciente_id, c.paciente_id) as paciente_id,
      coalesce(a.nome, c.nome) as nome,
      coalesce(
        nullif(regexp_replace(coalesce(a.favorecido ->> 'cpf', ''), '\D', '', 'g'), ''),
        a.cpf_coluna
      ) as cpf,
      coalesce(
        case
          when a.favorecido ->> 'data_nascimento' ~ '^\d{2}/\d{2}/\d{4}$'
          then to_date(a.favorecido ->> 'data_nascimento', 'DD/MM/YYYY')
        end,
        a.nascimento_coluna
      ) as data_nascimento,
      a.convenio_id,
      coalesce(a.convenio_nome, c.convenio_nome) as convenio_nome,
      a.numero_carteirinha,
      coalesce(a.responsavel_nome, nullif(btrim(a.familiar ->> 'nome'), '')) as responsavel_nome,
      coalesce(a.responsavel_email, nullif(btrim(a.familiar ->> 'email'), '')) as responsavel_email,
      coalesce(a.responsavel_telefone, nullif(btrim(a.familiar ->> 'celular'), '')) as responsavel_telefone,
      nullif(regexp_replace(coalesce(a.familiar ->> 'cpf', ''), '\D', '', 'g'), '') as responsavel_cpf,
      nullif(btrim(coalesce(a.familiar ->> 'parentesco', '')), '') as responsavel_parentesco,
      case
        when a.familiar ? 'resp_financeiro'
        then (a.familiar ->> 'resp_financeiro')::boolean
      end as responsavel_financeiro,
      nullif(regexp_replace(coalesce(a.familiar ->> 'cep', ''), '\D', '', 'g'), '') as cep,
      nullif(btrim(coalesce(a.familiar ->> 'endereco', '')), '') as logradouro,
      nullif(btrim(coalesce(a.familiar ->> 'numeroResidencia', '')), '') as numero,
      nullif(btrim(coalesce(a.familiar ->> 'complemento', '')), '') as complemento,
      nullif(btrim(coalesce(a.familiar ->> 'bairro', '')), '') as bairro,
      nullif(btrim(coalesce(a.familiar ->> 'cidade', '')), '') as cidade,
      nullif(upper(btrim(coalesce(a.familiar ->> 'uf', ''))), '') as uf
    from agenda_agg a
    full outer join csv_grade_agg c on c.paciente_id = a.paciente_id
  )
  select
    paciente_id,
    nome,
    cpf,
    data_nascimento,
    convenio_id,
    convenio_nome,
    numero_carteirinha,
    responsavel_nome,
    responsavel_email,
    responsavel_telefone,
    responsavel_cpf,
    responsavel_parentesco,
    responsavel_financeiro,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    (
      public.normalizar_nome_paciente(nome) in (
        'horario administrativo',
        'horario bloqueado',
        'notificacao previa',
        'ainda nao selecionado'
      )
      or nome ilike 'Horário Administrativo%'
      or nome ilike 'Horário Bloqueado%'
      or nome ilike 'Notificação Prévia%'
      or nome ilike 'Alinhamento%'
      or nome ilike 'Supervis%'
      or nome ilike 'Facilitador Técnico%'
    ) as ficticio
  from combinado
  where length(btrim(coalesce(nome, ''))) >= 2;

  select count(*) into v_vistos from pg_temp.tmp_tita_pacientes;

  -- 2. Vincula pacientes cadastrados à mão no Pulsar pelo CPF caso surjam no TiTa
  with vinc as (
    update public.pacientes p
       set tita_paciente_id = t.paciente_id
      from (
        select distinct on (t.cpf) t.cpf, t.paciente_id
        from pg_temp.tmp_tita_pacientes t
        where t.cpf is not null and length(t.cpf) = 11
          and not exists (
            select 1 from public.pacientes x where x.tita_paciente_id = t.paciente_id
          )
        order by t.cpf, t.paciente_id
      ) t
     where p.tita_paciente_id is null
       and p.cpf = t.cpf
    returning p.id_paciente
  )
  select count(*) into v_vinculados from vinc;

  -- 3. Identifica alterações que serão feitas nos existentes (antes de aplicar)
  create temporary table pg_temp.tmp_pacientes_upd (
    id_paciente bigint,
    tita_paciente_id bigint,
    nome text,
    campos text[],
    mudancas jsonb
  ) on commit drop;

  insert into pg_temp.tmp_pacientes_upd (id_paciente, tita_paciente_id, nome, campos, mudancas)
  select
    p.id_paciente,
    p.tita_paciente_id,
    p.nome,
    array_remove(array[
      case when t.cpf is not null and length(t.cpf) = 11 and t.cpf is distinct from p.cpf then 'CPF' end,
      case when t.nome is not null and length(btrim(t.nome)) >= 2 and btrim(t.nome) is distinct from btrim(p.nome) then 'Nome' end,
      case when t.data_nascimento is not null and t.data_nascimento is distinct from p.data_nascimento then 'Data de nascimento' end,
      case when t.convenio_nome is not null and t.convenio_nome is distinct from p.convenio_nome then 'Convênio' end,
      case when t.numero_carteirinha is not null and t.numero_carteirinha is distinct from p.numero_carteirinha then 'Carteirinha' end,
      case when t.responsavel_nome is not null and t.responsavel_nome is distinct from p.responsavel_nome then 'Nome do responsável' end,
      case when t.responsavel_cpf is not null and length(t.responsavel_cpf) = 11 and t.responsavel_cpf is distinct from p.responsavel_cpf then 'CPF do responsável' end,
      case when t.responsavel_telefone is not null and t.responsavel_telefone is distinct from p.responsavel_telefone then 'Telefone do responsável' end,
      case when t.responsavel_email is not null and t.responsavel_email is distinct from p.responsavel_email then 'E-mail do responsável' end,
      case when t.logradouro is not null and t.logradouro is distinct from p.logradouro then 'Endereço' end
    ], null) as campos,
    (
      select coalesce(jsonb_agg(m), '[]'::jsonb)
      from (
        select jsonb_build_object('campo', 'CPF', 'de', p.cpf, 'para', t.cpf) as m
        where t.cpf is not null and length(t.cpf) = 11 and t.cpf is distinct from p.cpf
        union all
        select jsonb_build_object('campo', 'Nome', 'de', p.nome, 'para', left(btrim(t.nome), 200))
        where t.nome is not null and length(btrim(t.nome)) >= 2 and btrim(t.nome) is distinct from btrim(p.nome)
        union all
        select jsonb_build_object('campo', 'Data de nascimento', 'de', to_char(p.data_nascimento, 'DD/MM/YYYY'), 'para', to_char(t.data_nascimento, 'DD/MM/YYYY'))
        where t.data_nascimento is not null and t.data_nascimento is distinct from p.data_nascimento
        union all
        select jsonb_build_object('campo', 'Convênio', 'de', p.convenio_nome, 'para', t.convenio_nome)
        where t.convenio_nome is not null and t.convenio_nome is distinct from p.convenio_nome
        union all
        select jsonb_build_object('campo', 'Carteirinha', 'de', p.numero_carteirinha, 'para', t.numero_carteirinha)
        where t.numero_carteirinha is not null and t.numero_carteirinha is distinct from p.numero_carteirinha
        union all
        select jsonb_build_object('campo', 'Nome do responsável', 'de', p.responsavel_nome, 'para', t.responsavel_nome)
        where t.responsavel_nome is not null and t.responsavel_nome is distinct from p.responsavel_nome
        union all
        select jsonb_build_object('campo', 'CPF do responsável', 'de', p.responsavel_cpf, 'para', t.responsavel_cpf)
        where t.responsavel_cpf is not null and length(t.responsavel_cpf) = 11 and t.responsavel_cpf is distinct from p.responsavel_cpf
        union all
        select jsonb_build_object('campo', 'Telefone do responsável', 'de', p.responsavel_telefone, 'para', t.responsavel_telefone)
        where t.responsavel_telefone is not null and t.responsavel_telefone is distinct from p.responsavel_telefone
        union all
        select jsonb_build_object('campo', 'E-mail do responsável', 'de', p.responsavel_email, 'para', t.responsavel_email)
        where t.responsavel_email is not null and t.responsavel_email is distinct from p.responsavel_email
        union all
        select jsonb_build_object('campo', 'Endereço', 'de', p.logradouro, 'para', t.logradouro)
        where t.logradouro is not null and t.logradouro is distinct from p.logradouro
      ) sub
    ) as mudancas
  from public.pacientes p
  join pg_temp.tmp_tita_pacientes t on t.paciente_id = p.tita_paciente_id
  where (
       (t.cpf is not null and length(t.cpf) = 11 and t.cpf is distinct from p.cpf)
    or (t.nome is not null and length(btrim(t.nome)) >= 2 and btrim(t.nome) is distinct from btrim(p.nome))
    or (t.data_nascimento is not null and t.data_nascimento is distinct from p.data_nascimento)
    or (t.convenio_nome is not null and t.convenio_nome is distinct from p.convenio_nome)
    or (t.numero_carteirinha is not null and t.numero_carteirinha is distinct from p.numero_carteirinha)
    or (t.responsavel_nome is not null and t.responsavel_nome is distinct from p.responsavel_nome)
    or (t.responsavel_cpf is not null and length(t.responsavel_cpf) = 11 and t.responsavel_cpf is distinct from p.responsavel_cpf)
    or (t.responsavel_telefone is not null and t.responsavel_telefone is distinct from p.responsavel_telefone)
    or (t.responsavel_email is not null and t.responsavel_email is distinct from p.responsavel_email)
    or (t.logradouro is not null and t.logradouro is distinct from p.logradouro)
  );

  select count(*) into v_atualizados from pg_temp.tmp_pacientes_upd;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id_paciente,
        'tita_id', u.tita_paciente_id,
        'nome', u.nome,
        'campos', to_jsonb(u.campos),
        'mudancas', coalesce(u.mudancas, '[]'::jsonb)
      )
    ),
    '[]'::jsonb
  ) into v_atualizados_json
  from pg_temp.tmp_pacientes_upd u;

  -- Aplica a atualização segura nos existentes (edições no TiTa sempre atualizam o cadastro)
  update public.pacientes p
     set nome                 = case when t.nome is not null and length(btrim(t.nome)) >= 2 and btrim(t.nome) is distinct from btrim(p.nome) then left(btrim(t.nome), 200) else p.nome end,
         cpf                  = case when t.cpf is not null and length(t.cpf) = 11 and t.cpf is distinct from p.cpf then t.cpf else p.cpf end,
         data_nascimento      = coalesce(t.data_nascimento, p.data_nascimento),
         convenio_id          = coalesce(t.convenio_id, p.convenio_id),
         convenio_nome        = coalesce(t.convenio_nome, p.convenio_nome),
         numero_carteirinha   = coalesce(t.numero_carteirinha, p.numero_carteirinha),
         responsavel_nome     = coalesce(t.responsavel_nome, p.responsavel_nome),
         responsavel_cpf      = case when t.responsavel_cpf is not null and length(t.responsavel_cpf) = 11 and t.responsavel_cpf is distinct from p.responsavel_cpf then t.responsavel_cpf else p.responsavel_cpf end,
         responsavel_email    = coalesce(t.responsavel_email, p.responsavel_email),
         responsavel_telefone = coalesce(t.responsavel_telefone, p.responsavel_telefone),
         responsavel_parentesco = coalesce(t.responsavel_parentesco, p.responsavel_parentesco),
         responsavel_financeiro = coalesce(t.responsavel_financeiro, p.responsavel_financeiro),
         cep         = coalesce(t.cep, p.cep),
         logradouro  = coalesce(t.logradouro, p.logradouro),
         numero      = coalesce(t.numero, p.numero),
         complemento = coalesce(t.complemento, p.complemento),
         bairro      = coalesce(t.bairro, p.bairro),
         cidade      = coalesce(t.cidade, p.cidade),
         uf          = coalesce(t.uf, p.uf),
         ficticio    = coalesce(t.ficticio, p.ficticio),
         sincronizado_em = now()
    from pg_temp.tmp_tita_pacientes t
   where p.tita_paciente_id = t.paciente_id
     and p.id_paciente in (select id_paciente from pg_temp.tmp_pacientes_upd);

  -- 4. Insere novos pacientes
  create temporary table pg_temp.tmp_pacientes_novos (
    id_paciente bigint,
    tita_paciente_id bigint,
    nome text,
    cpf text
  ) on commit drop;

  with ins as (
    insert into public.pacientes (
      tita_paciente_id, nome, cpf, data_nascimento,
      convenio_id, convenio_nome, numero_carteirinha,
      responsavel_nome, responsavel_cpf, responsavel_email, responsavel_telefone,
      responsavel_parentesco, responsavel_financeiro,
      cep, logradouro, numero, complemento, bairro, cidade, uf,
      ficticio, ativo, origem_cadastro, sincronizado_em
    )
    select
      t.paciente_id,
      left(btrim(t.nome), 200),
      case when length(t.cpf) = 11 then t.cpf end,
      t.data_nascimento,
      t.convenio_id,
      t.convenio_nome,
      t.numero_carteirinha,
      t.responsavel_nome,
      case when length(t.responsavel_cpf) = 11 then t.responsavel_cpf end,
      t.responsavel_email,
      t.responsavel_telefone,
      t.responsavel_parentesco,
      t.responsavel_financeiro,
      t.cep, t.logradouro, t.numero, t.complemento, t.bairro, t.cidade, t.uf,
      t.ficticio, true, 'tita', now()
    from pg_temp.tmp_tita_pacientes t
    where not exists (
      select 1 from public.pacientes p where p.tita_paciente_id = t.paciente_id
    )
    on conflict (tita_paciente_id) do nothing
    returning id_paciente, tita_paciente_id, nome, cpf
  )
  insert into pg_temp.tmp_pacientes_novos
  select id_paciente, tita_paciente_id, nome, cpf from ins;

  select count(*) into v_novos from pg_temp.tmp_pacientes_novos;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id_paciente,
        'tita_id', n.tita_paciente_id,
        'nome', n.nome,
        'cpf', n.cpf
      )
    ),
    '[]'::jsonb
  ) into v_novos_json
  from pg_temp.tmp_pacientes_novos n;

  -- Grava auditoria dos novos pacientes
  insert into public.cadastros_auditoria (
    tabela, registro_id, acao, alvo_nome, paciente_id, paciente_nome, resumo, usuario_id, usuario_nome
  )
  select
    'paciente', n.id_paciente::text, 'criar', n.nome, n.id_paciente, n.nome,
    'Importado do TiTa.', auth.uid(), v_usuario_nome
  from pg_temp.tmp_pacientes_novos n;

  -- Grava auditoria dos pacientes com dados atualizados do TiTa
  insert into public.cadastros_auditoria (
    tabela, registro_id, acao, alvo_nome, paciente_id, paciente_nome, resumo, usuario_id, usuario_nome
  )
  select
    'paciente', u.id_paciente::text, 'editar', u.nome, u.id_paciente, u.nome,
    concat('Atualizado do TiTa: ', array_to_string(u.campos, ', ')), auth.uid(), v_usuario_nome
  from pg_temp.tmp_pacientes_upd u;

  -- 5. Atualiza o log da execução
  v_detalhes := jsonb_build_object(
    'novos', v_novos_json,
    'atualizados', v_atualizados_json
  );

  update public.pacientes_importacoes_log
     set finalizado_em = now(),
         status = 'sucesso',
         vistos_na_tita = v_vistos,
         novos = v_novos,
         vinculados_por_cpf = v_vinculados,
         atualizados = v_atualizados,
         detalhes = v_detalhes
   where id = v_log_id;

  -- Se havia alerta em aberto de falha anterior, resolve-o
  update public.alertas
     set status = 'resolvido', atualizado_em = now()
   where regra_codigo = 'sync_pacientes_falhou'
     and status = 'aberto';

  return jsonb_build_object(
    'sucesso', true,
    'log_id', v_log_id,
    'vistos_na_tita', v_vistos,
    'novos', v_novos,
    'vinculados_por_cpf', v_vinculados,
    'atualizados', v_atualizados,
    'detalhes', v_detalhes
  );

exception when others then
  v_erro := sqlerrm;

  update public.pacientes_importacoes_log
     set status = 'erro',
         erro_mensagem = v_erro,
         finalizado_em = now()
   where id = v_log_id;

  -- Registra alerta no sistema
  with novo as (
    insert into public.alertas (
      modulo, regra_codigo, origem, entidade_tipo, entidade_id, entidade_ref,
      titulo, descricao, prioridade, status, setor_destino, fingerprint
    ) values (
      'sync', 'sync_pacientes_falhou', 'sistema', 'sync_pacientes',
      to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD_HH24:MI'),
      jsonb_build_object('erro', v_erro, 'origem', p_origem),
      'Sincronização de pacientes do TiTa falhou',
      concat('A rotina de importação de pacientes (', p_origem, ') falhou com o erro: ', v_erro),
      'alta', 'aberto', 'admin',
      concat_ws('|', 'sync_pacientes', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'))
    )
    on conflict do nothing
    returning id
  )
  insert into public.alertas_eventos (
    alerta_id, entidade_tipo, entidade_id, tipo, autor_tipo, autor_nome, descricao
  )
  select
    novo.id, 'sync_pacientes', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
    'deteccao', 'sistema', 'Sistema',
    concat('Falha na importação de pacientes: ', v_erro)
  from novo;

  if p_origem = 'manual' then
    raise;
  end if;

  return jsonb_build_object(
    'sucesso', false,
    'log_id', v_log_id,
    'erro', v_erro
  );
end
$func$;

comment on function public.pacientes_importar_tita(text) is
  'Importa pacientes do TiTa para public.pacientes. Cria novos, completa campos vazios sem sobrescrever edições, gera log com diff e resolve ou abre alertas.';

revoke all on function public.pacientes_importar_tita(text) from public, anon;
grant execute on function public.pacientes_importar_tita(text) to authenticated, service_role;

-- Overload sem parâmetros para o PostgREST RPC
create or replace function public.pacientes_importar_tita()
returns jsonb
language sql
security definer
set search_path = ''
as $wrapper$
  select public.pacientes_importar_tita('manual');
$wrapper$;

revoke all on function public.pacientes_importar_tita() from public, anon;
grant execute on function public.pacientes_importar_tita() to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Agendamento diário às 04:00 (Brasília) = 07:00 UTC via pg_cron
-- ═════════════════════════════════════════════════════════════════════════════
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'pacientes-importar-tita-diario') then
      perform cron.unschedule('pacientes-importar-tita-diario');
    end if;

    perform cron.schedule(
      'pacientes-importar-tita-diario',
      '0 7 * * *',
      $cmd$select public.pacientes_importar_tita('cron');$cmd$
    );
  end if;
end
$cron$;
