-- Aplica, numa transação só, as duas migrations do Chat da equipe (16/10/2026):
--   20261016100400_catalogo_permissoes_espelha_sidebar  (cadastra o código chat_equipe)
--   20261016120000_chat_equipe                           (tabelas, RLS, RPCs, tempo real)
-- Nesta ordem: usuarios_permissoes tem FK para o código, que precisa existir antes.
-- Ensaio: supabase/tests/chat_equipe.pglite.mjs (39 checagens, 16/10).
--
-- Depois de aplicar, NINGUÉM além de admin/diretoria tem o chat: marque
-- "Chat da equipe" (grupo Geral) nos grupos que devem ter, em /admin/permissoes.
-- Gerado concatenando os dois arquivos — se mudar uma migration, gere de novo.
begin;
set local lock_timeout = '5s';

-- ═══ 20261016100400_catalogo_permissoes_espelha_sidebar ═══
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
  ('chat_equipe', 'Chat da equipe', 'Geral', '/chat-equipe', 20),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 30),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 40),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 50),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 60),
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 70),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 80),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 90),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 100),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 110),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 120),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 130),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 140),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 150),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 160),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 170),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 180),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 190),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 200),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 210),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 220),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 230),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 240),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 250),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 260),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 270),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 280),
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', 'Indicadores', '/cronograma/indicadores?tab=alimentar-bd', 290),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 300),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 310),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 320),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 330),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 340),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 350),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 360),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 370),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 380),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 390),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 400),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 410),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 420),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 430),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 440),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 450),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 460),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 470),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 480),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 490),
  ('usuarios', 'Usuários', 'Administração', '/admin', 500),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 510),
  ('api_integracao', 'API', 'Administração', '/admin/api', 520),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 530),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 540)
) AS v(codigo, nome, grupo, rota, ordem)
ON CONFLICT (codigo) DO NOTHING;

