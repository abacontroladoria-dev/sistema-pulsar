// Teste das migrations 20261019160000 (RPCs) e 20261019160100 (fecha a
// leitura de pacientes) no PGlite.
// Prova: login só com a Grade não lê CPF pela tabela, mas a lista básica
// responde (sem CPF); login sem nenhuma permissão não recebe nada; Pacientes e
// os papéis admin/diretoria/cronograma continuam lendo; a busca do PEP devolve
// só os 4 últimos dígitos e o vínculo grava o CPF lido no banco; Autorizações
// Avulsas exige a permissão e esconde fictício como antes; trava e ordem das
// migrations; reroda.
//
//   node supabase/tests/seguranca_pacientes.pglite.mjs \
//     supabase/migrations/20261019160000_seguranca_pacientes_rpcs.sql \
//     supabase/migrations/20261019160100_seguranca_pacientes_leitura_restrita.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

let f = 0
const ok = (c, m) => { console.log(c ? '  ok  ' : '  FALHA', m); if (!c) f++ }
const migRpcs = readFileSync(process.argv[2], 'utf8')
const migFechaOriginal = readFileSync(process.argv[3], 'utf8')
const migFecha = migFechaOriginal.replace('rpcs_aplicadas_e_frontend_publicado boolean := false', 'rpcs_aplicadas_e_frontend_publicado boolean := true')
ok(migFecha !== migFechaOriginal, 'a trava existe no texto da 20261019160100')

const U = {
  grade:     '00000000-0000-0000-0000-000000000001',
  nenhuma:   '00000000-0000-0000-0000-000000000002',
  cadastro:  '00000000-0000-0000-0000-000000000003',
  cronogr:   '00000000-0000-0000-0000-000000000004',
  rp:        '00000000-0000-0000-0000-000000000005',
  avulsas:   '00000000-0000-0000-0000-000000000006',
  inativo:   '00000000-0000-0000-0000-000000000007',
}

async function novoBanco() {
  const db = new PGlite()
  await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.usuarios (id uuid primary key, nome text, role text, ativo boolean default true);
insert into public.usuarios (id, nome, role, ativo) values
  ('${U.grade}', 'Grade', 'recepcao', true), ('${U.nenhuma}', 'Nada', 'recepcao', true),
  ('${U.cadastro}', 'Cadastro', 'recepcao', true), ('${U.cronogr}', 'Cronograma', 'cronograma', true),
  ('${U.rp}', 'RP', 'rp', true), ('${U.avulsas}', 'Avulsas', 'recepcao', true),
  ('${U.inativo}', 'Inativo', 'recepcao', false);
create table public.usuarios_permissoes (usuario_id uuid, permissao_codigo text, permitido boolean, primary key (usuario_id, permissao_codigo));
insert into public.usuarios_permissoes values
  ('${U.grade}', 'cronograma_grade', true), ('${U.cadastro}', 'cadastros_pacientes', true),
  ('${U.avulsas}', 'autorizacoes_avulsas', true), ('${U.inativo}', 'cronograma_grade', true);
create table public.grupos_permissoes (id int primary key, modelo_permissoes jsonb);
create table public.grupos_permissoes_membros (grupo_id int, usuario_id uuid);

-- usuario_tem_permissao como em 20260929140000.
create function public.usuario_tem_permissao(p_codigo text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin', 'diretoria'))
  or (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo)
      and (exists (select 1 from public.usuarios_permissoes up where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido)
           or (exists (select 1 from public.grupos_permissoes_membros m join public.grupos_permissoes g on g.id = m.grupo_id
                       where m.usuario_id = auth.uid() and g.modelo_permissoes -> p_codigo = 'true'::jsonb)
               and not exists (select 1 from public.usuarios_permissoes up where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and not up.permitido))));
$$;
grant execute on function public.usuario_tem_permissao(text) to authenticated;
create function public.remuneracao_has_role(p text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role = any (p)) $$;
grant execute on function public.remuneracao_has_role(text[]) to authenticated;
create function public.sp_pep_pode_escrever() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('rp', 'admin')) $$;
grant execute on function public.sp_pep_pode_escrever() to authenticated;

create table public.pacientes (
  id_paciente bigint generated always as identity primary key, tita_paciente_id bigint unique, nome text not null,
  cpf text, responsavel_cpf text, logradouro text, convenio_nome text, ativo boolean not null default true,
  ficticio boolean not null default false, falecido boolean not null default false, foto_path text);
insert into public.pacientes (tita_paciente_id, nome, cpf, responsavel_cpf, logradouro, convenio_nome, ficticio) values
  (101, 'Ana Souza', '123.456.789-01', '999.888.777-66', 'Rua A', 'ASSIM', false),
  (102, 'Bruno Lima', '987.654.321-00', null, 'Rua B', 'Unimed', false),
  (103, 'Horário Bloqueado', null, null, null, null, true);
