-- Diagnóstico: a inbox está lenta para a Pamela (central_role = operator)?
--
-- SOMENTE LEITURA. Tudo roda dentro de uma transação desfeita no fim
-- (rollback), com o papel `authenticated` e as claims do token dela, para as
-- regras de acesso (RLS) valerem exatamente como na sessão dela.
--
-- Mede as três consultas que a /connect/inbox repete a cada 5 segundos:
--   1. lista de conversas;
--   2. contatos da lista;
--   3. mensagens da conversa aberta.
--
-- Como ler: em cada bloco, a última linha do EXPLAIN traz "Execution Time".
-- Abaixo de ~50 ms é normal; se algum passar de centenas de ms, é o banco.
-- Se tudo for rápido, a lentidão está fora do banco (rede, máquina ou tela).
--
-- Rode o arquivo INTEIRO de uma vez: o SQL Editor mostra o resultado do último
-- comando; se quiser ver cada EXPLAIN, rode bloco a bloco selecionando.

begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',             '207593d6-54a1-428e-9b71-518d2e5390a9',   -- Pamela Rodrigues
    'role',            'authenticated',
    'organization_id', 'a0000000-0000-0000-0000-000000000001',
    'central_role',    'operator'
  )::text,
  true
);

-- 0. O que ela enxerga (esperado: só as conversas dos números de que é membro).
select count(*) as conversas_visiveis from central.conversations;

-- 1. Lista de conversas (igual à /api/central/conversations?limit=50).
explain (analyze, buffers)
select * from central.conversations
 where organization_id = 'a0000000-0000-0000-0000-000000000001'
 order by last_message_at desc nulls last
 limit 50;

-- 2. Contatos (igual à /api/central/contacts?limit=…).
explain (analyze, buffers)
select * from central.contacts
 where organization_id = 'a0000000-0000-0000-0000-000000000001'
 limit 500;

-- 3. Mensagens da conversa do número Autorização (as 20 mais recentes).
explain (analyze, buffers)
select m.* from central.messages m
 where m.conversation_id = (
   select c.id from central.conversations c
    where c.inbox_id = '1afd12a3-7ddf-43a8-86d7-aa0dd2d1b692'
    limit 1)
 order by m.created_at desc
 limit 20;

rollback;
