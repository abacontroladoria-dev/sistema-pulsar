-- ============================================================================
-- Central: o bucket dos anexos do atendimento
--
-- O QUE FALTAVA
--
-- `central.message_attachments` existe desde 20260701000600 e descreve um
-- pipeline de dois estágios: o webhook grava o id da mídia com
-- `storage_status: 'pending'`, e um worker baixa o arquivo e grava
-- `storage_path` com 'stored'. O segundo estágio nunca foi construído, porque
-- nunca houve bucket. Todo anexo em produção está 'pending' e o painel mostra
-- "[imagem]".
--
-- PRIVADO, E ISSO NÃO É NEGOCIÁVEL
--
-- É áudio de mãe descrevendo crise do filho, laudo neuropediátrico, foto de
-- carteirinha. Dado pessoal sensível de menor, pela LGPD. Um bucket público
-- serve qualquer objeto a quem souber (ou adivinhar) o path, sem sessão — e
-- URL de CDN vaza em log, em histórico de navegador e em print.
--
-- O repo de referência (integra-connect) usa bucket PÚBLICO, e tem um motivo
-- técnico: a Evolution/Meta daquele desenho exige URL pública para enviar
-- mídia. Aqui NÃO exigimos: a Graph API aceita upload direto
-- (POST /{phone-number-id}/media devolve um media ID), então o arquivo nunca
-- precisa ser alcançável pela internet. O privado sai de graça.
--
-- Quem exibe é uma URL ASSINADA de curta duração, emitida pela rota
-- /api/central/anexos/[id] depois de conferir a sessão e a organização. O path
-- nunca vai ao cliente.
--
-- CONVENÇÃO DE PATH: {organization_id}/{conversation_id}/{message_id}/{arquivo}
--
-- É a mesma que o comentário da 20260701000600 já documentava. A organização
-- como PRIMEIRO segmento é o que faz a policy conseguir isolar org sem
-- consultar tabela nenhuma — `storage.foldername(name)[1]` comparado com
-- `central.current_organization_id()`.
--
-- O nome do arquivo é gerado, nunca o original: nome de arquivo vaza dado
-- pessoal ("laudo-joao-silva.pdf") em log e em URL. O original vive em
-- `message_attachments.file_name`, que está sob RLS.
--
-- OS LIMITES
--
-- `file_size_limit` é 16 MiB, o teto da Meta para áudio e vídeo. Documento a
-- Meta aceita até 100 MB, mas aqui o limite é o nosso: o upload atravessa uma
-- rota Next, e 100 MB numa rota serverless é um timeout caro. 16 MiB cobre o
-- que uma recepção de fato envia.
--
-- `allowed_mime_types` é a interseção do que a Meta aceita com o que uma
-- clínica manda. Deliberadamente SEM tipos executáveis e SEM SVG (que carrega
-- script e seria servido a partir de uma URL assinada nossa).
--
-- ATENÇÃO AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o
-- SQL Editor recusar com "must be owner of table objects", crie as quatro
-- policies pelo Dashboard (Storage > central-anexos > Policies) usando
-- EXATAMENTE as mesmas expressões. O INSERT em storage.buckets funciona normal.
-- É o mesmo aviso de 20260826100400, pelo mesmo motivo.
--
-- ROLLBACK REFERENCE
--   drop policy if exists "central_anexos_select" on storage.objects;
--   drop policy if exists "central_anexos_insert" on storage.objects;
--   drop policy if exists "central_anexos_update" on storage.objects;
--   drop policy if exists "central_anexos_delete" on storage.objects;
--   delete from storage.objects where bucket_id = 'central-anexos';
--   delete from storage.buckets where id = 'central-anexos';
--   alter table central.message_attachments drop column storage_error;
--
-- Depends on:
--   20260701000600_create_ca_messages.sql        (message_attachments)
--   20260701000700_create_ca_rls_helpers.sql     (current_organization_id)
--   20260826100400                               (o padrão de DDL de bucket)
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'central-anexos',
  'central-anexos',
  false,                      -- PRIVADO. Ver o bloco acima.
  16777216,                   -- 16 MiB — teto da Meta para áudio/vídeo.
  array[
    -- Imagem: só o que a Meta aceita enviar. Sem SVG, de propósito.
    'image/jpeg', 'image/png', 'image/webp',
    -- Áudio: o ogg/opus é o formato do áudio gravado no WhatsApp.
    'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus',
    -- Vídeo
    'video/mp4', 'video/3gpp',
    -- Documento: o que uma clínica de fato recebe.
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "central_anexos_select" on storage.objects;
drop policy if exists "central_anexos_insert" on storage.objects;
drop policy if exists "central_anexos_update" on storage.objects;
drop policy if exists "central_anexos_delete" on storage.objects;

-- ----------------------------------------------------------------------------
-- As policies isolam por ORGANIZAÇÃO, usando o primeiro segmento do path.
--
-- `central.current_organization_id()` é a mesma função que governa todo o
-- schema `central` (20260701000700). Usá-la aqui faz o bucket herdar
-- exatamente o mesmo recorte das tabelas — sem uma segunda definição de
-- "minha organização" que pudesse divergir da primeira.
--
-- Note que NÃO há checagem de papel: quem tem `central_role` e pertence à org
-- pode ler os anexos dela. É o mesmo alcance de `central.messages`, e faria
-- pouco sentido um atendente ler "[áudio]" na conversa e não poder ouvi-lo.
-- ----------------------------------------------------------------------------

create policy "central_anexos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'central-anexos'
    and (storage.foldername(name))[1] = central.current_organization_id()::text
  );

