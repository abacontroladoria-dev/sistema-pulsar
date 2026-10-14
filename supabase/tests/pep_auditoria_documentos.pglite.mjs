// Teste da migration 20261015100000 (pep_auditoria_documentos) no PGlite,
// aplicada por cima da 20261014110000 com documentos já "analisados".
//
// Prova:
//   • tudo o que foi lido volta para "aguardando" (lido, não auditado), os
//     ilegíveis continuam ilegíveis, os pares de cópia são apagados; reaplicar
//     a migration não apaga auditoria feita depois;
//   • o robô grava conteúdo novo como "aguardando";
//   • réguas: v1 de OE/ETC/PIC; append-only; publicar só rp/admin (versão
//     sobe sozinha); nota obrigatória; anon e login sem permissão não leem;
//   • a permissão nova da tela lê documentos, itens, pastas e réguas — e
//     continua SEM ler o texto.
//
// Rodar FORA do repo:
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pep_auditoria_documentos.pglite.mjs .
//   node pep_auditoria_documentos.pglite.mjs <repo>/supabase/migrations

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'
import { join } from 'path'

const dir = process.argv[2]
if (!dir) { console.error('uso: node pep_auditoria_documentos.pglite.mjs <pasta das migrations>'); process.exit(2) }

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }
const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}
async function como(papel, sub, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false); set role ${papel};`)
  try { return await fn() } finally { await db.exec('reset role') }
}

const AUD = '00000000-0000-0000-0000-00000000000a' // só a tela nova
const SEM = '00000000-0000-0000-0000-00000000000b' // nada
const RP = '00000000-0000-0000-0000-00000000000c'  // rp
const EXEC = '11111111-1111-1111-1111-111111111111'

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema cron;
create table cron.job(nome text primary key, quando text, comando text);
create function cron.schedule(p_nome text, p_quando text, p_cmd text) returns bigint language sql as $$
  insert into cron.job values (p_nome, p_quando, p_cmd) on conflict (nome) do update set quando = excluded.quando returning 1::bigint $$;
create function cron.unschedule(p_nome text) returns boolean language sql as $$ delete from cron.job where nome = p_nome returning true $$;

create table public.usuarios(id uuid primary key, nome text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;
create function public.sp_pep_pode_escrever() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true and u.role in ('rp','admin')) $$;
revoke all on function public.sp_pep_pode_escrever() from public, anon;
grant execute on function public.sp_pep_pode_escrever() to authenticated;
create function public.robo_autenticar(p_token text) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_token is distinct from 'tok-maquina' then raise exception 'token invalido' using errcode = '28000'; end if;
  return 'maq-1';
end $$;

-- Pré-existentes (shape mínimo) e as policies antigas que a migration troca.
create table public.sp_pep_itens(sp_id text primary key, nome text not null, tipo text not null, status text not null default 'sugerido',
  e_tag text, tamanho bigint, criado_em_sp timestamptz default now(), removido_em timestamptz, sigla text);
create table public.sp_pep_pastas(id text primary key, nome text, papel text, prestador_pasta_id text);
create table public.sp_pep_prestadores(pasta_id text primary key, prestador_nome text, status text, motivo text);
create table public.sp_pep_pacientes(pasta_id text primary key, paciente_nome text);
alter table public.sp_pep_itens enable row level security;
alter table public.sp_pep_pastas enable row level security;
alter table public.sp_pep_prestadores enable row level security;
alter table public.sp_pep_pacientes enable row level security;
create policy sp_pep_itens_select on public.sp_pep_itens for select to authenticated using (public.usuario_tem_permissao('relacionamento_prestador_pep'));
create policy sp_pep_pastas_select on public.sp_pep_pastas for select to authenticated using (public.usuario_tem_permissao('relacionamento_prestador_pep'));
create policy sp_pep_prestadores_select on public.sp_pep_prestadores for select to authenticated using (public.usuario_tem_permissao('relacionamento_prestador_pep'));
create policy sp_pep_pacientes_select on public.sp_pep_pacientes for select to authenticated using (public.usuario_tem_permissao('relacionamento_prestador_pep'));
revoke insert, update, delete on public.sp_pep_itens, public.sp_pep_pastas, public.sp_pep_prestadores, public.sp_pep_pacientes from authenticated;
revoke all on public.sp_pep_itens, public.sp_pep_pastas, public.sp_pep_prestadores, public.sp_pep_pacientes from anon;
create table public.sp_pep_execucoes(id uuid primary key, versao text);
create table public.auditoria_worker_config(id boolean primary key, url text, ativo boolean);
create table public.auditoria_reauditoria_fila(id bigint, status text, disponivel_em timestamptz);

insert into public.usuarios values ('${AUD}', 'Auditora', 'terapeutico', true), ('${SEM}', 'Sem', 'terapeutico', true), ('${RP}', 'Rita RP', 'rp', true);
insert into public.usuarios_permissoes values ('${AUD}', 'relacionamento_prestador_auditoria_documentos', true);
insert into public.sp_pep_itens(sp_id, nome, tipo, e_tag, sigla) values
  ('A', 'PIC-JOAO-092026.docx', 'evidencia', 'ea1', 'PIC'), ('B', 'PIC-LUCAS-092026.docx', 'evidencia', 'eb1', 'PIC'),
  ('C', 'foto.heic', 'evidencia', 'ec1', 'PIC');
insert into public.sp_pep_pastas values ('P1', 'Prestador de Serviço - Fulana (X LTDA)', 'prestador', null);
insert into public.sp_pep_prestadores values ('P1', null, 'nao_reconhecido', 'planilha_ausente');
insert into public.sp_pep_execucoes values ('${EXEC}', '0.5.0');
`)

