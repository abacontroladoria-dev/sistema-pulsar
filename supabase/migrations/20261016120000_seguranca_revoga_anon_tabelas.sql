-- Segurança (Etapa 3): o anon (chave pública, que está no JavaScript do site e
-- qualquer pessoa extrai) não precisa de NENHUMA tabela ou view.
--
-- Medido em produção em 16/10/2026 (frontend/scripts/seguranca-varredura-
-- completa.mjs): o anon não lê nenhuma linha em nenhuma das 237 tabelas/views —
-- a RLS segura tudo. Mas 58 delas ainda tinham GRANT para o anon (entre elas
-- agenda_tita, csv_grades_profissionais, controle_terapeutico,
-- grade_profissionais_tita, worker_tokens, usuarios_permissoes): uma policy
-- escrita "to public using (true)" por engano abriria o dado na hora.
--
-- Quem usa dado sem login (TV da recepção, ficha escolar, formulário de
-- disponibilidade) passa por rota de servidor com a chave de serviço — nada
-- disso usa o anon. Login e recuperação de senha são do schema auth (intocado).
--
--   1. Revoga do anon tudo em tabelas, views e sequências de public e central.
--   2. Tabela/view NOVA criada pelo postgres (migrations) não nasce mais com
--      GRANT para o anon.
--
-- Funções não entram aqui: policy que chama função precisa de EXECUTE de quem
-- consulta. As executáveis pelo anon estão no bloco 8 de
-- docs/seguranca/AUDITORIA_SEGURANCA.sql para revisão uma a uma.
--
-- Volta (se algo público quebrar): grant select on public.<tabela> to anon;
-- Idempotente.

set lock_timeout = '5s';

do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select n2.nspname as esquema, c.relname as nome, c.relkind
    from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
    where n2.nspname in ('public', 'central')
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (
        has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER')
      )
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence %I.%I from anon', r.esquema, r.nome);
    else
      execute format('revoke all on %I.%I from anon', r.esquema, r.nome);
    end if;
    n := n + 1;
  end loop;
  raise notice 'Permissões do anon retiradas de % objeto(s).', n;
end $$;

-- Daqui em diante, o que as migrations criarem não nasce aberto ao anon.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
