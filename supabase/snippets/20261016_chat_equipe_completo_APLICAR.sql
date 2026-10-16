-- Aplica 20261016170000_chat_equipe_completo (16/10/2026): responder, editar,
-- apagar, reagir, anexos e "Visto" no Chat da equipe.
--
-- PRÉ-REQUISITO: 20261016_chat_equipe_para_todos_APLICAR.sql já aplicado
-- (o bloco abaixo para com erro se não estiver).
-- Teste: supabase/tests/chat_equipe.pglite.mjs (73 checagens, as três migrations).
--
-- DUAS PARTES, cada uma na sua transação:
--   PARTE 1  colunas, RPCs, tempo real (+ livro-caixa)
--   PARTE 2  bucket chat-anexos e as policies de storage.objects
-- Se a PARTE 2 falhar com "must be owner of table objects", a PARTE 1 já
-- ficou: crie as três policies pelo Dashboard (Storage > chat-anexos >
-- Policies) com as mesmas expressões. Sem elas o chat funciona, só não anexa.
-- Gerado a partir da migration — se ela mudar, gere de novo.

-- ═══════════════════════════════ PARTE 1 ═══════════════════════════════
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.chat_eu_posso()') is null then
    raise exception 'aplique antes 20261016_chat_equipe_para_todos_APLICAR.sql';
  end if;
end;
$$;

-- ============================================================================
-- Chat da equipe completo: responder, editar, apagar, reagir, anexar, "visto"
--
-- Pedido de 16/10/2026: "um chat completo, com emojis, separação de datas e
-- outras ferramentas naturais". Emoji no texto e separação de datas são só da
-- tela; o que precisa de banco está aqui.
--
-- O QUE MUDA EM chat_mensagens
--   responde_a   a mensagem citada (do mesmo fio). Apagar a citada não apaga
--                a resposta: vira nulo.
--   editada_em   a tela mostra "editada". Só quem escreveu edita.
--   apagada_em   apagar é marcar: o corpo, os anexos e as reações são
--                zerados na hora (o outro lado não lê mais nada pela RLS), e a
--                linha fica para o fio não perder a ordem — "Mensagem apagada".
--   reacoes      {"👍": ["<uuid>", …]} — na própria linha, e não numa tabela à
--                parte, para a reação chegar pelo MESMO canal de tempo real
--                (UPDATE de chat_mensagens, recortado pela RLS) e ser lida na
--                mesma consulta do fio.
--   anexos       [{path, nome, tipo, tamanho}] no bucket privado chat-anexos.
--                Mensagem só com anexo (corpo vazio) passa a valer.
--
-- RPCs novas: chat_editar, chat_apagar, chat_reagir. chat_enviar ganha
-- p_responde_a e p_anexos (com padrão: a tela antiga, que manda só p_conversa e
-- p_corpo, continua funcionando).
--
-- "VISTO": chat_membros entra no tempo real — quando o outro lê, o lido_ate
-- dele chega e a tela marca "Visto". chat_marcar_lida passa a gravar só quando
-- há o que ler: a tela chama a cada mensagem e a cada volta à aba, e sem isso
-- cada chamada seria uma escrita (e um aviso de tempo real) à toa.
--
-- ANEXOS: bucket privado `chat-anexos`, caminho
--   {conversa_id}/{autor_id}/{uuid}-{nome}
-- Lê quem é membro do fio; grava e apaga só o próprio autor, na pasta dele. A
-- tela exibe por URL assinada (expira). O arquivo de mensagem apagada é
-- removido pela tela (storage.protect_delete barra DELETE direto pelo SQL).
--
-- ATENÇÃO AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o
-- SQL Editor recusar as policies com "must be owner of table objects", crie-as
-- pelo Dashboard (Storage > chat-anexos > Policies) com EXATAMENTE as mesmas
-- expressões. O resto não depende disso.
--
-- Reexecutável.
--
-- ROLLBACK REFERENCE (ordem inversa):
--   drop policy if exists "chat_anexos_select" on storage.objects;
--   drop policy if exists "chat_anexos_insert" on storage.objects;
--   drop policy if exists "chat_anexos_delete" on storage.objects;
--   alter publication supabase_realtime drop table public.chat_membros;
--   drop function if exists public.chat_reagir(uuid, text);
--   drop function if exists public.chat_apagar(uuid);
--   drop function if exists public.chat_editar(uuid, text);
--   (chat_enviar, chat_marcar_lida, chat_nao_lidas e chat_conversas_lista:
--    reaplicar 20261016150000 e 20261016120000)
--   alter table public.chat_mensagens drop column responde_a, drop column editada_em,
--     drop column apagada_em, drop column reacoes, drop column anexos;
--
-- Depends on: 20261016150000_chat_equipe_para_todos.sql (chat_eu_posso)
-- ============================================================================

