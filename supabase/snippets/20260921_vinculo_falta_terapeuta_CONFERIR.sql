-- =============================================================================
-- Conferência do vínculo a FALTA DE TERAPEUTA — rodar no SQL Editor
-- =============================================================================
-- Blocos 1 e 2 são SPIKES: rodar ANTES de aplicar a migration. O bloco 1 é o
-- único que pode invalidar o desenho, e ele falha em SILÊNCIO se estiver errado
-- (o cartão simplesmente não fica clicável, sem erro nenhum na tela).
--
-- Blocos 3 a 6 são a verificação DEPOIS de aplicar. Nenhum deles escreve nada.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SPIKE — o formato do bloco sintético bate entre RPC e cliente?
-- ─────────────────────────────────────────────────────────────────────────────
-- O cliente monta `falta_${paciente_id}_${data_atendimento}_${hora_inicial}_${tuss}`
-- em frontend/services/auditoria-assim.service.ts:49, a partir do que
-- get_faltas_auditoria_assim devolve pelo PostgREST. A RPC nova monta a mesma
-- string em SQL. As duas TÊM de ser idênticas caractere a caractere.
--
-- O que observar: `horario_texto` precisa sair 'HH:MM:SS' (com segundos). Se
-- sair 'HH:MM' em alguma linha, o bloco diverge e a candidata nunca vira alvo.
select
  f.horario::text                                        as horario_texto,
  length(f.horario::text)                                as tamanho,  -- 8 = HH:MM:SS
  'falta_' || f.paciente_id::text
           || '_' || f.data_atendimento::text
           || '_' || f.horario::text
           || '_' || f.tuss                              as bloco_pela_rpc
from public.fila_autorizacoes f
where f.tipo_falta ilike '%terapeuta%'
  and f.data_atendimento_real is null
order by f.data_atendimento desc
limit 10;

-- Confirmação pela OUTRA ponta: o mesmo bloco, montado como o cliente o monta a
-- partir da RPC de faltas. As duas colunas têm de ser iguais nas 10 linhas.
--
-- A data é passada à mão porque `current_date - 1` cai em dia sem falta com
-- facilidade (fim de semana, feriado) e um resultado vazio aqui parece um "ok"
-- sem ser um. Use uma das datas que o bloco acima devolveu.
select
  x.hora_inicial::text as hora_da_rpc_de_faltas,
  'falta_' || x.paciente_id || '_' || x.data_atendimento::text
           || '_' || x.hora_inicial::text || '_' || x.tuss as bloco_pelo_cliente
from public.get_faltas_auditoria_assim(date '2026-09-18') x
where x.tipo_falta ilike '%terapeuta%'
limit 10;

-- MEDIDO em 2026-09-21 (spike 1): `horario::text` devolve 'HH:MM:SS' (tamanho 8)
-- nas 10 linhas amostradas, e o bloco da RPC bate com o do cliente. O formato
-- está confirmado; este bloco fica para quando alguém mexer em qualquer das duas
-- pontas.
--
-- MEDIDO em 2026-09-21 (spike 2): no máximo 4 faltas de terapeuta por
-- paciente/TUSS em 30 dias — 1 ou 2 na janela real de 7. O CTE novo não pesa.
-- Quase tudo é TUSS 22070397: guia de outro TUSS simplesmente não terá falta
-- candidata, e isso está certo (a guarda de TUSS é a mais estreita das dez).


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SPIKE — volume: quantas faltas de terapeuta por paciente/TUSS em 7 dias?
-- ─────────────────────────────────────────────────────────────────────────────
-- Se o típico for 0 ou 1, o custo do CTE novo é desprezível e não há o que
-- otimizar. Serve para decidir se vale medir o tempo da RPC depois.
select
  f.paciente_id, f.tuss,
  count(*)                                   as faltas_terapeuta,
  min(f.data_atendimento)                    as de,
  max(f.data_atendimento)                    as ate
from public.fila_autorizacoes f
where f.tipo_falta ilike '%terapeuta%'
  and f.data_atendimento_real is null
  and f.data_atendimento >= current_date - 30
group by 1, 2
order by faltas_terapeuta desc
limit 15;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DEPOIS — as constraints e o índice entraram?
-- ─────────────────────────────────────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.autorizacoes_vinculos'::regclass
  and conname in ('autorizacoes_vinculos_tipo_ck', 'autorizacoes_vinculos_forma_ck');

select indexname, indexdef
from pg_indexes
where tablename = 'autorizacoes_vinculos'
  and indexname = 'autorizacoes_vinculos_falta_ativa_uq';

