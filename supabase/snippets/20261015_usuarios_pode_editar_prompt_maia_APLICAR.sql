-- Aplica 20261015180000_usuarios_pode_editar_prompt_maia. Ensaio feito em 15/10 (autoconcessão bloqueada).
begin;
set local lock_timeout = '5s';

-- Permissão de editar o prompt da Maia sem ser admin nem diretoria.
--
-- Pedido de 15/10/2026: a Danielle (recepção, operator na Central) precisa
-- ver e alterar o prompt da Maia. Dar `director` abriria a Central inteira
-- (todas as conversas, números, membros, chave da ElevenLabs). Esta marca abre
-- SÓ o texto do prompt: /api/central/agent-settings lê e grava `system_prompt`
-- para quem a tem, pelo servidor, e nada mais.
--
-- Fica em public.usuarios, ao lado de `central_role`, e não no catálogo de
-- permissões do Pulsar: aquele catálogo é gerado do menu (um código por tela,
-- lib/permissions/menu.ts), e um código sem tela deixaria o aviso de "catálogo
-- diferente do menu" aceso em /admin/permissoes. Como o central_role, é dada
-- por SQL (snippet 20261015_prompt_maia_danielle_APLICAR.sql é o modelo).

alter table public.usuarios
  add column if not exists pode_editar_prompt_maia boolean not null default false;

comment on column public.usuarios.pode_editar_prompt_maia is
  'Pode ver e alterar o prompt da Maia (central.agent_settings.system_prompt) sem ser admin/diretoria. Só o servidor grava, pela rota /api/central/agent-settings.';

-- A marca é acesso: entra na trava de 20261015170000 (a própria pessoa não se
-- dá a permissão pela policy usuarios_update_own_profile).
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
  or new.pode_editar_prompt_maia is distinct from old.pode_editar_prompt_maia then
    raise exception 'Sem permissão para alterar papel, acesso ou organização de usuário'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261015180000', 'usuarios_pode_editar_prompt_maia')
on conflict (version) do nothing;

commit;
