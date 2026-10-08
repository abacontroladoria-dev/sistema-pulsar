-- Contratos do paciente: aba "Contratos" da ficha e tela "Status Contratos".
--
-- Plano: docs/PLANO_CONTRATOS_PACIENTE.md. Esta migration é a FASE 0, o ponto
-- de encontro entre as duas metades do trabalho:
--
--   - aba Contratos + Status Contratos (modo MANUAL): a equipe cria o contrato,
--     anexa o PDF e marca "assinado" com a data;
--   - integração D4Sign + WhatsApp (feita depois, por outra pessoa): o mesmo
--     registro passa a ser movido pelo webhook da D4Sign, pela RPC
--     contratos_registrar_evento_externo, só service_role.
--
-- Nada aqui é de prestador: remuneracao_contratos* e /cadastros/contratos são
-- contratos de PROFISSIONAL e não se misturam com isto.
--
-- Cinco decisões que valem explicação:
--
-- 1. DOIS EIXOS, UM GRAVADO. `status` é o andamento da ASSINATURA (rascunho →
--    enviado → aguardando → assinado; recusado/cancelado/expirado). A VIGÊNCIA
--    (vigente, a vencer, vencido, não iniciado) sai das datas e NUNCA é gravada:
--    gravada, precisaria de job diário para não mentir. "Expirado" é o LINK que
--    venceu sem assinatura; "vencido" é o CONTRATO que passou da data. São
--    coisas distintas e a tela mostra as duas.
--
-- 2. ESCRITA SÓ POR RPC. authenticated tem SELECT e nada mais. Mudar `status`
--    por /rest/v1 pularia a regra de transição e o histórico; as funções
--    SECURITY DEFINER abaixo checam a permissão, a transição e gravam o evento
--    na mesma transação.
--
-- 3. A REGRA DE TRANSIÇÃO MORA EM UM LUGAR NO BANCO (sp_contratos_transicao_ok)
--    e é espelhada em frontend/lib/contratos/status.ts. O teste de segurança
--    (fase 5) compara as duas matrizes célula a célula.
--
-- 4. HISTÓRICO IMUTÁVEL. pacientes_contratos_eventos só recebe INSERT; um
--    trigger recusa UPDATE e DELETE (mesma função de Disponibilidade).
--
-- 5. ARQUIVO SÓ PELA SERVICE_ROLE. O bucket `contratos-pacientes` é privado e
--    sem policy para authenticated. Quem grava e assina URL é a rota de API,
--    depois de conferir a permissão. O caminho NUNCA leva o nome do paciente
--    ({paciente_id}/{contrato_id}/{original|assinado}-{timestamp}.pdf), e o
--    caminho só é registrado por RPC de service_role — se fosse do navegador,
--    um usuário poderia apontar o contrato dele para o PDF de outro paciente e
--    baixá-lo pela rota de download.
--
-- Sem `force row level security` pelo mesmo motivo de 20261005160000: as RPCs
-- SECURITY DEFINER gravam como DONAS da tabela, e authenticated/anon não têm
-- GRANT de escrita nenhum — o FORCE não fecharia porta alguma.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Contratos
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_contratos (
  id                     bigint generated always as identity primary key,
  paciente_id            bigint not null
                           references public.pacientes(id_paciente) on delete cascade,

  tipo                   text not null,
  data_inicio            date not null,
  data_vencimento        date not null,

  -- Andamento da assinatura. Só muda pelas RPCs abaixo.
  status                 text not null default 'rascunho',
  assinado_em            timestamptz,
  origem_assinatura      text,

  -- Caminhos no bucket privado `contratos-pacientes`. Nunca uma URL.
  arquivo_original_path  text,
  -- Nome do arquivo como a equipe o subiu, só para exibir. Fica sob a RLS da
  -- tabela, nunca no caminho do storage.
  arquivo_original_nome  text,
  arquivo_assinado_path  text,

  -- Preenchidos pela integração D4Sign (fase 3).
  d4sign_documento_uuid  text,
  d4sign_cofre_uuid      text,
  link_expira_em         timestamptz,

  observacao             text,
  -- Soft delete, como Altas. Contrato cancelado continua ativo = true: cancelar
  -- é um STATUS (aparece na linha do tempo); `ativo = false` é para lançamento
  -- errado, e só a service_role faz.
  ativo                  boolean not null default true,

  criado_por_usuario_id  uuid,
  criado_por_nome        text,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),

  constraint pac_contratos_tipo_check
    check (tipo in ('avaliacao_neuropsicologica', 'terapias', 'tecnico_terapeutico_particular')),

  constraint pac_contratos_status_check
    check (status in ('rascunho', 'enviado', 'aguardando_assinatura', 'assinado',
                      'recusado', 'cancelado', 'expirado')),

  constraint pac_contratos_origem_assinatura_check
    check (origem_assinatura is null or origem_assinatura in ('manual', 'd4sign')),

  constraint pac_contratos_datas_check
    check (data_vencimento >= data_inicio),

  -- Assinado sem data de assinatura seria um contrato que "foi assinado" sem
  -- ninguém saber quando — o que a tela de status não consegue exibir.
  constraint pac_contratos_assinado_check
    check (status <> 'assinado' or (assinado_em is not null and origem_assinatura is not null)),

  constraint pac_contratos_textos_curtos
    check (coalesce(length(observacao), 0) <= 1000
           and coalesce(length(arquivo_original_nome), 0) <= 255
           and coalesce(length(criado_por_nome), 0) <= 200)
);