-- ============================================================================
-- Colunas
-- ============================================================================
alter table public.chat_mensagens
  add column if not exists responde_a uuid,
  add column if not exists editada_em timestamptz,
  add column if not exists apagada_em timestamptz,
  add column if not exists reacoes    jsonb not null default '{}'::jsonb,
  add column if not exists anexos     jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_chat_mensagens_responde_a') then
    alter table public.chat_mensagens
      add constraint fk_chat_mensagens_responde_a
      foreign key (responde_a) references public.chat_mensagens(id) on delete set null;
  end if;
end;
$$;

-- Corpo: até 4000; vazio só se a mensagem tem anexo ou foi apagada.
alter table public.chat_mensagens drop constraint if exists ck_chat_mensagens_corpo;
alter table public.chat_mensagens add constraint ck_chat_mensagens_corpo check (
  length(corpo) <= 4000
  and (apagada_em is not null or length(btrim(corpo)) > 0 or anexos <> '[]'::jsonb)
);

alter table public.chat_mensagens drop constraint if exists ck_chat_mensagens_reacoes;
alter table public.chat_mensagens add constraint ck_chat_mensagens_reacoes check (
  jsonb_typeof(reacoes) = 'object'
);

-- CASE e não AND: jsonb_array_length num não-array é erro, não falso.
alter table public.chat_mensagens drop constraint if exists ck_chat_mensagens_anexos;
alter table public.chat_mensagens add constraint ck_chat_mensagens_anexos check (
  case when jsonb_typeof(anexos) = 'array' then jsonb_array_length(anexos) <= 10 else false end
);

comment on column public.chat_mensagens.reacoes is
  'Reações: {"emoji": ["usuario_id", ...]}. Escrita só por chat_reagir.';
comment on column public.chat_mensagens.anexos is
  'Anexos no bucket chat-anexos: [{path, nome, tipo, tamanho}]. Path = {conversa}/{autor}/{uuid}-{nome}.';

-- ============================================================================
-- RPCs
-- ============================================================================

-- O padrão dos parâmetros novos mantém a chamada antiga (p_conversa, p_corpo)
-- válida. A versão de dois parâmetros sai: com as duas, a chamada antiga
-- ficaria ambígua.
drop function if exists public.chat_enviar(uuid, text);

create or replace function public.chat_enviar(
  p_conversa   uuid,
  p_corpo      text,
  p_responde_a uuid  default null,
  p_anexos     jsonb default '[]'::jsonb
)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu     uuid  := auth.uid();
  v_anexos jsonb := coalesce(p_anexos, '[]'::jsonb);
  v_a      jsonb;
  v_msg    public.chat_mensagens;
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.chat_membros where conversa_id = p_conversa and usuario_id = v_eu
  ) then
    raise exception 'você não participa desta conversa' using errcode = '42501';
  end if;
  if p_responde_a is not null and not exists (
    select 1 from public.chat_mensagens where id = p_responde_a and conversa_id = p_conversa
  ) then
    raise exception 'a mensagem respondida não é desta conversa' using errcode = '22023';
  end if;

  if jsonb_typeof(v_anexos) <> 'array' or jsonb_array_length(v_anexos) > 10 then
    raise exception 'até 10 anexos por mensagem' using errcode = '22023';
  end if;
  -- Cada anexo tem de estar na pasta de quem envia, neste fio, e já ter subido:
  -- ninguém aponta para o arquivo de outra conversa.
  for v_a in select value from jsonb_array_elements(v_anexos) loop
    if jsonb_typeof(v_a) <> 'object'
       or coalesce(v_a->>'path', '') not like p_conversa::text || '/' || v_eu::text || '/%' then
      raise exception 'anexo inválido' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects where bucket_id = 'chat-anexos' and name = v_a->>'path'
    ) then
      raise exception 'o anexo % não terminou de subir', v_a->>'nome' using errcode = '22023';
    end if;
  end loop;
  -- Só as chaves conhecidas, com tamanho máximo.
  select coalesce(jsonb_agg(jsonb_build_object(
           'path',    a->>'path',
           'nome',    left(coalesce(nullif(btrim(a->>'nome'), ''), 'arquivo'), 200),
           'tipo',    left(coalesce(a->>'tipo', ''), 100),
           'tamanho', case when (a->>'tamanho') ~ '^[0-9]{1,12}$' then (a->>'tamanho')::bigint end
         )), '[]'::jsonb)
    into v_anexos
    from jsonb_array_elements(v_anexos) a;

  insert into public.chat_mensagens (conversa_id, autor_id, corpo, responde_a, anexos)
  values (p_conversa, v_eu, btrim(coalesce(p_corpo, '')), p_responde_a, v_anexos)
  returning * into v_msg;

  update public.chat_conversas set ultima_mensagem_em = v_msg.criada_em where id = p_conversa;
  update public.chat_membros set lido_ate = v_msg.criada_em
  where conversa_id = p_conversa and usuario_id = v_eu;

  return v_msg;
