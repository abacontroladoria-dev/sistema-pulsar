-- "Carregar o Pulsar segundo o TiTa" pelo botão passa a rodar NO SERVIDOR,
-- como a rotina das 04:00 (decisão de 23/10/2026). Antes, o navegador rodava
-- as 4 etapas e esperava a releitura ao vivo do TiTa (até 75 min) com a aba
-- aberta; fechar a aba interrompia a carga.
--
-- Agora a rota /api/tita/carga-manual grava a linha em tita_cargas e roda as
-- etapas depois de responder; a página só acompanha esta linha. Colunas novas:
--
--   passo             o que a carga está fazendo agora (texto para a tela)
--   progresso         releitura ao vivo: {inicio, fim, total, conferidos,
--                     desde, ultimo_avanco_em}
--   atualizado_em     último sinal de vida da carga (a tela avisa se parar)
--   parar_pedido_em   alguém pediu para parar: a carga para no fim do passo
--                     em curso, sem começar a etapa seguinte
--   pedida_por(_nome) quem clicou (as funções das etapas registram a rotina,
--                     porque rodam com a chave de serviço)
--
-- Situação nova: 'parada'. Idempotente.

set lock_timeout = '5s';

alter table public.tita_cargas
  add column if not exists passo            text,
  add column if not exists progresso        jsonb,
  add column if not exists atualizado_em    timestamptz,
  add column if not exists parar_pedido_em  timestamptz,
  add column if not exists pedida_por       uuid,
  add column if not exists pedida_por_nome  text;

alter table public.tita_cargas drop constraint if exists tita_cargas_situacao_check;
alter table public.tita_cargas add constraint tita_cargas_situacao_check
  check (situacao in ('rodando', 'sucesso', 'parcial', 'erro', 'parada'));

comment on table public.tita_cargas is
  'Cada execução de "Carregar o Pulsar segundo o TiTa": rotina diária (04:00, origem cron) ou botão da página (origem manual). Escrita só pela service_role (rotas /api/tita/carga-diaria e /api/tita/carga-manual).';

-- Uma carga por vez, garantido pelo banco: dois cliques ao mesmo tempo (ou o
-- botão junto com a rotina das 04:00) não abrem duas. Carga que morreu no meio
-- (servidor reiniciado) é encerrada pela rota antes de abrir a próxima
-- (encerrarCargasAbandonadas, em services/tita/cargaTita.server.ts).
-- Antes do índice, encerra as "rodando" que sobraram, menos a mais recente.
update public.tita_cargas c
   set situacao = 'erro',
       erro_mensagem = coalesce(c.erro_mensagem, 'Interrompida: a carga parou no meio sem terminar.'),
       finalizado_em = coalesce(c.finalizado_em, now())
 where c.situacao = 'rodando'
   and (c.iniciado_em < now() - interval '3 hours'
        or c.id <> (select id from public.tita_cargas where situacao = 'rodando' order by iniciado_em desc limit 1));

create unique index if not exists uq_tita_cargas_uma_rodando
  on public.tita_cargas ((true)) where situacao = 'rodando';
