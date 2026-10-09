-- Rodar no SQL Editor (produção). Espelha a migration 20261007170000.
alter view public.vw_faltas_pacientes set (security_invoker = true);

insert into supabase_migrations.schema_migrations (version, name)
values ('20261007170000', 'vw_faltas_pacientes_security_invoker')
on conflict (version) do nothing;

-- Conferência: deve trazer {security_invoker=true}
select relname, reloptions from pg_class
where oid = 'public.vw_faltas_pacientes'::regclass;
