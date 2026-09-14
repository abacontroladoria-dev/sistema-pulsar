-- ============================================================================
-- central.agent_settings — director passa a ler e a gravar, e só o prompt
--
-- A diretoria precisa ajustar o texto que a atendente virtual usa sem depender
-- de um admin. Até aqui as quatro policies da tabela exigiam `admin` puro, e a
-- rota /api/central/agent-settings exigia o mesmo — um `director` levava 403 na
-- leitura antes mesmo de tentar salvar.
--
-- O QUE ESTA MIGRATION NÃO CONSEGUE FAZER, e por que o gate HTTP importa:
-- RLS decide por LINHA. Não existe policy "pode dar UPDATE em system_prompt e
-- em mais nada" — a tabela tem uma linha por organização, e liberar o UPDATE
-- dela para `director` libera todas as colunas que o grant de coluna já
-- permite, `elevenlabs_api_key` inclusive (que é gravável, ainda que não
-- legível, desde 20260810120300).
--
-- Por isso a restrição "só o prompt" mora na borda HTTP, em
-- app/api/central/agent-settings/route.ts, que para `director` descarta todo
-- campo que não seja systemPrompt ANTES de chamar o service. Esta policy é a
-- segunda barreira, não a primeira: ela garante o isolamento por organização e
-- que nenhum papel abaixo de director encoste na tabela.
--
-- A leitura continua sem devolver a chave em nenhum caminho: o grant por coluna
-- de 20260810120300 não concede SELECT em elevenlabs_api_key a `authenticated`,
-- e `director` é `authenticated` como qualquer outro. A máscara que a tela
-- mostra vem do service, que lê a chave com service role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SELECT — admin e director
--
-- DROP + CREATE, e não ALTER: `alter policy ... using` exige repetir a
-- expressão inteira de qualquer forma, e o par drop/create deixa o estado final
-- explícito no arquivo.
-- ----------------------------------------------------------------------------
drop policy if exists agent_settings_select_admin on central.agent_settings;

create policy agent_settings_select_admin
  on central.agent_settings
  for select
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ----------------------------------------------------------------------------
-- UPDATE — admin e director
--
-- `with check` repete o `using`: sem ele, um UPDATE poderia mover a linha para
-- outra organization_id e escapar do próprio filtro que a autorizou.
-- ----------------------------------------------------------------------------
drop policy if exists agent_settings_update_admin on central.agent_settings;

create policy agent_settings_update_admin
  on central.agent_settings
  for update
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  )
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ----------------------------------------------------------------------------
-- INSERT — admin e director
--
-- Necessário porque `garantirPadrao()` cria a linha da organização na primeira
-- leitura (agent-settings.repository.ts). Sem INSERT, o primeiro director a
-- abrir a tela numa organização que ainda não tem linha tomaria erro de RLS em
-- vez de ver os padrões.
-- ----------------------------------------------------------------------------
drop policy if exists agent_settings_insert_admin on central.agent_settings;

create policy agent_settings_insert_admin
  on central.agent_settings
  for insert
  to authenticated
  with check (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

-- ----------------------------------------------------------------------------
-- DELETE — segue só admin, de propósito.
--
-- Apagar a linha de configuração devolve a organização aos padrões e derruba a
-- chave junto. Não é operação de quem só edita texto, e nenhuma tela chama.
-- ----------------------------------------------------------------------------

comment on table central.agent_settings is
  'Configuração do agente e da voz, uma linha por organização. admin lê e grava tudo; director lê e grava apenas system_prompt — o recorte por coluna é feito na rota /api/central/agent-settings, porque RLS decide por linha.';