-- O INSERT exige os TRÊS primeiros segmentos como UUID. Sem isso, um cliente
-- com bug despejaria arquivos na raiz e a limpeza por conversa (ou o
-- atendimento a um pedido de exclusão da LGPD) viraria varredura manual.
create policy "central_anexos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'central-anexos'
    and (storage.foldername(name))[1] = central.current_organization_id()::text
    and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[3] ~* '^[0-9a-f-]{36}$'
  );

-- UPDATE existe porque o `upsert` do supabase-js precisa dele. Não se sobrescreve
-- anexo de propósito — mas uma retentativa de download sobre o mesmo path é
-- legítima (dois atendentes clicando no mesmo áudio ao mesmo tempo), e sem esta
-- policy ela falharia com uma mensagem que não explica nada.
create policy "central_anexos_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'central-anexos'
    and (storage.foldername(name))[1] = central.current_organization_id()::text
  );

-- DELETE serve à retenção e ao direito de exclusão da LGPD. Não há caminho de
-- UI que o use hoje; existe para que apagar não exija service_role.
create policy "central_anexos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'central-anexos'
    and (storage.foldername(name))[1] = central.current_organization_id()::text
  );

-- ----------------------------------------------------------------------------
-- Por que o download pode falhar, em texto
--
-- `storage_status` já distingue 'pending' de 'failed', mas não diz POR QUE — e
-- as causas pedem ações opostas: mídia expirada na Meta é irrecuperável (não
-- adianta retentar), token vencido conserta-se e a retentativa funciona, tipo
-- recusado pelo bucket é decisão nossa.
--
-- Sem isto, "o áudio não carrega" obriga a ler log da aplicação para descobrir
-- se vale insistir. Quem grava é MessageService.urlDoAnexo — o download é sob
-- demanda, no primeiro clique, e não há worker varrendo anexos pendentes.
-- ----------------------------------------------------------------------------
alter table central.message_attachments
  add column if not exists storage_error text;

comment on column central.message_attachments.storage_error is
  'Por que o download da midia falhou, em texto legivel. NULL quando nao falhou. Preenchido por MessageService.urlDoAnexo, que baixa sob demanda no primeiro clique (nao ha worker de anexos); limpo quando uma retentativa da certo.';

comment on column central.message_attachments.external_url is
  'Para midia RECEBIDA guarda o MEDIA ID da Meta (nao uma URL): o id vale 7 dias e e a unica forma de pedir o arquivo de novo, enquanto a URL que a Graph devolve expira em 5 MINUTOS. Para midia ENVIADA por nos guarda o media ID devolvido pelo upload, que vale 30 dias.';

notify pgrst, 'reload schema';
