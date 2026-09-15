-- ============================================================================
-- Central: o ai_mode da CONVERSA passa a valer, e a conversa passa a herdar
--
-- O DEFEITO
--
-- `central.conversations.ai_mode` existe desde 20260701000500 (linha 59), mas
-- ninguem a LE. O worker decide responder ou nao olhando so
-- `central.agent_settings` (escopo organizacao/inbox) —
-- agrupamento.worker.ts:237. A coluna da conversa e apenas ESCRITA, em um lugar
-- unico: `escalarParaHumano()` grava `ai_mode = 'off'` quando a IA desiste do
-- turno (agrupamento.worker.ts:496-500).
--
-- Ou seja: escalar uma conversa para humano nao segura nada. O proximo turno le
-- o agent_settings da organizacao, ve 'autonomous', e a atendente volta a
-- responder por cima do humano que acabou de ser chamado.
--
-- O PEDIDO
--
-- O atendimento comeca sempre pela atendente automatica e, em algum momento,
-- pode precisar passar para uma pessoa. Isso e uma chave POR CONVERSA — a
-- recepcionista assume UMA conversa, nao desliga a IA da clinica inteira.
--
-- POR QUE A COLUNA PRECISA ACEITAR NULL
--
-- Hoje ela e `not null default 'off'`, e o insert de conversa
-- (conversation.repository.ts:131-138) nao informa o campo. Toda conversa nasce
-- 'off'. Se o worker simplesmente passasse a ler a conversa, a atendente
-- pararia de responder para TODO MUNDO no mesmo deploy.
--
-- A correcao nao e trocar o default por 'autonomous': isso faria a conversa
-- nascer com uma decisao que ninguem tomou, e o `ai_mode` da organizacao viraria
-- enfeite — desligar a IA globalmente nao alcancaria nenhuma conversa ja aberta,
-- que e justamente o botao de emergencia que se quer ter.
--
-- Entao NULL ganha significado: "ninguem decidiu nada nesta conversa; vale o
-- padrao da inbox/organizacao". So quando alguem mexe no botao — ou quando a
-- propria IA escala — e que a coluna recebe valor, e a partir dai a conversa
-- manda. Um estado a mais, mas e o unico que distingue "esta conversa foi
-- desligada" de "esta conversa nunca foi tocada", e e essa distincao que faz o
-- padrao da organizacao continuar valendo para quem nao foi tocado.
--
-- O BACKFILL
--
-- Os 'off' que existem hoje NAO sao decisao de ninguem: sao o default da coluna.
-- Verificado em producao antes desta migration — as conversas existentes estao
-- todas em ('off', priority is null), e `escalarParaHumano` grava
-- `priority = 'high'` junto com o 'off'. Logo, nenhuma delas foi escalada, e
-- limpar 'off' para NULL nao apaga escolha alguma.
--
-- O predicado do update carrega essa prova: `priority is distinct from 'high'`
-- preserva qualquer conversa escalada que apareca entre esta leitura e a
-- aplicacao da migration. Se um dia esta migration for reaplicada sobre uma base
-- ja em uso, ela nao vai desligar a protecao de quem foi escalado.
-- ============================================================================

alter table central.conversations
  alter column ai_mode drop not null,
  alter column ai_mode drop default;

-- Ver o bloco O BACKFILL acima para por que isto nao perde decisao.
update central.conversations
set ai_mode = null
where ai_mode = 'off'
  and priority is distinct from 'high';

comment on column central.conversations.ai_mode is
  'Modo de IA DESTA conversa, e nao da organizacao. NULL = ninguem decidiu, vale o ai_mode de central.agent_settings (inbox vence org). Valor preenchido = esta conversa manda, e o padrao da organizacao nao a alcanca. Escrito pelo botao Maia/Atendente no inbox e por escalarParaHumano() no worker.';
