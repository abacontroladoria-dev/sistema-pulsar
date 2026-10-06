-- Foto de perfil e foto da assinatura/carimbo do profissional.
--
-- Usa o MESMO bucket das fotos de paciente (`pacientes-fotos`, privado — ver
-- 20260826100400), numa pasta própria:
--
--   profissionais/{id_profissional}/foto-{epoch_ms}.{jpg|png|webp}
--   profissionais/{id_profissional}/assinatura-{epoch_ms}.{jpg|png|webp}
--
-- As policies do bucket eram por BUCKET: quem tem `cadastros_pacientes` lia
-- qualquer objeto dele. Com a pasta nova isso deixaria a equipe de Pacientes ler
-- a assinatura de um profissional (imagem que serve para falsificar documento).
-- Por isso as quatro policies de paciente passam a valer só para as pastas
-- numéricas (a convenção que o INSERT delas já exigia desde o início — nenhum
-- objeto de paciente fica fora), e a pasta `profissionais/` ganha as suas,
-- com `cadastros_profissionais`.
--
-- ATENÇÃO AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o
-- SQL Editor recusar com "must be owner of table objects", crie/edite as
-- policies pelo Dashboard (Storage > pacientes-fotos > Policies) usando
-- EXATAMENTE as mesmas expressões. As colunas da parte A não dependem disso.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Colunas em public.profissionais (o banco guarda o PATH, nunca a URL:
--    o bucket é privado e a exibição usa URL assinada, que expira).
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.profissionais
  add column if not exists foto_path       text,
  add column if not exists assinatura_path text;

-- O path tem de ser da pasta DESTE profissional — impede apontar a foto de um
-- para o arquivo de outro (ou para a pasta de um paciente).
alter table public.profissionais drop constraint if exists profissionais_foto_path_check;
alter table public.profissionais add constraint profissionais_foto_path_check check (
  foto_path is null
  or foto_path ~ ('^profissionais/' || id::text || '/foto-[0-9]{10,16}\.(jpg|png|webp)$')
);
alter table public.profissionais drop constraint if exists profissionais_assinatura_path_check;
alter table public.profissionais add constraint profissionais_assinatura_path_check check (
  assinatura_path is null
  or assinatura_path ~ ('^profissionais/' || id::text || '/assinatura-[0-9]{10,16}\.(jpg|png|webp)$')
);

comment on column public.profissionais.foto_path is
  'Path no bucket pacientes-fotos (profissionais/{id}/foto-*.ext). Quando existe, substitui o ícone da terapia no avatar.';
comment on column public.profissionais.assinatura_path is
  'Path no bucket pacientes-fotos (profissionais/{id}/assinatura-*.ext): foto da assinatura/carimbo.';

-- Só UPDATE: a foto entra depois que o profissional já existe (o path leva o id).
grant update (foto_path, assinatura_path) on public.profissionais to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Policies do bucket
-- ═════════════════════════════════════════════════════════════════════════════

-- B.1) Paciente: mesmas regras de 20260826100400, agora só nas pastas numéricas.
drop policy if exists "pacientes_fotos_select" on storage.objects;
drop policy if exists "pacientes_fotos_insert" on storage.objects;
drop policy if exists "pacientes_fotos_update" on storage.objects;
drop policy if exists "pacientes_fotos_delete" on storage.objects;

create policy "pacientes_fotos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.usuario_tem_permissao('cadastros_pacientes')
  );

create policy "pacientes_fotos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.usuario_tem_permissao('cadastros_pacientes')
  );

create policy "pacientes_fotos_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.usuario_tem_permissao('cadastros_pacientes')
  )
  with check (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.usuario_tem_permissao('cadastros_pacientes')
  );

create policy "pacientes_fotos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.usuario_tem_permissao('cadastros_pacientes')
  );

-- B.2) Profissional: pasta profissionais/{id}/, nomes fixos (foto-/assinatura-).
drop policy if exists "profissionais_arquivos_select" on storage.objects;
drop policy if exists "profissionais_arquivos_insert" on storage.objects;
drop policy if exists "profissionais_arquivos_delete" on storage.objects;

create policy "profissionais_arquivos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] = 'profissionais'
    and public.usuario_tem_permissao('cadastros_profissionais')
  );

-- O INSERT valida o nome inteiro: pasta de um id numérico e arquivo foto-/assinatura-.
create policy "profissionais_arquivos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'pacientes-fotos'
    and name ~ '^profissionais/[0-9]+/(foto|assinatura)-[0-9]{10,16}\.(jpg|png|webp)$'
    and public.usuario_tem_permissao('cadastros_profissionais')
  );

-- Sem UPDATE: trocar a imagem grava um objeto NOVO (o cache do navegador
-- serviria a antiga) e remove o anterior.
create policy "profissionais_arquivos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'pacientes-fotos'
    and (storage.foldername(name))[1] = 'profissionais'
    and public.usuario_tem_permissao('cadastros_profissionais')
  );
