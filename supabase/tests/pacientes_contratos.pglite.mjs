// Teste de segurança/execução da migration 20261008160000 no PGlite (Postgres
// de verdade em Node, sem Docker). Fase 5 do docs/PLANO_CONTRATOS_PACIENTE.md.
//
// Prova: anon não lê nem executa nada; usuário sem permissão não lê; quem só
// tem status_contratos lê e não escreve; UPDATE/INSERT direto recusados;
// transição inválida falha; webhook repetido não duplica; eventos imutáveis; e
// a matriz de transição do banco bate com frontend/lib/contratos/status.ts.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pacientes_contratos.pglite.mjs .
//   node pacientes_contratos.pglite.mjs //     <repo>/supabase/migrations/20261008160000_pacientes_contratos.sql //     <repo>/frontend/lib/contratos/status.ts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath, statusPath] = process.argv
const mig = readFileSync(migPath, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

// ═══════════════════════════════════════════════════════════════════════════
// 0. UPGRADE: quem já tinha a versão com PDF (arquivo_original_path etc.,
//    contratos_registrar_arquivo, bucket contratos-pacientes) antes da decisão
//    de 09/10/2026. Instância PGLITE PRÓPRIA — não reaproveita `db` abaixo,
//    porque `create table if not exists` da migration não mexeria numa tabela
//    que já existisse com o shape novo, e isso poluiria o resto do teste.
// ═══════════════════════════════════════════════════════════════════════════
{
  const dbUp = new PGlite()
  await dbUp.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id bigint generated always as identity primary key, bucket_id text);
    create table public.pacientes(id_paciente bigint primary key, nome text);
    create table public.responsaveis(id bigint primary key, nome text);
    create function public.set_atualizado_em() returns trigger language plpgsql as $$
    begin new.atualizado_em := now(); return new; end $$;
    create or replace function public.sp_pac_disp_imutavel() returns trigger language plpgsql as $$
    begin
      if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
      raise exception '% é histórico imutável: % não é permitido', tg_table_name, tg_op using errcode = '42501';
    end $$;
    create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
    language sql stable as $$ select true $$;

    -- Shape da versão anterior (com arquivo).
    create table public.pacientes_contratos (
      id bigint generated always as identity primary key,
      paciente_id bigint not null,
      tipo text not null,
      data_inicio date not null,
      data_vencimento date not null,
      status text not null default 'rascunho',
      assinado_em timestamptz,
      origem_assinatura text,
      arquivo_original_path text,
      arquivo_original_nome text,
      arquivo_assinado_path text,
      d4sign_documento_uuid text,
      d4sign_cofre_uuid text,
      link_expira_em timestamptz,
      observacao text,
      ativo boolean not null default true,
      criado_por_usuario_id uuid,
      criado_por_nome text,
      criado_em timestamptz not null default now(),
      atualizado_em timestamptz not null default now()
    );
    create table public.pacientes_contratos_eventos (
      id bigint generated always as identity primary key,
      contrato_id bigint not null references public.pacientes_contratos(id),
      tipo text not null,
      status_antes text,
      status_depois text,
      detalhe jsonb,
      origem text not null default 'usuario',
      usuario_id uuid,
      usuario_nome text,
      criado_em timestamptz not null default now(),
      criado_em_brasilia text,
      constraint pac_contratos_ev_tipo_check check (tipo in ('criado', 'arquivo_anexado'))
    );
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('contratos-pacientes', 'contratos-pacientes', false, 1, array['application/pdf']);
    create function public.contratos_registrar_arquivo(bigint, text, text, text, uuid, text)
      returns bigint language sql as $$ select $1 $$;
  `)
  await dbUp.exec(mig)
  const cols = await dbUp.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='pacientes_contratos' and column_name like 'arquivo%'`,
  )
  ok(cols.rows.length === 0, 'upgrade: colunas de arquivo removidas de quem já tinha a tabela')
  const bucketGone = await dbUp.query(`select 1 from storage.buckets where id = 'contratos-pacientes'`)
  ok(bucketGone.rows.length === 0, 'upgrade: bucket removido (estava vazio)')
  const fnGone = await dbUp.query(
    `select count(*)::int n from pg_proc where proname = 'contratos_registrar_arquivo'`,
  )
  ok(fnGone.rows[0].n === 0, 'upgrade: função contratos_registrar_arquivo removida')
  const chk = await dbUp.query(
    `select pg_get_constraintdef(oid) def from pg_constraint where conname = 'pac_contratos_ev_tipo_check'`,
  )
  ok(!chk.rows[0].def.includes('arquivo_anexado'), 'upgrade: arquivo_anexado fora do check de tipo de evento')
  await dbUp.close()
}

