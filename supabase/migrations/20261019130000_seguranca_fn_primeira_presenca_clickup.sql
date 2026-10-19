-- fn_primeira_presenca_clickup_disparar só serve ao agendador (pg_cron, que roda
-- como dono do banco). Nasceu em 20261016190100 sem REVOKE, e no PostgreSQL toda
-- função nasce com EXECUTE para PUBLIC (anon é membro), então ficava chamável
-- por /rest/v1/rpc. Não é SECURITY DEFINER, então quem chamasse não leria o Vault,
-- mas a rota não deve existir. O cron continua funcionando: o dono não depende do grant.

revoke all on function public.fn_primeira_presenca_clickup_disparar() from public, anon, authenticated;
