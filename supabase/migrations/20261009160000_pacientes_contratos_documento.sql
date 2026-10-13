-- Contratos do paciente: o que falta para GERAR O DOCUMENTO preenchido a
-- partir dos modelos do jurídico (contratos-pacientes/*.docx →
-- frontend/lib/contratos/modelos/, rota GET /api/contratos/[id]/documento/).
--
-- Depende de 20261008160000_pacientes_contratos.sql (aplicar aquela antes).
--
-- O que entra:
--
-- 1. NÚMERO DO CONTRATO. Sequência ÚNICA para todos os tipos (decisão do
--    usuário, 09/10/2026), formatada por sp_contratos_formatar_numero — o
--    formato mora só ali. O prefixo "ABA-TMP-03-" é o do modelo atual do
--    contrato de Avaliação Neuropsicológica; a confirmar com o jurídico.
--    Numerado na criação (default da coluna): um rascunho cancelado queima o
--    número, como numa série de notas.
--
-- 2. VALOR, LIMITE DE SESSÕES E SESSÃO AVULSA, que o contrato de Avaliação
--    Neuropsicológica imprime na cláusula sétima. Antes iam no texto livre da
--    observação. O valor é sugerido pela tela a partir de
--    cronograma_convenio_pacote_avaliacao (Particular, à vista) e pode ser
--    ajustado.
--
-- 3. TERMO DE USO DE IMAGEM como tipo novo (`termo_uso_imagem`). É instrumento
--    apartado e VINCULADO ao contrato de Terapias do paciente (decisão do
--    usuário, 09/10/2026): imprime "Vinculado ao Contrato nº …, firmado em …" e
--    vigora enquanto o contrato vigorar — por isso o vencimento do Termo é
--    SEMPRE o do contrato vinculado, copiado pela RPC.
--
-- 4. AUTORIZAÇÕES DE IMAGEM (jsonb): os canais que o responsável escolheu,
--    marcados ANTES do envio — a D4Sign não deixa o signatário marcar caixa.
--    Chave ausente ou false = NÃO AUTORIZO, que é também a regra do texto
--    ("campo não marcado equivale a NÃO AUTORIZO").
--
-- Valor novo em `tipo`: todo predicado que enumera tipos foi conferido
-- (frontend/lib/contratos/filtros.ts compara 'terapias' por igualdade; nenhum
-- `else` de duas pernas).

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Número
-- ═════════════════════════════════════════════════════════════════════════════
create sequence if not exists public.pacientes_contratos_numero_seq;

create or replace function public.sp_contratos_formatar_numero(p_n bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select 'ABA-TMP-03-' || lpad(p_n::text, 5, '0')
$$;

comment on function public.sp_contratos_formatar_numero(bigint) is
  'Formato do número do contrato do paciente (sequência única para todos os tipos). Mudou o formato, muda só aqui.';

alter table public.pacientes_contratos
  add column if not exists numero                text,
  add column if not exists valor_total           numeric(12, 2),
  add column if not exists sessoes_max           integer,
  add column if not exists valor_sessao_avulsa   numeric(12, 2),
  -- Sem ON DELETE: o contrato só some por cascata do paciente, e aí o Termo
  -- vai junto na mesma instrução (NO ACTION confere só no fim dela).
  add column if not exists contrato_vinculado_id bigint
                             references public.pacientes_contratos(id),
  add column if not exists autorizacoes_imagem   jsonb;

-- Os contratos que já existem ganham número na ordem em que foram criados (um
-- UPDATE só não garante a ordem em que o nextval é chamado; o laço garante).
do $$
declare r record;
begin
  for r in select id from public.pacientes_contratos where numero is null order by id loop
    update public.pacientes_contratos
       set numero = public.sp_contratos_formatar_numero(nextval('public.pacientes_contratos_numero_seq'))
     where id = r.id;
  end loop;
end $$;

alter table public.pacientes_contratos
  alter column numero set default public.sp_contratos_formatar_numero(nextval('public.pacientes_contratos_numero_seq')),
  alter column numero set not null;

create unique index if not exists uq_pac_contratos_numero
  on public.pacientes_contratos (numero);

create index if not exists idx_pac_contratos_vinculado
  on public.pacientes_contratos (contrato_vinculado_id)
  where contrato_vinculado_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Regras da tabela
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.pacientes_contratos drop constraint if exists pac_contratos_tipo_check;
alter table public.pacientes_contratos
  add constraint pac_contratos_tipo_check
  check (tipo in ('avaliacao_neuropsicologica', 'terapias', 'tecnico_terapeutico_particular',
                  'termo_uso_imagem'));

alter table public.pacientes_contratos drop constraint if exists pac_contratos_valores_check;
alter table public.pacientes_contratos
  add constraint pac_contratos_valores_check
  check ((valor_total is null or valor_total > 0)
         and (sessoes_max is null or sessoes_max between 1 and 100)
         and (valor_sessao_avulsa is null or valor_sessao_avulsa > 0));

alter table public.pacientes_contratos drop constraint if exists pac_contratos_vinculo_check;
alter table public.pacientes_contratos
  add constraint pac_contratos_vinculo_check
  check ((tipo = 'termo_uso_imagem') = (contrato_vinculado_id is not null));

alter table public.pacientes_contratos drop constraint if exists pac_contratos_autorizacoes_check;
alter table public.pacientes_contratos
  add constraint pac_contratos_autorizacoes_check
  check (autorizacoes_imagem is null or jsonb_typeof(autorizacoes_imagem) = 'object');

comment on column public.pacientes_contratos.numero is
  'Número impresso no documento. Sequência única (pacientes_contratos_numero_seq), formato em sp_contratos_formatar_numero.';
comment on column public.pacientes_contratos.contrato_vinculado_id is
  'Só no Termo de Uso de Imagem: o contrato de Terapias do mesmo paciente a que ele se vincula ("Vinculado ao Contrato nº …").';
comment on column public.pacientes_contratos.autorizacoes_imagem is
  'Canais de uso externo de imagem escolhidos pelo responsável: {site, redes, impressos, ensino, primeiro_nome} booleanos. Ausente/false = NÃO AUTORIZO.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) Normalização comum às RPCs de criar e editar
-- ═════════════════════════════════════════════════════════════════════════════

-- Só as cinco chaves conhecidas, só booleanos. Fora dos tipos que imprimem a
-- tabela de imagem, nada é guardado.
create or replace function public.sp_contratos_autorizacoes(p_tipo text, p_aut jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_tipo not in ('avaliacao_neuropsicologica', 'termo_uso_imagem') then null
    else jsonb_build_object(
      'site',          coalesce((p_aut ->> 'site')::boolean, false),
      'redes',         coalesce((p_aut ->> 'redes')::boolean, false),
      'impressos',     coalesce((p_aut ->> 'impressos')::boolean, false),
      'ensino',        coalesce((p_aut ->> 'ensino')::boolean, false),
      -- Identificação pelo primeiro nome só existe no Termo.
      'primeiro_nome', p_tipo = 'termo_uso_imagem' and coalesce((p_aut ->> 'primeiro_nome')::boolean, false))
  end
$$;

-- O contrato de Terapias a que um Termo se vincula: do MESMO paciente, ativo,
-- não cancelado. Devolve o vencimento dele (o do Termo é sempre esse).
create or replace function public.sp_contratos_vencimento_do_vinculo(
  p_paciente_id bigint,
  p_tipo        text,
  p_vinculado   bigint
)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v public.pacientes_contratos;
begin
  if p_tipo <> 'termo_uso_imagem' then
    return null;
  end if;
  if p_vinculado is null then
    raise exception 'Escolha o contrato de Terapias a que o Termo se vincula.' using errcode = '22023';
  end if;
  select * into v from public.pacientes_contratos where id = p_vinculado and ativo;
  if v.id is null or v.paciente_id <> p_paciente_id or v.tipo <> 'terapias' or v.status = 'cancelado' then
    raise exception 'O Termo só se vincula a um contrato de Terapias deste paciente, não cancelado.'
      using errcode = '22023';
  end if;
  return v.data_vencimento;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) RPCs com os campos novos
-- ═════════════════════════════════════════════════════════════════════════════
-- Assinatura nova = função nova: DROP da antiga para não sobrarem duas
-- sobrecargas. Os parâmetros novos têm default, então a tela antiga (5
-- parâmetros nomeados) continua casando com a função nova durante o deploy.
drop function if exists public.contratos_criar(bigint, text, date, date, text);
drop function if exists public.contratos_editar_rascunho(bigint, text, date, date, text);

create or replace function public.contratos_criar(
  p_paciente_id           bigint,
  p_tipo                  text,
  p_data_inicio           date,
  p_data_vencimento       date,
  p_observacao            text    default null,
  p_valor_total           numeric default null,
  p_sessoes_max           integer default null,
  p_valor_sessao_avulsa   numeric default null,
  p_contrato_vinculado_id bigint  default null,
  p_autorizacoes_imagem   jsonb   default null
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_venc  date;
  v_linha public.pacientes_contratos;
begin
  v_nome := public.sp_contratos_exigir_equipe();

  if not exists (select 1 from public.pacientes where id_paciente = p_paciente_id) then
    raise exception 'Paciente % não encontrado.', p_paciente_id using errcode = 'P0002';
  end if;

  v_venc := coalesce(public.sp_contratos_vencimento_do_vinculo(p_paciente_id, p_tipo, p_contrato_vinculado_id),
                     p_data_vencimento);

  insert into public.pacientes_contratos (
    paciente_id, tipo, data_inicio, data_vencimento, status, observacao,
    valor_total, sessoes_max, valor_sessao_avulsa, contrato_vinculado_id, autorizacoes_imagem,
    criado_por_usuario_id, criado_por_nome
  ) values (
    p_paciente_id, p_tipo, p_data_inicio, v_venc, 'rascunho', nullif(btrim(p_observacao), ''),
    p_valor_total, p_sessoes_max, p_valor_sessao_avulsa,
    case when p_tipo = 'termo_uso_imagem' then p_contrato_vinculado_id end,
    public.sp_contratos_autorizacoes(p_tipo, p_autorizacoes_imagem),
    auth.uid(), v_nome
  )
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (v_linha.id, 'criado', null, 'rascunho',
     jsonb_strip_nulls(jsonb_build_object(
       'tipo', p_tipo, 'numero', v_linha.numero,
       'data_inicio', p_data_inicio, 'data_vencimento', v_venc,
       'valor_total', v_linha.valor_total, 'sessoes_max', v_linha.sessoes_max,
       'valor_sessao_avulsa', v_linha.valor_sessao_avulsa,
       'contrato_vinculado_id', v_linha.contrato_vinculado_id,
       'autorizacoes_imagem', v_linha.autorizacoes_imagem)),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_criar(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) is
  'Aba Contratos → "Novo contrato". Cria em Rascunho (numerado) e registra o evento "criado". Termo de imagem: vencimento = o do contrato de Terapias vinculado.';

create or replace function public.contratos_editar_rascunho(
  p_id                    bigint,
  p_tipo                  text,
  p_data_inicio           date,
  p_data_vencimento       date,
  p_observacao            text    default null,
  p_valor_total           numeric default null,
  p_sessoes_max           integer default null,
  p_valor_sessao_avulsa   numeric default null,
  p_contrato_vinculado_id bigint  default null,
  p_autorizacoes_imagem   jsonb   default null
)
returns public.pacientes_contratos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome  text;
  v_venc  date;
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
  if p_contrato_vinculado_id = p_id then
    raise exception 'Um contrato não se vincula a si mesmo.' using errcode = '22023';
  end if;

  v_venc := coalesce(public.sp_contratos_vencimento_do_vinculo(v_antes.paciente_id, p_tipo, p_contrato_vinculado_id),
                     p_data_vencimento);

  update public.pacientes_contratos
     set tipo = p_tipo,
         data_inicio = p_data_inicio,
         data_vencimento = v_venc,
         observacao = nullif(btrim(p_observacao), ''),
         valor_total = p_valor_total,
         sessoes_max = p_sessoes_max,
         valor_sessao_avulsa = p_valor_sessao_avulsa,
         contrato_vinculado_id = case when p_tipo = 'termo_uso_imagem' then p_contrato_vinculado_id end,
         autorizacoes_imagem = public.sp_contratos_autorizacoes(p_tipo, p_autorizacoes_imagem)
   where id = p_id
  returning * into v_linha;

  insert into public.pacientes_contratos_eventos
    (contrato_id, tipo, status_antes, status_depois, detalhe, origem, usuario_id, usuario_nome)
  values
    (p_id, 'editado', 'rascunho', 'rascunho',
     jsonb_build_object(
       'antes',  jsonb_strip_nulls(jsonb_build_object(
                   'tipo', v_antes.tipo, 'data_inicio', v_antes.data_inicio,
                   'data_vencimento', v_antes.data_vencimento,
                   'valor_total', v_antes.valor_total, 'sessoes_max', v_antes.sessoes_max,
                   'valor_sessao_avulsa', v_antes.valor_sessao_avulsa,
                   'contrato_vinculado_id', v_antes.contrato_vinculado_id,
                   'autorizacoes_imagem', v_antes.autorizacoes_imagem)),
       'depois', jsonb_strip_nulls(jsonb_build_object(
                   'tipo', v_linha.tipo, 'data_inicio', v_linha.data_inicio,
                   'data_vencimento', v_linha.data_vencimento,
                   'valor_total', v_linha.valor_total, 'sessoes_max', v_linha.sessoes_max,
                   'valor_sessao_avulsa', v_linha.valor_sessao_avulsa,
                   'contrato_vinculado_id', v_linha.contrato_vinculado_id,
                   'autorizacoes_imagem', v_linha.autorizacoes_imagem))),
     'usuario', auth.uid(), v_nome);

  return v_linha;
end $$;

comment on function public.contratos_editar_rascunho(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) is
  'Edita um contrato AINDA em Rascunho (tipo, datas, valores, vínculo, autorizações de imagem). Fora disso, recusa. O número não muda.';

-- ═════════════════════════════════════════════════════════════════════════════
-- GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.sp_contratos_formatar_numero(bigint)                     from public, anon, authenticated;
revoke all on function public.sp_contratos_autorizacoes(text, jsonb)                    from public, anon, authenticated;
revoke all on function public.sp_contratos_vencimento_do_vinculo(bigint, text, bigint)  from public, anon, authenticated;
revoke all on function public.contratos_criar(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) from public, anon;
revoke all on function public.contratos_editar_rascunho(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) from public, anon;

grant execute on function public.contratos_criar(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) to authenticated;
grant execute on function public.contratos_editar_rascunho(bigint, text, date, date, text, numeric, integer, numeric, bigint, jsonb) to authenticated;
-- O default da coluna `numero` chama a função e a sequência no INSERT: quem
-- insere (as RPCs SECURITY DEFINER, como donas; a service_role da fase 3)
-- precisa de EXECUTE/USAGE.
grant execute on function public.sp_contratos_formatar_numero(bigint) to service_role;
grant usage on sequence public.pacientes_contratos_numero_seq to service_role;
