-- O papel 'faturamento' gera o relatório da Central de Terapeutas, mas não lia
-- controle_terapeutico: a vw_central_terapeutica (security_invoker) fazia o
-- LEFT JOIN voltar nulo e o XLSX saía com Substituto, Observação,
-- Confirmado_Por e Confirmado_Em vazios (e Status sempre "Pendente").
-- Só leitura: UPDATE continua restrito.

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
