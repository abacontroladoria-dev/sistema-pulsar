// Teste da migration 20261016180000 (Evoluções Terapêuticas e Registro de Faltas na Grade)
// no PGlite (Postgres real em Node).
//
// Valida:
//   1. Controle de acesso estrito: apenas role = 'admin' pode evoluir/marcar falta/limpar
//      (nem 'diretoria' nem 'cronograma' podem).
//   2. Espelhamento inicial do TiTa (csv_grades_profissionais → grade_evolucoes) com
//      origem = 'tita_importacao' (evolução e falta existentes no TiTa).
//   3. Registro de evolução pelo Admin:
//      - Captura automática do nome ("Sanderson Rodrigues") sem escolha manual;
//      - Vínculo e substituição detectados corretamente;
//      - Funciona inclusive em data passada (sem ser barrado pelo trigger de congelamento de grade_agendamentos).
//   4. Carimbo do profissional retornando em grade_detalhe_evolucao (assinatura_path + conselho).
//   5. Registro de falta ('Falta do paciente' / 'Falta do profissional') e reversão/limpeza pelo Admin.
//   6. Detecção de Inconsistência (recepção marcou falta em fila_autorizacoes + sessão evoluída):
//      - Para 'admin': retorna falta_recepcao = true E possui_tratativa = true E inconsistencia = true;
//      - Para não-admin: mascara a inconsistência (inconsistencia = false, possui_tratativa = false,
//        status_execucao = 'Cancelado', sem expor texto da evolução nem que houve conflito).
//   7. Soberania do Pulsar: reimportação do TiTa (sp_grade_espelhar_evolucoes_tita) NÃO sobrescreve
//      evolução ou falta registrada no Pulsar (origem = 'pulsar').
//   8. View vw_grade_execucao_pulsar pronta para RP e Central de Pacientes.
//   9. 20261019200300: grade_evolucoes guarda o histórico do TiTa sem sessão na
//      Grade (chave própria, agendamento_id opcional), arquivado por gatilho a
//      partir da csv_grades_profissionais — e TUDO acima continua valendo com ela
//      aplicada (ela entra logo depois da 20261019120000).

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'fs'

const [, , repo = '.'] = process.argv
const migDir = `${repo}/supabase/migrations`
const arquivo = prefixo => readFileSync(`${migDir}/${readdirSync(migDir).find(f => f.startsWith(prefixo))}`, 'utf8')

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}
const um = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const todos = async (sql, params = []) => (await db.query(sql, params)).rows

const ADMIN = '00000000-0000-0000-0000-0000000000a1'
const ADMIN_SUB = '00000000-0000-0000-0000-0000000000a2'
const DIRETORIA = '00000000-0000-0000-0000-0000000000d1'
const EDITOR = '00000000-0000-0000-0000-0000000000b1'
const SEM_PERM = '00000000-0000-0000-0000-0000000000c1'

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.usuarios(id uuid primary key, nome text, email text, role text, ativo boolean default true);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text, permitido boolean);
create or replace function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria'))
  or exists (select 1 from public.usuarios_permissoes up join public.usuarios u on u.id = up.usuario_id
             where up.usuario_id = auth.uid() and up.permissao_codigo = p_codigo and up.permitido and u.ativo) $$;
