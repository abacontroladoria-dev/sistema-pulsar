-- Rodar no SQL Editor. Mesmo conteúdo da migration
-- 20261008130000_controle_terapeutico_select_faturamento.sql.

BEGIN;

DROP POLICY IF EXISTS controle_terapeutico_therapeutic_select ON public.controle_terapeutico;

CREATE POLICY controle_terapeutico_therapeutic_select
  ON public.controle_terapeutico
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['terapeutico', 'terapeuta', 'admin', 'diretoria', 'faturamento'])
        AND u.ativo = true
    )
  );

COMMIT;

-- Conferência: deve listar 'faturamento' no qual.
SELECT policyname, qual
FROM pg_policies
WHERE tablename = 'controle_terapeutico' AND policyname = 'controle_terapeutico_therapeutic_select';
