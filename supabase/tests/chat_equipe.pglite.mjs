// Teste de segurança/execução do Chat da equipe no PGlite (Postgres de verdade
// em Node, sem Docker): 20261016120000 (tabelas, RLS, RPCs) seguida de
// 20261016150000 (liberado para todo usuário ativo) e 20261016170000 (chat
// completo: responder, editar, apagar, reagir, anexar), como em produção.
//
// Prova: as migrations rodam e reroda; anon não lê nada; authenticated não grava
// nada direto; todo usuário ATIVO usa o chat, menos o perfil
// disponibilidade_terapeuta; não se abre conversa consigo mesmo nem com inativo;
// abrir duas vezes devolve o mesmo fio; só os membros leem o fio; desativar o
// cadastro esconde tudo; não lidas contam só a mensagem do outro depois do
// lido_ate e zeram ao marcar como lida; o código `chat_equipe` sai do catálogo;
// só o autor edita e apaga, apagar não deixa o corpo legível; reação liga e
// desliga por pessoa; anexo só da própria pasta, no próprio fio, já enviado.
//
// Rodar FORA do repo (o pacote não é dependência do projeto):
//   mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite
//   cp <repo>/supabase/tests/chat_equipe.pglite.mjs . && node chat_equipe.pglite.mjs \
//     <repo>/supabase/migrations/20261016120000_chat_equipe.sql \
//     <repo>/supabase/migrations/20261016150000_chat_equipe_para_todos.sql \
//     <repo>/supabase/migrations/20261016170000_chat_equipe_completo.sql
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const [, , ...migPaths] = process.argv
const migs = migPaths.map(p => readFileSync(p, 'utf8'))

let falhas = 0
const ok = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { falhas++; console.log('  FALHA', msg) } }

const db = new PGlite()
async function erro(sql, params = []) {
  try { await db.query(sql, params); return null } catch (e) { return e }
}

const ANA   = '00000000-0000-0000-0000-0000000000a1' // recepção
const BIA   = '00000000-0000-0000-0000-0000000000a2' // recepção
const CAIO  = '00000000-0000-0000-0000-0000000000a3' // recepção
const DUDA  = '00000000-0000-0000-0000-0000000000a4' // faturamento
const DIR   = '00000000-0000-0000-0000-0000000000d1' // diretoria
const INAT  = '00000000-0000-0000-0000-0000000000f1' // inativa
const TERAP = '00000000-0000-0000-0000-0000000000f2' // disponibilidade_terapeuta (externo)
const G_REC = 'e0000000-0000-0000-0000-000000000001'

// O que existe no banco real e as migrations usam, sem o resto.
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- O que o Supabase faz no banco real: CRUD para anon/authenticated em toda
-- tabela nova de public. É isso que a migration precisa fechar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create publication supabase_realtime;

-- O pedaço do Storage que a 20261016170000 usa: bucket, objetos sob RLS e
-- storage.foldername (o mesmo corpo do Supabase).
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
grant all on storage.objects to service_role;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

create table public.usuarios(id uuid primary key, nome text, ativo boolean default true, role text);
create table public.permissoes(codigo text primary key, nome text);
create table public.grupos_permissoes(id uuid primary key, nome text, modelo_permissoes jsonb not null default '{}');
create table public.grupos_permissoes_membros(grupo_id uuid, usuario_id uuid);
create table public.usuarios_permissoes(usuario_id uuid, permissao_codigo text references public.permissoes(codigo) on delete cascade, permitido boolean);

-- Só a primeira migration usa; a segunda troca por chat_eu_posso().
create function public.usuario_tem_permissao(p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo and u.role in ('admin','diretoria')) $$;
grant execute on function public.usuario_tem_permissao(text) to authenticated;

