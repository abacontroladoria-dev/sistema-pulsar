-- ============================================================================
-- central.agent_settings — director com os mesmos poderes do admin
--
-- 20260914190000 deu a director SELECT, INSERT e UPDATE, deixando DELETE só
-- para admin, e a restrição "só o prompt" morava na rota (RLS decide por linha,
-- não por coluna). A diretoria passou a ter a página inteira: o recorte por
-- campo saiu da rota, e aqui sai o último degrau que ainda separava os papéis.
--
-- O que isso passa a permitir, explicitamente: director grava
-- `elevenlabs_api_key`. A coluna é gravável por `authenticated` desde
-- 20260810120300 e continua NÃO legível — nem para admin, nem para director —
-- porque o grant por coluna daquela migration não concede SELECT nela. A
-- máscara que a tela mostra vem do service, que lê com service role.
--
-- DELETE apaga a linha de configuração da organização e derruba a chave junto.
-- Nenhuma tela chama; a policy existe para não deixar um papel com UPDATE e
-- sem DELETE por acidente de histórico, e não porque haja caso de uso.
-- ============================================================================

drop policy if exists agent_settings_delete_admin on central.agent_settings;

create policy agent_settings_delete_admin
  on central.agent_settings
  for delete
  to authenticated
  using (
    organization_id = central.current_organization_id()
    and central.ca_current_role() in ('admin', 'director')
  );

comment on table central.agent_settings is
  'Configuração do agente e da voz, uma linha por organização. admin e director leem e gravam tudo; elevenlabs_api_key é gravável mas não legível por authenticated (grant por coluna em 20260810120300).';
