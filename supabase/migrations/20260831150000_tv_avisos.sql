-- Carrossel de avisos da TV do saguão (/tv).
--
-- O painel esquerdo da TV tem dois estados: CHAMADA (nome do responsável, 96px)
-- e ESPERA. O de espera é o que fica na tela quase o dia inteiro, e até aqui era
-- uma ilustração fixa com "Atendimento em andamento" — espaço nobre dizendo só
-- "aguarde". Esta tabela é a fila de imagens que o marketing coloca ali.
--
-- A chamada continua tendo precedência absoluta: o carrossel vive apenas no ramo
-- de espera, e some inteiro quando alguém é chamado. Nada disso divide tela com
-- o nome do paciente, que é o motivo de a TV existir.
--
-- ─── Por que o bucket é PÚBLICO ──────────────────────────────────────────────
--
-- Ao contrário de `pacientes-fotos` (privado, LGPD — 20260826100400), o conteúdo
-- aqui é cartaz de parede: feito para ser visto por toda a sala de espera. Não há
-- dado pessoal a proteger.
--
-- E há um motivo técnico: a TV roda SEM CONTA (/tv é rota pública em proxy.ts),
-- num quiosque ligado o dia inteiro. URL assinada expira em 15 min e obrigaria a
-- tela a renovar cada imagem indefinidamente — mais uma coisa para falhar em
-- silêncio às 3h da manhã e deixar a TV com quadrado vazio. `getPublicUrl` não
-- expira.
--
-- ─── Ordem ───────────────────────────────────────────────────────────────────
--
-- `ordem` é int com empate resolvido por `criado_em`: a UI mexe com setas ↑↓ e
-- reescreve o bloco inteiro, mas uma linha inserida enquanto alguém reordenava
-- não pode embaralhar a lista. Ordenação total sempre, nunca parcial.

create table if not exists public.tv_avisos (
  id uuid primary key default gen_random_uuid(),

  -- PATH do objeto no bucket, NUNCA a URL. Mesma disciplina de
  -- `pacientes.foto_path`: a URL é derivada na leitura, o path é o dado.
  -- Trocar a imagem grava um objeto novo — sobrescrever o mesmo path faria o
  -- cache do navegador (e o da TV, que nunca recarrega) servir o cartaz velho.
  caminho text not null,

  -- Rótulo interno, só para o marketing se achar na lista de gestão. NÃO
  -- aparece na TV: a informação do aviso está na imagem, e uma legenda por cima
  -- competiria com ela.
  titulo text,

  ordem int not null default 0,

  -- Desligar sem apagar: campanha sazonal volta no ano seguinte, e apagar o
  -- objeto obrigaria o marketing a subir o mesmo arquivo de novo.
  ativo boolean not null default true,

  criado_em       timestamptz not null default now(),
  criado_por_id   uuid references public.usuarios(id),
  criado_por_nome text,

  atualizado_em       timestamptz not null default now(),
  atualizado_por_id   uuid references public.usuarios(id),
  atualizado_por_nome text,
  -- String já formatada em horário de Brasília, igual a
  -- laudos_acompanhamento.atualizado_em_brasilia. Coluna GERADA não serve:
  -- to_char() e AT TIME ZONE não são IMMUTABLE.
  atualizado_em_brasilia text
);

-- A única pergunta que a TV faz: "os ativos, na ordem". Índice parcial porque
-- aviso inativo nunca entra nessa leitura.
create index if not exists idx_tv_avisos_ativos
  on public.tv_avisos (ordem, criado_em)
  where ativo;