insert into public.usuarios values
  ('${ANA}',   'Ana',      true,  'recepcao'),
  ('${BIA}',   'Bia',      true,  'recepcao'),
  ('${CAIO}',  'Caio',     true,  'recepcao'),
  ('${DUDA}',  'Duda',     true,  'faturamento'),
  ('${DIR}',   'Diretora', true,  'diretoria'),
  ('${INAT}',  'Inativa',  false, 'recepcao'),
  ('${TERAP}', 'Terapeuta Externo', true, 'disponibilidade_terapeuta');
-- O estado de produção depois da 20261016100400: o código no catálogo.
insert into public.permissoes values ('chat_equipe', 'Chat da equipe'), ('atendimentos', 'Atendimentos');
insert into public.grupos_permissoes values ('${G_REC}', 'Recepção', '{"chat_equipe": true, "atendimentos": true}');
insert into public.usuarios_permissoes values ('${CAIO}', 'chat_equipe', false);
`)

console.log('1. migrations executam (e reexecutam)')
for (const m of migs) await db.exec(m)
ok(true, 'primeira execução')
for (const m of migs) await db.exec(m)
ok(true, 'segunda execução (idempotente)')
const pub = (await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_mensagens'`)).rows[0].n
ok(pub === 1, 'chat_mensagens na publicação do tempo real (uma vez só)')
const cat = (await db.query(`select
  (select count(*)::int from public.permissoes where codigo = 'chat_equipe') p,
  (select count(*)::int from public.grupos_permissoes where modelo_permissoes ? 'chat_equipe') g,
  (select count(*)::int from public.usuarios_permissoes where permissao_codigo = 'chat_equipe') u,
  (select modelo_permissoes ? 'atendimentos' from public.grupos_permissoes limit 1) resto`)).rows[0]
ok(cat.p === 0 && cat.g === 0 && cat.u === 0 && cat.resto, 'código chat_equipe saiu do catálogo, dos grupos e dos ajustes — o resto do grupo ficou')

async function como(papel, uid = '') {
  await db.exec(`reset role; set request.jwt.claim.sub = '${uid}'; set role ${papel};`)
}
const rpc = async (uid, sql, params = []) => { await como('authenticated', uid); return (await db.query(sql, params)).rows }

console.log('2. com quem dá para conversar')
const pessoas = (await rpc(ANA, `select nome from public.chat_pessoas()`)).map(r => r.nome)
ok(JSON.stringify(pessoas) === JSON.stringify(['Bia', 'Caio', 'Diretora', 'Duda']),
  `Ana vê todos os ativos — não a si, nem a inativa, nem o terapeuta externo: ${pessoas}`)
await como('authenticated', TERAP)
ok(await erro(`select * from public.chat_pessoas()`), 'o perfil disponibilidade_terapeuta não usa o chat')
await como('authenticated', INAT)
ok(await erro(`select * from public.chat_pessoas()`), 'nem quem está inativo')

console.log('3. abrir conversa direta')
const [{ chat_abrir_direta: conv }] = await rpc(ANA, `select public.chat_abrir_direta($1)`, [BIA])
ok(!!conv, 'Ana abre conversa com Bia')
const [{ chat_abrir_direta: conv2 }] = await rpc(BIA, `select public.chat_abrir_direta($1)`, [ANA])
ok(conv2 === conv, 'Bia abrindo com Ana cai no MESMO fio')
await como('authenticated', ANA)
ok(await erro(`select public.chat_abrir_direta($1)`, [ANA]), 'não se abre conversa consigo mesmo')
ok(await erro(`select public.chat_abrir_direta($1)`, [INAT]), 'nem com inativo')
ok(await erro(`select public.chat_abrir_direta($1)`, [TERAP]), 'nem com o terapeuta externo')
ok(!(await erro(`select public.chat_abrir_direta($1)`, [CAIO])), 'Caio (que tinha o código retirado) agora recebe conversa')
const [{ chat_abrir_direta: convDir }] = await rpc(DUDA, `select public.chat_abrir_direta($1)`, [DIR])
ok(!!convDir, 'faturamento e diretoria conversam')

