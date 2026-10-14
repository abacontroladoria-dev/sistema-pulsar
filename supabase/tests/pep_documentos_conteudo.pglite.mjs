// Teste da migration 20261014110000 (pep_documentos_conteudo) no PGlite.
//
// SEGURANÇA ("os dados não podem vazar"):
//   • anon não lê nenhuma das três tabelas;
//   • login SEM permissão não vê documento nenhum (RLS);
//   • login COM permissão vê documentos e pares, mas NUNCA o texto;
//   • ninguém logado executa as RPCs do robô, a consolidação ou o expurgo;
//   • RPC do robô sem token válido falha;
//   • revisar exige rp/admin.
// COMPORTAMENTO:
//   • robô: a_ler → registrar → a_ler vazio; mesmo conteúdo (renomeado) não
//     zera análise nem revisão; conteúdo novo zera, reabre a revisão (com
//     histórico) e apaga os pares;
//   • indicação: errado / pode_conter_erros / bom / ilegivel; par marcado
//     como alarme falso sai da conta;
//   • expurgo apaga só o texto vencido.
//
// Rodar FORA do repo:
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/pep_documentos_conteudo.pglite.mjs .
//   node pep_documentos_conteudo.pglite.mjs <repo>/supabase/migrations/20261014110000_pep_documentos_conteudo.sql

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const arquivo = process.argv[2]
if (!arquivo) { console.error('uso: node pep_documentos_conteudo.pglite.mjs <migration>'); process.exit(2) }

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

const COM = '00000000-0000-0000-0000-00000000000a' // relacionamento_prestador_pep (leitura)
const SEM = '00000000-0000-0000-0000-00000000000b' // nenhuma permissão
const RP = '00000000-0000-0000-0000-00000000000c'  // role rp: lê (via grupo) e revisa

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

-- Iguais às do banco (20261001120000 / 20260813100000), no essencial.
create function public.sp_pep_pode_escrever() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true and u.role in ('rp','admin')) $$;
revoke all on function public.sp_pep_pode_escrever() from public, anon;
grant execute on function public.sp_pep_pode_escrever() to authenticated;
create function public.robo_autenticar(p_token text) returns text language plpgsql security definer set search_path = public as $$
begin
  if p_token is distinct from 'tok-maquina' then raise exception 'token invalido' using errcode = '28000'; end if;
  return 'maq-1';
end $$;

create table public.sp_pep_itens(sp_id text primary key, nome text not null, tipo text not null, status text not null default 'sugerido',
  e_tag text, tamanho bigint, criado_em_sp timestamptz default now(), removido_em timestamptz, sigla text);
create table public.sp_pep_execucoes(id uuid primary key, versao text);
create table public.auditoria_worker_config(id boolean primary key, url text, ativo boolean);
create table public.auditoria_reauditoria_fila(id bigint, status text, disponivel_em timestamptz);

insert into public.usuarios values
  ('${COM}', 'Leitora PEP', 'terapeutico', true),
  ('${SEM}', 'Sem permissão', 'terapeutico', true),
  ('${RP}',  'Rita RP', 'rp', true);
insert into public.usuarios_permissoes values
  ('${COM}', 'relacionamento_prestador_pep', true),
  ('${RP}',  'relacionamento_prestador_pep', true);
insert into public.sp_pep_itens(sp_id, nome, tipo, e_tag, sigla) values
  ('A', 'OE-JOAO-092026.docx', 'evidencia', 'ea1', 'OE'),
  ('B', 'OE-LUCAS-092026.docx', 'evidencia', 'eb1', 'OE'),
  ('C', 'foto.heic', 'evidencia', 'ec1', 'OE'),
  ('X', 'planilha.xlsx', 'fora_padrao', 'ex1', null);
