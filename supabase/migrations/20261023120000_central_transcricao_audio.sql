-- ============================================================================
-- Central: transcrição dos áudios recebidos no /connect/inbox
--
-- O QUE FALTAVA
--
-- Áudio chega como "[áudio de voz]" e um player. Para saber o que a mãe disse,
-- a atendente precisa parar e ouvir — no celular da recepção, às vezes sem
-- fone. A transcrição põe o texto embaixo do player.
--
-- POR QUE COLUNAS NO ANEXO, E NÃO A TABELA audio_transcriptions DA SPEC
--
-- docs/central-atendimento/09-audio-transcription.md desenha uma tabela à parte.
-- Aqui a relação é 1:1 com o anexo (um áudio, uma transcrição), e colunas em
-- message_attachments herdam de graça três coisas que uma tabela nova teria de
-- reconstruir:
--   • a RLS de message_attachments (admin/director ou membro da caixa) — uma
--     transcrição é tão sensível quanto o áudio de que saiu;
--   • a leitura: o detalhe da conversa já faz `attachments:message_attachments(*)`
--     a cada 5s, então o texto aparece na tela sem rota nem join novos;
--   • a escrita só por service role: message_attachments não tem INSERT/UPDATE
--     para `authenticated` (20260701000800), e é o worker/rota com service role
--     que grava.
-- Reprocessar SOBRESCREVE. O histórico de quem pediu e quando fica no
-- conversation_events (event_type 'audio.transcribed' / 'audio.transcription_failed').
--
-- ESTADOS (transcricao_status)
--   NULL         nunca foi pedida — áudio antigo, enviado por nós, ou fora da
--                janela do worker. A bolha oferece "Transcrever".
--   processing   alguém reivindicou. Lease de 2 min: passado isso, outro tique
--                ou outro clique pode retomar (o processo pode ter morrido).
--   completed    transcricao preenchida (pode ser '' — áudio sem fala).
--   failed       transcricao_erro diz por quê. A bolha oferece "Tentar de novo".
--
-- Sem 'pending': o worker escolhe pelo NULL, e um estado a mais seria só uma
-- segunda forma de dizer "ninguém pegou ainda".
--
-- ROLLBACK REFERENCE
--   drop index if exists central.idx_message_attachments_audio_sem_transcricao;
--   alter table central.message_attachments
--     drop constraint if exists chk_transcricao_status,
--     drop column if exists transcricao,
--     drop column if exists transcricao_status,
--     drop column if exists transcricao_erro,
--     drop column if exists transcricao_modelo,
--     drop column if exists transcricao_ms,
--     drop column if exists transcricao_iniciada_em,
--     drop column if exists transcricao_em;
--
-- Depends on:
--   20260701000600_create_ca_messages.sql     (message_attachments)
--   20260921160000_central_anexos_storage.sql (bucket central-anexos)
-- ============================================================================

-- message_attachments recebe escrita a cada mensagem com mídia. ADD COLUMN sem
-- default é só catálogo, mas pede AccessExclusiveLock; se houver fila, desiste
-- em 5s em vez de travar o webhook atrás dela. Rodar de novo é seguro.
set lock_timeout = '5s';

alter table central.message_attachments
  add column if not exists transcricao             text,
  add column if not exists transcricao_status      text,
  add column if not exists transcricao_erro        text,
  add column if not exists transcricao_modelo      text,
  add column if not exists transcricao_ms          integer,
  add column if not exists transcricao_iniciada_em timestamptz,
  add column if not exists transcricao_em          timestamptz;

-- NOT VALID: só catálogo. Linhas existentes têm NULL, que passa no CHECK, então
-- o VALIDATE logo abaixo é rápido e usa lock fraco.
alter table central.message_attachments
  drop constraint if exists chk_transcricao_status;
alter table central.message_attachments
  add constraint chk_transcricao_status
  check (transcricao_status in ('processing', 'completed', 'failed')) not valid;

reset lock_timeout;

alter table central.message_attachments
  validate constraint chk_transcricao_status;

-- O worker pergunta "que áudio das últimas horas ninguém transcreveu?" a cada
-- 10 segundos. Parcial: só áudio sem estado. Cresce devagar — áudio antigo que
-- ninguém pediu para transcrever fica NULL para sempre e continua aqui —, mas
-- só com áudio, nunca com o resto dos anexos.
create index if not exists idx_message_attachments_audio_sem_transcricao
  on central.message_attachments (created_at)
  where transcricao_status is null and file_type like 'audio/%';

comment on column central.message_attachments.transcricao is
  'Texto do audio, gerado por TranscricaoService (OpenAI /audio/transcriptions). NULL enquanto nao transcrito; string vazia = audio sem fala. Complementa o audio, nunca o substitui.';
comment on column central.message_attachments.transcricao_status is
  'NULL (nunca pedida) | processing (lease de 2 min em transcricao_iniciada_em) | completed | failed (motivo em transcricao_erro).';
comment on column central.message_attachments.transcricao_modelo is
  'Modelo usado na transcricao (MODELO_TRANSCRICAO; /audio/transcriptions nao devolve o modelo, entao e o pedido). Para custo e para comparar modelos.';
comment on column central.message_attachments.transcricao_ms is
  'Tempo de parede da chamada de transcricao, sem o download da midia.';

notify pgrst, 'reload schema';