end;
$$;

-- A mensagem, travada para a alteração, se quem chama é o autor e membro.
create or replace function public.chat_minha_mensagem(p_mensagem uuid)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_msg public.chat_mensagens;
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  select * into v_msg from public.chat_mensagens where id = p_mensagem for update;
  if not found or v_msg.autor_id <> auth.uid() or not exists (
    select 1 from public.chat_membros where conversa_id = v_msg.conversa_id and usuario_id = auth.uid()
  ) then
    raise exception 'só quem escreveu a mensagem pode alterá-la' using errcode = '42501';
  end if;
  if v_msg.apagada_em is not null then
    raise exception 'essa mensagem foi apagada' using errcode = '22023';
  end if;
  return v_msg;
end;
$$;

create or replace function public.chat_editar(p_mensagem uuid, p_corpo text)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_msg   public.chat_mensagens := public.chat_minha_mensagem(p_mensagem);
  v_corpo text := btrim(coalesce(p_corpo, ''));
begin
  if v_corpo = v_msg.corpo then
    return v_msg;
  end if;
  if v_corpo = '' and v_msg.anexos = '[]'::jsonb then
    raise exception 'a mensagem não pode ficar vazia — para tirá-la, apague' using errcode = '22023';
  end if;
  if length(v_corpo) > 4000 then
    raise exception 'até 4000 caracteres por mensagem' using errcode = '22023';
  end if;
  update public.chat_mensagens set corpo = v_corpo, editada_em = now()
  where id = p_mensagem
  returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.chat_apagar(p_mensagem uuid)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_msg public.chat_mensagens := public.chat_minha_mensagem(p_mensagem);
begin
  update public.chat_mensagens
     set apagada_em = now(), corpo = '', reacoes = '{}'::jsonb, anexos = '[]'::jsonb, responde_a = null
   where id = p_mensagem
  returning * into v_msg;
  return v_msg;
end;
$$;

-- Liga/desliga a reação de quem chama. Qualquer membro do fio reage.
create or replace function public.chat_reagir(p_mensagem uuid, p_emoji text)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu    uuid := auth.uid();
  v_msg   public.chat_mensagens;
  v_lista jsonb;
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  -- Um emoji com modificadores (tom de pele, família) passa de 4 bytes; 32 é folga.
  if p_emoji is null or btrim(p_emoji) = '' or octet_length(p_emoji) > 32 then
    raise exception 'reação inválida' using errcode = '22023';
  end if;
  select * into v_msg from public.chat_mensagens where id = p_mensagem for update;
  if not found or not exists (
    select 1 from public.chat_membros where conversa_id = v_msg.conversa_id and usuario_id = v_eu
  ) then
    raise exception 'mensagem não encontrada' using errcode = '42501';
  end if;
  if v_msg.apagada_em is not null then
    raise exception 'essa mensagem foi apagada' using errcode = '22023';
  end if;

  v_lista := coalesce(v_msg.reacoes -> p_emoji, '[]'::jsonb);
  if v_lista ? v_eu::text then
    v_lista := v_lista - v_eu::text;
  else
    if not (v_msg.reacoes ? p_emoji)
       and (select count(*) from jsonb_object_keys(v_msg.reacoes)) >= 20 then
      raise exception 'limite de 20 reações diferentes por mensagem' using errcode = '22023';
    end if;
    v_lista := v_lista || to_jsonb(v_eu::text);
  end if;

  update public.chat_mensagens
     set reacoes = case
                     when jsonb_array_length(v_lista) = 0 then reacoes - p_emoji
                     else jsonb_set(reacoes, array[p_emoji], v_lista)
                   end
   where id = p_mensagem
  returning * into v_msg;
  return v_msg;
end;
$$;

