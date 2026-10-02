-- Duas migrations do repositório que NUNCA rodaram em produção — achadas na
-- auditoria do livro-caixa de 02/10/2026 — e de que o código já depende.
--
-- APLICA 20260811150000 e 20260929150000 e as registra no livro-caixa. Snippet e
-- não `db push` (histórico dessincronizado). Reexecutável.
--
-- 1) 20260811150000_substituicoes_historico_fora_especialidade
--    O commit d29e3333 (11/08) passou a gravar `fora_da_especialidade` e
--    `motivo_excecao` em substituicoes_historico. As colunas não existiam, o
--    PostgREST recusava a linha inteira e o serviço só fazia console.error: a
--    última linha do histórico é de 11/08/2026 13:49 UTC — quase dois meses de
--    substituições sem registro (as que se perderam NÃO voltam com isto; a
--    gravação volta a partir de agora). Aditiva: duas colunas com default numa
--    tabela de 434 linhas, uma CHECK (todas as linhas atuais passam: o default é
--    FALSE) e um índice parcial. A CHECK vai dentro de um teste de existência
--    porque o ADD CONSTRAINT do arquivo não é reexecutável — mesmo efeito.
--
-- 2) 20260929150000_grupos_do_usuario
--    Função só de leitura que as telas chamam para mostrar o GRUPO onde antes
--    mostravam o nível técnico. Sem ela, carregarGruposDoUsuario() devolve null e
--    o rótulo fica vazio (o próprio arquivo diz: "pode aplicar a qualquer
--    momento"). Idempotente.

begin;

set lock_timeout = '5s';

-- 1) ---------------------------------------------------------------------------
ALTER TABLE public.substituicoes_historico
  ADD COLUMN IF NOT EXISTS fora_da_especialidade BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS motivo_excecao TEXT;

COMMENT ON COLUMN public.substituicoes_historico.fora_da_especialidade IS
  'TRUE quando profissional_substituto_nome não pertence à matriz terapiasCompativeis() da terapia_real da sessão.';
COMMENT ON COLUMN public.substituicoes_historico.motivo_excecao IS
  'Motivo obrigatório digitado pelo usuário quando fora_da_especialidade = TRUE. NULL quando a substituição segue a matriz de compatibilidade padrão.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.substituicoes_historico'::regclass
       AND conname = 'chk_subst_hist_motivo_excecao'
  ) THEN
    ALTER TABLE public.substituicoes_historico
      ADD CONSTRAINT chk_subst_hist_motivo_excecao
      CHECK (NOT fora_da_especialidade OR (motivo_excecao IS NOT NULL AND btrim(motivo_excecao) <> ''));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_subst_hist_fora_especialidade
  ON public.substituicoes_historico (fora_da_especialidade)
  WHERE fora_da_especialidade;

reset lock_timeout;

-- 2) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grupos_do_usuario(p_usuario_id uuid DEFAULT auth.uid())
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nomes text[];
BEGIN
  -- De OUTRA pessoa, só para quem administra acessos ("Visualizar como") —
  -- mesma regra de permissoes_efetivas() (20260929140000).
  IF p_usuario_id IS DISTINCT FROM auth.uid()
     AND NOT (public.is_admin() OR public.is_diretoria()
              OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'sem permissão para consultar os grupos de outro usuário'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(g.nome ORDER BY g.nome), ARRAY[]::text[])
  INTO v_nomes
  FROM public.grupos_permissoes_membros m
  JOIN public.grupos_permissoes g ON g.id = m.grupo_id
  WHERE m.usuario_id = p_usuario_id;

  RETURN v_nomes;
END;
$$;

REVOKE ALL ON FUNCTION public.grupos_do_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grupos_do_usuario(uuid) TO authenticated, service_role;

-- Livro-caixa ------------------------------------------------------------------
notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260811150000', 'substituicoes_historico_fora_especialidade'),
  ('20260929150000', 'grupos_do_usuario')
on conflict (version) do nothing;

commit;

-- Conferência (só leitura): colunas = 2, regra = 1, funcao = 1, registradas = 2.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'substituicoes_historico'
      and column_name in ('fora_da_especialidade', 'motivo_excecao'))                              as colunas,
  (select count(*) from pg_constraint where conname = 'chk_subst_hist_motivo_excecao')               as regra,
  (select count(*) from pg_proc where proname = 'grupos_do_usuario')                                 as funcao,
  (select count(*) from supabase_migrations.schema_migrations
    where version in ('20260811150000', '20260929150000'))                                           as registradas;
