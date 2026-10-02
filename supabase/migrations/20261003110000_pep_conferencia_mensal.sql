-- PEP: "Conferido" — uma pessoa confere as entregas de um analista no mês.
--
-- Pedido do usuário (02/10/2026): o status do analista na Visão geral de
-- Entregas PEP deixa de dizer "o sistema já calculou" e passa a dizer o que as
-- pessoas fizeram: Faltam entregas → Entregas completas → Conferido → Liberado
-- para pagamento. "Conferido" precisa de um registro: quem clicou e quando.
--
-- A conferência perde a validade sozinha se uma entrega do analista mudar
-- depois dela (a tela compara pep_registros_entrega.updated_at com
-- conferido_em), então não há nada a "desconferir" à mão.
--
-- Só acrescenta; idempotente.

CREATE TABLE IF NOT EXISTS public.pep_conferencia_mensal (
  prestador_nome     text        NOT NULL,
  competencia        text        NOT NULL,
  conferido_por      uuid        REFERENCES public.usuarios(id),
  conferido_por_nome text,
  conferido_em       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prestador_nome, competencia)
);

COMMENT ON TABLE public.pep_conferencia_mensal IS
  'Uma pessoa conferiu as entregas do analista no mês. Vale até uma entrega do analista mudar depois de conferido_em.';

ALTER TABLE public.pep_conferencia_mensal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pep_conferencia_mensal_select ON public.pep_conferencia_mensal;
CREATE POLICY pep_conferencia_mensal_select ON public.pep_conferencia_mensal
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo AND u.role IN ('rp', 'admin', 'diretoria')));

REVOKE ALL ON public.pep_conferencia_mensal FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.pep_conferencia_mensal FROM authenticated;
GRANT SELECT ON public.pep_conferencia_mensal TO authenticated;

-- Marca ou desmarca. Mesmo critério de quem registra entregas (rp e admin).
-- Mês liberado já é a palavra final: não precisa (nem deve) ser conferido.
CREATE OR REPLACE FUNCTION public.pep_conferir_mes(p_prestador text, p_competencia text, p_conferir boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao para conferir entregas do PEP' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_prestador), '') = '' OR p_competencia !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'prestador ou competencia invalidos' USING ERRCODE = '22023';
  END IF;

  IF NOT p_conferir THEN
    DELETE FROM pep_conferencia_mensal WHERE prestador_nome = p_prestador AND competencia = p_competencia;
    RETURN jsonb_build_object('conferido', false);
  END IF;

  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  INSERT INTO pep_conferencia_mensal (prestador_nome, competencia, conferido_por, conferido_por_nome, conferido_em)
  VALUES (p_prestador, p_competencia, auth.uid(), v_nome, now())
  ON CONFLICT (prestador_nome, competencia) DO UPDATE
     SET conferido_por = EXCLUDED.conferido_por, conferido_por_nome = EXCLUDED.conferido_por_nome,
         conferido_em = EXCLUDED.conferido_em;
  RETURN jsonb_build_object('conferido', true, 'por', v_nome, 'em', now());
END;
$$;
REVOKE ALL ON FUNCTION public.pep_conferir_mes(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pep_conferir_mes(text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