-- 2. Nome, grupo, rota e ordem iguais ao menu.
UPDATE public.permissoes p
SET nome = v.nome, grupo = v.grupo, rota = v.rota, ordem = v.ordem
FROM (VALUES
  ('dashboard', 'Dashboard', 'Geral', '/', 10),
  ('chat_equipe', 'Chat da equipe', 'Geral', '/chat-equipe', 20),
  ('atendimentos', 'Atendimentos', 'Pacientes', '/solicitar', 30),
  ('gestao', 'Gestão Recepção', 'Pacientes', '/central-pacientes', 40),
  ('autorizacoes_avulsas', 'Autorizações Avulsas', 'Pacientes', '/autorizacoes-avulsas', 50),
  ('acompanhamento_laudos', 'Status Laudos e Senhas', 'Pacientes', '/acompanhamento/laudos', 60),
  ('status_contratos', 'Status Contratos', 'Pacientes', '/acompanhamento/contratos', 70),
  ('outros_convenios', 'Outros Convênios', 'Pacientes', '/outros-convenios', 80),
  ('escala_terapeutica', 'Gestão', 'Terapêutico', '/central-terapeutas', 90),
  ('analise_tratativas', 'Análise de Evolução', 'Terapêutico', '/analise-tratativas', 100),
  ('terapeutico_auditoria_evolucoes', 'Auditoria de Evoluções', 'Terapêutico', '/terapeutico/auditoria-evolucoes', 110),
  ('terapeutico_pdi', 'PDI - Controle', 'Terapêutico', '/terapeutico/prazos-pdi', 120),
  ('terapeutico_pdi_painel', 'PDI - Painel', 'Terapêutico', '/terapeutico/pdi-painel-analista', 130),
  ('auditoria_assim', 'Conferência ASSIM', 'Autorização', '/auditoria-assim?tab=auditoria', 140),
  ('reconciliacao_assim', 'Reconciliação ASSIM', 'Autorização', '/auditoria-assim?tab=reconciliacao', 150),
  ('conferencia_guias', 'Conferência de Guias', 'Autorização', '/conferencia-guias', 160),
  ('insumos', 'Solicitações', 'Suprimentos', '/insumos', 170),
  ('cronograma_grade', 'Grade', 'Cronograma', '/cronograma/grade', 180),
  ('cronograma_saida_profissional', 'Saída Profissional', 'Cronograma', '/cronograma/saida-profissional', 190),
  ('cronograma_ocupacao_paciente', 'Ocupação Paciente', 'Cronograma', '/cronograma/ocupacao-paciente', 200),
  ('reposicao_faltas', 'Reposição de Faltas', 'Cronograma', '/cronograma/reposicao', 210),
  ('ocupacao_clinica', 'Oportunidades recusadas', 'Cronograma', '/cronograma/ocupacao?tab=oportunidades-recusadas', 220),
  ('ocupacao_clinica_gaps', 'Diferença: Laudo e Oferta', 'Cronograma', '/cronograma/ocupacao?tab=gaps', 230),
  ('ocupacao_clinica_inconsistencias', 'Inconsistências e Exceções', 'Cronograma', '/cronograma/ocupacao?tab=inconsistencias', 240),
  ('ocupacao_profissionais', 'Ocupação de Profissionais', 'Indicadores', '/cronograma/indicadores?tab=profissionais', 250),
  ('indicadores_ocupacao_unidades', 'Ocupação Clínica', 'Indicadores', '/cronograma/indicadores?tab=unidades', 260),
  ('indicadores_pacientes', 'Dashboard de Pacientes', 'Indicadores', '/cronograma/indicadores?tab=pacientes', 270),
  ('indicadores_previsao_receitas', 'Previsão de Receitas', 'Indicadores', '/cronograma/indicadores?tab=previsao-receitas', 280),
  ('indicadores_alimentar_bd', 'Preencher Receitas Faturadas', 'Indicadores', '/cronograma/indicadores?tab=alimentar-bd', 290),
  ('indicadores_comparativo_sessoes', 'Comparativo de Sessões', 'Indicadores', '/cronograma/indicadores?tab=comparativo-sessoes', 300),
  ('indicadores_entrada_convenio', 'Entrada de Pacientes (Convênio)', 'Indicadores', '/cronograma/indicadores?tab=entrada-convenio', 310),
  ('cadastros_pacientes', 'Pacientes', 'Cadastros', '/cadastros/pacientes', 320),
  ('cadastros_profissionais', 'Profissionais', 'Cadastros', '/cadastros/profissionais', 330),
  ('cadastros_terapias', 'Terapias', 'Cadastros', '/cadastros/terapias', 340),
  ('cadastros_convenios', 'Convênios', 'Cadastros', '/cadastros/convenios', 350),
  ('cronograma_valores_convenio', 'Cadastro de Valores', 'Cadastros', '/cadastros/cadastro-valores', 360),
  ('cadastros_feriados', 'Feriados', 'Cadastros', '/cadastros/feriados', 370),
  ('cadastros_taxas', 'Variáveis & Taxas', 'Cadastros', '/cadastros/taxas-e-parametros', 380),
  ('cadastros_contratos', 'Contratos', 'Cadastros', '/cadastros/contratos', 390),
  ('cronograma_ocupacao_salas', 'Ocupação de Salas', 'Relacionamento Prestador', '/relacionamento-prestador/ocupacao-salas', 400),
  ('cronograma_solicitacoes', 'Simulação de Novo Prestador', 'Relacionamento Prestador', '/relacionamento-prestador/solicitacoes', 410),
  ('cronograma_disponibilidade_interna', 'Ocupar Profissionais Disponíveis', 'Relacionamento Prestador', '/relacionamento-prestador/ocupar-profissionais-disponiveis', 420),
  ('relacionamento_prestador_analise', 'Rem. Mês - Previsão', 'Relacionamento Prestador', '/relacionamento-prestador/analise', 430),
  ('relacionamento_prestador_rp', 'Remuneração Total', 'Relacionamento Prestador', '/relacionamento-prestador/rp', 440),
  ('relacionamento_prestador_individual', 'Remuneração Individual', 'Relacionamento Prestador', '/relacionamento-prestador/individual', 450),
  ('relacionamento_prestador_pep', 'Entregas PEP', 'Relacionamento Prestador', '/relacionamento-prestador/pep', 460),
  ('relacionamento_prestador_pep_historico', 'PEP - Histórico', 'Relacionamento Prestador', '/relacionamento-prestador/pep-historico', 470),
  ('relacionamento_prestador_auditoria_documentos', 'Auditoria de Documentos PEP', 'Relacionamento Prestador', '/relacionamento-prestador/auditoria-documentos', 480),
  ('tv_avisos', 'TV da Recepção', 'Marketing', '/tv-avisos', 490),
  ('usuarios', 'Usuários', 'Administração', '/admin', 500),
  ('permissoes', 'Permissões', 'Administração', '/admin/permissoes', 510),
  ('api_integracao', 'API', 'Administração', '/admin/api', 520),
  ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 530),
  ('connect', 'Pulsar Connect', 'Geral', '/connect', 540)
) AS v(codigo, nome, grupo, rota, ordem)
WHERE p.codigo = v.codigo;

