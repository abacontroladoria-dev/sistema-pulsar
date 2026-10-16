-- ============================================================================
-- Chat da equipe liberado para todo usuário ativo (decisão de 16/10/2026)
--
-- 20261016120000 prendia o chat ao código de permissão `chat_equipe`, que nasce
-- sem grupo: na prática só admin e diretoria usavam, e a lista "Nova conversa"
-- saía quase vazia. Pedido: "devem aparecer todos os usuários".
--
-- A regra passa a ser UMA: usuário ativo, menos o perfil
-- `disponibilidade_terapeuta` (terapeuta externo que só preenche a própria
-- disponibilidade e nunca entra no Pulsar — o layout o redireciona).
--
-- O QUE MUDA
--   chat_usuario_pode(p)  passa a ser essa regra (para OUTRA pessoa)
--   chat_eu_posso()       a mesma regra para quem está logado — policies e RPCs
--   policies e RPCs       trocam usuario_tem_permissao('chat_equipe') por ela
--   public.permissoes     o código `chat_equipe` sai do catálogo (saiu do menu).
--                         Conferido em produção antes: nenhum grupo e nenhum
--                         ajuste individual o tinham.
--
-- Perder o acesso continua escondendo tudo: desativar o cadastro tira a leitura
-- dos fios e a pessoa some da lista dos outros (o histórico deles fica).
--
-- Reexecutável. Depends on: 20261016120000_chat_equipe.sql
-- ============================================================================

-- ============================================================================
-- A regra
-- ============================================================================
create or replace function public.chat_usuario_pode(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = p_usuario
      and u.ativo = true
      and u.role is distinct from 'disponibilidade_terapeuta'
  );
$$;

-- Sem parâmetro de propósito: quem chama só pergunta sobre si mesmo.
create or replace function public.chat_eu_posso()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.chat_usuario_pode(auth.uid());
$$;

revoke all on function public.chat_usuario_pode(uuid) from public, anon, authenticated;
revoke all on function public.chat_eu_posso()         from public, anon;
grant execute on function public.chat_eu_posso() to authenticated;

-- ============================================================================
-- RLS
-- ============================================================================
drop policy if exists chat_conversas_select on public.chat_conversas;
create policy chat_conversas_select on public.chat_conversas
  for select to authenticated
  using ((select public.chat_eu_posso()) and id in (select public.chat_minhas_conversas()));

drop policy if exists chat_membros_select on public.chat_membros;
create policy chat_membros_select on public.chat_membros
  for select to authenticated
  using ((select public.chat_eu_posso()) and conversa_id in (select public.chat_minhas_conversas()));

drop policy if exists chat_mensagens_select on public.chat_mensagens;
create policy chat_mensagens_select on public.chat_mensagens
  for select to authenticated
  using ((select public.chat_eu_posso()) and conversa_id in (select public.chat_minhas_conversas()));

-- ============================================================================
-- RPCs — mesmos corpos de 20261016120000, só a checagem de entrada muda
-- ============================================================================
create or replace function public.chat_abrir_direta(p_outro uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu    uuid := auth.uid();
  v_chave text;
  v_id    uuid;
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  if p_outro is null or p_outro = v_eu then
    raise exception 'escolha outra pessoa para conversar' using errcode = '22023';
  end if;
  if not public.chat_usuario_pode(p_outro) then
    raise exception 'essa pessoa não está ativa no Pulsar' using errcode = '42501';
  end if;

  v_chave := least(v_eu::text, p_outro::text) || ':' || greatest(v_eu::text, p_outro::text);

  insert into public.chat_conversas (tipo, chave_direta, criada_por)
  values ('direta', v_chave, v_eu)
  on conflict (chave_direta) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.chat_conversas where chave_direta = v_chave;
  end if;

  insert into public.chat_membros (conversa_id, usuario_id)
  values (v_id, v_eu), (v_id, p_outro)
  on conflict (conversa_id, usuario_id) do nothing;

  return v_id;
end;
$$;

create or replace function public.chat_enviar(p_conversa uuid, p_corpo text)
returns public.chat_mensagens
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_eu  uuid := auth.uid();
  v_msg public.chat_mensagens;
begin
  if not public.chat_eu_posso() then
    raise exception 'sem acesso ao Chat da equipe' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.chat_membros where conversa_id = p_conversa and usuario_id = v_eu
  ) then
    raise exception 'você não participa desta conversa' using errcode = '42501';
  end if;

  insert into public.chat_mensagens (conversa_id, autor_id, corpo)
  values (p_conversa, v_eu, btrim(p_corpo))
  returning * into v_msg;

  update public.chat_conversas set ultima_mensagem_em = v_msg.criada_em where id = p_conversa;
  update public.chat_membros set lido_ate = v_msg.criada_em
  where conversa_id = p_conversa and usuario_id = v_eu;

  return v_msg;
