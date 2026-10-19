-- Fase 0 do app de evoluções (docs/app-evolucoes/PLANO_BACKEND.md): três brechas
-- de acesso em public.usuarios, que valem mesmo sem o app.
--
-- 1. handle_new_user CONFIAVA NO PAPEL QUE QUEM SE CADASTRA ESCOLHE
--
-- O trigger em auth.users gravava role = raw_user_meta_data->>'role', e o
-- metadata é escrito por quem chama signUp. trg_sync_central_role_admin então
-- dava central_role = 'admin' a role = 'admin', e nem o hook do token nem
-- central.ca_current_role() olhavam `ativo`: signUp({ data: { role: 'admin' } })
-- virava admin da Central de Atendimento mesmo com ativo = false. Hoje não é
-- explorável só porque o cadastro público está DESLIGADO no Dashboard de
-- produção (conferido em 19/10/2026); religar a chave reabria a falha.
--
-- Agora o trigger grava sempre 'recepcao' + ativo = false. Os três caminhos que
-- criam usuário já gravam o papel por conta própria, com service role, logo
-- depois: /api/admin/create-user-with-password (upsert), /api/admin/create-user
-- (upsert) e a Edge Function admin-create-user (update) — nenhum dependia do
-- papel vindo do metadata.
--
-- O mesmo trigger impedia conta só de telefone: usuarios.email é NOT NULL, o
-- insert falhava e o Auth desfazia a conta. Conta sem e-mail é responsável do
-- app (login por código no celular) e NÃO é da equipe: não ganha linha em
-- usuarios, que é a tabela que herda menus, papéis e permissões.
--
-- 2. central_role SÓ COM ativo = true
--
-- custom_access_token_hook passa a emitir o claim central_role só para usuário
-- ativo, e o fallback de central.ca_current_role() (sem claim no token) também
-- exige ativo. lib/central/auth.ts confia no claim quando ele vem no token (o
-- caminho do banco é que checa ativo), então é no hook que o inativo é cortado.
-- Token já emitido segue válido até vencer (1 h), como hoje.
--
-- 3. profissional_id ENTRA NA TRAVA DE COLUNAS
--
-- Com o app, usuarios.profissional_id decide de quem é a agenda que o terapeuta
-- vê e evolui. Pela policy usuarios_update_own_profile, cada um alterava a
-- própria linha — inclusive se ligar a qualquer profissional. A trava de
-- 20261015170000 (redefinida em 20261015180000) ganha a coluna; admin,
-- diretoria e o servidor continuam podendo gravá-la.

-- ── 1. handle_new_user ──────────────────────────────────────────────────────
-- search_path igual ao de produção (public, extensions, pg_temp), que diverge
-- do remote_schema do repo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- Conta só de telefone = responsável do app, fora da equipe.
  if new.email is null then
    return new;
  end if;

  -- Papel NUNCA vem do metadata (quem se cadastra o escreve). Quem cria o
  -- usuário pelo admin grava o papel certo em seguida, pelo servidor.
  insert into public.usuarios (id, nome, email, role, ativo, primeiro_acesso)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.email,
    'recepcao',
    false,
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ── 2. central_role só para ativo ───────────────────────────────────────────
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims         jsonb;
  v_org_id       uuid;
  v_central_role text;
begin
  select organization_id,
         case when ativo then central_role end
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
$$;

create or replace function central.ca_current_role()
returns text
language sql
stable
security definer
set search_path = public, central
as $$
  select coalesce(
    auth.jwt() ->> 'central_role',
    (
      select central_role
      from public.usuarios
      where id = auth.uid()
        and ativo
      limit 1
    )
  );
$$;

-- ── 3. trava de colunas: + profissional_id ──────────────────────────────────
create or replace function public.usuarios_trava_colunas_de_acesso()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  or new.pode_editar_prompt_maia is distinct from old.pode_editar_prompt_maia
  or new.profissional_id         is distinct from old.profissional_id then
    raise exception 'Sem permissão para alterar papel, acesso ou organização de usuário'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