create or replace function public.remuneracao_has_role(p text[]) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role = any(p)) $$;
create or replace function public.hoje_brasilia() returns date language sql stable as $$ select current_date $$;
create or replace function public.normalizar_nome_paciente(p text) returns text language sql immutable as $$
  select lower(btrim(regexp_replace(translate(coalesce(p, ''), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooooucAAAAEEIOOOUC'), '\\s+', ' ', 'g'))) $$;

create table public.cadastros_auditoria (
  id uuid primary key default gen_random_uuid(), tabela text not null, registro_id text not null, acao text not null,
  paciente_id bigint, paciente_nome text, convenio_nome text, alvo_nome text, antes jsonb, depois jsonb,
  resumo text, motivo text, usuario_id uuid, usuario_nome text,
  criado_em timestamptz not null default now(), criado_em_brasilia text);
create table public.pacientes (
  id_paciente bigint generated always as identity primary key, tita_paciente_id bigint unique,
  nome text not null, ficticio boolean default false, ativo boolean default true, falecido boolean default false,
  convenio_id integer, convenio_nome text, carteirinha text);
create table public.feriados (data date, nome text, tipo text, horario_inicio text, horario_fim text);
create table public.cadastros_pacientes_alta_clinica (id_paciente_pulsar bigint, ativo boolean, data_alta_clinica date);
create table public.cronograma_capacidade_profissional_dia (profissional_nome text, dow int, capacidade int);
create table public.pacientes_disponibilidade_versoes (paciente_id bigint, numero_versao int, criado_em timestamptz);
create table public.pacientes_importacoes_log (id uuid primary key default gen_random_uuid(), origem text);
create table public.csv_grades_profissionais (
  id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint, data date,
  hora_inicial time, hora_final time, paciente_id bigint, paciente_nome text,
  profissional_id bigint, profissional_nome text, profissional_cpf text,
  terapia_id bigint, terapia_nome text, terapia_exibicao_id bigint, terapia_exibicao_nome text,
  sala_nome text, unidade_id integer default 280, status_agendamento text default 'Agendado',
  status_execucao text, justificativa text, tipo_falta text, possui_tratativa boolean default false,
  tratativa_profissional_id bigint, tratativa_profissional_nome text, tratativa_criada_em timestamptz,
  tratativa_origem text, evolucao_vinculo text, descricao_evolucao text,
  tratativas smallint, tratativas_distintas smallint,
  modalidade text, convenio_id integer, convenio_nome text, carteirinha text, tipo_atendimento text,
  ativo boolean default true, updated_at timestamptz default now());
create table public.grade_profissionais_tita (
  profissional_id bigint, data date, numero_telefone text, cbo_profissional text, registro_profissional text,
  tipo_registro_profissional text, uf_registro_profissional text);
create table public.cronograma_salas (
  id uuid primary key default gen_random_uuid(), nome_exibicao text, unidade_nome text, numero_sala text,
  capacidade text default 'unico', status text default 'ativa', sala_nome_referencia text);
create table public.cronograma_salas_terapias_exclusivas (sala_id uuid, terapia_id bigint, terapia_nome text, modo text);
create table public.fila_autorizacoes (
  id uuid primary key default gen_random_uuid(), tita_agendamento_id bigint, paciente_id bigint,
  paciente_nome text, data_atendimento date, horario text, terapia_nome text,
  status text default 'aguardando', tipo_falta text, falta_revertida_em timestamptz);

insert into public.usuarios values
  ('${ADMIN}', 'Sanderson Rodrigues', 'sanderson@pulsar.com', 'admin', true),
  ('${ADMIN_SUB}', 'Carla Substituta', 'carla@pulsar.com', 'admin', true),
  ('${DIRETORIA}', 'Diana Diretora', 'diana@pulsar.com', 'diretoria', true),
  ('${EDITOR}', 'Edu Editor', 'edu@pulsar.com', 'cronograma', true),
  ('${SEM_PERM}', 'Olga Outra', 'olga@pulsar.com', 'recepcao', true);
insert into public.usuarios_permissoes values
  ('${EDITOR}', 'cronograma_grade', true),
  ('${SEM_PERM}', 'cadastros_pacientes', true);
`)

console.log('1. Cadeia de migrations até 20261016180000')
for (const p of ['20261006120000', '20261006120100', '20261006130000', '20261006140000', '20261006170000',
                 '20261005170000', '20261008100000', '20261008100100', '20261008100200', '20261008100300',
                 '20261015190000', '20261016100000', '20261016120000_seguranca']) {
  await db.exec(arquivo(p))
}

// Prepara profissionais, pacientes e sessões (incluindo uma vinda do TiTa antes da migration 180000 para testar o backfill)
await db.exec(`
alter table public.profissionais add column if not exists assinatura_path text, add column if not exists foto_path text;
insert into public.profissionais (nome, tita_profissional_id, origem, assinatura_path, tipo_registro, uf_registro, codigo_registro)
values
  ('Pedro Terapeuta', 501, 'tita', 'profissionais/1/assinatura-123.png', 'CRP', 'RN', '17/9999'),
  ('Carla Substituta', 502, 'tita', 'profissionais/2/assinatura-456.png', 'CREFONO', 'RN', '8888');

insert into public.pacientes (tita_paciente_id, nome, convenio_nome) values
  (9001, 'Ana Paciente', 'UNIMED'),
  (9002, 'Beto Paciente', 'AMIL');

insert into public.cadastro_terapias (nome) values ('ABA') on conflict on constraint cadastro_terapias_nome_unico do nothing;
`)

const profPedro = await um(`select id from public.profissionais where tita_profissional_id = 501`)
const profCarla = await um(`select id from public.profissionais where tita_profissional_id = 502`)
const pacAna = await um(`select id_paciente from public.pacientes where tita_paciente_id = 9001`)
const pacBeto = await um(`select id_paciente from public.pacientes where tita_paciente_id = 9002`)
const terAba = await um(`select id from public.cadastro_terapias where nome = 'ABA'`)

await db.exec(`
alter table public.grade_agendamentos disable trigger trg_grade_agendamentos_guarda;
insert into public.grade_agendamentos
  (data, hora_inicio, hora_fim, profissional_id, profissional_nome, paciente_id, paciente_nome, terapia_id, terapia_nome, tita_agendamento_id, origem)
values
  (current_date - 2, '08:00', '09:00', ${profPedro.id}, 'Pedro Terapeuta', ${pacAna.id_paciente}, 'Ana Paciente', ${terAba.id}, 'ABA', 70001, 'tita_importacao'),
  (current_date,     '10:00', '11:00', ${profPedro.id}, 'Pedro Terapeuta', ${pacAna.id_paciente}, 'Ana Paciente', ${terAba.id}, 'ABA', 70002, 'tita_importacao'),
  (current_date - 1, '14:00', '15:00', ${profPedro.id}, 'Pedro Terapeuta', ${pacBeto.id_paciente}, 'Beto Paciente', ${terAba.id}, 'ABA', 70003, 'tita_importacao');
alter table public.grade_agendamentos enable trigger trg_grade_agendamentos_guarda;

insert into public.csv_grades_profissionais
  (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome, profissional_id, profissional_nome,
   terapia_id, terapia_nome, status_agendamento, status_execucao, possui_tratativa, tratativa_profissional_id,
   tratativa_profissional_nome, tratativa_criada_em, tratativa_origem, evolucao_vinculo, descricao_evolucao)
values
  (70001, current_date - 2, '08:00', '09:00', 9001, 'Ana Paciente', 501, 'Pedro Terapeuta',
   ${terAba.id}, 'ABA', 'Agendado', 'Realizado', true, 501,
   'Pedro Terapeuta', now() - interval '2 days', 'Prontuario', 'Agendamento ativo', 'Evolução importada do TiTa.');
`)

// Aplica a migration 20261016180000
await db.exec(arquivo('20261016180000'))
ok(true, 'Migration 20261016180000 aplicada com sucesso')
await db.exec(arquivo('20261019120000'))
ok(true, 'Migration 20261019120000 (texto clínico só para admin) aplicada com sucesso')
await db.exec(arquivo('20261019200300'))
await db.exec(arquivo('20261019200300'))
ok(true, 'Migration 20261019200300 (histórico do TiTa na grade_evolucoes) aplicada e reaplicada')
{
  const arq = await todos(`select * from public.grade_evolucoes where agendamento_id is null`)
  ok(arq.length === 1 && arq[0].chave_tita === 'ag:70001' && arq[0].descricao_evolucao === 'Evolução importada do TiTa.'
     && arq[0].origem === 'tita_importacao' && arq[0].tita_paciente_id === 9001 && arq[0].tita_tratativa_profissional_id === 501,
     'Carga inicial: a evolução que a cópia do TiTa já tinha vira linha do arquivo (sem sessão)')
  const espelho = await todos(`select * from public.grade_evolucoes where agendamento_id is not null`)
  ok(espelho.length === 1 && espelho[0].tita_agendamento_id === 70001,
     'O espelho da Grade (com sessão) continua lá, separado do arquivo')
}

const ag1 = await um(`select id from public.grade_agendamentos where tita_agendamento_id = 70001`)
const ag2 = await um(`select id from public.grade_agendamentos where tita_agendamento_id = 70002`)
const ag3 = await um(`select id from public.grade_agendamentos where tita_agendamento_id = 70003`)

console.log('2. Backfill inicial do TiTa')
const evTita = await um(`select * from public.grade_evolucoes where agendamento_id = $1`, [ag1.id])
ok(evTita && evTita.origem === 'tita_importacao' && evTita.possui_tratativa === true, 'Evolução do TiTa espelhada no backfill com origem = tita_importacao')
ok(Number(evTita.tratativa_profissional_id) === Number(profPedro.id), 'tratativa_profissional_id traduzido de tita_profissional_id (501) para id do Pulsar')

console.log('3. Controle de acesso (apenas Admin pode evoluir; nem Diretoria pode)')
async function como(uid, fn) {
  await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`)
  return fn()
}

await como(DIRETORIA, async () => {
  const ac = (await um(`select public.grade_meu_acesso_evolucao() as r`)).r
  ok(ac.pode_evoluir === false && ac.eh_admin === false, 'Diretoria: pode_evoluir = false')
  const e = await erro(`select public.grade_registrar_evolucao($1, 'Tentativa da diretoria')`, [ag2.id])
  ok(e && e.message.includes('Apenas administradores'), 'Diretoria bloqueada ao tentar evoluir')
})

await como(EDITOR, async () => {
  const ac = (await um(`select public.grade_meu_acesso_evolucao() as r`)).r
  ok(ac.pode_evoluir === false, 'Editor de grade: pode_evoluir = false')
  const e = await erro(`select public.grade_registrar_falta($1, 'Falta do paciente')`, [ag2.id])
  ok(e && e.message.includes('Apenas administradores'), 'Editor de grade bloqueado ao tentar marcar falta')
})

console.log('4. Registro de evolução pelo Admin (inclusive em data passada congelada)')
await como(ADMIN, async () => {
  const ac = (await um(`select public.grade_meu_acesso_evolucao() as r`)).r
  ok(ac.pode_evoluir === true && ac.eh_admin === true && ac.usuario_nome === 'Sanderson Rodrigues', 'Admin: pode_evoluir = true e nome captado automaticamente')

  // Evoluir sessão no passado (ag3 = ontem): não pode esbarrar na guarda de grade_agendamentos
  const res = (await um(`select public.grade_registrar_evolucao($1, 'Sessão realizada com excelente engajamento.') as r`, [ag3.id])).r
  ok(res.status_execucao === 'Realizado' && res.tratativa_profissional_nome === 'Sanderson Rodrigues' && res.evolucao_vinculo === 'Agendamento ativo',
     'Evolução em data passada gravada com "Realizado por Sanderson Rodrigues" e vínculo Agendamento ativo')
  ok(res.substituicao === false, 'Sem indicação de substituto: substituicao = false (sem falso selo)')

  // Detalhe traz o carimbo do profissional agendado quando não houve substituição
  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag3.id])).r
  ok(det.carimbo && det.carimbo.assinatura_path === 'profissionais/1/assinatura-123.png' && det.carimbo.codigo_registro === '17/9999',
     'grade_detalhe_evolucao retorna assinatura_path e conselho para exibir o carimbo do agendado')
})