insert into public.sp_pep_execucoes values ('11111111-1111-1111-1111-111111111111', '0.5.0');
`)

await db.exec(readFileSync(arquivo, 'utf8'))
const EXEC = '11111111-1111-1111-1111-111111111111'
const doc = (sp, extra = {}) => ({ sp_id: sp, e_tag: `e${sp.toLowerCase()}1`, sha256: `sha-${sp}`, extensao: 'docx', tamanho: 2000, status: 'ok', texto: `texto clínico de ${sp}`, caracteres: 20, ...extra })

console.log('Robô (anon + token da máquina)')
ok(!!(await como('anon', null, () => erro(`select public.robo_pep_documentos_a_ler('errado', 10)`))), 'token inválido é recusado')
const aLer = await como('anon', null, () => db.query(`select public.robo_pep_documentos_a_ler('tok-maquina', 10) j`))
ok(aLer.rows[0].j.total === 3, `a_ler pede as 3 evidências (veio ${aLer.rows[0].j.total})`)
const reg = await como('anon', null, () => db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb) j`,
  [EXEC, JSON.stringify([doc('A'), doc('B'), { sp_id: 'C', e_tag: 'ec1', status: 'formato_nao_suportado', detalhe: '.heic' }, doc('X'), doc('NAO_EXISTE')])]))
ok(reg.rows[0].j.gravados === 3 && reg.rows[0].j.desconhecidos === 2, `registrar grava 3 e recusa 2 que não são evidência (${JSON.stringify(reg.rows[0].j)})`)
const aLer2 = await como('anon', null, () => db.query(`select public.robo_pep_documentos_a_ler('tok-maquina', 10) j`))
ok(aLer2.rows[0].j.total === 0, 'depois de lidas, a_ler não pede de novo')
ok((await db.query(`select veredito, analise_status from sp_pep_documentos where sp_id = 'C'`)).rows[0].veredito === 'ilegivel', 'formato que o robô não lê = ilegivel')
ok((await db.query(`select count(*)::int n from sp_pep_documentos_texto`)).rows[0].n === 2, 'texto só dos que foram lidos')
ok(!!(await como('anon', null, () => erro(`select public.robo_pep_registrar_documentos('errado', $1, '[]'::jsonb)`, [EXEC]))), 'registrar sem token é recusado')

console.log('Leitura por papel')
ok(!!(await como('anon', null, () => erro(`select * from sp_pep_documentos`))), 'anon não lê sp_pep_documentos')
ok(!!(await como('anon', null, () => erro(`select * from sp_pep_documentos_texto`))), 'anon não lê o texto')
ok(!!(await como('anon', null, () => erro(`select * from sp_pep_documentos_semelhancas`))), 'anon não lê semelhanças')
ok((await como('authenticated', SEM, () => db.query(`select * from sp_pep_documentos`))).rows.length === 0, 'login sem permissão não vê documento nenhum')
ok((await como('authenticated', COM, () => db.query(`select * from sp_pep_documentos`))).rows.length === 3, 'login com permissão vê os documentos')
ok(!!(await como('authenticated', COM, () => erro(`select * from sp_pep_documentos_texto`))), 'login COM permissão também NÃO lê o texto')
ok(!!(await como('authenticated', RP, () => erro(`select * from sp_pep_documentos_texto`))), 'RP não lê o texto')
ok(!!(await como('authenticated', COM, () => erro(`update sp_pep_documentos set veredito = 'bom'`))), 'login não escreve direto na tabela')
ok(!!(await como('authenticated', RP, () => erro(`select public.robo_pep_documentos_a_ler('tok-maquina', 10)`))), 'login não executa RPC do robô')
ok(!!(await como('authenticated', RP, () => erro(`select public.sp_pep_documentos_consolidar(null)`))), 'login não executa a consolidação')
ok(!!(await como('authenticated', RP, () => erro(`select public.sp_pep_documentos_expurgar_texto()`))), 'login não executa o expurgo')
ok(!!(await como('anon', null, () => erro(`select public.sp_pep_documento_revisar('A', 'corrigido', null)`))), 'anon não revisa')

console.log('Indicação (service_role analisa e consolida)')
await db.exec(`
  update sp_pep_documentos set analise_status = 'concluida', achados = '[{"nivel":"errado","codigo":"lacuna_do_modelo"}]' where sp_id = 'A';
  update sp_pep_documentos set analise_status = 'concluida', achados = '[]', ia_achados = '[{"nivel":"atencao","codigo":"ia"}]' where sp_id = 'B';
  select public.sp_pep_documentos_consolidar(null);`)
