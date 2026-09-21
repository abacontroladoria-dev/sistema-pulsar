-- ============================================================================
-- Central: a conversa passa a saber ate onde a equipe leu
--
-- O QUE FALTAVA
--
-- Nada no schema `central` registra leitura. A UI sabia disso e retirou a peca
-- em vez de fingir: centralToNina.ts grava `unreadCount: 0` fixo, e a badge
-- numerica saiu do ChatInterface com o comentario de que um "3" falso e pior
-- que nada — o operador confia no numero e deixa de abrir a conversa que tem
-- mensagem nova de verdade.
--
-- `central.messages.status` NAO serve para isso. Ele e entrega do lado do
-- CONTATO ('sent'|'delivered'|'read', escrito pelo webhook da Meta): diz que a
-- pessoa leu o que NOS mandamos, nao que nos lemos o que ELA mandou. Sao eixos
-- opostos, e confundi-los faria "marcar como nao lida" mentir para a Meta.
--
-- POR QUE POR CONVERSA, E NAO POR USUARIO
--
-- Uma tabela `conversation_reads (conversation_id, user_id, last_read_at)` daria
-- um nao-lido proprio para cada atendente. Seria mais correto se cada um tivesse
-- a propria caixa — mas aqui a recepcao atende a MESMA fila: quando alguem lê e
-- responde, a conversa esta tratada para todo mundo, e um nao-lido por pessoa
-- faria a mesma conversa cobrar atencao de quem ja sabe que ela foi resolvida.
--
-- A coluna unica assume esse modelo de propriedade coletiva. Se um dia a clinica
-- separar as caixas por atendente, o caminho e a tabela — e esta coluna vira o
-- fallback de quem nunca abriu.
--
-- A SEMANTICA
--
-- `last_read_at` e uma MARCA D'AGUA, nao um contador. Nao-lido e "existe
-- mensagem inbound com sent_at > last_read_at". Isso resolve sozinho tres coisas
-- que um contador erraria:
--
--   * mensagem que chega enquanto a conversa esta aberta nao precisa de UPDATE
--     concorrente — a marca fica para tras e o nao-lido aparece por comparacao;
--   * "marcar como nao lida" nao inventa numero: recua a marca para ANTES da
--     ultima mensagem inbound, e o nao-lido passa a ser exatamente 1, que e o
--     sinal honesto de "isto aqui precisa de retorno";
--   * NULL (nunca lida) e diferente de uma data antiga, e as duas coisas caem
--     na mesma comparacao sem `coalesce` espalhado pelo codigo.
--
-- ROLLBACK REFERENCE
--   alter table central.conversations drop column last_read_at;
--
-- Depends on:
--   20260701000500_create_ca_conversations.sql  (a tabela)
--   20260701000800_create_ca_rls_policies.sql   (conversations_update ja existe)
--
-- Sem GRANT novo: os privilegios de central.conversations sao de TABELA INTEIRA
-- (nao ha grant por coluna nesta tabela), entao a coluna nova ja esta coberta.
-- Ver reference_grants_coluna_postgrest para o caso contrario.
-- ============================================================================

alter table central.conversations
  add column if not exists last_read_at timestamptz;

comment on column central.conversations.last_read_at is
  'Marca d agua de leitura pela EQUIPE (nao por usuario). Nao-lido = existe central.messages inbound com sent_at > last_read_at. NULL = ninguem abriu ainda. Nao confundir com central.messages.status, que e entrega do lado do contato.';

-- Backfill deliberadamente AUSENTE.
--
-- Nao se sabe o que ja foi lido — a informacao nunca existiu. Marcar tudo como
-- lido (last_read_at = now()) apagaria de uma vez as conversas que de fato
-- esperam retorno, que e o dano que esta feature existe para evitar. Deixar NULL
-- faz toda conversa com mensagem do contato aparecer como nao lida no primeiro
-- deploy: barulhento por um dia, e some sozinho conforme a equipe abre cada uma.
-- Barulho que se resolve abrindo a conversa e melhor que silencio que esconde.

notify pgrst, 'reload schema';