console.log('5. Evolução em Substituição (quando usuário evoluindo tem profissional_id diferente do agendado ou indica substituto)')
// 5a) Admin selecionando profissional substituto explicitamente:
await como(ADMIN, async () => {
  const res = (await um(`select public.grade_registrar_evolucao($1, 'Atendimento realizado por Carla em substituição.', $2) as r`, [ag2.id, profCarla.id])).r
  ok(res.substituicao === true && res.tratativa_profissional_nome === 'Carla Substituta',
     'Admin escolhe profissional substituto: detecta substituicao = true e grava tratativa com Carla')
  ok(res.carimbo && res.carimbo.assinatura_path === 'profissionais/2/assinatura-456.png' && res.carimbo.tipo_registro === 'CREFONO',
     'Em substituição, o carimbo retornado no registro é obrigatoriamente o de quem substituiu (Carla Substituta)')

  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag2.id])).r
  ok(det.carimbo && det.carimbo.assinatura_path === 'profissionais/2/assinatura-456.png' && det.carimbo.profissional_nome === 'Carla Substituta',
     'grade_detalhe_evolucao em substituição entrega carimbo e assinatura de quem substituiu')
})

// 5b) Usuário logado com profissional_id diferente do agendado (futuro terapeuta)
await db.exec(`reset role; update public.usuarios set profissional_id = ${profCarla.id} where id = '${ADMIN_SUB}';`)
await como(ADMIN_SUB, async () => {
  const res = (await um(`select public.grade_registrar_evolucao($1, 'Atendimento realizado em substituição.') as r`, [ag2.id])).r
  ok(res.substituicao === true && res.tratativa_profissional_nome === 'Carla Substituta',
     'Detecta Substituição automaticamente quando profissional_id do usuário logado difere do agendado')

  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag2.id])).r
  ok(det.carimbo && det.carimbo.assinatura_path === 'profissionais/2/assinatura-456.png' && det.carimbo.tipo_registro === 'CREFONO',
     'Em substituição pelo próprio terapeuta, o carimbo exibido é o de quem evoluiu (Carla Substituta)')
})

