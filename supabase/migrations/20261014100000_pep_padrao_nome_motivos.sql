-- ═════════════════════════════════════════════════════════════════════════════
-- PEP — padrão de nome: motivos mais precisos (14/10/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- A REGRA não muda (a mesma de 20261002100000): nenhum arquivo que hoje segue
-- o padrão deixa de seguir, e nenhum fora do padrão passa a seguir. Muda só o
-- MOTIVO que a tela mostra para o arquivo fora do padrão — antes, quatro
-- casos comuns saíam com uma mensagem enganosa:
--
--   TOP-01-JOAO SILVA-092026    → "o paciente no nome não é o da pasta"
--                                 (o "01" virava parte do nome do paciente)
--                                 agora: sequencial_nao_esperado
--   TAP-1-JOAO SILVA-092026     → "TAP precisa do número"
--   STC-1-092026                → "falta o número"
--                                 agora: sequencial_com_dois_digitos
--   PIC-JOAO SILVA-092026 (2)   → "nome fora do padrão"
--   PIC-JOAO SILVA-092026 - Cópia
--                                 agora: copia_com_sufixo
--   PIC-JOAO SILVA-09-2026      → "falta o mês no fim do nome"
--                                 agora: mes_com_separador
--
-- Espelho em TypeScript: frontend/lib/roboSharepoint/padraoNome.ts (testes em
-- padraoNome.test.ts) — as duas precisam continuar iguais.
--
-- Idempotente. Ao fim, reaplica o padrão: só padrao_motivo muda, e o gatilho
-- de histórico (sp_pep_itens_historico) não registra evento para isso.

CREATE OR REPLACE FUNCTION public.sp_pep_ler_nome_padrao(p_nome text, p_sigla text, p_tipo_registro text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s    text := upper(COALESCE(p_sigla, ''));
  b    text;
  m    text[];
  t1   text;
  MES  constant text := '(0[1-9]|1[0-2])(20[0-9]{2})';
BEGIN
  -- Tira a extensão e uniformiza o separador ("PIC - JOAO" = "PIC-JOAO").
  b := regexp_replace(COALESCE(p_nome, ''), '\.[A-Za-z0-9]{1,5}$', '');
  b := btrim(regexp_replace(b, '\s*[-–—]\s*', '-', 'g'));

  m := regexp_match(b, '^REP-(PIC|RT|OE)-(.+)-' || MES || '$', 'i');
  IF m IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'rep', upper(m[1]) = s, 'sigla', upper(m[1]), 'seq', NULL,
      'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3],
      'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
  END IF;

  IF p_tipo_registro = 'GERAL' THEN
    m := regexp_match(b, '^(STC|ETC)-([0-9]{2})-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', upper(m[1]) = s, 'rep', false, 'sigla', upper(m[1]), 'seq', m[2],
        'paciente', NULL, 'competencia', m[4] || '-' || m[3],
        'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
    END IF;
    IF b ~* ('^(STC|ETC)-[0-9]-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sequencial_com_dois_digitos');
    END IF;
    IF b ~* ('^(STC|ETC)-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'geral_sem_sequencial');
    END IF;
  ELSIF s = 'TAP' THEN
    m := regexp_match(b, '^TAP-([0-9]{2})-(.+)-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'rep', false, 'sigla', 'TAP', 'seq', m[1],
        'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3], 'erro', NULL);
    END IF;
    IF b ~* ('^TAP-[0-9]-(.+)-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sequencial_com_dois_digitos');
    END IF;
    IF b ~* ('^TAP-(.+)-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'tap_sem_sequencial');
    END IF;
  ELSE
    -- Só o TAP leva número. "TOP-01-JOAO-092026" casaria a regra abaixo com o
    -- paciente "01-JOAO" — e sairia como paciente diferente da pasta.
    m := regexp_match(b, '^(TOP|PIC|RT|OE)-[0-9]{1,2}-(.+)-' || MES || '$', 'i');
    IF m IS NOT NULL AND upper(m[1]) = s THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sequencial_nao_esperado');
    END IF;
    m := regexp_match(b, '^(TAP|TOP|PIC|RT|OE)-(.+)-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', upper(m[1]) = s, 'rep', false, 'sigla', upper(m[1]), 'seq', NULL,
        'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3],
        'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
    END IF;
  END IF;

  -- Não casou: diz o mais útil sobre o que está errado.
  t1 := upper(split_part(b, '-', 1));
  IF t1 IN ('STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE', 'REP') THEN
    IF t1 <> s AND t1 <> 'REP' THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sigla_diferente_da_pasta');
    END IF;
    -- Cópia do Windows/SharePoint: "… (2)", "… - Cópia", "… - Copia (3)".
    IF b ~* '(\s*\([0-9]+\)|-c[oó]pia(\s*\([0-9]+\))?)$' THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'copia_com_sufixo');
    END IF;
    -- O mês está lá, mas separado do ano: "09-2026", "09_2026", "09.2026".
    IF b ~ '(0[1-9]|1[0-2])[-_. /](20[0-9]{2})$' THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'mes_com_separador');
    END IF;
    IF b !~ (MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sem_competencia');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'formato_desconhecido');
END;
$$;
GRANT EXECUTE ON FUNCTION public.sp_pep_ler_nome_padrao(text, text, text) TO authenticated;

-- Reaplica para os motivos novos aparecerem já, sem esperar a leitura das 03:00.
SELECT public.sp_pep_aplicar_padrao();