create unique index if not exists uq_pac_contratos_d4sign_documento
  on public.pacientes_contratos (d4sign_documento_uuid)
  where d4sign_documento_uuid is not null;

create index if not exists idx_pac_contratos_paciente
  on public.pacientes_contratos (paciente_id, tipo, data_inicio desc);

drop trigger if exists trg_pac_contratos_atualizado_em on public.pacientes_contratos;
create trigger trg_pac_contratos_atualizado_em
  before update on public.pacientes_contratos
  for each row execute function public.set_atualizado_em();

comment on table public.pacientes_contratos is
  'Contratos do PACIENTE (Avaliação Neuropsicológica, Terapias, Técnico Terapêutico Particular). status = andamento da assinatura; a vigência é calculada das datas, nunca gravada. Escrita só pelas RPCs contratos_* (ver 20261008160000).';
comment on column public.pacientes_contratos.status is
  'rascunho | enviado | aguardando_assinatura | assinado | recusado | cancelado | expirado. "expirado" = link de assinatura venceu sem assinatura (não confundir com contrato vencido).';
comment on column public.pacientes_contratos.arquivo_original_path is
  'Caminho no bucket privado contratos-pacientes: {paciente_id}/{contrato_id}/original-{timestamp}.pdf. Sem nome do paciente.';

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Signatários (retrato no momento do envio)
-- ═════════════════════════════════════════════════════════════════════════════
-- O cadastro do responsável pode mudar depois do envio (celular novo, e-mail
-- corrigido); o contrato precisa lembrar PARA QUEM foi. Por isso o retrato.
create table if not exists public.pacientes_contratos_signatarios (
  id                     bigint generated always as identity primary key,
  contrato_id            bigint not null
                           references public.pacientes_contratos(id) on delete cascade,
  responsavel_id         bigint references public.responsaveis(id) on delete set null,
  nome                   text not null,
  cpf                    text,
  email                  text,
  celular                text,
  d4sign_signatario_key  text,
  status                 text not null default 'pendente',
  assinado_em            timestamptz,
  link_enviado_em        timestamptz,
  envios                 integer not null default 0,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),

  constraint pac_contratos_sig_status_check
    check (status in ('pendente', 'assinado', 'recusado')),
  constraint pac_contratos_sig_envios_check
    check (envios >= 0)
);

create index if not exists idx_pac_contratos_sig_contrato
  on public.pacientes_contratos_signatarios (contrato_id);

drop trigger if exists trg_pac_contratos_sig_atualizado_em on public.pacientes_contratos_signatarios;
create trigger trg_pac_contratos_sig_atualizado_em
  before update on public.pacientes_contratos_signatarios
  for each row execute function public.set_atualizado_em();

