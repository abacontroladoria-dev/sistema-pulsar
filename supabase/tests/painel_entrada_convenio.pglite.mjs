// Teste de segurança/execução da migration 20261013100000 no PGlite (Postgres
// de verdade em Node, sem Docker). Fase de segurança do Painel de Entrada de
// Pacientes de Convênio.
//
// Prova: a migration roda e reroda; anon e authenticated não leem as tabelas
// por fora nem executam RPC nenhuma; só quem tem a permissão lê snapshots;
// registrar grava snapshot novo só quando muda, recusa JSON torto sem gravar,
// abre e resolve alertas; o selo de disponibilidade casa pelo nome completo.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   node <repo>/supabase/tests/painel_entrada_convenio.pglite.mjs //     <repo>/supabase/migrations/20261013100000_painel_entrada_convenio.sql
// (com NODE_PATH apontando para o node_modules de /tmp/pg, ou copiando o .mjs para lá)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , migPath, migPath2] = process.argv
const mig = readFileSync(migPath, 'utf8')
const mig2 = migPath2 ? readFileSync(migPath2, 'utf8') : null // 20261015130000: cruzamento de nomes

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}

const COM = '00000000-0000-0000-0000-00000000000a' // indicadores_entrada_convenio
const SEM = '00000000-0000-0000-0000-00000000000b' // nenhuma permissão

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase concede tudo por padrão em public: o revoke da migration é que fecha.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
revoke all on function public.usuario_tem_permissao(text) from public, anon;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

-- Pré-existentes no banco real (shape mínimo usado pela migration).
create table public.feriados(data date unique, nome text, tipo text);
create table public.pacientes(id_paciente bigint primary key, nome text, nome_normalizado text,
  cpf text, ativo boolean default true, ficticio boolean default false);
-- O real usa unaccent; aqui basta minúsculo + espaço colapsado.
create function public.normalizar_nome_paciente(p_nome text) returns text language sql stable as $$
  select nullif(regexp_replace(lower(coalesce(p_nome,'')), '\\s+', ' ', 'g'), '') $$;
create table public.pacientes_disponibilidade_versoes(id bigint generated always as identity primary key,
  paciente_id bigint, numero_versao int, origem text, criado_em timestamptz default now());
create table public.alertas_regras(codigo text primary key, modulo text, nome text, setor_destino text,
  prioridade text default 'media', tolerancia_minutos int, ativo boolean default true,
  criado_em timestamptz default now(), atualizado_em timestamptz default now());
create table public.alertas(id uuid primary key default gen_random_uuid(), modulo text, regra_codigo text,
  origem text, entidade_tipo text, entidade_id text, entidade_ref jsonb, titulo text, descricao text,
  prioridade text, status text default 'aberto', setor_destino text, resolvido_em timestamptz,
  resolucao text, fingerprint text not null, criado_em timestamptz default now(), atualizado_em timestamptz default now());
create unique index uq_alertas_fingerprint_aberto on public.alertas(fingerprint) where status <> 'resolvido';
create table public.alertas_eventos(id bigserial primary key, alerta_id uuid, entidade_tipo text,
  entidade_id text, tipo text, autor_tipo text, autor_nome text, descricao text);

insert into public.usuarios values ('${COM}', 'Com Permissão', 'recepcao', true), ('${SEM}', 'Sem Permissão', 'recepcao', true);
insert into public.usuarios_permissoes values ('${COM}', 'indicadores_entrada_convenio', true);
insert into public.pacientes(id_paciente, nome, nome_normalizado, cpf) values
  (1, 'Ana Teste Um',      'ana teste um',      '11122233344'),
  (2, 'Bruno Teste Dois',  'bruno teste dois',  null),
  (3, 'Carla Repetida',    'carla repetida',    '22233344455'),
  (4, 'Carla Repetida',    'carla repetida',    '33344455566'),
  (5, 'Davi Teste Quatro', 'davi teste quatro', '444.555.666-77'),
  (6, 'Eva Ficticia',      'eva ficticia',      '55566677788');
update public.pacientes set ficticio = true where id_paciente = 6;
insert into public.pacientes(id_paciente, nome, nome_normalizado, cpf) values
  (7,  'Pietro Teste Silva Gomes',                'pietro teste silva gomes',                '66677788899'),
  (8,  'Maria Estela Teste Povoleri Marins',      'maria estela teste povoleri marins',      '77788899900'),
  (9,  'Ana Maria Souza Lima',                    'ana maria souza lima',                    '88899900011'),
  (10, 'Joao Pedro Silva Alves',                  'joao pedro silva alves',                  '99900011122'),
  (11, 'Joao Pedro Silva Barbosa',                'joao pedro silva barbosa',                '00011122233');
insert into public.pacientes_disponibilidade_versoes(paciente_id, numero_versao, origem) values
  (1, 1, 'equipe'), (1, 2, 'formulario');
