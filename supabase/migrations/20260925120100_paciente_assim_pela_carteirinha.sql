-- =============================================================================
-- paciente_id da guia ASSIM pela carteirinha INTEIRA, não só pela matrícula.
--
-- CASO: Guilherme De Carvalho Tiburcio (11610), 03/09/2026. O modal da
-- Reconciliação mostrava a guia 70998 como autorização a mais — só que a guia é
-- da Laura Alves Simões (461800.0000001.02). E as guias do próprio Guilherme
-- (224059.0000001.03) estavam com paciente_id 14447 (Emanuel).
--
-- CAUSA: `preencher_paciente_assim` casava `agenda_orbita` só pela parte do
-- meio da carteirinha (`split_part(matricula, '.', 2)`) e pegava a linha mais
-- recente. A parte do meio NÃO é única:
--   - `0000001` é usada por 5 carteirinhas de empresas diferentes;
--   - irmãos dividem a matrícula e só o dependente muda (.00 / .01 / .02).
-- O paciente atribuído era o de quem teve agenda lançada por último.
--
-- MEDIDO (25/09, 5.233 guias): 206 mudam de paciente com a regra nova, em 20
-- pares — Murillo/Saory, Enzo/Brayn, Davi/Mirella/Manuella, José Pedro/Yasmim,
-- os 5 da `0000001`. Em todos, o nome (truncado) da guia bate com o paciente
-- novo. Nenhuma guia fica sem paciente que hoje tem.
--
-- REGRA:
--   1. empresa + matrícula + dependente. Se a própria carteirinha inteira for
--      de mais de um paciente (existe 1: 000000.0774737.01, Heitor e Guilherme
--      Hespanhol — cadastro duplicado na TiTa), desempata pelo nome da guia
--      como prefixo do nome da agenda (a ASSIM trunca em 20, caixa alta, sem
--      acento) e só então pela linha mais recente.
--   2. Sem casamento inteiro (matrícula sem pontos, carteirinha ainda não vista
--      na agenda): só a matrícula, e SÓ se ela for de um único paciente.
--      Ambígua → NULL, que é "não sei", em vez de um palpite errado.
--   3. Matrícula vazia → NULL (antes casava com toda linha de matrícula vazia).
-- =============================================================================

set lock_timeout = '5s';

-- agenda_orbita não tinha índice por matrícula: o trigger fazia uma varredura
-- inteira (~21 mil linhas) por guia gravada, e o backfill abaixo faria 5 mil.
CREATE INDEX IF NOT EXISTS idx_agenda_orbita_carteirinha
  ON public.agenda_orbita (matricula, empresa, dep);

CREATE OR REPLACE FUNCTION public.paciente_da_guia_assim(p_matricula text, p_nome text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_emp  text;
  v_mat  text;
  v_dep  text;
  v_nome text := upper(btrim(coalesce(p_nome, '')));
  v_id   bigint;
  v_ids  bigint[];
BEGIN
  IF p_matricula LIKE '%.%.%' THEN
    v_emp := split_part(p_matricula, '.', 1);
    v_mat := split_part(p_matricula, '.', 2);
    v_dep := split_part(p_matricula, '.', 3);
  ELSE
    v_mat := regexp_replace(coalesce(p_matricula, ''), '\D', '', 'g');
  END IF;

  IF coalesce(v_mat, '') = '' THEN
    RETURN NULL;
  END IF;

  IF v_emp IS NOT NULL THEN
    SELECT ao.paciente_id::bigint INTO v_id
      FROM agenda_orbita ao
     WHERE ao.matricula = v_mat
       AND ao.empresa   = v_emp
       AND ao.dep       = v_dep
     ORDER BY
       (v_nome <> '' AND upper(translate(ao.paciente_nome,
          'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) LIKE v_nome || '%') DESC,
       ao.created_at DESC
     LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  SELECT array_agg(DISTINCT ao.paciente_id::bigint) INTO v_ids
    FROM agenda_orbita ao
   WHERE ao.matricula = v_mat;

  IF cardinality(v_ids) = 1 THEN
    RETURN v_ids[1];
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.paciente_da_guia_assim(text, text) IS
  'Resolve o paciente de uma guia ASSIM pela carteirinha inteira (empresa.matricula.dep) em agenda_orbita; '
  'só a matrícula quando ela é de um paciente só. A matrícula sozinha não identifica: irmãos e a 0000001 a '
  'compartilham (20260925120100).';

-- Fechada para a API: devolveria paciente_id a partir de uma carteirinha. Quem a
-- chama é o trigger abaixo, que é SECURITY DEFINER — então o papel que grava a
-- guia (o robô da ASSIM, seja qual for a chave) não precisa de EXECUTE aqui.
REVOKE ALL ON FUNCTION public.paciente_da_guia_assim(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paciente_da_guia_assim(text, text) TO service_role;

-- O trigger mantém `matricula_limpa` como era (é chave de idx_autorizacoes_assim_match).
-- SECURITY DEFINER: antes a leitura de agenda_orbita dependia dos privilégios de
-- quem gravava a guia; agora não depende, e o helper pode ficar fechado.
CREATE OR REPLACE FUNCTION public.preencher_paciente_assim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  new.matricula_limpa :=
    CASE
      WHEN new.matricula LIKE '%.%.%'
        THEN split_part(new.matricula, '.', 2)
      ELSE regexp_replace(new.matricula, '\D', '', 'g')
    END;

  new.paciente_id := public.paciente_da_guia_assim(new.matricula, new.paciente_nome);

  RETURN new;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Backfill: só as linhas cujo paciente muda. O UPDATE dispara o trigger de
-- updated_at nessas ~206 linhas; nada no repo usa updated_at de
-- autorizacoes_assim como marca d'água.
-- -----------------------------------------------------------------------------
WITH novo AS (
  SELECT guia, public.paciente_da_guia_assim(matricula, paciente_nome) AS paciente_id
    FROM public.autorizacoes_assim
)
UPDATE public.autorizacoes_assim aa
   SET paciente_id = n.paciente_id
  FROM novo n
 WHERE n.guia = aa.guia
   AND aa.paciente_id IS DISTINCT FROM n.paciente_id;
