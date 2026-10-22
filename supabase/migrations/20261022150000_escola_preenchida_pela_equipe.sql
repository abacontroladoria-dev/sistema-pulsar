-- Dados escolares também preenchidos pela EQUIPE (decisão do usuário, 22/10/2026).
--
-- Até aqui pacientes_dados_escolares só recebia o formulário público
-- /ficha-escolar, e a tela da ficha era somente leitura. O pedido é o mesmo
-- desenho da Disponibilidade (20261005160000): o link continua lá para mandar à
-- família, e a equipe pode preencher quando a família não preencheu (ou passou
-- a informação por telefone).
--
-- O que NÃO muda: cada gravação continua sendo uma linha nova (histórico, nada
-- sobrescrito) e a ficha lê a mais recente. A equipe não corrige o envio da
-- família — registra um envio novo, marcado como dela. É isso que preserva a
-- diferença entre "a família informou" e "alguém da equipe registrou".
--
-- Três mudanças:
--
-- 1. `origem` ('formulario' | 'equipe') e quem registrou (usuário do Pulsar).
--    Linhas existentes são todas do formulário: o default cobre o backfill.
--    `preenchido_por_nome` deixa de ser NOT NULL — na equipe, "quem da família
--    informou" é opcional, como na Disponibilidade —, mas o formulário continua
--    obrigado a trazê-lo (constraint abaixo).
--
-- 2. Escrita da equipe SÓ pela RPC escola_salvar_equipe (SECURITY DEFINER), que
--    grava o usuário logado. authenticated perde INSERT/UPDATE/DELETE diretos:
--    nada no frontend escrevia nesta tabela (a única escrita era a rota pública,
--    com service_role), e sem isso qualquer pessoa com a tela poderia gravar um
--    envio com `origem = 'formulario'` e o nome de outra pessoa pelo /rest/v1.
--
-- 3. Sai o FORCE ROW LEVEL SECURITY, pelo mesmo motivo de 20261005160000 (item
--    4): a RPC grava como DONA da tabela, e com FORCE dependeria de o papel dono
--    ter BYPASSRLS. Como authenticated/anon ficam sem GRANT de escrita, o FORCE
--    não fecha porta nenhuma que já não esteja fechada.
--
-- Ordem com o deploy: livre. A tela nova lê com fallback se as colunas ainda não
-- existirem, e a tela antiga não depende de nada que esta migration remove.

-- ═════════════════════════════════════════════════════════════════════════════
-- A) Colunas
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.pacientes_dados_escolares
  add column if not exists origem                 text not null default 'formulario',
  add column if not exists registrado_por_usuario uuid,
  add column if not exists registrado_por_nome    text,
  add column if not exists observacao             text;

alter table public.pacientes_dados_escolares
  alter column preenchido_por_nome drop not null;

alter table public.pacientes_dados_escolares
  drop constraint if exists pacientes_dados_escolares_origem_check,
  drop constraint if exists pacientes_dados_escolares_formulario_identificado,
  drop constraint if exists pacientes_dados_escolares_equipe_identificada,
  drop constraint if exists pacientes_dados_escolares_textos_curtos;

-- `textos_curtos` entra NOT VALID: vale para toda gravação nova, sem conferir
-- as linhas antigas (o formulário sempre limitou nesses tamanhos, mas uma linha
-- fora do padrão faria a migration inteira falhar).
alter table public.pacientes_dados_escolares
  add constraint pacientes_dados_escolares_origem_check
    check (origem in ('formulario', 'equipe')),
  add constraint pacientes_dados_escolares_formulario_identificado
    check (origem <> 'formulario' or preenchido_por_nome is not null),
  add constraint pacientes_dados_escolares_equipe_identificada
    check (origem <> 'equipe' or registrado_por_usuario is not null),
  add constraint pacientes_dados_escolares_textos_curtos
    check (length(escola_nome) <= 120
           and coalesce(length(escola_endereco), 0) <= 300
           and coalesce(length(escola_telefone), 0) <= 120
           and coalesce(length(escola_email), 0) <= 120
           and coalesce(length(coordenador_nome), 0) <= 120
           and coalesce(length(turma), 0) <= 120
           and coalesce(length(preenchido_por_nome), 0) <= 120
           and coalesce(length(preenchido_por_telefone), 0) <= 120
           and coalesce(length(registrado_por_nome), 0) <= 200
           and coalesce(length(observacao), 0) <= 500) not valid;

