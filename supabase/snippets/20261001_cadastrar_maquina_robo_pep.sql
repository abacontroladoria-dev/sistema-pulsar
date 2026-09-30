-- Cadastra o robô SharePoint → PEP (container Coolify) em public.maquinas, no
-- mesmo esquema de identidade por máquina do robo-autorizador e do robo-laudos
-- (20260813100000_robo_identidade_por_maquina.sql, 20260813100200_robo_rpcs.sql).
--
-- PRÉ-REQUISITO: a migration 20261001120000_robo_pep_sharepoint.sql aplicada.
--
-- UM PASSO SÓ (01/10/2026: a versão em duas etapas parava na trava quando o
-- arquivo era rodado inteiro). Gera o token, grava só o hash SHA-256 e mostra
-- o token em claro UMA VEZ, na coluna token_copie_agora.
--
-- Copie o token direto para:
--   1. C:\Users\Maquina001\.pulsar-sharepoint\robo.env  → MACHINE_TOKEN=
--   2. Coolify, recurso robo-pep-sharepoint           → MACHINE_TOKEN (Secret)
-- Não cole em chat nem em e-mail.
--
-- ATENÇÃO: rodar de novo gera OUTRO token e invalida o anterior (o robô para
-- até o token novo ser colado nos dois lugares). É também o jeito de trocar o
-- token se ele vazar.

with novo as (
  select encode(gen_random_bytes(32), 'hex') as token
), gravado as (
  insert into public.maquinas (id, nome, ativa, hostname, token_hash, token_criado_em)
  select 'robo-pep-sharepoint',
         'Robô SharePoint → PEP (Coolify)',
         true,
         'coolify',
         encode(sha256(convert_to(novo.token, 'UTF8')), 'hex'),
         now()
    from novo
  on conflict (id) do update
    set token_hash        = excluded.token_hash,
        token_criado_em   = excluded.token_criado_em,
        token_revogado_em = null,
        ativa             = true
  returning id, token_criado_em
)
select novo.token          as token_copie_agora,
       gravado.id          as maquina,
       gravado.token_criado_em,
       (select count(*) from public.sp_pep_execucoes) as execucoes_registradas  -- 0 = migration aplicada
  from novo, gravado;

-- ---------------------------------------------------------------------------
-- Em caso de vazamento do token: revogar (o robô para na próxima chamada).
-- ---------------------------------------------------------------------------
-- update public.maquinas set token_revogado_em = now() where id = 'robo-pep-sharepoint';