-- 3. Códigos no banco que não têm mais item no menu. COMENTADO de propósito:
--    apagar um código apaga junto as concessões dele (FK ON DELETE CASCADE em
--    usuarios_permissoes). Confira que a tela saiu de verdade antes de descomentar.
-- UPDATE public.grupos_permissoes
-- SET modelo_permissoes = modelo_permissoes - ARRAY['cco', 'preauditoria']::text[],
--     updated_at = now()
-- WHERE modelo_permissoes ?| ARRAY['cco', 'preauditoria']::text[];
-- DELETE FROM public.permissoes WHERE codigo IN ('cco', 'preauditoria');

-- ═══ 20261016120000_chat_equipe ═══
-- ============================================================================
-- Chat da equipe — conversa direta entre usuários do Pulsar
--
-- O QUE FALTAVA
--
-- As notas internas do Connect (20261015120000) só existem presas a uma
-- conversa de WhatsApp, e só para quem tem papel na Central. Duas pessoas da
-- equipe não tinham onde falar entre si dentro do sistema — iam para o
-- WhatsApp pessoal, com nome e dado de paciente fora de qualquer controle.
--
-- O QUE ESTA MIGRATION CRIA
--
--   chat_conversas   o fio. Hoje só `direta` (duas pessoas); grupo e conversa
--                    presa a um paciente/guia entram depois, ampliando o CHECK.
--   chat_membros     quem participa e ATÉ ONDE LEU (`lido_ate`). Não lida é
--                    "mensagem de outra pessoa depois do meu lido_ate" — uma
--                    marca por pessoa por fio, não uma linha por mensagem.
--   chat_mensagens   as mensagens.
--
-- QUEM USA
--
-- O código de permissão `chat_equipe` (item "Chat da equipe" do menu). Nasce sem
-- estar em grupo nenhum, como todo código novo: só admin e diretoria (o atalho
-- de usuario_tem_permissao) usam até alguém marcá-lo nos grupos em
-- /admin/permissoes. Só se abre conversa com quem também tem o código.
--
-- QUEM LÊ: só os membros do fio, e só enquanto tiverem o código.
--
-- QUEM GRAVA: ninguém direto. INSERT/UPDATE/DELETE saem de authenticated e
-- anon; toda escrita é por RPC SECURITY DEFINER que confere permissão e
-- participação antes (chat_abrir_direta, chat_enviar, chat_marcar_lida). A
-- mesma ideia das notas internas — escrita num caminho só, que confere tudo —
-- mas dentro do banco, para a regra não depender de uma rota de API lembrar.
--
-- TEMPO REAL: chat_mensagens entra na publicação supabase_realtime. O
-- postgres_changes aplica a RLS de leitura por assinante, então cada pessoa só
-- recebe o aviso das mensagens dos fios dela.
--
-- usuário sem FK para public.usuarios (criada_por, usuario_id, autor_id), como
-- em central.conversation_notes: a FK impediria apagar um cadastro que já
-- conversou, e o histórico do outro lado não deve sumir junto.
--
-- Reexecutável.
--
-- ROLLBACK REFERENCE (ordem inversa):
--   drop function if exists public.chat_conversas_lista();
--   drop function if exists public.chat_nao_lidas();
--   drop function if exists public.chat_pessoas();
--   drop function if exists public.chat_marcar_lida(uuid);
--   drop function if exists public.chat_enviar(uuid, text);
--   drop function if exists public.chat_abrir_direta(uuid);
--   drop function if exists public.chat_minhas_conversas();
--   drop function if exists public.chat_usuario_pode(uuid);
--   drop table if exists public.chat_mensagens;
--   drop table if exists public.chat_membros;
--   drop table if exists public.chat_conversas;
--
-- Depends on:
--   20260929140000_grupos_valem_ao_vivo.sql (usuario_tem_permissao, grupos)
-- ============================================================================

-- ============================================================================
-- Tabelas
-- ============================================================================
create table if not exists public.chat_conversas (
  id                 uuid        primary key default gen_random_uuid(),
  tipo               text        not null default 'direta',
  -- 'menor:maior' dos dois ids: impede abrir duas conversas diretas entre as
  -- mesmas pessoas (clique duplo, os dois abrindo ao mesmo tempo).
  chave_direta       text        unique,
  criada_por         uuid        not null,
  criada_em          timestamptz not null default now(),
  ultima_mensagem_em timestamptz,

  constraint ck_chat_conversas_tipo check (tipo in ('direta')),
  constraint ck_chat_conversas_direta_tem_chave check (tipo <> 'direta' or chave_direta is not null)
);