// ═══════════════════════════════════════════════════════════════════════════
// Resto do teste: instalação NOVA (nunca teve arquivo).
// ═══════════════════════════════════════════════════════════════════════════
const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}

const A = '00000000-0000-0000-0000-00000000000a' // cadastros_pacientes
const B = '00000000-0000-0000-0000-00000000000b' // nenhuma permissão
const C = '00000000-0000-0000-0000-00000000000c' // status_contratos
const D = '00000000-0000-0000-0000-00000000000d' // diretoria (bypass)

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity primary key, bucket_id text);

-- Supabase concede tudo por padrão em public: o revoke da migration é que fecha.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create table public.pacientes(id_paciente bigint primary key, nome text);
create table public.responsaveis(id bigint primary key, nome text);
create function public.set_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create or replace function public.sp_pac_disp_imutavel() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception '% é histórico imutável: % não é permitido', tg_table_name, tg_op using errcode = '42501';
end $$;
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

insert into public.usuarios values
  ('${A}', 'Ana Cadastro', 'recepcao', true),
  ('${B}', 'Beto Sem', 'recepcao', true),
  ('${C}', 'Carla Status', 'recepcao', true),
  ('${D}', 'Dora Diretoria', 'diretoria', true);
insert into public.usuarios_permissoes values
  ('${A}', 'cadastros_pacientes', true),
  ('${C}', 'status_contratos', true);
insert into public.pacientes values (1, 'Paciente Um'), (2, 'Paciente Dois');
`)

console.log('1. migration executa (e reexecuta)')
await db.exec(mig)
ok(true, 'primeira execução')
await db.exec(mig)
ok(true, 'segunda execução (idempotente)')
const bucketNovo = await db.query(`select 1 from storage.buckets where id = 'contratos-pacientes'`)
ok(bucketNovo.rows.length === 0, 'instalação nova não cria bucket nenhum (sem PDF neste tema)')

async function como(papel, uid) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid ?? ''}'; set role ${papel};`)
}

console.log('2. usuário com cadastros_pacientes (A)')
await como('authenticated', A)
const criado = await db.query(`select * from public.contratos_criar(1, 'terapias', '2026-10-08', '2027-10-07', ' obs ')`)
const id1 = criado.rows[0].id
ok(criado.rows[0].status === 'rascunho' && criado.rows[0].observacao === 'obs', 'cria em rascunho, observação aparada')
ok(criado.rows[0].criado_por_nome === 'Ana Cadastro', 'grava quem criou')
const ed = await db.query(`select * from public.contratos_editar_rascunho($1, 'terapias', '2026-10-08', '2027-10-08', null)`, [id1])
ok(ed.rows[0].data_vencimento instanceof Date || ed.rows[0].data_vencimento, 'edita rascunho')
let e = await erro(`select public.contratos_criar(1, 'terapias', '2026-10-08', '2026-10-01', null)`)
ok(e && /pac_contratos_datas_check/.test(e.message), 'vencimento antes do início é recusado')
e = await erro(`select public.contratos_criar(1, 'outro', '2026-10-08', '2027-10-01', null)`)
ok(e && /pac_contratos_tipo_check/.test(e.message), 'tipo fora da lista é recusado')
e = await erro(`select public.contratos_marcar_assinado_manual($1, (now() + interval '3 days')::date)`, [id1])
ok(e && /futuro/.test(e.message), 'assinatura no futuro é recusada')
const ass = await db.query(`select * from public.contratos_marcar_assinado_manual($1, '2026-10-08')`, [id1])
ok(ass.rows[0].status === 'assinado' && ass.rows[0].origem_assinatura === 'manual', 'marca assinado manual')
const assEm = await db.query(`select to_char(assinado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') d from public.pacientes_contratos where id = $1`, [id1])
ok(assEm.rows[0].d === '2026-10-08', 'data da assinatura não escorrega de dia')
e = await erro(`select public.contratos_editar_rascunho($1, 'terapias', '2026-10-08', '2027-10-08', null)`, [id1])
ok(e && /Rascunho/.test(e.message), 'não edita contrato assinado')
e = await erro(`select public.contratos_marcar_assinado_manual($1, '2026-10-08')`, [id1])
ok(!!e, 'assinado → assinado recusado')
e = await erro(`select public.contratos_cancelar($1, 'x')`, [id1])
ok(e && /motivo/.test(e.message), 'cancelar exige motivo')
const can = await db.query(`select * from public.contratos_cancelar($1, 'rescisão a pedido da família')`, [id1])
ok(can.rows[0].status === 'cancelado', 'assinado → cancelado (rescisão)')
e = await erro(`select public.contratos_cancelar($1, 'de novo, outra vez')`, [id1])
ok(!!e, 'cancelado → cancelado recusado')
const ev = await db.query(`select tipo, status_antes, status_depois, usuario_nome, criado_em_brasilia from public.pacientes_contratos_eventos where contrato_id = $1 order by id`, [id1])
ok(ev.rows.map(r => r.tipo).join(',') === 'criado,editado,assinado_manual,cancelado', 'linha do tempo completa: ' + ev.rows.map(r => r.tipo).join(','))
ok(ev.rows.every(r => r.usuario_nome === 'Ana Cadastro' && /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(r.criado_em_brasilia)), 'eventos com autor e data de Brasília')
e = await erro(`update public.pacientes_contratos set status = 'assinado' where id = $1`, [id1])
ok(e && /permission denied/.test(e.message), 'UPDATE direto recusado: ' + e?.message)
e = await erro(`insert into public.pacientes_contratos (paciente_id, tipo, data_inicio, data_vencimento) values (1, 'terapias', '2026-01-01', '2026-02-01')`)
ok(e && /permission denied/.test(e.message), 'INSERT direto recusado')
e = await erro(`insert into public.pacientes_contratos_eventos (contrato_id, tipo, origem) values ($1, 'assinado', 'usuario')`, [id1])
ok(e && /permission denied/.test(e.message), 'INSERT direto em eventos recusado')
e = await erro(`select public.contratos_registrar_evento_externo($1, 'assinado', 'assinado')`, [id1])
ok(e && /permission denied/.test(e.message), 'registrar_evento_externo recusado para authenticated')
const leA = await db.query(`select count(*)::int n from public.pacientes_contratos`)
ok(leA.rows[0].n >= 1, 'A lê contratos')

