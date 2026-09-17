-- =============================================================================
-- APLICAR: unidade fechada sai da Conferência
-- =============================================================================
-- Rode os passos EM ORDEM. O passo 1 é leitura, o 2 é a mudança, o 3 confere.
-- Espelha a migration 20260917110000_unidade_fechada_sai_da_conferencia.sql.
--
-- O que muda: num dia em que a recepção lançou "Unidade fechada" (feriado,
-- recesso, falta de energia), as sessões deixam de aparecer na Conferência como
-- "Retorno não confirmado" e voltam como cartão próprio "Unidade fechada",
-- fora da contagem de pendências. Nada muda na assiduidade do paciente.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 1 — ANTES: o tamanho do problema
-- ─────────────────────────────────────────────────────────────────────────────
-- (1a) Quantas sessões de unidade fechada estão HOJE na Conferência, por dia.
--      Cada uma dessas linhas é uma pendência falsa na tela da gestora.
select f.data_atendimento,
       count(*) as sessoes_cobradas_a_toa
  from public.fila_autorizacoes f
 where f.tipo_falta ilike '%unidade%'
   and f.data_atendimento >= current_date - 90
   and f.data_atendimento_real is null
 group by 1
 order by 1 desc;

-- (1b) O caso de referência: 07/09/2026, o dia da Independência.
--      Esperado ANTES: 4 linhas, todas com situacao = 'RETORNO_NAO_CONFIRMADO'.
select bloco_id, hora_inicial, terapias, situacao, motivo_falta
  from public.get_auditoria_assim(date '2026-09-07')
 where paciente_id::text = '11579'
 order by hora_inicial;

-- (1c) E o mesmo dia pelo lado das faltas.
--      Esperado ANTES: NENHUMA linha — é o outro meio do defeito. A sessão não
--      estava nem na Conferência corretamente nem entre as faltas.
select paciente_nome, hora_inicial, tipo_falta, motivo_falta
  from public.get_faltas_auditoria_assim(date '2026-09-07')
 order by paciente_nome, hora_inicial
 limit 20;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 2 — A MUDANÇA
-- ─────────────────────────────────────────────────────────────────────────────
-- Cole aqui o conteúdo INTEIRO de
--   supabase/migrations/20260917110000_unidade_fechada_sai_da_conferencia.sql
-- e execute.
--
-- Ele reescreve três funções a partir da definição VIVA em produção
-- (pg_get_functiondef), trocando só os predicados que enumeram tipos de falta —
-- não cola corpo nenhum, então não há risco de divergir do que está no ar.
--
-- Cada etapa ABORTA com mensagem clara se não encontrar o texto que espera, e
-- avisa com NOTICE se já tiver sido aplicada. Reexecutar é seguro.
--
-- Você deve ver três NOTICEs:
--   get_auditoria_assim_periodo: unidade_fechada sai da Conferência (2 anti-joins)
--   get_faltas_auditoria_assim: unidade_fechada volta como cartão de falta
--   resumo diário: unidade_fechada deixa de ser contada como falta do paciente


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 3 — DEPOIS: provar os três efeitos
-- ─────────────────────────────────────────────────────────────────────────────

-- (3a) A Conferência não cobra mais o feriado.
--      Esperado DEPOIS: NENHUMA linha (antes eram 4).
select bloco_id, hora_inicial, situacao
  from public.get_auditoria_assim(date '2026-09-07')
 where paciente_id::text = '11579'
 order by hora_inicial;

-- (3b) E elas reaparecem como falta de unidade, com o porquê junto.
--      Esperado DEPOIS: as 4 do Davi Lucas, tipo_falta = 'unidade_fechada'.
select paciente_nome, hora_inicial, terapia_nome, tipo_falta,
       motivo_falta, justificativa_falta
  from public.get_faltas_auditoria_assim(date '2026-09-07')
 where paciente_id::text = '11579'
 order by hora_inicial;

-- (3c) O dia inteiro fechou: o que saiu da Conferência é o que entrou nas faltas.
--      Esperado DEPOIS: `na_conferencia` cai para perto de zero para o dia todo,
--      e `nas_faltas` passa a ter as 336.
select
  (select count(*) from public.get_auditoria_assim(date '2026-09-07'))        as na_conferencia,
  (select count(*) from public.get_faltas_auditoria_assim(date '2026-09-07')) as nas_faltas;

-- (3d) A assiduidade do paciente NÃO mudou — feriado nunca contou e segue não
--      contando. Esperado: o mesmo número de antes (provavelmente 0 para 07/09).
select public.contar_faltas_do_paciente('11579', date '2026-09-01', date '2026-09-30')
         as faltas_do_paciente_em_setembro;

-- (3e) Um dia NORMAL não mudou nada — a prova de que o conserto é cirúrgico.
--      Rode antes e depois do passo 2 e compare: os dois números têm de bater.
select
  (select count(*) from public.get_auditoria_assim(current_date - 1))        as conferencia_ontem,
  (select count(*) from public.get_faltas_auditoria_assim(current_date - 1)) as faltas_ontem;


-- ─────────────────────────────────────────────────────────────────────────────
-- PASSO 4 (OPCIONAL) — corrigir o histórico da visão gerencial
-- ─────────────────────────────────────────────────────────────────────────────
-- O resumo diário JÁ GRAVADO mantém o carimbo antigo: os dias fechados do
-- passado seguem contados como falta do paciente no gráfico da gestora. O cron
-- reescreve o dia corrente, mas não volta no tempo sozinho.
--
-- Para refazer os dias fechados dos últimos 90 dias, um a um (é caro: cada dia
-- reprocessa a Conferência inteira — rode fora do horário de pico):
--
--   select f.data_atendimento,
--          public.refresh_auditoria_assim_resumo(f.data_atendimento, f.data_atendimento, true)
--     from (select distinct data_atendimento
--             from public.fila_autorizacoes
--            where tipo_falta ilike '%unidade%'
--              and data_atendimento >= current_date - 90) f
--    order by 1;
--
-- Deixado COMENTADO de propósito: decida com o horário na mão.