alter table public.pacientes enable row level security;
grant all on public.pacientes to authenticated, service_role;
create policy pacientes_select on public.pacientes for select to authenticated using (true);
create policy pacientes_write on public.pacientes for all to authenticated
  using (public.remuneracao_has_role(array['admin', 'diretoria', 'cronograma']))
  with check (public.remuneracao_has_role(array['admin', 'diretoria', 'cronograma']));
create policy pacientes_write_cadastro on public.pacientes for all to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes')) with check (public.usuario_tem_permissao('cadastros_pacientes'));

-- Robô PEP: o vínculo grava o que recebe.
create table public.sp_pep_vinculos (pasta_id text primary key, paciente_nome text, paciente_cpf text);
create function public.sp_pep_vincular_pasta(p_pasta_id text, p_tipo text, p_prestador_nome text default null,
  p_paciente_nome text default null, p_paciente_cpf text default null) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.sp_pep_pode_escrever() then raise exception 'sem permissao' using errcode = '42501'; end if;
  insert into public.sp_pep_vinculos values (p_pasta_id, p_paciente_nome, p_paciente_cpf)
    on conflict (pasta_id) do update set paciente_nome = excluded.paciente_nome, paciente_cpf = excluded.paciente_cpf;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.sp_pep_vincular_pasta(text, text, text, text, text) to authenticated;

-- Autorizações Avulsas: corpo de 20260825130000 (resumido: sem agenda_orbita).
create table public.agenda_tita (paciente_id bigint, paciente_nome text, numero_carteirinha text, data_atendimento date, ativo boolean, convenio_nome text);
grant select on public.agenda_tita to authenticated;
insert into public.agenda_tita values
  (101, 'Ana Souza', 'C-1', current_date, true, 'ASSIM'), (103, 'Horário Bloqueado', null, current_date, true, 'ASSIM');
create function public.listar_pacientes_assim()
returns table (paciente_id bigint, paciente_nome text, numero_carteirinha text, crm text, crm_uf text, nome_medico text, ultima_sessao date)
language sql stable security invoker set search_path = public set statement_timeout = '10s' as $$
  with assim as (
    select distinct on (at.paciente_id) at.paciente_id, at.paciente_nome, at.numero_carteirinha, at.data_atendimento
    from public.agenda_tita at
    where at.data_atendimento >= current_date - 180 and at.ativo and at.convenio_nome ilike '%assim%'
    order by at.paciente_id, at.data_atendimento desc)
  select a.paciente_id, a.paciente_nome, a.numero_carteirinha, null::text, null::text, null::text, a.data_atendimento
  from assim a left join public.pacientes p on p.tita_paciente_id = a.paciente_id
  where coalesce(p.ficticio, false) = false
  order by a.paciente_nome
