-- ============================================================================
-- Foto de perfil do contato (WhatsApp) no inbox do Connect
--
-- Até aqui nada preenchia central.contacts.avatar_url, e a lista só mostrava
-- iniciais. O worker `avatar` do tique busca a foto na Evolution
-- (/chat/fetchProfilePictureUrl) e COPIA a imagem para cá: o link do WhatsApp
-- (pps.whatsapp.net) expira em poucos dias.
--
-- Bucket PRIVADO, como o de anexos: é rosto de paciente e de responsável. A
-- tela lê por /api/central/contacts/[id]/foto, que confere a sessão e a RLS do
-- contato antes de devolver uma URL assinada. Nenhuma policy para
-- `authenticated` em storage.objects — só o service role lê e grava.
--
-- avatar_checked_at: quando a foto foi conferida pela última vez (achada ou
-- não). Null = nunca. O worker reconfere a cada 7 dias.
-- ============================================================================

set lock_timeout = '5s';

alter table central.contacts
  add column if not exists avatar_checked_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'central-avatares',
  'central-avatares',
  false,
  2097152,                                  -- 2 MiB; foto de perfil tem ~50 KB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
