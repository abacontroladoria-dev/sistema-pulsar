-- REVERTE 20261019170000_seguranca_cadastro_token_profissional.
-- As quatro funções exatamente como estavam em PRODUÇÃO em 19/10/2026, antes da
-- aplicação (copiadas com pg_get_functiondef). CREATE OR REPLACE mantém dono e
-- grants. Usar só se o login (Pulsar ou Connect) quebrar depois do _APLICAR.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  insert into public.usuarios (id, nome, email, role, ativo, primeiro_acesso)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'recepcao'),
    false,
    true
  )
  ON CONFLICT (id) DO NOTHING;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  claims         jsonb;
  v_org_id       uuid;
  v_central_role text;
begin
  select organization_id, central_role
    into v_org_id, v_central_role
  from public.usuarios
  where id = (event ->> 'user_id')::uuid
  limit 1;

  claims := event -> 'claims';

  if v_org_id is not null then
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
  end if;

  if v_central_role is not null then
    claims := jsonb_set(claims, '{central_role}', to_jsonb(v_central_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$;

CREATE OR REPLACE FUNCTION central.ca_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'central'
AS $function$
  select coalesce(
    auth.jwt() ->> 'central_role',
    (
      select central_role
      from public.usuarios
      where id = auth.uid()
      limit 1
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.usuarios_trava_colunas_de_acesso()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Servidor (service_role) e sessão sem JWT (SQL Editor, CLI, cron): livres.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Quem já pode dar acesso. is_admin()/is_diretoria() leem a linha ANTES desta
  -- atualização: quem tenta se promover ainda não é nenhum dos dois.
  if public.is_admin() or public.is_diretoria() then
    return new;
  end if;

  if new.id                      is distinct from old.id
  or new.email                   is distinct from old.email
  or new.role                    is distinct from old.role
  or new.central_role            is distinct from old.central_role
  or new.ativo                   is distinct from old.ativo
  or new.organization_id         is distinct from old.organization_id
  or new.unidade                 is distinct from old.unidade
  or new.unidades                is distinct from old.unidades
  or new.created_at              is distinct from old.created_at
  or new.pode_editar_prompt_maia is distinct from old.pode_editar_prompt_maia then
    raise exception 'Sem permissão para alterar papel, acesso ou organização de usuário'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

delete from supabase_migrations.schema_migrations where version = '20261019170000';

commit;

-- Conferência: true = voltou ao estado anterior.
-- (md5 não serve: o corpo original tinha \r\n e este arquivo tem \n.)
select pg_get_functiondef('public.usuarios_trava_colunas_de_acesso()'::regprocedure) not like '%profissional_id%' as trava_original,
       pg_get_functiondef('public.handle_new_user()'::regprocedure) like '%raw_user_meta_data->>''role''%' as cadastro_original;