$$;
revoke all on function public.listar_pacientes_assim() from public;
grant execute on function public.listar_pacientes_assim() to authenticated;
`)
  return db
}

const como = async (db, uid, sql) => {
  try {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, campos: r.fields.map(x => x.name) }
  } catch (e) {
    return { ok: false, erro: e.message }
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const tentar = async (db, sql) => { try { await db.exec(sql); return '' } catch (e) { return e.message } }

// ── Ordem e trava ───────────────────────────────────────────────────────────
{
  const db = await novoBanco()
  ok(/Pare: aplique a 20261019160000/.test(await tentar(db, migFechaOriginal)), 'trava: a 20261019160100 para sem trocar false → true')
  ok(/não está aplicada/.test(await tentar(db, migFecha)), 'sem a 20261019160000, a 20261019160100 para')
  ok((await como(db, U.nenhuma, `select cpf from public.pacientes`)).rows?.length === 3, 'e nada foi alterado (hoje qualquer login lê o CPF)')
}

// ── Só as RPCs (antes de fechar): nada muda para quem lê a tabela ───────────
{
  const db = await novoBanco()
  await db.exec(migRpcs)
  await db.exec(migRpcs)
  ok(true, 'a 20261019160000 aplica e reroda')
  ok((await como(db, U.nenhuma, `select cpf from public.pacientes`)).rows?.length === 3, 'só com as RPCs a tabela continua como estava (pode ir antes do redeploy)')
}

// ── As duas aplicadas ───────────────────────────────────────────────────────
{
  const db = await novoBanco()
  await db.exec(migRpcs)
  await db.exec(migFecha)
  await db.exec(migRpcs)
  await db.exec(migFecha)
  ok(true, 'as duas aplicam e reaplicam')

  const tabelaGrade = await como(db, U.grade, `select cpf from public.pacientes`)
  ok(tabelaGrade.ok && tabelaGrade.rows.length === 0, 'login só com a Grade: a tabela não devolve nada (nem CPF)')
  const lista = await como(db, U.grade, `select * from public.pacientes_lista_basica()`)
  ok(lista.ok && lista.rows.length === 3, 'login só com a Grade: a lista básica responde')
  ok(lista.ok && !lista.campos.some(c => /cpf|logradouro|responsavel/.test(c)), 'a lista básica não traz CPF, endereço nem responsável')
  const porTita = await como(db, U.grade, `select id_paciente, nome from public.pacientes_lista_basica(null, array[102]::bigint[])`)
  ok(porTita.ok && porTita.rows.length === 1 && porTita.rows[0].nome === 'Bruno Lima', 'filtro por id do TiTa (Ocupação Paciente)')
  const porId = await como(db, U.grade, `select nome from public.pacientes_lista_basica(array[1]::bigint[])`)
  ok(porId.ok && porId.rows.length === 1, 'filtro por id do Pulsar (nome atual na Grade)')

  const nada = await como(db, U.nenhuma, `select * from public.pacientes_lista_basica()`)
  ok(!nada.ok && /sem permissão/.test(nada.erro), 'login sem nenhuma permissão: a lista básica recusa')
  const nadaTabela = await como(db, U.nenhuma, `select * from public.pacientes`)
  ok(nadaTabela.ok && nadaTabela.rows.length === 0, 'login sem nenhuma permissão: a tabela não devolve nada')
  const inativo = await como(db, U.inativo, `select * from public.pacientes_lista_basica()`)
  ok(!inativo.ok, 'usuário inativo com a permissão: recusado')

  const cad = await como(db, U.cadastro, `select cpf from public.pacientes where cpf is not null`)
  ok(cad.ok && cad.rows.length === 2, 'Pacientes (cadastros_pacientes) continua lendo o cadastro inteiro')
  const cron = await como(db, U.cronogr, `select cpf from public.pacientes where cpf is not null`)
  ok(cron.ok && cron.rows.length === 2, 'papel cronograma continua lendo (pacientes_write)')
  ok(!(await db.query(`select has_function_privilege('anon', 'public.pacientes_lista_basica(bigint[], bigint[])', 'EXECUTE') a`)).rows[0].a, 'anon não executa a lista básica')

  // PEP
  const busca = await como(db, U.rp, `select * from public.pacientes_buscar_para_pep('ana')`)
  ok(busca.ok && busca.rows.length === 1 && busca.rows[0].cpf_final === '8901', 'busca do PEP: só os 4 últimos dígitos do CPF')
  ok(busca.ok && !busca.campos.includes('cpf'), 'busca do PEP: sem a coluna CPF')
  const buscaFicticio = await como(db, U.rp, `select * from public.pacientes_buscar_para_pep('Horário')`)
  ok(buscaFicticio.ok && buscaFicticio.rows.length === 0, 'busca do PEP: fictício fica de fora')
  const buscaCurta = await como(db, U.rp, `select * from public.pacientes_buscar_para_pep('an')`)
  ok(buscaCurta.ok && buscaCurta.rows.length === 0, 'busca do PEP: menos de 3 letras não busca')
  const buscaCuringa = await como(db, U.rp, `select * from public.pacientes_buscar_para_pep('%%%')`)
  ok(buscaCuringa.ok && buscaCuringa.rows.length === 0, 'busca do PEP: % não vira curinga')
  ok(!(await como(db, U.grade, `select * from public.pacientes_buscar_para_pep('ana')`)).ok, 'busca do PEP: quem não é do PEP é recusado')
  const vinc = await como(db, U.rp, `select public.sp_pep_vincular_pasta_paciente('pasta-1', 1) r`)
  ok(vinc.ok, 'vínculo da pasta pelo id do paciente')
  const gravado = (await db.query(`select paciente_nome, paciente_cpf from public.sp_pep_vinculos where pasta_id = 'pasta-1'`)).rows[0]
  ok(gravado?.paciente_nome === 'Ana Souza' && gravado?.paciente_cpf === '123.456.789-01', 'o vínculo grava nome e CPF lidos dentro do banco')
  ok(!(await como(db, U.grade, `select public.sp_pep_vincular_pasta_paciente('pasta-2', 1)`)).ok, 'vínculo: quem não é do PEP é recusado')

  // Autorizações Avulsas
  const av = await como(db, U.avulsas, `select * from public.listar_pacientes_assim()`)
  ok(av.ok && av.rows.length === 1 && av.rows[0].paciente_nome === 'Ana Souza', 'Autorizações Avulsas: lista e continua escondendo fictício (mesmo sem ler pacientes)')
  ok(av.ok && av.campos.join(',') === 'paciente_id,paciente_nome,numero_carteirinha,crm,crm_uf,nome_medico,ultima_sessao', 'Autorizações Avulsas: mesmas colunas, na mesma ordem')
  const avNao = await como(db, U.grade, `select * from public.listar_pacientes_assim()`)
  ok(!avNao.ok && /Autorizações Avulsas/.test(avNao.erro), 'Autorizações Avulsas: sem a permissão, recusa')
  ok(!(await como(db, U.avulsas, `select * from public.sp_listar_pacientes_assim_interno()`)).ok, 'a função interna não é chamável pelo login')

  await db.exec(`set role service_role`)
  const srv = await db.query(`select count(*)::int n from public.pacientes`).then(r => r.rows[0].n, () => -1)
  await db.exec(`reset role`)
  ok(srv === 3, 'service_role continua lendo tudo')
}

process.exit(f ? 1 : 0)