-- O statement_timeout foi REPOSTO? (CREATE OR REPLACE descarta proconfig, e sem
-- ele a RPC volta ao default e pendura a tela na fatia patológica.)
select proname, proconfig
from pg_proc
where proname in ('get_candidatas_vinculo', 'vincular_autorizacao_falta');


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DEPOIS — NÃO-REGRESSÃO: uma guia órfã que já funcionava hoje
-- ─────────────────────────────────────────────────────────────────────────────
-- O resultado tem de ser o mesmo de antes MAIS, eventualmente, linhas com
-- situacao = 'FALTA_TERAPEUTA'. Nenhuma sessão pode ter sumido nem mudado de
-- elegibilidade — a não-regressão importa mais que a feature nova.
--
-- 4.1 — SEM SUBSTITUIR NADA: escolhe a órfã sozinha e já roda a RPC nela.
--
-- Prefere uma órfã que tenha falta de terapeuta na janela (essa exercita os DOIS
-- ramos do union numa chamada só); se não houver nenhuma, cai na mais recente e
-- o teste vira só de não-regressão.
--
-- `faltas_esperadas` na primeira coluna diz quantas linhas de falta o resultado
-- DEVE conter. Se vier 2 e não aparecer nenhuma linha com `tipo_falta`
-- preenchido, o union não está entregando.
--
-- Demora alguns segundos: varre 30 dias de órfãs e depois chama a RPC, que são
-- 9 fatias de get_auditoria_assim_periodo.
with orfas as (
  select o.guia, o.paciente_id, o.data_execucao, o.codigo_tuss
  from public.get_guias_orfas(current_date - 30, current_date) o
),
com_falta as (
  select o.*,
         (select count(*) from public.fila_autorizacoes f
          where f.paciente_id::bigint = o.paciente_id
            and f.tuss                = o.codigo_tuss
            and f.tipo_falta ilike '%terapeuta%'
            and f.data_atendimento_real is null
            and f.data_atendimento between date(o.data_execucao) - 7
                                       and date(o.data_execucao)) as n_faltas
  from orfas o
),
escolhida as (
  select guia, n_faltas from com_falta
  order by n_faltas desc, data_execucao desc
  limit 1
)
select e.guia as guia_testada, e.n_faltas as faltas_esperadas,
       c.bloco_id, c.situacao, c.tipo_falta, c.data_atendimento,
       c.hora_inicial, c.elegivel, c.ja_vinculado, c.fila_id, c.distancia_horas
from escolhida e
cross join lateral public.get_candidatas_vinculo(e.guia, 7) c
order by c.situacao, c.data_atendimento;


-- 4.2 — as órfãs disponíveis, para escolher outra à mão se quiser.
select guia, paciente_nome, data_execucao, codigo_tuss
from public.get_guias_orfas(current_date - 30, current_date)
limit 10;

-- E a chamada avulsa (troque o número por um `guia` do resultado acima):
-- select bloco_id, situacao, tipo_falta, data_atendimento, hora_inicial,
--        elegivel, ja_vinculado, fila_id, distancia_horas
-- from public.get_candidatas_vinculo('15032', 7)
-- order by situacao, data_atendimento;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DEPOIS — as guardas recusam o que devem recusar
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ NÃO DÁ PARA RODAR DAQUI — medido em 2026-09-21.
--
-- O SQL Editor executa como `postgres`/`service_role`, então `fn_usuario_role()`
-- devolve nulo e a guarda 1 recusa tudo com 42501 antes de chegar às outras:
--   ERROR: 42501: Sem permissão para vincular autorizações
--
-- Isso é a guarda 1 FUNCIONANDO, não um defeito — e vale para
-- `vincular_autorizacao` do mesmo jeito, desde 2026-08. As chamadas abaixo ficam
-- registradas como documentação do que cada guarda recusa; para exercitá-las de
-- verdade é preciso uma sessão autenticada (a tela, logado como admin) ou um
-- bloco que simule o JWT dentro de uma transação com ROLLBACK.
--
-- Na prática as recusas (a) e (b) não são alcançáveis pela UI: a RPC de leitura
-- só oferece falta de TERAPEUTA, do mesmo TUSS, dentro da janela. Elas existem
-- para quem chamar a RPC por fora — que é justamente quando uma guarda importa.
--
-- A guarda 5 é a que sustenta o escopo (só terapeuta), e é a mais importante.

-- (a) falta de PACIENTE → 'Só falta de TERAPEUTA pode receber...'
-- select public.vincular_autorizacao_falta('<GUIA>', '<fila_id de falta de PACIENTE>');

-- (b) TUSS divergente → 'TUSS divergente...'
-- select public.vincular_autorizacao_falta('<GUIA>', '<fila_id de outro TUSS>');

-- (c) fora da janela → 'Falta de ... fora da janela de 7 dias...'
-- select public.vincular_autorizacao_falta('<GUIA>', '<fila_id de falta antiga>');

-- (d) guia já triada → 'Guia ... já foi triada.'
-- select public.vincular_autorizacao_falta('<GUIA JÁ VINCULADA>', '<fila_id válido>');


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. DEPOIS — o efeito no pareamento posicional, medido
-- ─────────────────────────────────────────────────────────────────────────────
-- A consequência assumida: a guia vinculada sai do pool posicional, e uma sessão
-- que ela cobria POR POSIÇÃO no dia da data_execucao volta a aparecer descoberta.
-- Rodar ANTES e DEPOIS de vincular, com a mesma data, e comparar.
-- (<PACIENTE_ID> e <DATA> = os da guia que você vai vincular.)

-- select bloco_id, hora_inicial, codigo_tuss, situacao, guia
-- from public.get_auditoria_assim_periodo('<DATA>', '<DATA>')
-- where paciente_id = '<PACIENTE_ID>'
-- order by hora_inicial;

-- E o que a triagem gravou:
select v.guia, v.tipo, v.bloco_id, v.fila_id, v.vinculado_por, v.vinculado_em,
       v.desfeito_em, v.observacao
from public.autorizacoes_vinculos v
where v.tipo = 'falta_terapeuta'
order by v.vinculado_em desc
limit 20;