await db.exec(readFileSync(join(dir, '20261014110000_pep_documentos_conteudo.sql'), 'utf8'))
// Estado de 14/10: dois analisados pela regra antiga (um errado), um par de cópia, um ilegível.
await db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb)`, [EXEC, JSON.stringify([
  { sp_id: 'A', e_tag: 'ea1', sha256: 'h1', status: 'ok', texto: 'texto A' },
  { sp_id: 'B', e_tag: 'eb1', sha256: 'h2', status: 'ok', texto: 'texto B' },
  { sp_id: 'C', e_tag: 'ec1', status: 'formato_nao_suportado' },
])])
await db.exec(`
  update sp_pep_documentos set analise_status = 'concluida', achados = '[{"nivel":"errado"}]', veredito = 'errado', ia_status = 'concluida', ia_regua = 'PIC@2026-10-14' where sp_id = 'A';
  update sp_pep_documentos set analise_status = 'concluida', veredito = 'bom' where sp_id = 'B';
  insert into sp_pep_documentos_semelhancas(a_sp_id, b_sp_id, tipo, similaridade, relacao, nivel) values ('A','B','parecido',0.9,'outro_paciente','errado');`)

const mig = readFileSync(join(dir, '20261015100000_pep_auditoria_documentos.sql'), 'utf8')
await db.exec(mig)

console.log('Tudo volta a "Lido, não auditado"')
let docs = Object.fromEntries((await db.query(`select sp_id, analise_status, veredito, achados, ia_regua from sp_pep_documentos`)).rows.map(r => [r.sp_id, r]))
ok(docs.A.analise_status === 'aguardando' && docs.A.veredito === null && docs.A.achados.length === 0 && docs.A.ia_regua === null, 'A: aguardando, sem veredito, sem achados, sem IA')
ok(docs.B.analise_status === 'aguardando', 'B: aguardando')
ok(docs.C.veredito === 'ilegivel' && docs.C.analise_status === 'concluida', 'C (ilegível) continua "Não foi possível ler"')
ok((await db.query(`select count(*)::int n from sp_pep_documentos_semelhancas`)).rows[0].n === 0, 'pares de cópia apagados')
ok((await db.query(`select count(*)::int n from sp_pep_documentos_texto`)).rows[0].n === 2, 'texto guardado continua (para auditar)')

console.log('Reaplicar não apaga auditoria feita depois')
await db.exec(`update sp_pep_documentos set analise_status = 'concluida', veredito = 'bom', auditoria_lote = gen_random_uuid() where sp_id = 'A'`)
await db.exec(mig)
ok((await db.query(`select veredito from sp_pep_documentos where sp_id = 'A'`)).rows[0].veredito === 'bom', 'auditoria de A sobrevive à reaplicação')

console.log('Robô')
await db.exec(`insert into sp_pep_itens(sp_id, nome, tipo, e_tag, sigla) values ('D', 'OE-ANA-092026.pdf', 'evidencia', 'ed1', 'OE')`)
await como('anon', null, () => db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb)`, [EXEC,
  JSON.stringify([{ sp_id: 'D', e_tag: 'ed1', sha256: 'h4', status: 'ok', texto: 'texto D' }])]))