create or replace function public.set_tv_avisos_atualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.atualizado_em_brasilia :=
    to_char(new.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end;
$$;

drop trigger if exists trg_tv_avisos_atualizado on public.tv_avisos;
create trigger trg_tv_avisos_atualizado
  before insert or update on public.tv_avisos
  for each row execute function public.set_tv_avisos_atualizado();

comment on table public.tv_avisos is
  'Fila de imagens do carrossel de avisos da TV do saguão (/tv), mantida pelo marketing em /tv-avisos. Aparece apenas no estado de ESPERA do painel esquerdo — a chamada de paciente tem precedência e ocupa a tela sozinha. Sem nenhum aviso ativo, a TV volta à ilustração fixa "Atendimento em andamento".';
comment on column public.tv_avisos.caminho is
  'Path do objeto no bucket `tv-avisos`, nunca a URL. Cada troca grava um objeto NOVO: sobrescrever o path faria a TV, que nunca recarrega, continuar servindo o cartaz antigo.';
comment on column public.tv_avisos.titulo is
  'Rótulo interno para o marketing se localizar na lista. NÃO é exibido na TV.';
comment on column public.tv_avisos.ordem is
  'Sequência no carrossel, reescrita em bloco pelas setas da UI. Empate desfeito por criado_em para a ordenação ser sempre total.';
comment on column public.tv_avisos.ativo is
  'Tira do ar sem apagar o objeto — campanha sazonal volta no ano seguinte.';

-- ===== RLS =====
--
-- Permissão nova `tv_avisos` (seed em 20260831150100). O ramo por PAPEL é
-- obrigatório: usuario_tem_permissao() lê usuarios_permissoes e IGNORA os
-- roleDefaults do frontend — sem ele, o admin que entra pelo papel veria a tela
-- e não conseguiria gravar. Mesmo padrão de 20260828150000.
--
-- ⚠️ RLS bloqueando WRITE não gera erro visível no frontend: a gravação
-- "funciona" e não grava. Se o upload aparecer e sumir ao recarregar,
-- suspeitar daqui ANTES do frontend.
--
-- COM policy de DELETE, ao contrário de laudos_acompanhamento: aqui não há
-- registro histórico a preservar. Cartaz errado no ar precisa poder ser
-- removido, e `ativo = false` já cobre o caso de "tirar sem perder".
--
-- A TV NÃO lê por esta RLS: /api/tv/avisos usa service_role, exatamente como
-- /api/tv/chamadas. Nenhuma policy precisa ser afrouxada para o anon.

alter table public.tv_avisos enable row level security;

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''tv_avisos'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'']))';
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tv_avisos'
  loop
    execute format('drop policy %I on public.tv_avisos', pol.policyname);
  end loop;

  execute format(
    'create policy tv_avisos_select on public.tv_avisos'
    || ' for select to authenticated using (%s)', cond);
  execute format(
    'create policy tv_avisos_insert on public.tv_avisos'
    || ' for insert to authenticated with check (%s)', cond);
  execute format(
    'create policy tv_avisos_update on public.tv_avisos'
    || ' for update to authenticated using (%s) with check (%s)', cond, cond);
  execute format(
    'create policy tv_avisos_delete on public.tv_avisos'
    || ' for delete to authenticated using (%s)', cond);
end $$;

revoke all on public.tv_avisos from public;
revoke all on public.tv_avisos from anon;
revoke all on public.tv_avisos from authenticated;
grant select, insert, update, delete on public.tv_avisos to authenticated;

alter table public.tv_avisos force row level security;

-- ===== BUCKET =====
--
-- ATENÇÃO AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o
-- SQL Editor recusar com "must be owner of table objects", crie as policies
-- pelo Dashboard (Storage > tv-avisos > Policies) usando EXATAMENTE as mesmas
-- expressões. O INSERT em storage.buckets funciona normal.
--
-- 10 MiB e não 5: cartaz de marketing é feito para uma TV em 1080p e chega em
-- PNG grande com frequência. O limite existe para barrar o acidente (vídeo
-- renomeado, PSD exportado errado), não para forçar otimização.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tv-avisos',
  'tv-avisos',
  true,                       -- PÚBLICO: cartaz de parede, e a TV lê sem conta.
  10485760,                   -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tv_avisos_objects_select" on storage.objects;
drop policy if exists "tv_avisos_objects_insert" on storage.objects;
drop policy if exists "tv_avisos_objects_update" on storage.objects;
drop policy if exists "tv_avisos_objects_delete" on storage.objects;

-- SELECT para `public` (inclui anon): é o que permite a TV sem conta exibir a
-- imagem. Bucket público sem esta policy responde 400 na URL pública.
create policy "tv_avisos_objects_select"
  on storage.objects for select
  to public
  using (bucket_id = 'tv-avisos');

-- Escrita continua exigindo a permissão. Público para LER não é público para
-- ESCREVER — sem isto, qualquer anon substituiria o que passa na TV do saguão.
--
-- O `or remuneracao_has_role(...)` repete a `cond` da RLS da tabela pela mesma
-- razão dali: usuario_tem_permissao() ignora os roleDefaults do frontend, então
-- sem ele o admin veria a tela e o upload falharia — e falha de storage policy
-- também é silenciosa do lado do usuário.
create policy "tv_avisos_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );

create policy "tv_avisos_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  )
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );

create policy "tv_avisos_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );
