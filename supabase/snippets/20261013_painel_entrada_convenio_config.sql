-- =============================================================================
-- Apontar o Painel de Entrada de Pacientes para o Doc do ClickUp
-- =============================================================================
-- Só depois de aplicar a migration 20261013100000_painel_entrada_convenio.sql.
--
-- PASSO 1: criar o Doc
--   No ClickUp, criar o Doc "Painel Entrada de Pacientes – dados" num espaço que
--   a conta da Carol (quem roda a tarefa agendada) e a conta adm2 enxerguem.
--   Abrir a página e copiar a URL. Ela tem a forma
--
--     https://app.clickup.com/9011600909/v/dc/<DOC_ID>/<PAGE_ID>
--
--   Ex.: .../v/dc/8cj47gd-12345/8cj47gd-67890 → doc_id 8cj47gd-12345,
--   page_id 8cj47gd-67890.
--
-- PASSO 2: o token
--   Na conta adm2: ClickUp → Settings → Apps → API Token → Generate (pk_...).
--   Colar SÓ no Supabase → Edge Functions → Secrets, com o nome
--   CLICKUP_TOKEN_PAINEL. Nunca neste arquivo, no chat ou no repositório
--   (o repositório é público). O CLICKUP_TOKEN das outras funções não muda.
--
-- PASSO 3: trocar os dois valores abaixo e o false da trava por true, e
--   executar no SQL Editor.
-- =============================================================================

do $$
begin
  if not false then  -- ← troque para true depois de conferir os IDs
    raise exception 'Trava: confira doc_id/page_id abaixo e troque o false da linha acima por true.';
  end if;

  update public.painel_entrada_convenio_config
     set doc_id        = 'COLE_O_DOC_ID',
         page_id       = 'COLE_O_PAGE_ID',
         ativo         = true,
         atualizado_em = now()
   where id = 1;
end $$;

select workspace_id, doc_id, page_id, ativo, atualizado_em
  from public.painel_entrada_convenio_config;