console.log('6. Inconsistência (Recepção marcou falta + Terapeuta evoluiu) e mascaramento para não-admin')
await db.exec(`
reset role;
insert into public.fila_autorizacoes (tita_agendamento_id, paciente_id, paciente_nome, data_atendimento, horario, terapia_nome, status, tipo_falta)
values (70002, ${pacAna.id_paciente}, 'Ana Paciente', current_date, '10:00:00', 'ABA', 'falta', 'paciente');
`)

// Como Admin: vê a inconsistência (possui_tratativa = true, falta_recepcao = true, inconsistencia = true)
await como(ADMIN, async () => {
  const resumo = await todos(`select * from public.grade_resumo_evolucoes_periodo(current_date - 3, current_date + 1)`)
  const r2 = resumo.find(r => r.agendamento_id === ag2.id)
  ok(r2 && r2.possui_tratativa === true && r2.falta_recepcao === true && r2.inconsistencia === true,
     'Admin vê possui_tratativa = true, falta_recepcao = true e inconsistencia = true')
})

// Como Editor (não-admin): NÃO pode saber que é inconsistência; só vê que a recepção alegou falta
await como(EDITOR, async () => {
  const resumo = await todos(`select * from public.grade_resumo_evolucoes_periodo(current_date - 3, current_date + 1)`)
  const r2 = resumo.find(r => r.agendamento_id === ag2.id)
  ok(r2 && r2.inconsistencia === false && r2.falta_recepcao === true,
     'Não-admin NÃO vê inconsistência no resumo: inconsistencia = false e falta_recepcao = true')

  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag2.id])).r
  ok(det.inconsistencia === false && det.falta_recepcao === true && det.possui_tratativa === true,
     'Não-admin vê o status (inconsistencia = false, falta_recepcao = true, possui_tratativa = true)')
  ok(det.descricao_evolucao === null && det.carimbo === null,
     'Não-admin NÃO recebe o texto clínico da evolução nem o carimbo')
})