end;
$$;

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
  update public.chat_membros
     set lido_ate = greatest(coalesce(lido_ate, '-infinity'::timestamptz), now())
   where conversa_id = p_conversa and usuario_id = auth.uid();
end;
$$;

-- Todos os ativos (menos eu e o perfil de disponibilidade), em ordem de nome.
create or replace function public.chat_pessoas()
returns table (id uuid, nome text)
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
    select u.id, coalesce(nullif(btrim(u.nome), ''), 'Sem nome')::text
    from public.usuarios u
    where u.ativo = true
      and u.role is distinct from 'disponibilidade_terapeuta'
      and u.id <> auth.uid()
    order by 2;
end;
$$;

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
          and m.criada_em > coalesce(eu.lido_ate, '-infinity'::timestamptz)
      )
    from public.chat_membros eu
    join public.chat_conversas c on c.id = eu.conversa_id
    left join public.chat_membros o on o.conversa_id = c.id and o.usuario_id <> eu.usuario_id
    left join public.usuarios u on u.id = o.usuario_id
    left join lateral (
      select m.corpo, m.autor_id from public.chat_mensagens m
      where m.conversa_id = c.id
      order by m.criada_em desc
      limit 1
    ) ult on true
    where eu.usuario_id = auth.uid()
    order by coalesce(c.ultima_mensagem_em, c.criada_em) desc;
end;
$$;

-- chat_nao_lidas é SECURITY INVOKER e já passa pela RLS acima: não muda.

-- CREATE OR REPLACE mantém os grants; reafirmados por garantia.
revoke all on function public.chat_abrir_direta(uuid)    from public, anon;
revoke all on function public.chat_enviar(uuid, text)    from public, anon;
revoke all on function public.chat_marcar_lida(uuid)     from public, anon;
revoke all on function public.chat_pessoas()             from public, anon;
revoke all on function public.chat_conversas_lista()     from public, anon;
grant execute on function public.chat_abrir_direta(uuid) to authenticated;
grant execute on function public.chat_enviar(uuid, text) to authenticated;
grant execute on function public.chat_marcar_lida(uuid)  to authenticated;
grant execute on function public.chat_pessoas()          to authenticated;
grant execute on function public.chat_conversas_lista()  to authenticated;

-- ============================================================================
-- O código sai do catálogo (e de qualquer grupo, por garantia). As concessões
-- individuais caem junto pela FK ON DELETE CASCADE de usuarios_permissoes.
-- ============================================================================
do $$
begin
  if to_regclass('public.grupos_permissoes') is not null then
    update public.grupos_permissoes
       set modelo_permissoes = modelo_permissoes - 'chat_equipe'
     where modelo_permissoes ? 'chat_equipe';
  end if;
  if to_regclass('public.permissoes') is not null then
    delete from public.permissoes where codigo = 'chat_equipe';
  end if;
end;
$$;

comment on table public.chat_mensagens is
  'Mensagens do Chat da equipe. Leitura: membros do fio, se ativos (chat_eu_posso).';

notify pgrst, 'reload schema';