console.log('4. enviar')
await rpc(ANA, `select * from public.chat_enviar($1, $2)`, [conv, '  Oi, Bia! A mãe do Pedro ligou.  '])
await rpc(BIA, `select * from public.chat_enviar($1, $2)`, [conv, 'Já retorno'])
await rpc(BIA, `select * from public.chat_enviar($1, $2)`, [conv, 'Qual o telefone?'])
const corpo = (await rpc(ANA, `select corpo from public.chat_mensagens where autor_id = $1`, [ANA]))[0].corpo
ok(corpo === 'Oi, Bia! A mãe do Pedro ligou.', 'corpo gravado sem espaços nas pontas')
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_enviar($1, '   ')`, [conv]), 'mensagem em branco é recusada')
ok(await erro(`select * from public.chat_enviar($1, repeat('x', 4001))`, [conv]), 'mensagem acima de 4000 caracteres é recusada')
ok(await erro(`select * from public.chat_enviar($1, 'intrusa')`, [convDir]), 'Ana não envia em fio de que não participa')

console.log('5. não lidas')
const naoLidas = async uid => (await rpc(uid, `select public.chat_nao_lidas() n`))[0].n
ok(await naoLidas(ANA) === 2, 'Ana tem 2 não lidas (as duas da Bia, depois da própria mensagem)')
ok(await naoLidas(BIA) === 0, 'Bia tem 0 (enviar marca como lido até ali)')
const lista = await rpc(ANA, `select * from public.chat_conversas_lista()`)
const daBia = lista.find(l => l.outro_nome === 'Bia')
ok(lista.length === 2 && daBia?.nao_lidas === 2 && daBia?.ultima_corpo === 'Qual o telefone?',
  'a lista da Ana mostra Bia (última mensagem, 2 não lidas) e Caio (sem mensagem)')
await rpc(ANA, `select public.chat_marcar_lida($1)`, [conv])
ok(await naoLidas(ANA) === 0, 'marcar como lida zera')
ok(await naoLidas(BIA) === 0, '…e não mexe na marca da Bia')
ok(await naoLidas(TERAP) === 0, 'quem não usa o chat tem contador 0 (não erro)')

console.log('6. quem lê')
const msgs = async uid => (await rpc(uid, `select count(*)::int n from public.chat_mensagens`))[0].n
ok(await msgs(ANA) === 3 && await msgs(BIA) === 3, 'as duas participantes leem o fio')
ok(await msgs(DUDA) === 0, 'Duda (de outro fio) não lê')
ok(await msgs(DIR) === 0, 'nem a diretoria, que não participa')
ok((await rpc(ANA, `select count(*)::int n from public.chat_membros`))[0].n === 4, 'Ana vê os membros dos fios dela (com Bia e com Caio), não os do outro')
await como('anon')
ok(await erro(`select * from public.chat_mensagens`), 'anon não lê mensagens')
ok(await erro(`select public.chat_nao_lidas()`), 'anon não chama as RPCs')

console.log('7. authenticated não grava nada direto')
await como('authenticated', ANA)
ok(await erro(`insert into public.chat_mensagens(conversa_id, autor_id, corpo) values ($1, $2, 'direto')`, [conv, ANA]), 'não insere mensagem')
ok(await erro(`update public.chat_mensagens set corpo = 'trocado'`), 'não edita mensagem')
ok(await erro(`delete from public.chat_mensagens where true`), 'não apaga mensagem')
ok(await erro(`insert into public.chat_membros(conversa_id, usuario_id) values ($1, $2)`, [convDir, ANA]), 'não se põe em fio alheio')
ok(await erro(`update public.chat_membros set lido_ate = now() where true`), 'não mexe no lido_ate direto')
ok(await erro(`select public.chat_usuario_pode($1)`, [BIA]), 'não consulta a situação de outra pessoa')

console.log('8. desativar o cadastro esconde tudo')
await como('service_role')
await db.query(`update public.usuarios set ativo = false where id = $1`, [BIA])
ok(await msgs(BIA) === 0, 'Bia inativa não lê mais o fio')
await como('authenticated', BIA)
ok(await erro(`select * from public.chat_enviar($1, 'ainda aqui?')`, [conv]), 'nem envia')
ok((await rpc(ANA, `select count(*)::int n from public.chat_pessoas() where nome = 'Bia'`))[0].n === 0, 'e some da lista de pessoas da Ana')
const bia = (await rpc(ANA, `select outro_ativo from public.chat_conversas_lista() where outro_nome = 'Bia'`))[0]
ok(bia && bia.outro_ativo === false, 'a conversa com ela continua na lista da Ana, marcada como inativa')
ok(await msgs(ANA) === 3, 'o histórico da Ana continua')
await como('service_role')
await db.query(`update public.usuarios set ativo = true where id = $1`, [BIA])
ok(await msgs(BIA) === 3, 'reativada, o fio volta')

console.log('9. chat completo')
const [{ chat_abrir_direta: convAD }] = await rpc(ANA, `select public.chat_abrir_direta($1)`, [DUDA])
const [mA] = await rpc(ANA, `select * from public.chat_enviar($1, 'Bom dia!')`, [conv])
const [resp] = await rpc(BIA, `select * from public.chat_enviar($1, 'Bom dia', $2)`, [conv, mA.id])
ok(resp.responde_a === mA.id, 'Bia responde citando a mensagem da Ana')
const [mDuda] = await rpc(DUDA, `select * from public.chat_enviar($1, 'oi Ana')`, [convAD])
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_enviar($1, 'x', $2)`, [conv, mDuda.id]), 'não se cita mensagem de outro fio')

