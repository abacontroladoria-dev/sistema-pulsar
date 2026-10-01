-- ============================================================================
-- Central: o bucket dos anexos passa a ser só de service role
--
-- O QUE ESTAVA ERRADO
--
-- As quatro policies de storage.objects da 20260921160000 isolavam o bucket
-- `central-anexos` só pela ORGANIZAÇÃO:
--
--   (storage.foldername(name))[1] = central.current_organization_id()::text
--
-- O comentário de lá supunha que só quem tem `central_role` "pertence à org".
-- Não é verdade: `public.usuarios.organization_id` é NOT NULL com default na
-- org da Central (20260701000001), então TODO usuário do Pulsar — terapeuta,
-- recepção, a conta compartilhada de disponibilidade — tem a organização, e
-- `current_organization_id()` a devolve sem olhar papel.
--
-- Efeito: qualquer usuário logado, sem acesso nenhum à Central, abria o console
-- do navegador e, com o cliente Supabase público do app, listava o bucket
-- (o path começa pela org, que é uma constante), baixava laudo, foto de
-- carteirinha e áudio de mãe falando do filho, sobrescrevia um arquivo com
-- `upsert` e apagava com `remove`. As tabelas (`messages`,
-- `message_attachments`) exigem admin/director ou ser membro da caixa; o
-- bucket era o único caminho sem esse portão.
--
-- O QUE MUDA
--
-- O bucket fica SEM policy para `authenticated`. Com RLS ligado em
-- storage.objects e nenhuma policy que o alcance, o navegador não lista, não
-- baixa, não grava e não apaga nada nele. Só service role (que contorna RLS)
-- opera o bucket.
--
-- Quem usa service role é o servidor, e só depois de o acesso ser decidido
-- pela RLS das TABELAS com o client do usuário (createMessageService em
-- frontend/modules/atendimento/services/index.ts):
--   • enviar mídia: conversa lida com o client do usuário + INSERT da
--     mensagem sob messages_insert, antes de subir o arquivo;
--   • abrir anexo: o anexo lido com o client do usuário
--     (message_attachments_select / _select_membro) antes de assinar a URL.
-- O path vem de linhas que só service role grava — message_attachments não
-- tem INSERT/UPDATE para `authenticated` —, nunca da requisição. O que o
-- navegador recebe continua sendo só a URL assinada de 5 minutos.
--
-- ORDEM DE APLICAÇÃO: o código primeiro. O código antigo opera o bucket com o
-- client do usuário; aplicado este SQL antes do deploy, enviar e abrir anexo
-- falham até o código novo subir. O código novo funciona com ou sem as
-- policies antigas.
--
-- ATENÇÃO AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o
-- SQL Editor recusar com "must be owner of table objects", apague as quatro
-- policies pelo Dashboard (Storage > Policies > central-anexos):
-- central_anexos_select, central_anexos_insert, central_anexos_update,
-- central_anexos_delete. É o mesmo aviso da 20260921160000.
--
-- ROLLBACK REFERENCE
--   Recriar as quatro policies exatamente como na 20260921160000 — o que
--   REABRE a falha descrita acima. Prefira corrigir para frente.
--
-- Depends on:
--   20260921160000_central_anexos_storage.sql   (o bucket e as policies)
-- ============================================================================

drop policy if exists "central_anexos_select" on storage.objects;
drop policy if exists "central_anexos_insert" on storage.objects;
drop policy if exists "central_anexos_update" on storage.objects;
drop policy if exists "central_anexos_delete" on storage.objects;

-- O bucket continua privado. Reafirmado aqui porque um bucket público serviria
-- o objeto pelo endpoint público sem passar por RLS nenhuma — e sem as
-- policies, "privado" é a única coisa que resta entre o arquivo e a internet.
update storage.buckets
   set public = false
 where id = 'central-anexos';