comment on table public.pacientes_contratos_signatarios is
  'Quem assina cada contrato, com RETRATO de nome/cpf/email/celular no envio. Fonte: responsaveis via pacientes_responsaveis (financeiro; sem ele, filiacao_1). Nunca as colunas legadas pacientes.responsavel_*. Escrita só service_role (integração D4Sign).';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Eventos (linha do tempo, imutável)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.pacientes_contratos_eventos (
  id                  bigint generated always as identity primary key,
  -- O contrato só some por cascata do paciente, e aí o histórico vai junto (o
  -- trigger de imutabilidade deixa passar o DELETE que vem de cascata).
  contrato_id         bigint not null
                        references public.pacientes_contratos(id) on delete cascade,
  tipo                text not null,
  status_antes        text,
  status_depois       text,
  detalhe             jsonb,
  origem              text not null,
  -- Sem FK para usuarios: um `on delete set null` viraria UPDATE, que o
  -- trigger de imutabilidade recusa. O nome fica gravado junto.
  usuario_id          uuid,
  usuario_nome        text,
  criado_em           timestamptz not null default now(),
  criado_em_brasilia  text,

  constraint pac_contratos_ev_tipo_check
    check (tipo in ('criado', 'editado', 'arquivo_anexado', 'enviado_d4sign',
                    'link_enviado_whatsapp', 'link_reenviado', 'assinado', 'recusado',
                    'cancelado', 'expirado', 'assinado_manual', 'status_corrigido')),
  constraint pac_contratos_ev_origem_check
    check (origem in ('usuario', 'd4sign', 'sistema'))
);

create index if not exists idx_pac_contratos_ev_contrato
  on public.pacientes_contratos_eventos (contrato_id, criado_em desc);

create or replace function public.sp_pac_contratos_ev_brasilia()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.criado_em := coalesce(new.criado_em, now());
  new.criado_em_brasilia := to_char(new.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end $$;

drop trigger if exists trg_pac_contratos_ev_brasilia on public.pacientes_contratos_eventos;
create trigger trg_pac_contratos_ev_brasilia
  before insert on public.pacientes_contratos_eventos
  for each row execute function public.sp_pac_contratos_ev_brasilia();

-- Reusa a função de imutabilidade da Disponibilidade (20261005160000): recusa
-- UPDATE/DELETE, exceto o DELETE que chega por cascata.
drop trigger if exists trg_pac_contratos_ev_imutavel on public.pacientes_contratos_eventos;
create trigger trg_pac_contratos_ev_imutavel
  before update or delete on public.pacientes_contratos_eventos
  for each row execute function public.sp_pac_disp_imutavel();

comment on table public.pacientes_contratos_eventos is
  'Linha do tempo de cada contrato. HISTÓRICO IMUTÁVEL (trigger recusa UPDATE/DELETE). Toda RPC contratos_* grava aqui na mesma transação.';

-- ═════════════════════════════════════════════════════════════════════════════
-- D) Log cru do webhook da D4Sign (fase 3)
-- ═════════════════════════════════════════════════════════════════════════════
-- Modelo: central.provider_webhook_logs (20260924180300). Só service_role.
create table if not exists public.d4sign_webhook_logs (
  id              bigint generated always as identity primary key,
  recebido_em     timestamptz not null default now(),
  documento_uuid  text,
  tipo_evento     text,
  payload         jsonb not null,
  processado      boolean not null default false,
  processado_em   timestamptz,
  erro            text
);

create index if not exists idx_d4sign_webhook_logs_documento
  on public.d4sign_webhook_logs (documento_uuid, recebido_em desc);

comment on table public.d4sign_webhook_logs is
  'Payload cru de todo POST recebido da D4Sign. Só service_role. O status do contrato NÃO vem daqui: o webhook reconsulta a D4Sign antes de chamar contratos_registrar_evento_externo.';

