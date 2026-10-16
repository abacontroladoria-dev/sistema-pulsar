-- ═════════════════════════════════════════════════════════════════════════════
-- ROTINA DIÁRIA "Carregar o Pulsar segundo o TiTa" — 04:00 (Brasília)
-- PASSO 1 DE 2: o segredo. Pode rodar a qualquer momento; não liga nada.
-- Rode ESTE arquivo inteiro sozinho (sem colar outro SQL junto).
-- Depois: copie o valor para o Coolify (CARGA_TITA_SEGREDO), publique o site e
-- só então rode docs/ATIVAR_CARGA_TITA_DIARIA_2_LIGAR.sql.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Pré-requisito: migration 20261016170000 aplicada. Confira:
--   select to_regclass('public.tita_cargas');   -- não pode vir vazio

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — segredo (pode rodar a qualquer momento; não liga nada)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cria o segredo no Vault (se ainda não existir) e mostra o valor. Copie o
-- valor para o Coolify como variável de ambiente CARGA_TITA_SEGREDO e
-- publique o site (com as branches desta entrega mescladas).

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'carga_tita_segredo') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'carga_tita_segredo',
      'Segredo da rotina diária Carregar do TiTa (04:00). Igual à variável CARGA_TITA_SEGREDO do Coolify.');
  end if;
end $$;

select decrypted_secret as copie_para_o_coolify_como_CARGA_TITA_SEGREDO
from vault.decrypted_secrets where name = 'carga_tita_segredo';

