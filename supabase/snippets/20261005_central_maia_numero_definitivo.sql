-- ============================================================================
-- Maia: do número de teste da Meta para o número definitivo
--
-- Rodar UMA vez, no SQL Editor, DEPOIS de:
--   1. a WABA 1217115200612520 estar inscrita no app "Pulsar Atendimento"
--      (POST /1217115200612520/subscribed_apps) — sem isso a Meta não entrega
--      nada no webhook;
--   2. o nome de exibição estar aprovado (em 05/10/2026 estava DECLINED).
--
-- Mesmo app e mesmo usuário de sistema do número de teste: META_WABA_TOKEN,
-- WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN NÃO mudam. Só os IDs.
--
-- Valores conferidos na Graph API em 05/10/2026:
--   +55 21 96624-6366 "Confirmação de Consulta Universo ABA", CLOUD_API, CONNECTED
--
-- Reverter = rodar 20260901_central_configurar_canal_meta.sql de novo.
-- ============================================================================

update central.channel_connections
set provider_metadata = jsonb_build_object(
      'phone_number_id',      '1281520138372573',
      'waba_id',              '1217115200612520',
      'display_phone_number', '+55 21 96624-6366',
      'e_numero_de_teste',    false
    ),
    external_id         = '1281520138372573',
    provider_account_id = '1217115200612520',
    connection_status   = 'active'
where channel_id = (
  select id from central.channels
  where provider = 'meta_waba'
    and organization_id = 'a0000000-0000-0000-0000-000000000001'
);

-- Conferência: deve voltar UMA linha, com o phone_number_id novo.
select c.name, c.status, cc.connection_status, cc.external_id, cc.provider_metadata
from central.channels c
join central.channel_connections cc on cc.channel_id = c.id
where c.provider = 'meta_waba';

-- Estado atual da atendente (não é alterado aqui):
select ai_mode from central.agent_settings
where organization_id = 'a0000000-0000-0000-0000-000000000001'
  and inbox_id is null;