let v = Object.fromEntries((await db.query(`select sp_id, veredito from sp_pep_documentos`)).rows.map(r => [r.sp_id, r.veredito]))
ok(v.A === 'errado' && v.B === 'pode_conter_erros' && v.C === 'ilegivel', `errado / pode conter erros / ilegivel (${JSON.stringify(v)})`)
await db.exec(`update sp_pep_documentos set ia_achados = '[]' where sp_id = 'B'; select public.sp_pep_documentos_consolidar(array['B']);`)
ok((await db.query(`select veredito from sp_pep_documentos where sp_id = 'B'`)).rows[0].veredito === 'bom', 'sem achado = bom')
await db.exec(`insert into sp_pep_documentos_semelhancas(a_sp_id, b_sp_id, tipo, similaridade, relacao, nivel) values ('A','B','parecido',0.91,'outro_paciente','errado');
  select public.sp_pep_documentos_consolidar(array['A','B']);`)
ok((await db.query(`select veredito from sp_pep_documentos where sp_id = 'B'`)).rows[0].veredito === 'errado', 'cópia ≥ 80% deixa os dois documentos errados')

console.log('Revisão por pessoa')
ok(!!(await como('authenticated', COM, () => erro(`select public.sp_pep_semelhanca_revisar('B', 'A', 'falso_positivo', 'são irmãos')`))), 'só leitura não revisa (42501)')
await como('authenticated', RP, () => db.query(`select public.sp_pep_semelhanca_revisar('B', 'A', 'falso_positivo', 'são irmãos')`))
ok((await db.query(`select veredito from sp_pep_documentos where sp_id = 'B'`)).rows[0].veredito === 'bom', 'alarme falso tira o par da conta (B volta a bom)')
ok((await db.query(`select revisao_por_nome from sp_pep_documentos_semelhancas`)).rows[0].revisao_por_nome === 'Rita RP', 'quem revisou fica registrado')
await como('authenticated', RP, () => db.query(`select public.sp_pep_documento_revisar('A', 'problema_confirmado', 'avisado')`))
const a = (await db.query(`select revisao_status, historico from sp_pep_documentos where sp_id = 'A'`)).rows[0]
ok(a.revisao_status === 'problema_confirmado' && a.historico.length === 1, 'revisão do documento com histórico')
ok(!!(await como('authenticated', RP, () => erro(`select public.sp_pep_documento_revisar('A', 'qualquer', null)`))), 'status inválido é recusado')

console.log('Arquivo renomeado × conteúdo novo')
await como('anon', null, () => db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb)`, [EXEC, JSON.stringify([doc('A', { e_tag: 'ea2' })])]))
let a2 = (await db.query(`select e_tag, revisao_status, analise_status from sp_pep_documentos where sp_id = 'A'`)).rows[0]
ok(a2.e_tag === 'ea2' && a2.revisao_status === 'problema_confirmado' && a2.analise_status === 'concluida', 'mesmo SHA (renomeado): só o eTag muda; análise e revisão ficam')
await como('anon', null, () => db.query(`select public.robo_pep_registrar_documentos('tok-maquina', $1, $2::jsonb)`, [EXEC, JSON.stringify([doc('A', { e_tag: 'ea3', sha256: 'sha-A-novo' })])]))
a2 = (await db.query(`select revisao_status, analise_status, veredito, historico from sp_pep_documentos where sp_id = 'A'`)).rows[0]
ok(a2.revisao_status === 'pendente' && a2.analise_status === 'pendente' && a2.veredito === null, 'conteúdo novo: análise do zero e revisão reaberta')
ok(a2.historico.some(h => h.acao === 'conteudo_mudou'), 'reabertura fica no histórico')
ok((await db.query(`select count(*)::int n from sp_pep_documentos_semelhancas`)).rows[0].n === 0, 'pares do documento alterado são refeitos (apagados)')

console.log('Expurgo do texto (90 dias)')
await db.exec(`update sp_pep_documentos_texto set expira_em = now() - interval '1 day' where sp_id = 'B'`)
const exp = (await db.query(`select public.sp_pep_documentos_expurgar_texto() n`)).rows[0].n
ok(exp === 1 && (await db.query(`select count(*)::int n from sp_pep_documentos_texto`)).rows[0].n === 1, 'apaga só o texto vencido')
ok((await db.query(`select count(*)::int n from sp_pep_documentos where sp_id = 'B'`)).rows[0].n === 1, 'documento e achados ficam')
ok((await db.query(`select quando from cron.job where nome = 'pep-documentos-expurgar-texto'`)).rows.length === 1, 'expurgo agendado no pg_cron')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