comment on column public.pacientes_dados_escolares.origem is
  'formulario = enviado pela família em /ficha-escolar; equipe = registrado na ficha do paciente por um usuário do Pulsar (RPC escola_salvar_equipe).';
comment on column public.pacientes_dados_escolares.registrado_por_nome is
  'Usuário do Pulsar que registrou (origem = equipe). Cópia de usuarios.nome no momento do registro. Sem FK para usuarios, como em pacientes_disponibilidade_versoes.';
comment on table public.pacientes_dados_escolares is
  'Dados escolares do paciente. Histórico: uma linha por envio, nunca sobrescrita — a ficha lê a mais recente. origem = formulario (família, /ficha-escolar, não conferido) ou equipe (RPC escola_salvar_equipe).';

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Gravação pela equipe
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.escola_salvar_equipe(
  p_paciente_id bigint,
  p_dados       jsonb
)
returns public.pacientes_dados_escolares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome   text;
  v_escola text := nullif(btrim(p_dados ->> 'escola_nome'), '');
  v_linha  public.pacientes_dados_escolares;
begin
  if auth.uid() is null or not public.usuario_tem_permissao('cadastros_pacientes') then
    raise exception 'Sem permissão para registrar a escola deste paciente.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.pacientes where id_paciente = p_paciente_id) then
    raise exception 'Paciente % não encontrado.', p_paciente_id using errcode = 'P0002';
  end if;

  if v_escola is null then
    raise exception 'Informe o nome da escola.' using errcode = '23514';
  end if;

  select nome into v_nome from public.usuarios where id = auth.uid();

  -- Whitelist de colunas: origem, quem registrou e telefone_confere nunca vêm do
  -- cliente. Turno e parentesco são conferidos pelos CHECKs da tabela.
  insert into public.pacientes_dados_escolares (
    paciente_id, escola_nome, escola_endereco, escola_telefone, escola_email,
    coordenador_nome, turma, turno,
    preenchido_por_nome, preenchido_por_parentesco,
    origem, registrado_por_usuario, registrado_por_nome, observacao
  ) values (
    p_paciente_id,
    v_escola,
    nullif(btrim(p_dados ->> 'escola_endereco'), ''),
    nullif(btrim(p_dados ->> 'escola_telefone'), ''),
    nullif(btrim(p_dados ->> 'escola_email'), ''),
    nullif(btrim(p_dados ->> 'coordenador_nome'), ''),
    nullif(btrim(p_dados ->> 'turma'), ''),
    nullif(p_dados ->> 'turno', ''),
    nullif(btrim(p_dados ->> 'preenchido_por_nome'), ''),
    nullif(p_dados ->> 'preenchido_por_parentesco', ''),
    'equipe',
    auth.uid(),
    coalesce(v_nome, 'Usuário do Pulsar'),
    nullif(btrim(p_dados ->> 'observacao'), '')
  )
  returning * into v_linha;

  return v_linha;
end $$;

comment on function public.escola_salvar_equipe(bigint, jsonb) is
  'Seção Escola do Cadastro do paciente: a equipe registra os dados escolares. Cria um envio novo (origem = equipe) com o usuário logado; nunca altera envios anteriores.';

-- ═════════════════════════════════════════════════════════════════════════════
-- C) RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
-- Remoção por catálogo: RLS é OR entre policies, e uma permissiva sobrevivente
-- (a antiga "_all", de leitura E escrita) anularia o fechamento em silêncio.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pacientes_dados_escolares'
  loop
    execute format('drop policy %I on public.pacientes_dados_escolares', pol.policyname);
  end loop;
end $$;

create policy "pacientes_dados_escolares_select" on public.pacientes_dados_escolares
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

alter table public.pacientes_dados_escolares no force row level security;

revoke all on public.pacientes_dados_escolares from public, anon, authenticated;
grant select on public.pacientes_dados_escolares to authenticated;

-- Funções nascem com EXECUTE para PUBLIC (e anon é PUBLIC): o revoke é o que
-- fecha /rest/v1/rpc para quem não está logado.
revoke all on function public.escola_salvar_equipe(bigint, jsonb) from public, anon;
grant execute on function public.escola_salvar_equipe(bigint, jsonb) to authenticated;