`)

console.log('1. migration executa (e reexecuta)')
await db.exec(mig)
ok(true, 'primeira execução')
await db.exec(mig)
ok(true, 'segunda execução (idempotente)')
if (mig2) {
  await db.exec(mig2)
  ok(true, 'migration do cruzamento de nomes: primeira execução')
  await db.exec(mig2)
  ok(true, 'migration do cruzamento de nomes: segunda execução (idempotente)')
}
const regras = await db.query(`select count(*)::int n from public.alertas_regras where codigo like 'painel_entrada_convenio%'`)
ok(regras.rows[0].n === 2, 'duas regras de alerta, sem duplicar')

async function como(papel, uid = '', role = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set request.jwt.claim.role = '${role}'; set role ${papel};`)
}

const etapas = ['E0','E1','E2','E3','E4','E5','E6','E7'].map((etapa, i) => ({ etapa, nome: `Etapa ${i}`, prazo: 1 }))
const pac = (nome, situacao = 'em andamento') => ({ paciente: nome, situacao, atual: { etapa: 'E2' }, historico: [] })
const hoje = (await db.query(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0].d
const dados = (extra = {}) => JSON.stringify({
  gerado_em: hoje, versao_fluxo: 4, resumo: {}, setores: {}, etapas,
  pacientes: [pac('Ana Teste Um'), pac('Bruno Teste Dois'), pac('Carla Repetida'), pac('Davi Teste Quatro'),
              pac('Eva Ficticia'), pac('Fulano Sem Cadastro'), pac('Gil Encerrado', 'encerrado'),
              pac('Pietro Teste Silva Gomes (ABA)'), pac('Pietro Teste Silva Gomes (Neuro)'), pac('Maria Estela Teste'),
              pac('Ana Maria'), pac('Joao Pedro Silva')],
  ...extra,
})

console.log('2. anon')
await como('anon')
for (const t of ['painel_entrada_convenio_config', 'painel_entrada_convenio_snapshots', 'painel_entrada_convenio_leituras']) {
  ok(await erro(`select * from public.${t}`), `anon não lê ${t}`)
}
for (const f of [
  `public.painel_entrada_convenio_atual()`,
  `public.painel_entrada_convenio_registrar('cron', '{}'::jsonb, null, null)`,
  `public.painel_entrada_convenio_registrar_ignorado('cron', 'x')`,
  `public.painel_entrada_convenio_dias_uteis_atras(current_date)`,
  `public.painel_entrada_convenio_abrir_alerta('a','b','c')`,
  `public.painel_entrada_convenio_resolver_alerta('a')`,
  `public.fn_painel_entrada_convenio_disparar()`,
]) {
  ok(await erro(`select ${f}`), `anon não executa ${f.split('(')[0]}`)
}

console.log('3. authenticated (com e sem permissão)')
await como('authenticated', COM, 'authenticated')
ok(await erro(`select public.painel_entrada_convenio_atual()`), 'authenticated não executa a RPC da tela (só a rota, com service_role)')
ok(await erro(`select public.painel_entrada_convenio_registrar('cron', '{}'::jsonb, null, null)`), 'authenticated não registra leitura')
ok(await erro(`select public.fn_painel_entrada_convenio_disparar()`), 'authenticated não dispara a Edge Function')
ok(await erro(`select * from public.painel_entrada_convenio_config`), 'authenticated não lê a config')
ok(await erro(`select * from public.painel_entrada_convenio_leituras`), 'authenticated não lê as leituras')
ok(await erro(`insert into public.painel_entrada_convenio_snapshots(gerado_em, versao_fluxo, hash, dados) values (current_date, 4, 'x', '{}')`),
  'authenticated não grava snapshot direto')

console.log('4. service_role registra')
await como('service_role', '', 'service_role')
let r = (await db.query(`select public.painel_entrada_convenio_registrar('cron', $1::jsonb, now(), null) r`, [dados()])).rows[0].r
ok(r.status === 'novo', 'primeira leitura grava snapshot novo')
r = (await db.query(`select public.painel_entrada_convenio_registrar('cron', $1::jsonb, now(), null) r`, [dados()])).rows[0].r
ok(r.status === 'sem_mudanca', 'mesmo conteúdo não vira linha nova')
let n = (await db.query(`select count(*)::int n from public.painel_entrada_convenio_snapshots`)).rows[0].n
ok(n === 1, 'um snapshot só')

r = (await db.query(`select public.painel_entrada_convenio_registrar('cron', '{"gerado_em":"x"}'::jsonb, null, null) r`)).rows[0].r
ok(r.status === 'erro', 'JSON fora da forma é recusado')
n = (await db.query(`select count(*)::int n from public.painel_entrada_convenio_snapshots`)).rows[0].n
ok(n === 1, 'recusa não grava snapshot')
let al = (await db.query(`select count(*)::int n from public.alertas where regra_codigo = 'painel_entrada_convenio_falhou' and status = 'aberto'`)).rows[0].n
ok(al === 1, 'falha abre alerta')
await db.query(`select public.painel_entrada_convenio_registrar('cron', null, null, 'ClickUp 401')`)
al = (await db.query(`select count(*)::int n from public.alertas where regra_codigo = 'painel_entrada_convenio_falhou'`)).rows[0].n
ok(al === 1, 'segunda falha do dia não duplica o alerta')
await db.query(`select public.painel_entrada_convenio_registrar('manual', $1::jsonb, now(), null)`, [dados()])
al = (await db.query(`select count(*)::int n from public.alertas where regra_codigo = 'painel_entrada_convenio_falhou' and status = 'aberto'`)).rows[0].n
ok(al === 0, 'leitura boa resolve o alerta de falha')

// Rodada velha: gerado_em há 10 dias corridos (>1 dia útil) abre o alerta de desatualizado.
const velho = (await db.query(`select ((now() at time zone 'America/Sao_Paulo')::date - 10)::text d`)).rows[0].d
await db.exec(`delete from public.painel_entrada_convenio_leituras; delete from public.painel_entrada_convenio_snapshots;`)
r = (await db.query(`select public.painel_entrada_convenio_registrar('cron', $1::jsonb, now(), null) r`, [dados({ gerado_em: velho })])).rows[0].r
ok(r.dias_uteis_atras > 1, 'dias úteis contados desde a rodada velha')
al = (await db.query(`select count(*)::int n from public.alertas where regra_codigo = 'painel_entrada_convenio_desatualizado' and status = 'aberto'`)).rows[0].n
ok(al === 1, 'rodada velha abre alerta de desatualizado')
await db.query(`select public.painel_entrada_convenio_registrar('cron', $1::jsonb, now(), null)`, [dados()])
al = (await db.query(`select count(*)::int n from public.alertas where regra_codigo = 'painel_entrada_convenio_desatualizado' and status = 'aberto'`)).rows[0].n
ok(al === 0, 'rodada de hoje resolve o desatualizado')

console.log('5. leitura da tela (service_role)')
const tela = (await db.query(`select public.painel_entrada_convenio_atual() t`)).rows[0].t
ok(tela.snapshot?.gerado_em === hoje && tela.desatualizado === false, 'devolve a rodada mais recente e frescor')
ok(tela.ultima_leitura?.status === 'novo', 'devolve a última leitura')
const selo = Object.fromEntries(tela.disponibilidade.map(d => [d.nome, d]))
ok(selo['Ana Teste Um']?.estado === 'preenchida_familia' && selo['Ana Teste Um'].paciente_id === 1, 'última versão do formulário = preenchida pela família')
ok(selo['Bruno Teste Dois']?.estado === 'sem_cpf', 'cadastro sem CPF')
ok(selo['Carla Repetida']?.estado === 'nome_ambiguo' && selo['Carla Repetida'].paciente_id === null, 'nome repetido no cadastro')
ok(selo['Davi Teste Quatro']?.estado === 'nao_preenchida', 'CPF mascarado conta como válido; nada enviado')
ok(selo['Eva Ficticia']?.estado === 'sem_cadastro', 'paciente fictício não casa')
ok(selo['Fulano Sem Cadastro']?.estado === 'sem_cadastro', 'sem cadastro')
ok(!selo['Gil Encerrado'], 'encerrado fica fora do selo')
const json = JSON.stringify(tela.disponibilidade)
ok(!/\d{11}|\d{3}\.\d{3}\.\d{3}|_inicio|_fim/.test(json), 'selo não expõe CPF nem horários')

if (mig2) {
  console.log('5b. cruzamento tolerante de nomes')
  ok(selo['Pietro Teste Silva Gomes (ABA)']?.paciente_id === 7 && selo['Pietro Teste Silva Gomes (Neuro)']?.paciente_id === 7,
    'sufixo (ABA)/(Neuro) ignorado: as duas linhas casam com o mesmo paciente')
  ok(selo['Pietro Teste Silva Gomes (ABA)']?.casamento === 'exato', 'sufixo ignorado conta como casamento exato')
  ok(selo['Maria Estela Teste']?.paciente_id === 8 && selo['Maria Estela Teste'].casamento === 'inicio_do_nome',
    'nome do ClickUp que é o começo do nome do cadastro casa e é marcado como inicio_do_nome')
  ok(selo['Ana Maria']?.estado === 'sem_cadastro', 'nome de só 2 palavras NÃO casa pelo começo (evita falso positivo)')
  ok(selo['Joao Pedro Silva']?.estado === 'nome_ambiguo' && selo['Joao Pedro Silva'].paciente_id === null,
    'começo que combina com mais de um paciente vira nome_ambiguo')
  ok(selo['Ana Teste Um']?.casamento === 'exato', 'casamento por nome inteiro continua exato')
  ok(selo['Fulano Sem Cadastro']?.casamento === null || selo['Fulano Sem Cadastro']?.casamento === undefined, 'sem cadastro não tem casamento')
}

console.log('6. RLS dos snapshots (leitura direta)')
await como('authenticated', COM, 'authenticated')
n = (await db.query(`select count(*)::int n from public.painel_entrada_convenio_snapshots`)).rows[0].n
ok(n > 0, 'com permissão lê os snapshots')
await como('authenticated', SEM, 'authenticated')
n = (await db.query(`select count(*)::int n from public.painel_entrada_convenio_snapshots`)).rows[0].n
ok(n === 0, 'sem permissão não vê snapshot nenhum')

await db.exec('reset role')
await db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
