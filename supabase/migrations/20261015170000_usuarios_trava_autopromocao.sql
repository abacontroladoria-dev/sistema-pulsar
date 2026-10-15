-- Fecha a autopromoção em public.usuarios.
--
-- A FALHA (achada em 15/10/2026, provada em transação desfeita)
--
-- A policy `usuarios_update_own_profile` deixa cada usuário alterar a PRÓPRIA
-- linha, e `authenticated` tem UPDATE em todas as colunas — inclusive `role`,
-- `central_role`, `ativo`, `organization_id` e `unidades`. Qualquer pessoa
-- logada no Pulsar, com a chave anon pública e o próprio token, fazia
--   update usuarios set role = 'admin' where id = auth.uid()
-- e virava admin (o trigger sync_central_role_admin ainda completava com
-- central_role = 'admin'). O log de usuários registra a troca de role, mas não
-- impedia; troca de central_role nem era registrada. Nenhuma autopromoção
-- aparecia em audit_logs até aqui.
--
-- A CORREÇÃO
--
-- Trigger BEFORE UPDATE: as colunas que dão acesso só mudam por quem já pode
-- dar acesso — admin, diretoria (as duas policies de UPDATE que existem para
-- isso) ou o servidor (service_role: as rotas /api/admin/* gravam por ele, e o
-- SQL Editor/CLI roda sem JWT). Para o resto, a própria linha continua
-- editável no que é dela: nome, username, último acesso, primeiro acesso.
--
-- Trigger, e não REVOKE por coluna: o UPDATE vem de grant de TABELA, e REVOKE
-- de coluna não subtrai de grant de tabela (ver reference_grants_coluna). Trocar
-- o grant de tabela por lista de colunas quebraria as policies de admin e
-- diretoria, que gravam pelo mesmo papel `authenticated`.

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

  if new.id                 is distinct from old.id
  or new.email              is distinct from old.email
  or new.role               is distinct from old.role
  or new.central_role       is distinct from old.central_role
  or new.ativo              is distinct from old.ativo
  or new.organization_id    is distinct from old.organization_id
  or new.unidade            is distinct from old.unidade
  or new.unidades           is distinct from old.unidades
  or new.created_at         is distinct from old.created_at then
    raise exception 'Sem permissão para alterar papel, acesso ou organização de usuário'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.usuarios_trava_colunas_de_acesso() is
  'Impede autopromoção: role, central_role, ativo, organização, unidades, email e id de public.usuarios só mudam por admin, diretoria ou service_role (15/10/2026).';

drop trigger if exists trg_usuarios_trava_colunas_de_acesso on public.usuarios;
create trigger trg_usuarios_trava_colunas_de_acesso
  before update on public.usuarios
  for each row
  execute function public.usuarios_trava_colunas_de_acesso();