const [ed] = await rpc(ANA, `select * from public.chat_editar($1, ' Bom dia, Bia! ')`, [mA.id])
ok(ed.corpo === 'Bom dia, Bia!' && ed.editada_em, 'Ana edita a própria mensagem (fica marcada como editada)')
await como('authenticated', BIA)
ok(await erro(`select * from public.chat_editar($1, 'mexi')`, [mA.id]), 'Bia não edita mensagem da Ana')
ok(await erro(`select * from public.chat_apagar($1)`, [mA.id]), 'nem apaga')
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_editar($1, '   ')`, [mA.id]), 'editar para vazio é recusado')

await rpc(BIA, `select * from public.chat_reagir($1, '👍')`, [mA.id])
const [r2] = await rpc(ANA, `select * from public.chat_reagir($1, '👍')`, [mA.id])
ok(JSON.stringify(r2.reacoes['👍']) === JSON.stringify([BIA, ANA]), 'reações das duas no mesmo emoji')
const [r3] = await rpc(BIA, `select * from public.chat_reagir($1, '👍')`, [mA.id])
ok(JSON.stringify(r3.reacoes) === JSON.stringify({ '👍': [ANA] }), 'reagir de novo desfaz só a de quem chamou')
const [r4] = await rpc(ANA, `select * from public.chat_reagir($1, '👍')`, [mA.id])
ok(JSON.stringify(r4.reacoes) === '{}', 'sem ninguém, o emoji sai do objeto')
await como('authenticated', DUDA)
ok(await erro(`select * from public.chat_reagir($1, '👍')`, [mA.id]), 'quem não é do fio não reage')
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_reagir($1, repeat('x', 40))`, [mA.id]), 'reação comprida demais é recusada')

const lidoBia = async () => (await rpc(BIA, `select lido_ate from public.chat_membros where conversa_id = $1 and usuario_id = $2`, [conv, BIA]))[0].lido_ate?.toISOString()
await rpc(BIA, `select public.chat_marcar_lida($1)`, [conv])
const antes = await lidoBia()
await rpc(BIA, `select public.chat_marcar_lida($1)`, [conv])
ok(await lidoBia() === antes, 'marcar como lida sem nada novo não grava')

