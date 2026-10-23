-- Carteirinha do paciente = CADASTRO do TiTa (23/10/2026).
--
-- Problema: 32 pacientes com convênio estavam sem carteirinha no Pulsar, e os
-- 32 TÊM carteirinha no TiTa. A importação só lia a carteirinha do AGENDAMENTO
-- (agenda_tita.numero_carteirinha); a cópia do cadastro
-- (tita_favorecidos_cadastro, de csv_situacao_favorecidos) descartava a coluna
-- "Número da Carteirinha" que o TiTa já manda.
--
--   1. tita_favorecidos_cadastro.numero_carteirinha: gravada pela mesma rotina
--      que grava o convênio (gravarCopiaCadastroTita).
--   2. pacientes_importar_tita: carteirinha do cadastro primeiro; a do
--      agendamento mais recente só se o cadastro não tiver. O resto do corpo é
--      o de 20261016160000, sem mudança.
--
-- Idempotente.

set lock_timeout = '5s';

alter table public.tita_favorecidos_cadastro
  add column if not exists numero_carteirinha text;

comment on column public.tita_favorecidos_cadastro.numero_carteirinha is
  'Número da Carteirinha do cadastro do TiTa. Fonte da carteirinha na importação de pacientes (o agendamento é reserva).';

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

  -- Quem e por quê, para o histórico gravado pelo gatilho (20261016150000).
  perform set_config('pulsar.autor', coalesce(v_usuario_nome, 'Sistema'), true);
  perform set_config('pulsar.origem_mudanca', 'Importação do TiTa', true);

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
  -- Convênio: do CADASTRO do TiTa (cópia de csv_situacao_favorecidos, até 36 h),
  -- ligado ao catálogo Convênios do Pulsar. Nunca do agendamento: o convênio é
  -- do paciente, e o nome na grade pode vir errado (decisão de 16/10/2026).
  -- Id do convênio no TiTa por nome: UMA leitura da agenda, só dos pares
  -- distintos (poucas dezenas). Antes era uma subconsulta por paciente
  -- (637 × 93 mil linhas) e a chamada manual estourava o tempo (16/10/2026).
  tita_conv as (
    select distinct on (public.sp_normalizar_convenio(x.convenio_nome))
           public.sp_normalizar_convenio(x.convenio_nome) as n, x.convenio_id
    from (
      select distinct at2.convenio_nome, at2.convenio_id
      from public.agenda_tita at2
      where at2.convenio_id is not null and at2.convenio_nome is not null
    ) x
    order by public.sp_normalizar_convenio(x.convenio_nome), x.convenio_id
  ),
  catalogo as (
    select distinct on (public.sp_normalizar_convenio(c.nome))
           public.sp_normalizar_convenio(c.nome) as n, c.id, c.nome
    from public.convenios c
    order by public.sp_normalizar_convenio(c.nome), c.id
  ),
  cadastro_tita as (
    select
      f.tita_favorecido_id as paciente_id,
      cv.id as convenio_catalogo_id,
      coalesce(cv.nome, btrim(f.plano_saude)) as convenio_nome,
      tc.convenio_id
    from public.tita_favorecidos_cadastro f
    left join catalogo cv on cv.n = public.sp_normalizar_convenio(f.plano_saude)
    left join tita_conv tc on tc.n = public.sp_normalizar_convenio(f.plano_saude)
    where f.sincronizado_em >= now() - interval '36 hours'
      and public.sp_normalizar_convenio(f.plano_saude) is not null
      and public.sp_normalizar_convenio(f.plano_saude) not in ('ainda nao selecionado', 'nao informado')
      and not f.plano_em_conflito
  ),
  -- Carteirinha: do CADASTRO do TiTa (mesma cópia, até 36 h), com a do
  -- agendamento mais recente de reserva. Separada de cadastro_tita porque não
  -- depende de o convênio estar preenchido ou sem conflito (20261023160000).
  carteirinha_tita as (
    select f.tita_favorecido_id as paciente_id, btrim(f.numero_carteirinha) as numero_carteirinha
    from public.tita_favorecidos_cadastro f
    where f.sincronizado_em >= now() - interval '36 hours'
      and nullif(btrim(f.numero_carteirinha), '') is not null
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
      cad.convenio_id,
      cad.convenio_catalogo_id,
      cad.convenio_nome,
      coalesce(ct.numero_carteirinha, a.numero_carteirinha) as numero_carteirinha,
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
    left join cadastro_tita cad on cad.paciente_id = coalesce(a.paciente_id, c.paciente_id)
    left join carteirinha_tita ct on ct.paciente_id = coalesce(a.paciente_id, c.paciente_id)
  )
  select
    paciente_id,
    nome,
    cpf,
    data_nascimento,
    convenio_id,
    convenio_catalogo_id,
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
      case when t.convenio_nome is not null and t.convenio_nome is not distinct from p.convenio_nome
                and t.convenio_catalogo_id is distinct from p.convenio_catalogo_id then 'Convênio (vínculo com o catálogo)' end,
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
    or (t.convenio_nome is not null and t.convenio_catalogo_id is distinct from p.convenio_catalogo_id)
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
         convenio_id          = case when t.convenio_nome is not null then t.convenio_id else p.convenio_id end,
         convenio_catalogo_id = case when t.convenio_nome is not null then t.convenio_catalogo_id else p.convenio_catalogo_id end,
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
      convenio_id, convenio_catalogo_id, convenio_nome, numero_carteirinha,
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
      t.convenio_catalogo_id,
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

  -- Auditoria dos pacientes atualizados: com o gatilho de histórico
  -- (20261016150000) ligado, ele grava campo a campo; sem ele, o resumo antigo.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.pacientes'::regclass and tgname = 'trg_pacientes_historico' and not tgisinternal
  ) then
    insert into public.cadastros_auditoria (
      tabela, registro_id, acao, alvo_nome, paciente_id, paciente_nome, resumo, usuario_id, usuario_nome
    )
    select
      'paciente', u.id_paciente::text, 'editar', u.nome, u.id_paciente, u.nome,
      concat('Atualizado do TiTa: ', array_to_string(u.campos, ', ')), auth.uid(), v_usuario_nome
    from pg_temp.tmp_pacientes_upd u;
  end if;

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
  'Importa pacientes do TiTa para public.pacientes. Convênio vem do CADASTRO do TiTa (tita_favorecidos_cadastro, até 36 h) e prevalece; nunca do agendamento. Carteirinha do cadastro, com a do agendamento de reserva. Gera log com diff e resolve ou abre alertas.';

revoke all on function public.pacientes_importar_tita(text) from public, anon;
grant execute on function public.pacientes_importar_tita(text) to authenticated, service_role;
