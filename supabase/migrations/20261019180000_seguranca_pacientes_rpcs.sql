-- ═════════════════════════════════════════════════════════════════════════════
-- Segurança — caminhos estreitos para o cadastro de pacientes (Fase 5, parte 1
-- de 2, branch feat/seguranca-falhas-dados)
--
-- SEM TRAVA: só CRIA funções. Pode ser aplicada antes ou depois do redeploy —
-- o frontend novo usa estas RPCs e, enquanto elas não existem, volta sozinho
-- para a leitura antiga da tabela. Quem FECHA a tabela é a parte 2
-- (20261019180100, com trava).
--
-- Hoje `public.pacientes` tem policy `using (true)`: qualquer login lê CPF,
-- endereço e responsável de todos. Cinco telas leem a tabela sem ter a
-- permissão de Pacientes. Cada uma ganha aqui um caminho que devolve só o que
-- ela usa, e só para quem tem a permissão da tela:
--
--   pacientes_lista_basica(p_ids, p_tita_ids)
--       id, id do TiTa, nome, convênio, ativo, fictício, falecido, foto — Grade,
--       Ocupação Paciente, Indicadores → Alimentar BD, Connect (e quem tem
--       Pacientes).
--   pacientes_buscar_para_pep(p_termo)
--       id, nome e os 4 últimos dígitos do CPF — vincular pasta do robô PEP.
--   sp_pep_vincular_pasta_paciente(p_pasta_id, p_paciente_id)
--       o vínculo por id: o CPF é lido aqui dentro, não viaja pelo navegador.
--   listar_pacientes_assim()
--       (Autorizações Avulsas) passa a conferir `autorizacoes_avulsas`. O corpo
--       atual NÃO é reescrito: a função de produção vira auxiliar interna
--       (sp_listar_pacientes_assim_interno) e a pública vira um invólucro com a
--       checagem e a MESMA assinatura de retorno, lida do próprio banco.
--
-- Idempotente. Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lista básica
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pacientes_lista_basica(
  p_ids      bigint[] default null,
  p_tita_ids bigint[] default null
)
returns table (
  id_paciente      bigint,
  tita_paciente_id bigint,
  nome             text,
  convenio_nome    text,
  ativo            boolean,
  ficticio         boolean,
  falecido         boolean,
  foto_path        text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from unnest(array[
      'cadastros_pacientes', 'cronograma_grade', 'cronograma_ocupacao_paciente',
      'indicadores_alimentar_bd', 'connect'
    ]) as c(codigo)
    where public.usuario_tem_permissao(c.codigo)
  ) then
    raise exception 'sem permissão para a lista de pacientes' using errcode = '42501';
  end if;

  return query
  select p.id_paciente::bigint, p.tita_paciente_id::bigint, p.nome::text, p.convenio_nome::text,
         p.ativo, p.ficticio, p.falecido, p.foto_path::text
  from public.pacientes p
  where (p_ids is null and p_tita_ids is null)
     or p.id_paciente = any (coalesce(p_ids, '{}'))
     or p.tita_paciente_id = any (coalesce(p_tita_ids, '{}'));
end $$;

comment on function public.pacientes_lista_basica(bigint[], bigint[]) is
  'Lista básica de pacientes (sem CPF, endereço, contato ou responsável) para telas sem a permissão de Pacientes: Grade, Ocupação Paciente, Alimentar BD, Connect. Sem ids = todos. 20261019180000.';

revoke all on function public.pacientes_lista_basica(bigint[], bigint[]) from public, anon;
grant execute on function public.pacientes_lista_basica(bigint[], bigint[]) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Robô PEP: buscar paciente para vincular uma pasta
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pacientes_buscar_para_pep(p_termo text)
returns table (
  id_paciente bigint,
  nome        text,
  cpf_final   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo text := btrim(coalesce(p_termo, ''));
begin
  if not (public.sp_pep_pode_escrever()
          or public.usuario_tem_permissao('robo_sharepoint')
          or public.usuario_tem_permissao('relacionamento_prestador_pep')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if length(v_termo) < 3 then
    return;
  end if;

  return query
  select p.id_paciente::bigint, p.nome::text,
         nullif(right(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), 4), '')
  from public.pacientes p
  where p.nome ilike '%' || replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    and not p.ficticio
  order by p.nome
  limit 10;
end $$;

comment on function public.pacientes_buscar_para_pep(text) is
  'Busca paciente por nome para vincular pasta do robô PEP: id, nome e só os 4 últimos dígitos do CPF. 20261019180000.';

revoke all on function public.pacientes_buscar_para_pep(text) from public, anon;
grant execute on function public.pacientes_buscar_para_pep(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Robô PEP: vincular pasta ao paciente pelo id
--    A permissão e a gravação continuam em sp_pep_vincular_pasta (auth.uid()
--    segue o do usuário dentro da chamada).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.sp_pep_vincular_pasta_paciente(p_pasta_id text, p_paciente_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_cpf  text;
begin
  if not public.sp_pep_pode_escrever() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select p.nome, p.cpf into v_nome, v_cpf
  from public.pacientes p
  where p.id_paciente = p_paciente_id;

  if v_nome is null then
    raise exception 'paciente nao encontrado' using errcode = '22023';
  end if;

  return public.sp_pep_vincular_pasta(p_pasta_id, 'paciente', null, v_nome, v_cpf);
end $$;

comment on function public.sp_pep_vincular_pasta_paciente(text, bigint) is
  'Vincula a pasta do robô PEP ao paciente pelo id; nome e CPF lidos do cadastro aqui dentro. 20261019180000.';

revoke all on function public.sp_pep_vincular_pasta_paciente(text, bigint) from public, anon;
grant execute on function public.sp_pep_vincular_pasta_paciente(text, bigint) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. listar_pacientes_assim: checagem de permissão sem reescrever o corpo
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_resultado text;
begin
  if to_regprocedure('public.listar_pacientes_assim()') is null then
    return;   -- banco sem Autorizações Avulsas
  end if;

  -- Primeira aplicação: a de produção vira a auxiliar interna. Reaplicação: a
  -- interna já existe e a pública já é o invólucro.
  if to_regprocedure('public.sp_listar_pacientes_assim_interno()') is null then
    alter function public.listar_pacientes_assim() rename to sp_listar_pacientes_assim_interno;
  end if;

  -- A interna lê agenda_tita e pacientes como dona: quem decide o acesso é o
  -- invólucro, e só ele (e a service_role) a executa.
  alter function public.sp_listar_pacientes_assim_interno() security definer;
  revoke all on function public.sp_listar_pacientes_assim_interno() from public, anon, authenticated;

  v_resultado := pg_get_function_result('public.sp_listar_pacientes_assim_interno()'::regprocedure);

  execute format($f$
    create or replace function public.listar_pacientes_assim()
    returns %s
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $corpo$
    begin
      if not public.usuario_tem_permissao('autorizacoes_avulsas') then
        raise exception 'sem permissão para Autorizações Avulsas' using errcode = '42501';
      end if;
      return query select * from public.sp_listar_pacientes_assim_interno();
    end $corpo$
  $f$, v_resultado);

  comment on function public.listar_pacientes_assim() is
    'Autorizações Avulsas: pacientes ASSIM dos últimos 180 dias. Invólucro com checagem de autorizacoes_avulsas (20261019180000); o corpo vive em sp_listar_pacientes_assim_interno.';
end $$;

do $$
begin
  if to_regprocedure('public.listar_pacientes_assim()') is not null then
    revoke all on function public.listar_pacientes_assim() from public, anon;
    grant execute on function public.listar_pacientes_assim() to authenticated;
  end if;
end $$;