-- ═════════════════════════════════════════════════════════════════════════════
-- E) Regra de transição (espelhada em frontend/lib/contratos/status.ts)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.sp_contratos_transicao_ok(p_de text, p_para text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_de
    when 'rascunho'              then p_para in ('enviado', 'assinado', 'cancelado')
    when 'enviado'               then p_para in ('aguardando_assinatura', 'assinado', 'recusado', 'cancelado', 'expirado')
    when 'aguardando_assinatura' then p_para in ('assinado', 'recusado', 'cancelado', 'expirado')
    -- Link vencido: reenviar gera link novo (volta a aguardar) ou o documento
    -- sobe de novo; a assinatura ainda pode chegar atrasada pela D4Sign.
    when 'expirado'              then p_para in ('enviado', 'aguardando_assinatura', 'assinado', 'cancelado')
    when 'recusado'              then p_para in ('cancelado')
    -- Contrato assinado só sai por rescisão (Cancelado). Nunca volta a rascunho.
    when 'assinado'              then p_para in ('cancelado')
    else false
  end
$$;

comment on function public.sp_contratos_transicao_ok(text, text) is
  'Matriz de transição do status do contrato do paciente. Espelho: frontend/lib/contratos/status.ts (TRANSICOES). Mudou aqui, muda lá.';

-- Porteiro comum às RPCs da equipe.
create or replace function public.sp_contratos_exigir_equipe()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_pacientes') then
    raise exception 'Sem permissão para alterar contratos de paciente.'
      using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = auth.uid();
  return coalesce(v_nome, 'Usuário do Pulsar');
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- F) RPCs da equipe (aba Contratos)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.contratos_criar(
  p_paciente_id      bigint,
  p_tipo             text,
  p_data_inicio      date,
  p_data_vencimento  date,
  p_observacao       text default null
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_linha public.pacientes_contratos;
begin
  v_nome := public.sp_contratos_exigir_equipe();

  if not exists (select 1 from public.pacientes where id_paciente = p_paciente_id) then
    raise exception 'Paciente % não encontrado.', p_paciente_id using errcode = 'P0002';
  end if;

  insert into public.pacientes_contratos (
    paciente_id, tipo, data_inicio, data_vencimento, status, observacao,
    criado_por_usuario_id, criado_por_nome
  ) values (
    p_paciente_id, p_tipo, p_data_inicio, p_data_vencimento, 'rascunho',
    nullif(btrim(p_observacao), ''), auth.uid(), v_nome
  )
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (v_linha.id, 'criado', null, 'rascunho',
     jsonb_build_object('tipo', p_tipo, 'data_inicio', p_data_inicio, 'data_vencimento', p_data_vencimento),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_criar(bigint, text, date, date, text) is
  'Aba Contratos → "Novo contrato". Cria em Rascunho e registra o evento "criado".';

-- Só enquanto Rascunho: depois de enviado, o documento na D4Sign é o que vale,
-- e mudar data por aqui deixaria os dois discordando.
create or replace function public.contratos_editar_rascunho(
  p_id               bigint,
  p_tipo             text,
  p_data_inicio      date,
  p_data_vencimento  date,
  p_observacao       text default null
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_antes public.pacientes_contratos;
  v_linha public.pacientes_contratos;
begin
  v_nome := public.sp_contratos_exigir_equipe();

  select * into v_antes from public.pacientes_contratos
  where id = p_id and ativo for update;
  if v_antes.id is null then
    raise exception 'Contrato % não encontrado.', p_id using errcode = 'P0002';
  end if;
  if v_antes.status <> 'rascunho' then
    raise exception 'Só é possível editar um contrato em Rascunho.' using errcode = '22023';
  end if;

  update public.pacientes_contratos
     set tipo = p_tipo,
         data_inicio = p_data_inicio,
         data_vencimento = p_data_vencimento,
         observacao = nullif(btrim(p_observacao), '')
   where id = p_id
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (p_id, 'editado', 'rascunho', 'rascunho',
     jsonb_build_object(
       'antes',  jsonb_build_object('tipo', v_antes.tipo, 'data_inicio', v_antes.data_inicio,
                                    'data_vencimento', v_antes.data_vencimento),
       'depois', jsonb_build_object('tipo', p_tipo, 'data_inicio', p_data_inicio,
                                    'data_vencimento', p_data_vencimento)),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_editar_rascunho(bigint, text, date, date, text) is
  'Edita tipo/datas/observação de um contrato AINDA em Rascunho. Fora disso, recusa.';

create or replace function public.contratos_marcar_assinado_manual(
  p_id           bigint,
  p_assinado_em  date
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_antes public.pacientes_contratos;
  v_linha public.pacientes_contratos;
begin
  v_nome := public.sp_contratos_exigir_equipe();

  select * into v_antes from public.pacientes_contratos
  where id = p_id and ativo for update;
  if v_antes.id is null then
    raise exception 'Contrato % não encontrado.', p_id using errcode = 'P0002';
  end if;
  -- A marcação manual cobre o contrato assinado em papel ou fora do sistema.
  -- Recusado/cancelado/assinado não entram (a matriz recusa): lá a decisão já
  -- foi tomada.
  if not public.sp_contratos_transicao_ok(v_antes.status, 'assinado') then
    raise exception 'Não é possível marcar como assinado um contrato %.', v_antes.status
      using errcode = '22023';
  end if;
  if p_assinado_em is null
     or p_assinado_em > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data da assinatura não pode ficar em branco nem no futuro.'
      using errcode = '22023';
  end if;

  update public.pacientes_contratos
     set status = 'assinado',
         -- Meio-dia de Brasília: uma data sem hora, gravada em timestamptz, não
         -- pode virar o dia anterior ao ser exibida em outro fuso.
         assinado_em = (p_assinado_em + time '12:00') at time zone 'America/Sao_Paulo',
         origem_assinatura = 'manual'
   where id = p_id
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (p_id, 'assinado_manual', v_antes.status, 'assinado',
     jsonb_build_object('assinado_em', p_assinado_em),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_marcar_assinado_manual(bigint, date) is
  'Marca o contrato como assinado fora da D4Sign (papel). Data obrigatória, não futura.';

create or replace function public.contratos_cancelar(
  p_id     bigint,
  p_motivo text
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_antes public.pacientes_contratos;
  v_linha public.pacientes_contratos;
begin
  v_nome := public.sp_contratos_exigir_equipe();

  if coalesce(length(btrim(p_motivo)), 0) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;

  select * into v_antes from public.pacientes_contratos
  where id = p_id and ativo for update;
  if v_antes.id is null then
    raise exception 'Contrato % não encontrado.', p_id using errcode = 'P0002';
  end if;
  if not public.sp_contratos_transicao_ok(v_antes.status, 'cancelado') then
    raise exception 'Não é possível cancelar um contrato %.', v_antes.status using errcode = '22023';
  end if;

  update public.pacientes_contratos
     set status = 'cancelado'
   where id = p_id
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (p_id, 'cancelado', v_antes.status, 'cancelado',
     jsonb_build_object('motivo', left(btrim(p_motivo), 500)),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_cancelar(bigint, text) is
  'Cancela o contrato no Pulsar (motivo obrigatório). Se já estiver na D4Sign, a rota de API da fase 3 cancela lá antes de chamar esta função.';

-- ═════════════════════════════════════════════════════════════════════════════
-- G) RPCs só service_role (rotas de API e webhook)
-- ═════════════════════════════════════════════════════════════════════════════

-- Registra o PDF que a rota de upload acabou de gravar no bucket. Recebe o
-- usuário já conferido pela rota — por isso é só service_role.
create or replace function public.contratos_registrar_arquivo(
  p_id            bigint,
  p_qual          text,
  p_path          text,
  p_nome          text,
  p_usuario_id    uuid,
  p_usuario_nome  text
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.pacientes_contratos;
  v_linha public.pacientes_contratos;
begin
  select * into v_antes from public.pacientes_contratos
  where id = p_id and ativo for update;
  if v_antes.id is null then
    raise exception 'Contrato % não encontrado.', p_id using errcode = 'P0002';
  end if;

  -- O caminho tem de ser deste contrato: {paciente_id}/{contrato_id}/...
  if p_path is null
     or p_path not like (v_antes.paciente_id::text || '/' || v_antes.id::text || '/%') then
    raise exception 'Caminho de arquivo inválido para o contrato %.', p_id using errcode = '22023';
  end if;

  if p_qual = 'original' then
    if v_antes.status in ('cancelado') then
      raise exception 'Contrato cancelado não recebe arquivo.' using errcode = '22023';
    end if;
    update public.pacientes_contratos
       set arquivo_original_path = p_path,
           arquivo_original_nome = left(nullif(btrim(p_nome), ''), 255)
     where id = p_id
    returning * into v_linha;
  elsif p_qual = 'assinado' then
    update public.pacientes_contratos
       set arquivo_assinado_path = p_path
     where id = p_id
    returning * into v_linha;
  else
    raise exception 'Tipo de arquivo inválido: %.', p_qual using errcode = '22023';
  end if;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (p_id, 'arquivo_anexado', v_antes.status, v_antes.status,
     jsonb_build_object('qual', p_qual,
                        'substituiu', case when p_qual = 'original'
                                           then v_antes.arquivo_original_path is not null
                                           else v_antes.arquivo_assinado_path is not null end),
     case when p_usuario_id is null then 'sistema' else 'usuario' end,
     p_usuario_id, p_usuario_nome);

  return v_linha;
end $$;

comment on function public.contratos_registrar_arquivo(bigint, text, text, text, uuid, text) is
  'Registra o PDF (original ou assinado) gravado no bucket contratos-pacientes. Só service_role: o caminho nunca vem do navegador.';

-- Ponto de entrada da integração D4Sign/WhatsApp. IDEMPOTENTE: se o contrato já
-- está no status pedido e o evento é o mesmo, não grava nada de novo e devolve
-- a linha — o webhook pode chegar duas vezes.
--
-- p_campos aceita SÓ estas chaves (o resto é ignorado):
--   d4sign_documento_uuid, d4sign_cofre_uuid, link_expira_em,
--   arquivo_assinado_path, assinado_em
create or replace function public.contratos_registrar_evento_externo(
  p_contrato_id  bigint,
  p_tipo_evento  text,
  p_status_novo  text,
  p_detalhe      jsonb default null,
  p_origem       text default 'd4sign',
  p_campos       jsonb default '{}'::jsonb
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes public.pacientes_contratos;
  v_linha public.pacientes_contratos;
  v_status text;
  v_c jsonb := coalesce(p_campos, '{}'::jsonb);
begin
  if p_origem not in ('d4sign', 'sistema') then
    raise exception 'Origem inválida: %.', p_origem using errcode = '22023';
  end if;

  select * into v_antes from public.pacientes_contratos
  where id = p_contrato_id and ativo for update;
  if v_antes.id is null then
    raise exception 'Contrato % não encontrado.', p_contrato_id using errcode = 'P0002';
  end if;

  v_status := coalesce(p_status_novo, v_antes.status);

  -- Idempotência: o contrato já está no status pedido e o último evento dele é
  -- este mesmo tipo — é o webhook chegando de novo. "link_reenviado" fica de
  -- fora: dois reenvios seguidos são dois fatos.
  if v_status = v_antes.status
     and p_tipo_evento <> 'link_reenviado'
     and p_tipo_evento = (select e.tipo from public.pacientes_contratos_eventos e
                          where e.contrato_id = p_contrato_id
                          order by e.id desc limit 1) then
    return v_antes;
  end if;

  if v_status <> v_antes.status and not public.sp_contratos_transicao_ok(v_antes.status, v_status) then
    raise exception 'Transição inválida: % → %.', v_antes.status, v_status using errcode = '22023';
  end if;

  update public.pacientes_contratos
     set status = v_status,
         d4sign_documento_uuid = coalesce(v_c ->> 'd4sign_documento_uuid', d4sign_documento_uuid),
         d4sign_cofre_uuid     = coalesce(v_c ->> 'd4sign_cofre_uuid', d4sign_cofre_uuid),
         link_expira_em        = coalesce((v_c ->> 'link_expira_em')::timestamptz, link_expira_em),
         arquivo_assinado_path = case
           when v_c ? 'arquivo_assinado_path'
                and (v_c ->> 'arquivo_assinado_path') like (paciente_id::text || '/' || id::text || '/%')
             then v_c ->> 'arquivo_assinado_path'
           else arquivo_assinado_path end,
         assinado_em = case
           when v_status = 'assinado'
             then coalesce((v_c ->> 'assinado_em')::timestamptz, assinado_em, now())
           else assinado_em end,
         origem_assinatura = case
           when v_status = 'assinado' and v_antes.status <> 'assinado' then 'd4sign'
           else origem_assinatura end
   where id = p_contrato_id
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem)
  values
    (p_contrato_id, p_tipo_evento, v_antes.status, v_status, p_detalhe, p_origem);

  return v_linha;
end $$;

comment on function public.contratos_registrar_evento_externo(bigint, text, text, jsonb, text, jsonb) is
  'Webhook D4Sign / envio WhatsApp / job de expiração. Só service_role. Idempotente; valida a transição; grava o evento. NUNCA chamar com dado vindo só do payload: reconsultar a D4Sign antes.';

-- ═════════════════════════════════════════════════════════════════════════════
-- H) Bucket privado
-- ═════════════════════════════════════════════════════════════════════════════
-- Sem policy nenhuma em storage.objects para este bucket: authenticated não
-- lista, não baixa, não grava. Só service_role (que ignora RLS), pelas rotas
-- /api/contratos/*.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contratos-pacientes',
  'contratos-pacientes',
  false,
  10485760,                     -- 10 MiB; contrato em PDF tem poucas centenas de KB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.pacientes_contratos             enable row level security;
alter table public.pacientes_contratos_signatarios enable row level security;
alter table public.pacientes_contratos_eventos     enable row level security;
alter table public.d4sign_webhook_logs             enable row level security;

-- Remoção por catálogo: RLS é OR entre policies; uma permissiva sobrevivente
-- anularia o fechamento em silêncio.
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('pacientes_contratos', 'pacientes_contratos_signatarios',
                        'pacientes_contratos_eventos', 'd4sign_webhook_logs')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Leitura: quem mantém o cadastro (aba Contratos) ou quem acompanha (Status
-- Contratos). Signatários são a exceção: guardam CPF, e-mail e celular do
-- responsável, e a Status Contratos não usa nada disso — só quem mantém o
-- cadastro lê. d4sign_webhook_logs fica SEM policy: só service_role.
create policy "pac_contratos_select" on public.pacientes_contratos
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes')
         or public.usuario_tem_permissao('status_contratos'));

create policy "pac_contratos_sig_select" on public.pacientes_contratos_signatarios
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

create policy "pac_contratos_ev_select" on public.pacientes_contratos_eventos
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes')
         or public.usuario_tem_permissao('status_contratos'));

revoke all on public.pacientes_contratos             from public, anon, authenticated;
revoke all on public.pacientes_contratos_signatarios from public, anon, authenticated;
revoke all on public.pacientes_contratos_eventos     from public, anon, authenticated;
revoke all on public.d4sign_webhook_logs             from public, anon, authenticated;

grant select on public.pacientes_contratos             to authenticated;
grant select on public.pacientes_contratos_signatarios to authenticated;
grant select on public.pacientes_contratos_eventos     to authenticated;

-- service_role: rotas de API (Status Contratos, upload/download) e integração.
grant select, insert, update on public.pacientes_contratos             to service_role;
grant select, insert, update on public.pacientes_contratos_signatarios to service_role;
grant select, insert         on public.pacientes_contratos_eventos     to service_role;
grant select, insert, update on public.d4sign_webhook_logs             to service_role;

-- Funções nascem com EXECUTE para PUBLIC (e anon é PUBLIC): o revoke fecha /rest/v1/rpc.
revoke all on function public.sp_contratos_transicao_ok(text, text)          from public, anon;
revoke all on function public.sp_contratos_exigir_equipe()                   from public, anon, authenticated;
revoke all on function public.sp_pac_contratos_ev_brasilia()                 from public, anon, authenticated;
revoke all on function public.contratos_criar(bigint, text, date, date, text) from public, anon;
revoke all on function public.contratos_editar_rascunho(bigint, text, date, date, text) from public, anon;
revoke all on function public.contratos_marcar_assinado_manual(bigint, date) from public, anon;
revoke all on function public.contratos_cancelar(bigint, text)               from public, anon;
revoke all on function public.contratos_registrar_arquivo(bigint, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.contratos_registrar_evento_externo(bigint, text, text, jsonb, text, jsonb) from public, anon, authenticated;

grant execute on function public.sp_contratos_transicao_ok(text, text)          to authenticated, service_role;
grant execute on function public.contratos_criar(bigint, text, date, date, text) to authenticated;
grant execute on function public.contratos_editar_rascunho(bigint, text, date, date, text) to authenticated;
grant execute on function public.contratos_marcar_assinado_manual(bigint, date) to authenticated;
grant execute on function public.contratos_cancelar(bigint, text)               to authenticated;
grant execute on function public.contratos_registrar_arquivo(bigint, text, text, text, uuid, text) to service_role;
grant execute on function public.contratos_registrar_evento_externo(bigint, text, text, jsonb, text, jsonb) to service_role;