create table if not exists public.chat_membros (
  conversa_id uuid        not null references public.chat_conversas(id) on delete cascade,
  usuario_id  uuid        not null,
  -- Nulo = nunca abriu o fio: tudo o que a outra pessoa mandou conta como não lido.
  lido_ate    timestamptz,
  entrou_em   timestamptz not null default now(),
  primary key (conversa_id, usuario_id)
);

-- "Os meus fios": a RLS das três tabelas e a lista do painel partem daqui.
create index if not exists idx_chat_membros_usuario on public.chat_membros (usuario_id);

create table if not exists public.chat_mensagens (
  id          uuid        primary key default gen_random_uuid(),
  conversa_id uuid        not null references public.chat_conversas(id) on delete cascade,
  autor_id    uuid        not null,
  corpo       text        not null,
  criada_em   timestamptz not null default now(),

  constraint ck_chat_mensagens_corpo check (length(btrim(corpo)) between 1 and 4000)
);

-- O fio aberto (mais recentes primeiro, com "carregar anteriores") e a contagem
-- de não lidas (mensagens do fio depois do lido_ate).
create index if not exists idx_chat_mensagens_conversa
  on public.chat_mensagens (conversa_id, criada_em desc);

-- ============================================================================
-- Privilégios: o navegador só LÊ, e só pelo que a RLS deixar.
-- O ALTER DEFAULT PRIVILEGES do Supabase dá CRUD a anon e authenticated em toda
-- tabela nova do schema public — os revoke abaixo NÃO são redundantes.
-- ============================================================================
revoke all on public.chat_conversas from anon;
revoke all on public.chat_membros   from anon;
revoke all on public.chat_mensagens from anon;
revoke insert, update, delete, truncate, references, trigger on public.chat_conversas from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.chat_membros   from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.chat_mensagens from authenticated;
grant select on public.chat_conversas to authenticated;
grant select on public.chat_membros   to authenticated;
grant select on public.chat_mensagens to authenticated;

alter table public.chat_conversas enable row level security;
alter table public.chat_membros   enable row level security;
alter table public.chat_mensagens enable row level security;

-- ============================================================================
-- Funções de apoio
-- ============================================================================

-- A regra de usuario_tem_permissao('chat_equipe'), mas para OUTRA pessoa: quem
-- pode receber uma conversa. Mantida em sincronia com 20260929140000 à mão — lá
-- a regra é sobre auth.uid() e não aceita parâmetro.
create or replace function public.chat_usuario_pode(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.usuarios u
      where u.id = p_usuario and u.ativo = true and u.role in ('admin', 'diretoria')
    )
    or (
      exists (select 1 from public.usuarios u where u.id = p_usuario and u.ativo = true)
      and (
        exists (
          select 1 from public.usuarios_permissoes up
          where up.usuario_id = p_usuario and up.permissao_codigo = 'chat_equipe' and up.permitido
        )
        or (
          exists (
            select 1
            from public.grupos_permissoes_membros m
            join public.grupos_permissoes g on g.id = m.grupo_id
            where m.usuario_id = p_usuario
              and g.modelo_permissoes -> 'chat_equipe' = 'true'::jsonb
          )
          and not exists (
            select 1 from public.usuarios_permissoes up
            where up.usuario_id = p_usuario and up.permissao_codigo = 'chat_equipe' and not up.permitido
          )
        )
      )
    );
$$;

-- Os fios de quem está logado. SECURITY DEFINER para a policy de chat_membros
-- poder perguntar "sou membro?" sem cair na própria RLS (recursão infinita).
create or replace function public.chat_minhas_conversas()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select conversa_id from public.chat_membros where usuario_id = auth.uid();
$$;

revoke all on function public.chat_usuario_pode(uuid)  from public, anon, authenticated;
revoke all on function public.chat_minhas_conversas()  from public, anon;
grant execute on function public.chat_minhas_conversas() to authenticated;

-- ============================================================================
-- RLS — membro do fio E com o código. Funções embrulhadas em (select …): uma
-- avaliação por consulta (initplan), não uma por linha.
-- ============================================================================
drop policy if exists chat_conversas_select on public.chat_conversas;
create policy chat_conversas_select on public.chat_conversas
  for select to authenticated
  using (
    (select public.usuario_tem_permissao('chat_equipe'))
    and id in (select public.chat_minhas_conversas())
  );

drop policy if exists chat_membros_select on public.chat_membros;
create policy chat_membros_select on public.chat_membros
  for select to authenticated
  using (
    (select public.usuario_tem_permissao('chat_equipe'))
    and conversa_id in (select public.chat_minhas_conversas())
  );

drop policy if exists chat_mensagens_select on public.chat_mensagens;
create policy chat_mensagens_select on public.chat_mensagens
  for select to authenticated
  using (
    (select public.usuario_tem_permissao('chat_equipe'))
    and conversa_id in (select public.chat_minhas_conversas())
  );

