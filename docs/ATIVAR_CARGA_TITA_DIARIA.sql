-- ═════════════════════════════════════════════════════════════════════════════
-- LIGAR A ROTINA DIÁRIA "Carregar o Pulsar segundo o TiTa" — 04:00 (Brasília)
-- NÃO É MIGRATION: aplicar à mão no SQL Editor, em DUAS PARTES, nesta ordem.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O que a rotina faz: às 04:00 o banco chama o site
-- (POST https://orbitaautomacao.com.br/api/tita/carga-diaria/), que roda as 4
-- etapas da página Administração → Carregar do TiTa: pacientes, profissionais,
-- disponibilidades e agendamentos. Só LÊ o TiTa. O resultado aparece na mesma
-- página ("Rotina diária das 04:00"); falha abre o alerta carga_tita_falhou.
--
-- Pré-requisito: migration 20261016170000 aplicada.
--
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

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — ligar (SÓ DEPOIS do site publicado com CARGA_TITA_SEGREDO)
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes, confira:
--   [ ] O site publicado tem a página Administração → Carregar do TiTa com o
--       quadro "Rotina diária das 04:00".
--   [ ] CARGA_TITA_SEGREDO no Coolify é IGUAL ao valor da Parte 1.
--   [ ] A Edge Function snapshot-previsao-receitas publicada (opcional: a
--       rotina já atualiza a cópia do cadastro do TiTa sozinha).
--
-- Troque "if not false" por "if not true" para ligar.

do $$
begin
  if not false then
    raise exception 'Trava ligada: confira o checklist da Parte 2 e troque "if not false" por "if not true".';
  end if;
end $$;

create or replace function public.fn_carga_tita_diaria()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  _segredo text;
begin
  select decrypted_secret into _segredo from vault.decrypted_secrets where name = 'carga_tita_segredo';
  if _segredo is null then
    raise exception 'fn_carga_tita_diaria: segredo carga_tita_segredo ausente no Vault (rode a Parte 1).';
  end if;
  -- Barra no fim: sem ela o Next responde 308 e o pg_net não segue redirect.
  -- A rota responde 202 na hora e roda as etapas depois (after()).
  perform net.http_post(
    url := 'https://orbitaautomacao.com.br/api/tita/carga-diaria/',
    headers := jsonb_build_object('x-carga-segredo', _segredo, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;
revoke all on function public.fn_carga_tita_diaria() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'carga-tita-diaria') then
    perform cron.unschedule('carga-tita-diaria');
  end if;
  -- 07:00 UTC = 04:00 em Brasília (sem horário de verão).
  perform cron.schedule('carga-tita-diaria', '0 7 * * *', 'select public.fn_carga_tita_diaria();');

  -- A importação de pacientes agora é a etapa 1 da carga: a rotina antiga sai.
  if exists (select 1 from cron.job where jobname = 'pacientes-importar-tita-diario') then
    perform cron.unschedule('pacientes-importar-tita-diario');
  end if;
end $$;

-- Conferência: deve aparecer só 'carga-tita-diaria' às 0 7 * * *.
select jobname, schedule, command from cron.job
where jobname in ('carga-tita-diaria', 'pacientes-importar-tita-diario');

-- Para testar na hora (sem esperar as 04:00): select public.fn_carga_tita_diaria();
-- e acompanhe em Administração → Carregar do TiTa.
