-- Aplica, numa transação só (16/10/2026):
--   20261016150000_chat_equipe_para_todos              (chat para todo usuário ativo)
--   20261016150100_catalogo_permissoes_espelha_sidebar (ordem do menu sem o item chat_equipe)
-- Pré-requisito: 20261016_chat_equipe_APLICAR.sql já aplicado (está, conferido 16/10).
-- Ensaio em produção com rollback (16/10): 35 pessoas aptas, 3 policies trocadas,
-- código chat_equipe fora do catálogo. Teste: supabase/tests/chat_equipe.pglite.mjs (42 checagens).
-- Gerado concatenando os dois arquivos — se mudar uma migration, gere de novo.
begin;
set local lock_timeout = '5s';

-- ═══ 20261016150000_chat_equipe_para_todos ═══
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

-- ═══ 20261016150100_catalogo_permissoes_espelha_sidebar ═══
-- Catálogo de permissões alinhado ao menu — GERADO por
-- frontend/scripts/gerar-catalogo-permissoes.mjs a partir de lib/permissions/menu.ts.
-- Não edite à mão: mude o menu e gere de novo.
--
-- Idempotente. Não muda o acesso de ninguém: só cadastra códigos novos e acerta
-- nome, grupo, rota e ordem. Um código NOVO nasce sem estar em grupo nenhum —
-- depois de aplicar, marque-o no modelo dos grupos que devem ter a tela
-- (/admin/permissoes → Por grupo).

-- 1. Códigos novos (os que já existem ficam como estão).
INSERT INTO public.permissoes (codigo, nome, grupo, rota, ordem)
SELECT v.codigo, v.nome, v.grupo, v.rota, v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 20),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 30),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 40),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 50),
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 60),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 70),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 80),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 90),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 100),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 110),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 120),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 130),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 140),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 150),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 160),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 170),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 180),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 190),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 200),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 210),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 220),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 230),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 240),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 250),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 260),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 270),
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', 'Indicadores', '/cronograma/indicadores?tab=alimentar-bd', 280),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 290),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 300),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 310),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 320),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 330),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 340),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 350),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 360),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 370),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 380),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 390),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 400),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 410),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 420),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 430),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 440),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 450),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 460),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 470),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 480),
  ('usuarios', 'Usuários', 'Administração', '/admin', 490),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 500),
  ('api_integracao', 'API', 'Administração', '/admin/api', 510),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 520),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 530)
) AS v(codigo, nome, grupo, rota, ordem)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Nome, grupo, rota e ordem iguais ao menu.
UPDATE public.permissoes p
SET nome = v.nome, grupo = v.grupo, rota = v.rota, ordem = v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 20),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 30),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 40),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 50),
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 60),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 70),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 80),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 90),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 100),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 110),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 120),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 130),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 140),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 150),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 160),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 170),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 180),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 190),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 200),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 210),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 220),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 230),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 240),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 250),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 260),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 270),
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', 'Indicadores', '/cronograma/indicadores?tab=alimentar-bd', 280),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 290),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 300),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 310),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 320),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 330),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 340),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 350),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 360),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 370),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 380),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 390),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 400),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 410),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 420),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 430),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 440),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 450),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 460),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 470),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 480),
  ('usuarios', 'Usuários', 'Administração', '/admin', 490),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 500),
  ('api_integracao', 'API', 'Administração', '/admin/api', 510),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 520),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 530)
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;

-- 3. Códigos no banco que não têm mais item no menu. COMENTADO de propósito:
--    apagar um código apaga junto as concessões dele (FK ON DELETE CASCADE em
--    usuarios_permissoes). Confira que a tela saiu de verdade antes de descomentar.
-- UPDATE public.grupos_permissoes
-- SET modelo_permissoes = modelo_permissoes - ARRAY['chat_equipe', 'cco', 'preauditoria', 'carregar_tita']::text[],
--     updated_at = now()
-- WHERE modelo_permissoes ?| ARRAY['chat_equipe', 'cco', 'preauditoria', 'carregar_tita']::text[];
-- DELETE FROM public.permissoes WHERE codigo IN ('chat_equipe', 'cco', 'preauditoria', 'carregar_tita');

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261016150000', 'chat_equipe_para_todos'),
  ('20261016150100', 'catalogo_permissoes_espelha_sidebar')
on conflict (version) do nothing;

commit;