ok((await db.query(`select analise_status from sp_pep_documentos where sp_id = 'D'`)).rows[0].analise_status === 'aguardando', 'documento novo entra como "aguardando"')
await como('anon', null, () => db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb)`, [EXEC,
  JSON.stringify([{ sp_id: 'A', e_tag: 'ea9', sha256: 'h1-novo', status: 'ok', texto: 'texto A novo' }])]))
const a = (await db.query(`select analise_status, veredito, auditoria_lote from sp_pep_documentos where sp_id = 'A'`)).rows[0]
ok(a.analise_status === 'aguardando' && a.veredito === null && a.auditoria_lote === null, 'conteúdo novo de um auditado volta a "aguardando"')

console.log('Réguas')
const v1 = (await db.query(`select sigla, versao from pep_reguas_versoes order by sigla`)).rows
ok(v1.length === 3 && v1.every(r => r.versao === 1), `v1 de ETC, OE, PIC (${v1.map(r => r.sigla).join(',')})`)
ok(!!(await erro(`update pep_reguas_versoes set conteudo = 'x' where sigla = 'PIC'`)), 'append-only: UPDATE recusado (até para o dono)')
ok(!!(await erro(`delete from pep_reguas_versoes where sigla = 'PIC'`)), 'append-only: DELETE recusado')
ok(!!(await como('authenticated', AUD, () => erro(`select public.sp_pep_regua_publicar('PIC', 'Nova régua do PIC com mais de vinte letras', 'teste')`))), 'quem só acessa a tela não publica (42501)')
ok(!!(await como('authenticated', AUD, () => erro(`insert into pep_reguas_versoes(sigla, versao, conteudo, publicado_por_nome) values ('PIC', 9, 'Régua inserida direto sem a RPC', 'x')`))), 'INSERT direto recusado')
ok(!!(await como('authenticated', RP, () => erro(`select public.sp_pep_regua_publicar('PIC', 'Nova régua do PIC com mais de vinte letras', '')`))), 'nota obrigatória')
ok(!!(await como('authenticated', RP, () => erro(`select public.sp_pep_regua_publicar('XYZ', 'Nova régua do PIC com mais de vinte letras', 'n')`))), 'sigla inválida recusada')
const pub = await como('authenticated', RP, () => db.query(`select public.sp_pep_regua_publicar('pic', 'Nova régua do PIC com mais de vinte letras', 'ajuste') j`))
ok(pub.rows[0].j.versao === 2 && pub.rows[0].j.sigla === 'PIC', 'RP publica: PIC v2')
const pubTap = await como('authenticated', RP, () => db.query(`select public.sp_pep_regua_publicar('TAP', 'Primeira régua do TAP com mais de vinte letras', 'chegou') j`))
ok(pubTap.rows[0].j.versao === 1, 'sigla nova começa na v1 (TAP)')
ok((await db.query(`select publicado_por_nome from pep_reguas_versoes where sigla = 'PIC' and versao = 2`)).rows[0].publicado_por_nome === 'Rita RP', 'quem publicou fica registrado')

console.log('Leitura por papel')
ok(!!(await como('anon', null, () => erro(`select * from pep_reguas_versoes`))), 'anon não lê réguas')
ok((await como('authenticated', SEM, () => db.query(`select * from pep_reguas_versoes`))).rows.length === 0, 'sem permissão não vê régua')
ok((await como('authenticated', AUD, () => db.query(`select * from pep_reguas_versoes`))).rows.length >= 4, 'permissão da tela vê as réguas')
ok((await como('authenticated', AUD, () => db.query(`select * from sp_pep_documentos`))).rows.length === 4, 'permissão da tela vê os documentos')
ok((await como('authenticated', AUD, () => db.query(`select * from sp_pep_itens`))).rows.length === 4, 'permissão da tela vê os itens')
ok((await como('authenticated', AUD, () => db.query(`select * from sp_pep_pastas`))).rows.length === 1, 'permissão da tela vê as pastas')
ok((await como('authenticated', AUD, () => db.query(`select * from sp_pep_prestadores`))).rows.length === 1, 'permissão da tela vê os prestadores')
ok(!!(await como('authenticated', AUD, () => erro(`select * from sp_pep_documentos_texto`))), 'permissão da tela NÃO lê o texto')
ok((await como('authenticated', SEM, () => db.query(`select * from sp_pep_documentos`))).rows.length === 0, 'sem permissão não vê documento')
ok(!!(await como('authenticated', AUD, () => erro(`update sp_pep_documentos set analise_status = 'pendente'`))), 'login não põe na fila direto (só a rota do servidor)')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