console.log('3. usuário sem permissão (B)')
await como('authenticated', B)
const leB = await db.query(`select (select count(*) from public.pacientes_contratos)::int a, (select count(*) from public.pacientes_contratos_eventos)::int b, (select count(*) from public.pacientes_contratos_signatarios)::int c`)
ok(leB.rows[0].a === 0 && leB.rows[0].b === 0 && leB.rows[0].c === 0, 'B não lê nada')
e = await erro(`select public.contratos_criar(1, 'terapias', '2026-10-08', '2027-10-07', null)`)
ok(e && e.code === '42501', 'B não cria')
e = await erro(`select * from public.d4sign_webhook_logs`)
ok(e && /permission denied/.test(e.message), 'B não lê webhook logs')

console.log('4. usuário só com status_contratos (C)')
await como('authenticated', C)
const leC = await db.query(`select count(*)::int n from public.pacientes_contratos`)
ok(leC.rows[0].n >= 1, 'C lê contratos')
e = await erro(`select public.contratos_criar(1, 'terapias', '2026-10-08', '2027-10-07', null)`)
ok(e && e.code === '42501', 'C não cria (só leitura)')
await como('service_role', null)
await db.query(`insert into public.pacientes_contratos_signatarios (contrato_id, nome, cpf, celular) values ($1, 'Mãe', '12345678900', '11999999999')`, [id1])
await como('authenticated', C)
const sigC = await db.query(`select count(*)::int n from public.pacientes_contratos_signatarios`)
ok(sigC.rows[0].n === 0, 'C não lê signatários (CPF/celular)')
await como('authenticated', A)
const sigA = await db.query(`select count(*)::int n from public.pacientes_contratos_signatarios`)
ok(sigA.rows[0].n === 1, 'A lê signatários')

console.log('5. diretoria (D) pelo bypass do papel')
await como('authenticated', D)
const cD = await db.query(`select * from public.contratos_criar(2, 'avaliacao_neuropsicologica', '2026-10-08', '2026-12-08', null)`)
const id2 = cD.rows[0].id
ok(cD.rows[0].status === 'rascunho', 'diretoria cria')

