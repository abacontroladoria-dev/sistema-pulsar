-- Cadastra o robô SharePoint → PEP (container Coolify) em public.maquinas, no
-- mesmo esquema de identidade por máquina do robo-autorizador e do robo-laudos
-- (20260813100000_robo_identidade_por_maquina.sql, 20260813100200_robo_rpcs.sql).
--
-- PRÉ-REQUISITO: a migration 20261001120000_robo_pep_sharepoint.sql aplicada.
--
-- Rode em DUAS ETAPAS no SQL Editor do Supabase.

-- ---------------------------------------------------------------------------
-- ETAPA 1 — gerar o token em claro. Aparece SÓ AGORA, nunca mais.
-- ---------------------------------------------------------------------------
select encode(gen_random_bytes(32), 'hex') as token_claro;

-- Copie o valor de "token_claro". Ele vai para o Coolify como MACHINE_TOKEN
-- (Secret) do recurso robo-pep-sharepoint — e para o robo.env da máquina de
-- desenvolvimento, que fica FORA do repositório. Não cole em chat nem e-mail.

-- ---------------------------------------------------------------------------
-- ETAPA 2 — colar o token copiado no lugar das DUAS ocorrências de
-- SEU_TOKEN_AQUI (Ctrl+H), trocar a trava para true e rodar. Só o hash SHA-256
-- fica gravado.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  colei_o_token_da_etapa_1 boolean := false;
BEGIN
  IF NOT colei_o_token_da_etapa_1 THEN
    RAISE EXCEPTION 'Pare: rode a ETAPA 1, cole o token no lugar de SEU_TOKEN_AQUI e troque false por true. Nada foi alterado.';
  END IF;
  IF length('SEU_TOKEN_AQUI') < 64 THEN
    RAISE EXCEPTION 'O token colado é curto demais (esperado: 64 caracteres). Nada foi alterado.';
  END IF;

  INSERT INTO public.maquinas (id, nome, ativa, hostname, token_hash, token_criado_em)
  VALUES (
    'robo-pep-sharepoint',
    'Robô SharePoint → PEP (Coolify)',
    true,
    'coolify',
    encode(sha256(convert_to('SEU_TOKEN_AQUI', 'UTF8')), 'hex'),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET token_hash        = EXCLUDED.token_hash,
        token_criado_em   = EXCLUDED.token_criado_em,
        token_revogado_em = NULL,
        ativa             = true;
END $$;

-- ---------------------------------------------------------------------------
-- Conferência — 1 linha, ativa = true, token_revogado_em nulo.
-- ---------------------------------------------------------------------------
select id, nome, ativa, hostname, token_criado_em, token_revogado_em, last_seen, app_version
  from public.maquinas
 where id = 'robo-pep-sharepoint';

-- ---------------------------------------------------------------------------
-- Em caso de vazamento do token: revogar (o robô para na próxima chamada).
-- ---------------------------------------------------------------------------
-- update public.maquinas set token_revogado_em = now() where id = 'robo-pep-sharepoint';