// O ajudante `como` usa `set local role`, que não vale fora de transação; por isso as
// permissões de função são conferidas direto no catálogo, sem depender do papel da sessão.
const privFn = async (papel, assinatura) =>
  (await um(`select has_function_privilege($1, $2, 'execute') as p`, [papel, assinatura])).p
const interna = 'public.sp_grade_detalhe_evolucao_interno(uuid)'
const publica = 'public.grade_detalhe_evolucao(uuid)'
ok(!(await privFn('authenticated', interna)) && !(await privFn('anon', interna)),
   'Função interna que devolve o texto completo: sem EXECUTE para authenticated e anon')
ok((await privFn('authenticated', publica)) && !(await privFn('anon', publica)),
   'grade_detalhe_evolucao (com máscara): authenticated executa, anon não')

await como(ADMIN, async () => {
  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag2.id])).r
  ok(det.descricao_evolucao === 'Atendimento realizado em substituição.' && det.carimbo && det.carimbo.profissional_nome,
     'Admin continua recebendo o texto clínico e o carimbo')
})

console.log('7. Registro de Falta (paciente / profissional) e reversão pelo Admin')
await como(ADMIN, async () => {
  const rFalta = (await um(`select public.grade_registrar_falta($1, 'Falta do profissional') as r`, [ag3.id])).r
  ok(rFalta.status_execucao === 'Cancelado' && rFalta.tipo_falta === 'terapeuta' && rFalta.justificativa === 'Não realizado — prestador',
     'Admin altera status para Falta do profissional (Cancelado / terapeuta)')

  const det = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag3.id])).r
  ok(det.possui_tratativa === false && det.status_execucao === 'Cancelado' && det.tipo_falta === 'terapeuta',
     'Detalhe reflete Falta do profissional e zera possui_tratativa')

  // Limpar / reverter registro
  const rLimpo = (await um(`select public.grade_limpar_evolucao($1) as r`, [ag3.id])).r
  ok(rLimpo.registrado === false, 'Admin consegue limpar/reverter o registro da sessão')
  const detDepois = (await um(`select public.grade_detalhe_evolucao($1) as r`, [ag3.id])).r
  ok(detDepois.status_execucao === null && detDepois.possui_tratativa === false, 'Sessão volta ao estado sem registro após limpeza')
})