console.log('6. anon')
await como('anon', null)
for (const t of ['pacientes_contratos', 'pacientes_contratos_eventos', 'pacientes_contratos_signatarios', 'd4sign_webhook_logs']) {
  e = await erro(`select * from public.${t}`)
  ok(e && /permission denied/.test(e.message), `anon não lê ${t}`)
}
for (const f of [
  `public.contratos_criar(1, 'terapias', '2026-10-08', '2027-10-07', null)`,
  `public.contratos_marcar_assinado_manual(1, '2026-10-08')`,
  `public.contratos_cancelar(1, 'motivo qualquer')`,
  `public.contratos_registrar_evento_externo(1, 'assinado', 'assinado')`,
]) {
  e = await erro(`select ${f}`)
  ok(e && /permission denied/.test(e.message), `anon não executa ${f.split('(')[0]}`)
}

console.log('7. service_role (webhook)')
await como('service_role', null)
const env = await db.query(`select * from public.contratos_registrar_evento_externo($1, 'enviado_d4sign', 'enviado', '{"x":1}', 'd4sign', '{"d4sign_documento_uuid":"uuid-1","link_expira_em":"2026-10-15T12:00:00Z"}')`, [id2])
ok(env.rows[0].status === 'enviado' && env.rows[0].d4sign_documento_uuid === 'uuid-1', 'rascunho → enviado com campos D4Sign')
await db.query(`select public.contratos_registrar_evento_externo($1, 'link_enviado_whatsapp', 'aguardando_assinatura')`, [id2])
const antes = (await db.query(`select count(*)::int n from public.pacientes_contratos_eventos where contrato_id = $1`, [id2])).rows[0].n
await db.query(`select public.contratos_registrar_evento_externo($1, 'link_enviado_whatsapp', 'aguardando_assinatura')`, [id2])
const depois = (await db.query(`select count(*)::int n from public.pacientes_contratos_eventos where contrato_id = $1`, [id2])).rows[0].n
ok(antes === depois, 'webhook repetido não duplica evento')
e = await erro(`select public.contratos_registrar_evento_externo($1, 'status_corrigido', 'rascunho', null, 'sistema')`, [id2])
ok(e && /Transição inválida/.test(e.message), 'aguardando → rascunho recusado')
e = await erro(`select public.contratos_registrar_evento_externo($1, 'assinado', 'assinado', null, 'usuario')`, [id2])
ok(e && /Origem/.test(e.message), 'origem "usuario" recusada na rota externa')
const fim = await db.query(`select * from public.contratos_registrar_evento_externo($1, 'assinado', 'assinado', null, 'd4sign', $2)`, [id2, JSON.stringify({ assinado_em: '2026-10-09T12:00:00Z' })])
ok(fim.rows[0].status === 'assinado' && fim.rows[0].origem_assinatura === 'd4sign' && fim.rows[0].assinado_em, 'aguardando → assinado (d4sign)')
e = await erro(`update public.pacientes_contratos_eventos set tipo = 'criado' where contrato_id = $1`, [id2])
ok(e && /imutável/.test(e.message), 'evento imutável até para service_role (UPDATE)')
e = await erro(`delete from public.pacientes_contratos_eventos where contrato_id = $1`, [id2])
ok(e && /imutável|permission denied/.test(e.message), 'evento imutável (DELETE)')
await db.exec('reset role')
e = await erro(`delete from public.pacientes where id_paciente = 2`)
ok(!e, 'paciente apagado leva contratos e eventos por cascata: ' + (e?.message ?? ''))

console.log('8. matriz de transição: banco × frontend/lib/contratos/status.ts')
const ts = readFileSync(statusPath, 'utf8')
const bloco = ts.slice(ts.indexOf('export const TRANSICOES'), ts.indexOf('}', ts.indexOf('export const TRANSICOES')))
const matrizTs = {}
for (const m of bloco.matchAll(/(\w+): \[([^\]]*)\]/g)) matrizTs[m[1]] = m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean)
const STATUS = ['rascunho', 'enviado', 'aguardando_assinatura', 'assinado', 'recusado', 'cancelado', 'expirado']
ok(Object.keys(matrizTs).length === 7, 'TS tem as 7 linhas')
let divergencias = []
for (const de of STATUS) for (const para of STATUS) {
  const r = await db.query(`select public.sp_contratos_transicao_ok($1, $2) v`, [de, para])
  const noBanco = r.rows[0].v === true
  const noTs = (matrizTs[de] ?? []).includes(para)
  if (noBanco !== noTs) divergencias.push(`${de}→${para} banco=${noBanco} ts=${noTs}`)
}
ok(divergencias.length === 0, 'as 49 células batem ' + divergencias.join('; '))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
process.exitCode = falhas ? 1 : 0
