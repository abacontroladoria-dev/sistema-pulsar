-- Disponibilidade do paciente: quanto tempo a criança pode passar na clínica.
--
-- O laudo costuma pedir muitas horas por semana, e a família quase nunca tem
-- todas. Até aqui esse dado vivia num CSV da Órbita que alguém sobe à mão no
-- "Novo Cronograma" e que some ao recarregar a página. Esta migration dá ao dado
-- uma casa no banco, alimentada por três caminhos:
--
--   - formulário público /disponibilidade-paciente (responsável, pelo CPF da
--     criança) → RPC disponibilidade_enviar_formulario, só service_role;
--   - aba "Disponibilidade" da ficha do paciente (equipe do Pulsar) → RPC
--     disponibilidade_salvar_equipe;
--   - carga inicial do CSV da Órbita → scripts/importar-disponibilidade-orbita.js.
--
-- Quatro decisões que valem explicação:
--
-- 1. HISTÓRICO IMUTÁVEL, não estado sobrescrito. Cada envio ou edição é uma
--    linha nova em pacientes_disponibilidade_versoes; a "atual" é a de maior
--    numero_versao. Nada é editado nem apagado — um trigger recusa UPDATE e
--    DELETE. O motivo é o caso que o usuário descreveu: pai preenche X, mãe
--    (divorciada) preenche Y. A equipe precisa ver as DUAS declarações, quem fez
--    cada uma e quando — não só a última.
--
-- 2. ESCRITA SÓ POR RPC. authenticated tem SELECT e nada mais; quem grava são as
--    funções SECURITY DEFINER abaixo. Sem isso, qualquer usuário com a tela
--    poderia reescrever o histórico por /rest/v1, e a trilha deixaria de ser
--    prova de nada.
--
-- 3. PRAZO DO RESPONSÁVEL no banco, não no handler. O responsável tem 5 dias a
--    partir do primeiro envio para corrigir; depois trava, e só a equipe reabre,
--    por 48h (pacientes_disponibilidade_liberacoes). A regra fica dentro da RPC,
--    com `for update` na linha do prazo, para dois envios simultâneos não
--    passarem juntos pela checagem.
--
-- 4. SEM `force row level security`, ao contrário de pacientes_dados_escolares.
--    Aqui as RPCs SECURITY DEFINER gravam como DONAS da tabela; com FORCE, elas
--    dependeriam do papel dono ter BYPASSRLS — algo que esta migration não
--    controla. Como authenticated/anon não têm GRANT de escrita nenhum, o FORCE
--    não fecharia porta alguma que já não esteja fechada.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Versões
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_disponibilidade_versoes (
  id                        bigint generated always as identity primary key,
  paciente_id               bigint not null
                              references public.pacientes(id_paciente) on delete cascade,

  -- Calculado pelo trigger de BEFORE INSERT. Qualquer valor enviado é ignorado.
  numero_versao             integer not null,

  -- ===== Escola =====
  -- null = não informado; false = não frequenta (horários obrigatoriamente nulos).
  frequenta_escola          boolean,
  escola_inicio             time,
  escola_fim                time,

  -- ===== Uma janela por dia, Seg–Sáb =====
  -- Os dois nulos = não vem nesse dia.
  seg_inicio time, seg_fim time,
  ter_inicio time, ter_fim time,
  qua_inicio time, qua_fim time,
  qui_inicio time, qui_fim time,
  sex_inicio time, sex_fim time,
  sab_inicio time, sab_fim time,

  -- ===== Quem declarou =====
  origem                    text not null,
  -- A pessoa da família que deu a informação. Obrigatória no formulário; na
  -- edição da equipe é opcional ("a mãe ligou e disse…").
  preenchido_por_nome       text,
  preenchido_por_parentesco text,
  preenchido_por_telefone   text,
  -- Mesmo indício de pacientes_dados_escolares.telefone_confere: últimos 8
  -- dígitos contra os responsáveis cadastrados. Indício, não prova.
  telefone_confere          boolean,

  -- ===== Quem registrou (usuário do Pulsar, só origem = 'equipe') =====
  -- Sem FK para usuarios de propósito: um `on delete set null` viraria UPDATE,
  -- que o trigger de imutabilidade recusa. O nome fica gravado junto para a
  -- trilha continuar legível mesmo que o usuário seja removido.
  registrado_por_usuario    uuid,
  registrado_por_nome       text,

  -- Calculado pelo trigger: o conteúdo é idêntico ao da versão anterior. O envio
  -- fica registrado mesmo assim ("confirmou sem mudanças").
  sem_alteracao             boolean not null default false,
  observacao                text,
  criado_em                 timestamptz not null default now(),

  constraint pac_disp_versoes_numero_unico unique (paciente_id, numero_versao),

  constraint pac_disp_versoes_origem_check
    check (origem in ('formulario', 'equipe', 'importacao_orbita')),

  -- Espelha pacientes_responsaveis.parentesco (20260828170050) e PARENTESCOS em
  -- frontend/types/responsavel.ts. Os três mudam juntos.
  constraint pac_disp_versoes_parentesco_check
    check (preenchido_por_parentesco is null or preenchido_por_parentesco in
      ('Mãe', 'Pai', 'Madrasta', 'Padrasto', 'Avó', 'Avô', 'Irmã', 'Irmão',
       'Tia', 'Tio', 'Tutor(a) legal', 'Responsável legal', 'Próprio paciente',
       'Outro')),

  constraint pac_disp_versoes_formulario_identificado
    check (origem <> 'formulario'
           or (preenchido_por_nome is not null and preenchido_por_parentesco is not null)),

  constraint pac_disp_versoes_equipe_identificada
    check (origem <> 'equipe' or registrado_por_usuario is not null),

  constraint pac_disp_versoes_textos_curtos
    check (coalesce(length(preenchido_por_nome), 0) <= 120
           and coalesce(length(preenchido_por_telefone), 0) <= 120
           and coalesce(length(registrado_por_nome), 0) <= 200
           and coalesce(length(observacao), 0) <= 500),

  constraint pac_disp_versoes_escola_check
    check ((escola_inicio is null) = (escola_fim is null)
           and (escola_inicio is null or escola_fim > escola_inicio)
           and (frequenta_escola is distinct from false or escola_inicio is null)),

  constraint pac_disp_versoes_janelas_check
    check (
          (seg_inicio is null) = (seg_fim is null) and (seg_inicio is null or seg_fim > seg_inicio)
      and (ter_inicio is null) = (ter_fim is null) and (ter_inicio is null or ter_fim > ter_inicio)
      and (qua_inicio is null) = (qua_fim is null) and (qua_inicio is null or qua_fim > qua_inicio)
      and (qui_inicio is null) = (qui_fim is null) and (qui_inicio is null or qui_fim > qui_inicio)
      and (sex_inicio is null) = (sex_fim is null) and (sex_inicio is null or sex_fim > sex_inicio)
      and (sab_inicio is null) = (sab_fim is null) and (sab_inicio is null or sab_fim > sab_inicio)
    )
);

