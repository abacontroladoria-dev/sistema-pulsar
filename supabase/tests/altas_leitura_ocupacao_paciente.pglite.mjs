// Teste da migration 20261020120000 (leitura de altas pela Ocupação de
// Paciente) no PGlite. Prova: quem só tem `cronograma_ocupacao_paciente` passa
// a LER alta registrada e alta clínica, mas continua sem gravar; quem não tem
// permissão nenhuma continua sem ler; quem tinha `cadastros_pacientes` segue
// igual; a migration reroda.
//
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/altas_leitura_ocupacao_paciente.pglite.mjs /tmp/pg/
//   node /tmp/pg/altas_leitura_ocupacao_paciente.pglite.mjs <repo>/supabase/migrations/20261020120000_altas_leitura_ocupacao_paciente.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
const db = new PGlite()
let f = 0; const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }

// Permissões do usuário "logado" vêm de uma GUC: lista separada por vírgula.
await db.exec(`create role authenticated;
grant usage on schema public to authenticated;
create function public.usuario_tem_permissao(p text) returns boolean language sql stable as
  $$ select p = any(string_to_array(coalesce(current_setting('teste.perms', true), ''), ',')) $$;
create function public.remuneracao_has_role(p text[]) returns boolean language sql stable as $$ select false $$;
grant execute on function public.usuario_tem_permissao(text), public.remuneracao_has_role(text[]) to authenticated;

create table public.cadastros_pacientes_altas (id_alta serial primary key, id_paciente_pulsar int, especialidade_alta text, ativo boolean default true);
create table public.cadastros_pacientes_alta_clinica (id_alta_clinica serial primary key, id_paciente_pulsar int, ativo boolean default true);
grant select, insert, update on public.cadastros_pacientes_altas, public.cadastros_pacientes_alta_clinica to authenticated;
grant usage on all sequences in schema public to authenticated;

-- Estado de produção antes da migration (20260826140700 / 20260921200100).
alter table public.cadastros_pacientes_altas enable row level security;
alter table public.cadastros_pacientes_altas force row level security;
create policy cadastros_pacientes_altas_select on public.cadastros_pacientes_altas for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes') or public.remuneracao_has_role(array['admin','diretoria','cronograma']));
create policy cadastros_pacientes_altas_insert on public.cadastros_pacientes_altas for insert to authenticated
  with check (public.usuario_tem_permissao('cadastros_pacientes') or public.remuneracao_has_role(array['admin','diretoria','cronograma']));
alter table public.cadastros_pacientes_alta_clinica enable row level security;
alter table public.cadastros_pacientes_alta_clinica force row level security;
create policy cadastros_pacientes_alta_clinica_select on public.cadastros_pacientes_alta_clinica for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes') or public.remuneracao_has_role(array['admin','diretoria','cronograma']));
create policy cadastros_pacientes_alta_clinica_insert on public.cadastros_pacientes_alta_clinica for insert to authenticated
  with check (public.usuario_tem_permissao('cadastros_pacientes') or public.remuneracao_has_role(array['admin','diretoria','cronograma']));

insert into public.cadastros_pacientes_altas (id_paciente_pulsar, especialidade_alta) values (1, 'Psicologia');
insert into public.cadastros_pacientes_alta_clinica (id_paciente_pulsar) values (2);`)

const como = async (perms, sql) => {
  await db.exec(`set teste.perms = '${perms}'; set role authenticated;`)
  try { return { rows: (await db.query(sql)).rows } } catch (e) { return { erro: e.message } } finally { await db.exec('reset role') }
}
const conta = async (perms, t) => (await como(perms, `select count(*)::int n from public.${t}`)).rows[0].n

ok(await conta('cronograma_ocupacao_paciente', 'cadastros_pacientes_altas') === 0, 'antes: só Ocupação Paciente lê zero altas (o defeito)')

const mig = readFileSync(process.argv[2], 'utf8')
await db.exec(mig); await db.exec(mig)

for (const t of ['cadastros_pacientes_altas', 'cadastros_pacientes_alta_clinica']) {
  ok(await conta('cronograma_ocupacao_paciente', t) === 1, `${t}: Ocupação Paciente passa a ler`)
  ok(await conta('cadastros_pacientes', t) === 1, `${t}: cadastros_pacientes continua lendo`)
  ok(await conta('', t) === 0, `${t}: sem permissão continua sem ler`)
  ok(await conta('outra_tela', t) === 0, `${t}: permissão de outra tela não lê`)
}
const ins = await como('cronograma_ocupacao_paciente', `insert into public.cadastros_pacientes_altas (id_paciente_pulsar, especialidade_alta) values (9, 'Fonoaudiologia')`)
ok(!!ins.erro, 'Ocupação Paciente continua SEM gravar alta')
const ins2 = await como('cronograma_ocupacao_paciente', `insert into public.cadastros_pacientes_alta_clinica (id_paciente_pulsar) values (9)`)
ok(!!ins2.erro, 'Ocupação Paciente continua SEM gravar alta clínica')
process.exit(f ? 1 : 0)
