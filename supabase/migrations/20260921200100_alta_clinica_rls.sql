-- RLS de cadastros_pacientes_alta_clinica.
--
-- Mesmo padrão já aplicado a cadastros_pacientes_altas (20260826140700) e
-- cadastros_pacientes_suspensoes_temporarias (20260902100100):
-- usuario_tem_permissao('cadastros_pacientes') OR papel
-- admin/diretoria/cronograma. Nasce com RLS fechada para não repetir o gap
-- que essas duas tiveram até suas respectivas migrations de RLS.
--
-- DELETE revogado do banco: alta clínica é registro clínico, mesma decisão
-- de alta/suspensão — a exclusão da tela é sempre soft delete (ativo=false).

alter table public.cadastros_pacientes_alta_clinica enable row level security;
alter table public.cadastros_pacientes_alta_clinica force row level security;

drop policy if exists cadastros_pacientes_alta_clinica_select
  on public.cadastros_pacientes_alta_clinica;
create policy cadastros_pacientes_alta_clinica_select
  on public.cadastros_pacientes_alta_clinica
  for select to authenticated
  using (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  );

drop policy if exists cadastros_pacientes_alta_clinica_insert
  on public.cadastros_pacientes_alta_clinica;
create policy cadastros_pacientes_alta_clinica_insert
  on public.cadastros_pacientes_alta_clinica
  for insert to authenticated
  with check (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  );

drop policy if exists cadastros_pacientes_alta_clinica_update
  on public.cadastros_pacientes_alta_clinica;
create policy cadastros_pacientes_alta_clinica_update
  on public.cadastros_pacientes_alta_clinica
  for update to authenticated
  using (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  )
  with check (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  );

revoke delete on public.cadastros_pacientes_alta_clinica from authenticated;