create index if not exists idx_pac_disp_versoes_paciente
  on public.pacientes_disponibilidade_versoes (paciente_id, numero_versao desc);

comment on table public.pacientes_disponibilidade_versoes is
  'Disponibilidade semanal do paciente (escola + uma janela por dia Seg–Sáb). HISTÓRICO IMUTÁVEL: cada envio/edição é uma linha; a atual é a de maior numero_versao (ver vw_pacientes_disponibilidade_atual). Escrita só pelas RPCs disponibilidade_* ou pela service_role.';
comment on column public.pacientes_disponibilidade_versoes.preenchido_por_nome is
  'Pessoa da família que declarou a disponibilidade. Declarado, não autenticado.';
comment on column public.pacientes_disponibilidade_versoes.registrado_por_nome is
  'Usuário do Pulsar que registrou (origem = equipe). Cópia de usuarios.nome no momento do registro.';
comment on column public.pacientes_disponibilidade_versoes.sem_alteracao is
  'true = conteúdo idêntico à versão anterior do mesmo paciente (o envio confirmou sem mudar nada).';

-- ── numero_versao e sem_alteracao: calculados, nunca confiados ao cliente ─────
create or replace function public.sp_pac_disp_versoes_antes_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  ant public.pacientes_disponibilidade_versoes%rowtype;
begin
  -- Serializa as inserções do MESMO paciente: sem isto, dois envios simultâneos
  -- leriam o mesmo max(numero_versao) e um deles morreria no unique.
  perform pg_advisory_xact_lock(hashtext('pacientes_disponibilidade_versoes'), new.paciente_id::integer);

  select * into ant
  from public.pacientes_disponibilidade_versoes
  where paciente_id = new.paciente_id
  order by numero_versao desc
  limit 1;

  new.numero_versao := coalesce(ant.numero_versao, 0) + 1;
  new.criado_em := coalesce(new.criado_em, now());

  new.sem_alteracao := ant.id is not null
    and new.frequenta_escola is not distinct from ant.frequenta_escola
    and new.escola_inicio is not distinct from ant.escola_inicio
    and new.escola_fim    is not distinct from ant.escola_fim
    and new.seg_inicio is not distinct from ant.seg_inicio and new.seg_fim is not distinct from ant.seg_fim
    and new.ter_inicio is not distinct from ant.ter_inicio and new.ter_fim is not distinct from ant.ter_fim
    and new.qua_inicio is not distinct from ant.qua_inicio and new.qua_fim is not distinct from ant.qua_fim
    and new.qui_inicio is not distinct from ant.qui_inicio and new.qui_fim is not distinct from ant.qui_fim
    and new.sex_inicio is not distinct from ant.sex_inicio and new.sex_fim is not distinct from ant.sex_fim
    and new.sab_inicio is not distinct from ant.sab_inicio and new.sab_fim is not distinct from ant.sab_fim;

  return new;