-- ============================================================================
-- RPCs — o único caminho de escrita
-- ============================================================================

-- Abre (ou devolve a que já existe) a conversa direta com outra pessoa.
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
  if v_eu is null or not public.usuario_tem_permissao('chat_equipe') then
    raise exception 'sem permissão para o Chat da equipe' using errcode = '42501';
  end if;
  if p_outro is null or p_outro = v_eu then
    raise exception 'escolha outra pessoa para conversar' using errcode = '22023';
  end if;
  if not public.chat_usuario_pode(p_outro) then
    raise exception 'essa pessoa não tem acesso ao Chat da equipe' using errcode = '42501';
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

-- Envia uma mensagem. Quem envia já leu até ela.
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
  if v_eu is null or not public.usuario_tem_permissao('chat_equipe') then
    raise exception 'sem permissão para o Chat da equipe' using errcode = '42501';
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

-- Marca o fio como lido até agora. Só mexe na linha de quem chama.
create or replace function public.chat_marcar_lida(p_conversa uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.usuario_tem_permissao('chat_equipe') then
    raise exception 'sem permissão para o Chat da equipe' using errcode = '42501';
  end if;
  update public.chat_membros
     set lido_ate = greatest(coalesce(lido_ate, '-infinity'::timestamptz), now())
   where conversa_id = p_conversa and usuario_id = auth.uid();
end;
$$;

-- Com quem dá para abrir conversa: ativos, com o código, menos eu.
-- SECURITY DEFINER porque public.usuarios e os grupos não são legíveis por todos.
-- Devolve só id e nome — nada de e-mail, papel ou telefone.
create or replace function public.chat_pessoas()
returns table (id uuid, nome text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.usuario_tem_permissao('chat_equipe') then
    raise exception 'sem permissão para o Chat da equipe' using errcode = '42501';
  end if;
  return query
    select u.id, coalesce(nullif(btrim(u.nome), ''), 'Sem nome')::text
    from public.usuarios u
    where u.ativo = true
      and u.id <> auth.uid()
      and public.chat_usuario_pode(u.id)
    order by 2;
end;
$$;

-- Total de mensagens não lidas — o número do item do menu.
-- SECURITY INVOKER: a RLS das tabelas já recorta os fios de quem chama, e sem
-- o código o resultado é 0 em vez de erro (o contador só some).
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
    and m.criada_em > coalesce(eu.lido_ate, '-infinity'::timestamptz);
$$;

-- A lista do painel numa consulta: o outro participante (com nome), a última
-- mensagem e as não lidas de cada fio. SECURITY DEFINER só para ler o NOME do
-- outro em public.usuarios; os fios são recortados por auth.uid() aqui dentro.
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
  if auth.uid() is null or not public.usuario_tem_permissao('chat_equipe') then
    raise exception 'sem permissão para o Chat da equipe' using errcode = '42501';
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

-- SECURITY DEFINER nasce com EXECUTE para PUBLIC.
revoke all on function public.chat_abrir_direta(uuid)     from public, anon;
revoke all on function public.chat_enviar(uuid, text)     from public, anon;
revoke all on function public.chat_marcar_lida(uuid)      from public, anon;
revoke all on function public.chat_pessoas()              from public, anon;
revoke all on function public.chat_nao_lidas()            from public, anon;
revoke all on function public.chat_conversas_lista()      from public, anon;
grant execute on function public.chat_abrir_direta(uuid)  to authenticated;
grant execute on function public.chat_enviar(uuid, text)  to authenticated;
grant execute on function public.chat_marcar_lida(uuid)   to authenticated;
grant execute on function public.chat_pessoas()           to authenticated;
grant execute on function public.chat_nao_lidas()         to authenticated;
grant execute on function public.chat_conversas_lista()   to authenticated;

-- ============================================================================
-- Tempo real
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens'
     ) then
    alter publication supabase_realtime add table public.chat_mensagens;
  end if;
end;
$$;

comment on table public.chat_conversas is
  'Chat da equipe: um fio de conversa entre usuários do Pulsar. Escrita só pelas RPCs chat_*.';
comment on table public.chat_membros is
  'Quem participa de cada fio e até onde leu (lido_ate nulo = nunca abriu).';
comment on table public.chat_mensagens is
  'Mensagens do Chat da equipe. Leitura: membros do fio com o código chat_equipe.';

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261016100400', 'catalogo_permissoes_espelha_sidebar'),
  ('20261016120000', 'chat_equipe')
on conflict (version) do nothing;

commit;