const [nova] = await rpc(ANA, `select * from public.chat_enviar($1, 'mandei no fio errado')`, [conv])
ok(await naoLidas(BIA) === 1, 'Bia tem 1 não lida')
await rpc(ANA, `select * from public.chat_reagir($1, '😅')`, [nova.id])
const [ap] = await rpc(ANA, `select * from public.chat_apagar($1)`, [nova.id])
ok(ap.apagada_em && ap.corpo === '' && JSON.stringify(ap.reacoes) === '{}', 'apagar zera corpo e reações')
ok(await naoLidas(BIA) === 0, 'apagada deixa de contar como não lida')
const vistaBia = (await rpc(BIA, `select corpo from public.chat_mensagens where id = $1`, [nova.id]))[0]
ok(vistaBia.corpo === '', 'Bia não lê mais o texto apagado')
const prevBia = (await rpc(BIA, `select ultima_corpo from public.chat_conversas_lista() where id = $1`, [conv]))[0]
ok(prevBia.ultima_corpo === 'Mensagem apagada', 'a lista mostra "Mensagem apagada"')
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_editar($1, 'volta')`, [nova.id]), 'apagada não se edita')
ok(await erro(`select * from public.chat_reagir($1, '👍')`, [nova.id]), 'nem recebe reação')

const pubM = (await db.query(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_membros'`)).rows[0].n
ok(pubM === 1, 'chat_membros no tempo real (o "Visto")')

console.log('10. anexos')
const caminho = `${conv}/${ANA}/0001-foto.png`
await como('authenticated', ANA)
ok(!(await erro(`insert into storage.objects(bucket_id, name) values ('chat-anexos', $1)`, [caminho])), 'Ana sobe arquivo na pasta dela, no fio dela')
ok(await erro(`insert into storage.objects(bucket_id, name) values ('chat-anexos', $1)`, [`${conv}/${BIA}/x.png`]), 'não sobe na pasta da Bia')
ok(await erro(`insert into storage.objects(bucket_id, name) values ('chat-anexos', $1)`, [`${convDir}/${ANA}/x.png`]), 'nem em fio de que não participa')
const anexo = JSON.stringify([{ path: caminho, nome: 'foto.png', tipo: 'image/png', tamanho: 1234, extra: 'x' }])
const [comAnexo] = await rpc(ANA, `select * from public.chat_enviar($1, '', null, $2::jsonb)`, [conv, anexo])
ok(comAnexo.anexos.length === 1 && comAnexo.anexos[0].nome === 'foto.png' && !('extra' in comAnexo.anexos[0]),
  'mensagem só com anexo vale (e só as chaves conhecidas ficam)')
const prevAnexo = (await rpc(BIA, `select ultima_corpo from public.chat_conversas_lista() where id = $1`, [conv]))[0]
ok(prevAnexo.ultima_corpo === '📎 foto.png', 'a lista mostra o nome do anexo')
ok((await rpc(BIA, `select count(*)::int n from storage.objects where name = $1`, [caminho]))[0].n === 1, 'Bia (do fio) lê o arquivo')
ok((await rpc(DUDA, `select count(*)::int n from storage.objects where name = $1`, [caminho]))[0].n === 0, 'Duda não')
await como('authenticated', ANA)
ok(await erro(`select * from public.chat_enviar($1, 'x', null, $2::jsonb)`,
  [conv, JSON.stringify([{ path: `${conv}/${ANA}/nao-subiu.png`, nome: 'n.png' }])]), 'anexo que não subiu é recusado')
ok(await erro(`select * from public.chat_enviar($1, 'x', null, $2::jsonb)`, [convAD, anexo]), 'anexo de outro fio é recusado')
await rpc(BIA, `delete from storage.objects where name = $1`, [caminho])
ok((await rpc(ANA, `select count(*)::int n from storage.objects where name = $1`, [caminho]))[0].n === 1, 'Bia não apaga o arquivo da Ana')
await rpc(ANA, `delete from storage.objects where name = $1`, [caminho])
ok((await rpc(ANA, `select count(*)::int n from storage.objects where name = $1`, [caminho]))[0].n === 0, 'Ana apaga o próprio')

await db.exec('reset role')
await db.close()
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok')
process.exit(falhas ? 1 : 0)