end $$;

drop trigger if exists trg_pac_disp_versoes_antes_insert on public.pacientes_disponibilidade_versoes;
create trigger trg_pac_disp_versoes_antes_insert
  before insert on public.pacientes_disponibilidade_versoes
  for each row execute function public.sp_pac_disp_versoes_antes_insert();

-- ── Imutabilidade ─────────────────────────────────────────────────────────────
-- Recusa UPDATE e DELETE diretos. A exceção é o DELETE que chega por cascata
-- (paciente excluído): a ação da FK roda dentro de um trigger de RI, então
-- pg_trigger_depth() > 1 aqui. Para remover uma versão de teste à mão, o caminho
-- é o SQL Editor com `alter table ... disable trigger trg_..._imutavel`, de
-- forma consciente — nunca pela aplicação.
create or replace function public.sp_pac_disp_imutavel()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception '% é histórico imutável: % não é permitido', tg_table_name, tg_op
    using errcode = '42501';
end $$;

drop trigger if exists trg_pac_disp_versoes_imutavel on public.pacientes_disponibilidade_versoes;
create trigger trg_pac_disp_versoes_imutavel
  before update or delete on public.pacientes_disponibilidade_versoes
  for each row execute function public.sp_pac_disp_imutavel();

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Prazo de edição do responsável
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_disponibilidade_prazo (
  paciente_id       bigint primary key
                      references public.pacientes(id_paciente) on delete cascade,
  -- null = o responsável ainda não enviou pelo link (o formulário está aberto).
  prazo_edicao_ate  timestamptz,
  atualizado_em     timestamptz not null default now()
);

comment on table public.pacientes_disponibilidade_prazo is
  'Até quando o responsável pode corrigir a disponibilidade pelo formulário público. Primeiro envio: +5 dias (não estende em reenvio). Vencido: travado até a equipe liberar +48h.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Liberações de edição (botão "Liberar edição por 48h")
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_disponibilidade_liberacoes (
  id                 bigint generated always as identity primary key,
  paciente_id        bigint not null
                       references public.pacientes(id_paciente) on delete cascade,
  liberado_por       uuid not null,
  liberado_por_nome  text,
  liberado_em        timestamptz not null default now(),
  prazo_ate          timestamptz not null
);

create index if not exists idx_pac_disp_liberacoes_paciente
  on public.pacientes_disponibilidade_liberacoes (paciente_id, liberado_em desc);

comment on table public.pacientes_disponibilidade_liberacoes is
  'Cada liberação de edição feita pela equipe. Histórico imutável, entra na linha do tempo da aba Disponibilidade.';

drop trigger if exists trg_pac_disp_liberacoes_imutavel on public.pacientes_disponibilidade_liberacoes;
create trigger trg_pac_disp_liberacoes_imutavel
  before update or delete on public.pacientes_disponibilidade_liberacoes
  for each row execute function public.sp_pac_disp_imutavel();

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Versão atual por paciente
-- ═════════════════════════════════════════════════════════════════════════════
-- security_invoker: a view respeita a RLS de quem consulta, em vez da do dono.
create or replace view public.vw_pacientes_disponibilidade_atual
with (security_invoker = true) as
select distinct on (v.paciente_id)
  v.*,
  pz.prazo_edicao_ate,
  count(*) over (partition by v.paciente_id) as total_versoes