console.log('8. Soberania do Pulsar na importação do TiTa e View vw_grade_execucao_pulsar')
await db.exec(`
reset role;
-- Tenta mudar no TiTa a sessão 70001 (que era tita_importacao) e a 70002 (que foi evoluída no Pulsar com origem = 'pulsar')
update public.csv_grades_profissionais
set descricao_evolucao = 'Atualização vinda do TiTa'
where tita_agendamento_id = 70001;

insert into public.csv_grades_profissionais
  (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome, profissional_id, profissional_nome,
   terapia_id, terapia_nome, status_agendamento, status_execucao, possui_tratativa, descricao_evolucao)
values
  (70002, current_date, '10:00', '11:00', 9001, 'Ana Paciente', 501, 'Pedro Terapeuta',
   ${terAba.id}, 'ABA', 'Agendado', 'Cancelado', false, 'TiTa dizendo falta');

select public.sp_grade_espelhar_evolucoes_tita(current_date - 5, current_date + 5);
`)

const ev1Depois = await um(`select * from public.grade_evolucoes where agendamento_id = $1`, [ag1.id])
const ev2Depois = await um(`select * from public.grade_evolucoes where agendamento_id = $1`, [ag2.id])
ok(ev1Depois.descricao_evolucao === 'Atualização vinda do TiTa' && ev1Depois.origem === 'tita_importacao',
   'Registro que ainda era tita_importacao atualiza normalmente quando o TiTa muda')
