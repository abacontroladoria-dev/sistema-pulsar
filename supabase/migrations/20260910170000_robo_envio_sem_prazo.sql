-- =============================================================================
-- Robô 1.1.8: a espera pelo clique em "enviar" não tem mais prazo
-- =============================================================================
--
-- O QUE ACONTECIA. Depois da leitura facial/QR o robô preenche o formulário e
-- PARA: quem clica em "enviar" é a recepcionista. Essa espera tinha prazo —
-- `envio_timeout_ms`, 120s. Estourado, o rpa.js lançava erro, o worker chamava
-- sessao.descartar() e o contexto do Chrome fechava: a JANELA SUMIA na cara do
-- operador, com o formulário preenchido dentro e sem nenhuma contagem visível
-- avisando que aquilo ia acontecer.
--
-- O QUE MUDA. A partir da 1.1.8 o robô IGNORA esta coluna. A espera acaba de
-- dois jeitos, e só: a ASSIM responde, ou uma pessoa fecha a aba.
--
-- POR QUE ZERAR SE O CÓDIGO JÁ IGNORA. Justamente por isso: o valor 120000 aqui
-- descreveria um comportamento que não existe mais, e a próxima pessoa a ler a
-- tabela acreditaria nele. O código não depende deste UPDATE — é máquina com
-- config velha em cache que não pode ressuscitar o fechamento automático.
--
-- A coluna NÃO é removida: robô 1.1.7 ainda em campo lê a config pela RPC
-- robo_obter_config_assim, e derrubar a coluna quebraria o parse dessas
-- máquinas durante a janela de atualização da frota.

UPDATE public.robo_config
   SET envio_timeout_ms = 0,
       updated_at       = now()
 WHERE envio_timeout_ms IS DISTINCT FROM 0;

COMMENT ON COLUMN public.robo_config.envio_timeout_ms IS
  'OBSOLETO desde o robô 1.1.8 (2026-09-10): o robô IGNORA este valor. A espera '
  'pelo clique em "enviar" não tem prazo — termina quando a ASSIM responde ou '
  'quando uma pessoa fecha a aba. Mantida só para o parse dos robôs <= 1.1.7 '
  'ainda em campo. Até a 1.1.7 valia 120000, e o estouro FECHAVA a janela da '
  'recepção com o formulário preenchido dentro.';