-- Grava só quando há mensagem do outro depois do meu lido_ate.
create or replace function public.chat_marcar_lida(p_conversa uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  update public.chat_membros eu
     set lido_ate = greatest(coalesce(eu.lido_ate, '-infinity'::timestamptz), now())
   where eu.conversa_id = p_conversa
     and eu.usuario_id = auth.uid()
     and exists (
       select 1 from public.chat_mensagens m
       where m.conversa_id = p_conversa
         and m.autor_id <> auth.uid()
         and m.criada_em > coalesce(eu.lido_ate, '-infinity'::timestamptz)
     );
end;
$$;

-- Mensagem apagada não conta como não lida.
create or replace function public.chat_nao_lidas()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.chat_mensagens m
  join public.chat_membros eu
    on eu.conversa_id = m.conversa_id and eu.usuario_id = auth.uid()
  where m.autor_id <> auth.uid()
    and m.apagada_em is null
    and m.criada_em > coalesce(eu.lido_ate, '-infinity'::timestamptz);
$$;

-- A prévia da lista sabe de mensagem apagada e de mensagem só com anexo.
create or replace function public.chat_conversas_lista()
returns table (
  id                 uuid,
  outro_id           uuid,
  outro_nome         text,
  outro_ativo        boolean,
  ultima_corpo       text,
  ultima_autor_id    uuid,
  ultima_mensagem_em timestamptz,
  nao_lidas          integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  return query
    select
      c.id,
      o.usuario_id,
      coalesce(nullif(btrim(u.nome), ''), 'Usuário removido')::text,
      coalesce(u.ativo, false),
      ult.corpo,
      ult.autor_id,
      c.ultima_mensagem_em,
      (
        select count(*)::int from public.chat_mensagens m
        where m.conversa_id = c.id
          and m.autor_id <> auth.uid()
          and m.apagada_em is null
          and m.criada_em > coalesce(eu.lido_ate, '-infinity'::timestamptz)
      )
    from public.chat_membros eu
    join public.chat_conversas c on c.id = eu.conversa_id
    left join public.chat_membros o on o.conversa_id = c.id and o.usuario_id <> eu.usuario_id
    left join public.usuarios u on u.id = o.usuario_id
    left join lateral (
      select
        case
          when m.apagada_em is not null then 'Mensagem apagada'
          when btrim(m.corpo) = '' then '📎 ' || coalesce(m.anexos->0->>'nome', 'Anexo')
          else m.corpo
        end::text as corpo,
        m.autor_id
      from public.chat_mensagens m
      where m.conversa_id = c.id
      order by m.criada_em desc
      limit 1
    ) ult on true
    where eu.usuario_id = auth.uid()
    order by coalesce(c.ultima_mensagem_em, c.criada_em) desc;
end;
$$;

revoke all on function public.chat_enviar(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.chat_minha_mensagem(uuid)           from public, anon, authenticated;
revoke all on function public.chat_editar(uuid, text)             from public, anon;
revoke all on function public.chat_apagar(uuid)                   from public, anon;
revoke all on function public.chat_reagir(uuid, text)             from public, anon;
revoke all on function public.chat_marcar_lida(uuid)              from public, anon;
revoke all on function public.chat_nao_lidas()                    from public, anon;
revoke all on function public.chat_conversas_lista()              from public, anon;
grant execute on function public.chat_enviar(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.chat_editar(uuid, text)              to authenticated;
grant execute on function public.chat_apagar(uuid)                    to authenticated;
grant execute on function public.chat_reagir(uuid, text)              to authenticated;
grant execute on function public.chat_marcar_lida(uuid)               to authenticated;
grant execute on function public.chat_nao_lidas()                     to authenticated;
grant execute on function public.chat_conversas_lista()               to authenticated;

-- ============================================================================
-- Tempo real: o lido_ate do outro ("Visto"). A RLS de chat_membros recorta
-- por assinante, como a de chat_mensagens.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_membros'
     ) then
    alter publication supabase_realtime add table public.chat_membros;
  end if;
end;
$$;


insert into supabase_migrations.schema_migrations (version, name) values
  ('20261016170000', 'chat_equipe_completo')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════ PARTE 2 ═══════════════════════════════
begin;
set local lock_timeout = '5s';

-- ============================================================================
-- Anexos: bucket privado e policies
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-anexos', 'chat-anexos', false, 26214400) -- 25 MB
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "chat_anexos_select" on storage.objects;
drop policy if exists "chat_anexos_insert" on storage.objects;
drop policy if exists "chat_anexos_delete" on storage.objects;

-- Pasta 1 = o fio (só membro lê); pasta 2 = quem enviou (só ele grava e apaga).
-- Sem UPDATE: anexo não se troca, manda-se outro.
create policy "chat_anexos_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-anexos'
    and (select public.chat_eu_posso())
    and (storage.foldername(name))[1] in (select c::text from public.chat_minhas_conversas() c)
  );

create policy "chat_anexos_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-anexos'
    and (select public.chat_eu_posso())
    and (storage.foldername(name))[1] in (select c::text from public.chat_minhas_conversas() c)
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "chat_anexos_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-anexos'
    and (storage.foldername(name))[1] in (select c::text from public.chat_minhas_conversas() c)
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

notify pgrst, 'reload schema';

commit;