ok(ev2Depois.origem === 'pulsar' && ev2Depois.descricao_evolucao === 'Atendimento realizado em substituição.' && ev2Depois.possui_tratativa === true,
   'Registro criado no Pulsar (origem = pulsar) NUNCA é sobrescrito pela importação do TiTa')

await como(ADMIN, async () => {
  const vw = await todos(`select * from public.vw_grade_execucao_pulsar where agendamento_id = $1`, [ag2.id])
  ok(vw.length === 1 && vw[0].is_substituicao === true && vw[0].tratativa_profissional_nome === 'Carla Substituta' && vw[0].controle_status === 'presente',
     'vw_grade_execucao_pulsar expõe formato compatível com RP e Central de Pacientes')
})

console.log('9. Histórico do TiTa (20261019200300)')
await db.exec(`reset role`)
{
  const totalAntes = (await um(`select count(*)::int n from public.grade_evolucoes where agendamento_id is null`)).n
  await db.exec(`
insert into public.csv_grades_profissionais
  (tita_agendamento_id, data, hora_inicial, hora_final, paciente_id, paciente_nome, profissional_id, profissional_nome,
   terapia_nome, terapia_exibicao_nome, unidade_id, convenio_nome, status_execucao, possui_tratativa,
   tratativa_profissional_id, tratativa_profissional_nome, tratativa_criada_em, descricao_evolucao)
values
  (80001, current_date - 200, '08:00', '08:40', 9002, 'BETO P', 501, 'Pedro', 'AE', 'Psicologia ABA', 280, 'AMIL', 'Realizado', true, 502, 'Carla', now() - interval '200 days', 'Antiga com substituição'),
  (80002, current_date - 200, '09:00', '09:40', 9002, 'BETO P', 501, 'Pedro', 'AE', 'Psicologia ABA', 280, 'AMIL', 'Cancelado', false, null, null, null, null),
  (80003, current_date - 200, '10:00', '10:40', 9002, 'BETO P', 501, 'Pedro', 'AE', 'Psicologia ABA', 999, 'AMIL', 'Realizado', true, 501, 'Pedro', now(), 'Outra unidade'),
  (80004, current_date - 200, '11:00', '11:40', 9002, 'BETO P', 501, 'Pedro', 'AE', 'Psicologia ABA', 280, 'AMIL', 'Em Conflito', true, 501, 'Pedro', now(), 'Em conflito, evoluída'),
  (null,  current_date - 199, '11:00', '11:40', 9002, 'BETO P', 501, 'Pedro', 'AE', 'Psicologia ABA', 280, 'AMIL', null, true, 501, 'Pedro', now(), 'Sem agendamento');
`)
  const arq = await todos(`select * from public.grade_evolucoes where agendamento_id is null order by chave_tita`)
  const porChave = Object.fromEntries(arq.map(a => [a.chave_tita, a]))
  ok(arq.length === totalAntes + 3, `Gatilho arquiva só o que é evolução (+3: 80001, 80004, sem agendamento) → ${arq.length - totalAntes}`)
  ok(porChave['ag:80001']?.tratativa_profissional_id === profCarla.id && porChave['ag:80001']?.tita_profissional_id === 501
     && porChave['ag:80001']?.tita_tratativa_profissional_id === 502 && porChave['ag:80001']?.terapia_exibicao_nome === 'Psicologia ABA'
     && porChave['ag:80001']?.convenio_nome === 'AMIL',
     'Arquivo guarda agendado, executor (substituto), terapia de exibição e convênio')
  ok(porChave['ag:80004']?.status_tita === 'Em Conflito' && porChave['ag:80004']?.status_execucao === 'Realizado', '"Em Conflito" evoluída entra, com o status original guardado')
  ok(!porChave['ag:80002'] && !porChave['ag:80003'], 'Falta e outra unidade não entram')
  const sem = arq.find(a => a.chave_tita.startsWith('sem:'))
  ok(sem && sem.tita_agendamento_id === null && sem.evolucao_vinculo === 'Sem agendamento', '"Sem agendamento" entra com chave própria')

  await db.exec(`update public.csv_grades_profissionais set descricao_evolucao = 'Texto corrigido no TiTa' where tita_agendamento_id = 80001`)
  ok((await um(`select descricao_evolucao d from public.grade_evolucoes where chave_tita = 'ag:80001'`)).d === 'Texto corrigido no TiTa',
     'Edição no TiTa (dentro da janela do sync) atualiza o arquivo, sem duplicar')
  await db.exec(`update public.csv_grades_profissionais set updated_at = now() where tita_agendamento_id = 80001`)
  ok((await um(`select count(*)::int n from public.grade_evolucoes where chave_tita = 'ag:80001'`)).n === 1, 'Reenvio sem mudança não duplica')

  const n = (await um(`select public.sp_grade_evolucoes_arquivar_tita(jsonb_build_array(jsonb_build_object(
    'tita_agendamento_id', 80005, 'paciente_id', 9001, 'paciente_nome', 'ANA', 'data', '2026-01-14', 'hora_inicial', '08:00:00',
    'hora_final', '08:40:00', 'profissional_id', 501, 'profissional_nome', 'Pedro', 'terapia_nome', 'FONO', 'unidade_id', 280,
    'status_execucao', 'Realizado', 'possui_tratativa', true, 'tratativa_profissional_id', 501,
    'tratativa_criada_em', '2026-01-14T09:00:00-03:00', 'descricao_evolucao', 'Carga histórica'))) n`)).n
  ok(n === 1 && (await um(`select data::text d from public.grade_evolucoes where chave_tita = 'ag:80005'`)).d === '2026-01-14',
     'Carga histórica (mesma função, chamada direta) grava janeiro')

  const vw = (await um(`select count(*)::int n from public.vw_grade_execucao_pulsar`)).n
  const ags = (await um(`select count(*)::int n from public.grade_agendamentos`)).n
  ok(vw === ags, 'vw_grade_execucao_pulsar (RP / Central) não enxerga as linhas do arquivo')

  const semSessaoPulsar = await erro(`insert into public.grade_evolucoes (status_execucao, possui_tratativa, descricao_evolucao, origem) values ('Realizado', true, 'x', 'pulsar')`)
  ok(semSessaoPulsar !== null, 'Evolução do Pulsar sem sessão é recusada (só o arquivo do TiTa fica sem sessão)')

  // Leitura direta da tabela pelo login: a política da 20261016180000 já barra
  // (permission denied ou nenhuma linha); o arquivo herda a mesma trava.
  await db.exec(`select set_config('request.jwt.claim.sub', '${SEM_PERM}', false)`)
  let leRecepcao
  try { await db.exec(`set role authenticated`); leRecepcao = (await um(`select count(*)::int n from public.grade_evolucoes where agendamento_id is null`)).n } catch { leRecepcao = 'negado' } finally { await db.exec(`reset role`) }
  ok(leRecepcao === 'negado' || leRecepcao === 0, `Login comum não lê o arquivo direto da tabela (${leRecepcao})`)
  await db.exec(`set role authenticated`)
  const execRec = await erro(`select public.sp_grade_evolucoes_arquivar_tita('[]'::jsonb)`)
  await db.exec(`reset role`)
  ok(execRec !== null && /permission denied/.test(execRec.message), 'Login comum não executa a função de arquivo')
}

if (falhas > 0) {
  console.error(`\n❌ ${falhas} falha(s) no teste PGlite`)
  process.exit(1)
} else {
  console.log('\n✔ Todos os testes de Evoluções Terapêuticas passaram no PGlite!')
}