from public.pacientes_disponibilidade_versoes v
left join public.pacientes_disponibilidade_prazo pz on pz.paciente_id = v.paciente_id
order by v.paciente_id, v.numero_versao desc;

comment on view public.vw_pacientes_disponibilidade_atual is
  'Última versão da disponibilidade de cada paciente + prazo do responsável. Fonte para cronograma/ocupação (integração futura).';

-- ═════════════════════════════════════════════════════════════════════════════
-- RPCs
-- ═════════════════════════════════════════════════════════════════════════════

-- Converte o jsonb do cliente nas colunas de conteúdo. Campo ausente ou "" = null.
-- Horário inválido levanta erro de cast (22007), e o CHECK de janelas barra
-- fim <= início — as duas coisas chegam ao handler como recusa, não como dado.
create or replace function public.sp_pac_disp_hora(p jsonb, k text)
returns time
language sql
immutable
as $$
  select nullif(p ->> k, '')::time
$$;

-- ── Formulário público (só service_role) ──────────────────────────────────────
create or replace function public.disponibilidade_enviar_formulario(
  p_paciente_id bigint,
  p_cpf         text,
  p_dados       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cpf_cadastro text;
  v_prazo        timestamptz;
  v_versao       integer;
begin
  -- Porteiro: o CPF digitado precisa ser o do cadastro deste paciente. O handler
  -- já achou o paciente pelo CPF, mas o id volta do navegador — sem reconferir
  -- aqui, um POST montado à mão escreveria em qualquer paciente.
  select regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g')
    into v_cpf_cadastro
  from public.pacientes p
  where p.id_paciente = p_paciente_id
    and p.ativo = true
    and p.ficticio = false;

  if v_cpf_cadastro is null
     or length(v_cpf_cadastro) <> 11
     or v_cpf_cadastro <> regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g') then
    return jsonb_build_object('status', 'cpf_nao_confere');
  end if;

  insert into public.pacientes_disponibilidade_prazo (paciente_id)
  values (p_paciente_id)
  on conflict (paciente_id) do nothing;

  select prazo_edicao_ate into v_prazo
  from public.pacientes_disponibilidade_prazo
  where paciente_id = p_paciente_id
  for update;

  if v_prazo is not null and v_prazo <= now() then
    return jsonb_build_object('status', 'travado', 'prazo', v_prazo);
  end if;

  -- Primeiro envio abre a janela de 5 dias. Reenvio dentro dela NÃO estende:
  -- senão a janela nunca fecharia para quem reenvia todo dia.
  if v_prazo is null then
    v_prazo := now() + interval '5 days';
    update public.pacientes_disponibilidade_prazo
       set prazo_edicao_ate = v_prazo, atualizado_em = now()
     where paciente_id = p_paciente_id;
  end if;

  insert into public.pacientes_disponibilidade_versoes (
    paciente_id, numero_versao,
    frequenta_escola, escola_inicio, escola_fim,
    seg_inicio, seg_fim, ter_inicio, ter_fim, qua_inicio, qua_fim,
    qui_inicio, qui_fim, sex_inicio, sex_fim, sab_inicio, sab_fim,
    origem, preenchido_por_nome, preenchido_por_parentesco,
    preenchido_por_telefone, telefone_confere
  ) values (
    p_paciente_id, 0,
    (p_dados ->> 'frequenta_escola')::boolean,
    sp_pac_disp_hora(p_dados, 'escola_inicio'), sp_pac_disp_hora(p_dados, 'escola_fim'),
    sp_pac_disp_hora(p_dados, 'seg_inicio'), sp_pac_disp_hora(p_dados, 'seg_fim'),
    sp_pac_disp_hora(p_dados, 'ter_inicio'), sp_pac_disp_hora(p_dados, 'ter_fim'),
    sp_pac_disp_hora(p_dados, 'qua_inicio'), sp_pac_disp_hora(p_dados, 'qua_fim'),
    sp_pac_disp_hora(p_dados, 'qui_inicio'), sp_pac_disp_hora(p_dados, 'qui_fim'),
    sp_pac_disp_hora(p_dados, 'sex_inicio'), sp_pac_disp_hora(p_dados, 'sex_fim'),
    sp_pac_disp_hora(p_dados, 'sab_inicio'), sp_pac_disp_hora(p_dados, 'sab_fim'),
    'formulario',
    nullif(btrim(p_dados ->> 'preenchido_por_nome'), ''),
    nullif(p_dados ->> 'preenchido_por_parentesco', ''),
    nullif(btrim(p_dados ->> 'preenchido_por_telefone'), ''),
    (p_dados ->> 'telefone_confere')::boolean
  )
  returning numero_versao into v_versao;

  return jsonb_build_object('status', 'ok', 'prazo', v_prazo, 'numero_versao', v_versao);
end $$;

comment on function public.disponibilidade_enviar_formulario(bigint, text, jsonb) is
  'Envio do formulário público /disponibilidade-paciente. Reconfere o CPF, aplica o prazo (5 dias do 1º envio; travado depois) e grava uma nova versão. Só service_role.';

-- ── Edição interna (equipe) ───────────────────────────────────────────────────
create or replace function public.disponibilidade_salvar_equipe(
  p_paciente_id bigint,
  p_dados       jsonb
)
returns public.pacientes_disponibilidade_versoes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_linha public.pacientes_disponibilidade_versoes;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_pacientes') then
    raise exception 'Sem permissão para editar a disponibilidade deste paciente.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.pacientes where id_paciente = p_paciente_id) then
    raise exception 'Paciente % não encontrado.', p_paciente_id using errcode = 'P0002';
  end if;

  select nome into v_nome from public.usuarios where id = auth.uid();

  insert into public.pacientes_disponibilidade_versoes (
    paciente_id, numero_versao,
    frequenta_escola, escola_inicio, escola_fim,
    seg_inicio, seg_fim, ter_inicio, ter_fim, qua_inicio, qua_fim,
    qui_inicio, qui_fim, sex_inicio, sex_fim, sab_inicio, sab_fim,
    origem, preenchido_por_nome, preenchido_por_parentesco,
    registrado_por_usuario, registrado_por_nome, observacao
  ) values (
    p_paciente_id, 0,
    (p_dados ->> 'frequenta_escola')::boolean,
    sp_pac_disp_hora(p_dados, 'escola_inicio'), sp_pac_disp_hora(p_dados, 'escola_fim'),
    sp_pac_disp_hora(p_dados, 'seg_inicio'), sp_pac_disp_hora(p_dados, 'seg_fim'),
    sp_pac_disp_hora(p_dados, 'ter_inicio'), sp_pac_disp_hora(p_dados, 'ter_fim'),
    sp_pac_disp_hora(p_dados, 'qua_inicio'), sp_pac_disp_hora(p_dados, 'qua_fim'),
    sp_pac_disp_hora(p_dados, 'qui_inicio'), sp_pac_disp_hora(p_dados, 'qui_fim'),
    sp_pac_disp_hora(p_dados, 'sex_inicio'), sp_pac_disp_hora(p_dados, 'sex_fim'),
    sp_pac_disp_hora(p_dados, 'sab_inicio'), sp_pac_disp_hora(p_dados, 'sab_fim'),
    'equipe',
    nullif(btrim(p_dados ->> 'preenchido_por_nome'), ''),
    nullif(p_dados ->> 'preenchido_por_parentesco', ''),
    auth.uid(),
    coalesce(v_nome, 'Usuário do Pulsar'),
    nullif(btrim(p_dados ->> 'observacao'), '')
  )
  returning * into v_linha;

  return v_linha;
end $$;

comment on function public.disponibilidade_salvar_equipe(bigint, jsonb) is
  'Edição pela equipe na aba Disponibilidade. Cria nova versão (origem = equipe) com o usuário logado. Não mexe no prazo do responsável.';

-- ── Liberar edição do responsável por 48h ─────────────────────────────────────
-- Devolve o novo prazo. A tela só mostra sucesso quando recebe esse valor — é a
-- defesa contra a "falha silenciosa" de escrita barrada sem erro.
create or replace function public.disponibilidade_liberar_edicao(p_paciente_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_prazo timestamptz;
  v_atual timestamptz;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_pacientes') then
    raise exception 'Sem permissão para liberar a edição deste paciente.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.pacientes where id_paciente = p_paciente_id) then
    raise exception 'Paciente % não encontrado.', p_paciente_id using errcode = 'P0002';
  end if;

  insert into public.pacientes_disponibilidade_prazo (paciente_id)
  values (p_paciente_id)
  on conflict (paciente_id) do nothing;

  select prazo_edicao_ate into v_atual
  from public.pacientes_disponibilidade_prazo
  where paciente_id = p_paciente_id
  for update;

  -- `greatest`: liberar nunca ENCURTA uma janela que ainda tinha mais de 48h.
  v_prazo := greatest(coalesce(v_atual, now()), now() + interval '48 hours');

  update public.pacientes_disponibilidade_prazo
     set prazo_edicao_ate = v_prazo, atualizado_em = now()
   where paciente_id = p_paciente_id;

  select nome into v_nome from public.usuarios where id = auth.uid();

  insert into public.pacientes_disponibilidade_liberacoes
    (paciente_id, liberado_por, liberado_por_nome, prazo_ate)
  values
    (p_paciente_id, auth.uid(), coalesce(v_nome, 'Usuário do Pulsar'), v_prazo);

  return v_prazo;
end $$;

comment on function public.disponibilidade_liberar_edicao(bigint) is
  'Botão "Liberar edição por 48h" da aba Disponibilidade. Reabre o formulário do responsável e registra quem liberou. Retorna o novo prazo.';

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
-- Toda tabela nova em `public` nasce com RLS ligada e zero policies pelo event
-- trigger rls_auto_enable. RLS não substitui GRANT: sem o grant de SELECT o
-- PostgREST devolve 403 mesmo com a policy no lugar.
alter table public.pacientes_disponibilidade_versoes    enable row level security;
alter table public.pacientes_disponibilidade_prazo      enable row level security;
alter table public.pacientes_disponibilidade_liberacoes enable row level security;

-- Remoção por catálogo: RLS é OR entre policies, e uma permissiva sobrevivente
-- anularia o fechamento em silêncio.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('pacientes_disponibilidade_versoes',
                        'pacientes_disponibilidade_prazo',
                        'pacientes_disponibilidade_liberacoes')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Só leitura. Escrita: RPCs acima (SECURITY DEFINER) ou service_role.
create policy "pac_disp_versoes_select" on public.pacientes_disponibilidade_versoes
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

create policy "pac_disp_prazo_select" on public.pacientes_disponibilidade_prazo
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

create policy "pac_disp_liberacoes_select" on public.pacientes_disponibilidade_liberacoes
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

revoke all on public.pacientes_disponibilidade_versoes    from public, anon, authenticated;
revoke all on public.pacientes_disponibilidade_prazo      from public, anon, authenticated;
revoke all on public.pacientes_disponibilidade_liberacoes from public, anon, authenticated;
revoke all on public.vw_pacientes_disponibilidade_atual   from public, anon, authenticated;

grant select on public.pacientes_disponibilidade_versoes    to authenticated;
grant select on public.pacientes_disponibilidade_prazo      to authenticated;
grant select on public.pacientes_disponibilidade_liberacoes to authenticated;
grant select on public.vw_pacientes_disponibilidade_atual   to authenticated;

-- service_role: rotas públicas (leitura do estado) e o script de importação.
grant select, insert on public.pacientes_disponibilidade_versoes    to service_role;
grant select, insert, update on public.pacientes_disponibilidade_prazo to service_role;
grant select on public.pacientes_disponibilidade_liberacoes to service_role;
grant select on public.vw_pacientes_disponibilidade_atual   to service_role;

-- Funções nascem com EXECUTE para PUBLIC (e anon é PUBLIC): o revoke é o que
-- fecha /rest/v1/rpc. O formulário público passa pela service_role, nunca anon.
revoke all on function public.disponibilidade_enviar_formulario(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.disponibilidade_salvar_equipe(bigint, jsonb)          from public, anon;
revoke all on function public.disponibilidade_liberar_edicao(bigint)                from public, anon;
revoke all on function public.sp_pac_disp_hora(jsonb, text)                         from public, anon;
revoke all on function public.sp_pac_disp_versoes_antes_insert()                    from public, anon, authenticated;
revoke all on function public.sp_pac_disp_imutavel()                                from public, anon, authenticated;

grant execute on function public.disponibilidade_enviar_formulario(bigint, text, jsonb) to service_role;
grant execute on function public.disponibilidade_salvar_equipe(bigint, jsonb)          to authenticated;
grant execute on function public.disponibilidade_liberar_edicao(bigint)                to authenticated;
grant execute on function public.sp_pac_disp_hora(jsonb, text)                         to authenticated, service_role;
