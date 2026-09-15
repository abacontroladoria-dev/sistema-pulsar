-- Sessao combinada: a falta precisa chegar aos DOIS agendamentos do TiTa.
--
-- O PROBLEMA
-- Quando um paciente tem duas terapias no mesmo horario, o TiTa (e o sistema
-- do parceiro) mostram DUAS sessoes separadas, cada uma com seu proprio botao
-- "Faltou". O Pulsar grava UMA linha, com os nomes concatenados por ' + ':
--
--   fila_autorizacoes:  11:20  "Aplicador ABA (AE) + Coordenador de Caso"
--   agenda_tita:        11:20  "Aplicador ABA (AE)"     id 3195192
--                       11:20  "Coordenador de Caso"    id 3535628
--
-- `fn_match_tita_agendamento_id` casa por igualdade EXATA de terapia_nome, e a
-- string concatenada nao e igual a nenhum dos dois nomes. Resultado:
-- `tita_agendamento_id` fica NULL, e como vw_integracao_faltas filtra
-- `tita_agendamento_id IS NOT NULL`, a falta NUNCA chega ao parceiro — nem para
-- uma sessao, nem para a outra.
--
-- Medido em producao nesta data: 118 linhas com ' + ' no terapia_nome e ZERO
-- com chave preenchida. A falha e de 100%, nao intermitente.
--
-- POR QUE A CORRECAO E SO NA SAIDA, E NAO NA TABELA
-- `fila_autorizacoes` tem unique_fila_agendamento UNIQUE (paciente_id,
-- data_atendimento, horario) — SEM terapia (20260518131652_remote_schema:884).
-- O banco so admite uma linha por horario. Isso nao e acidente: uma versao
-- anterior do lote tentou gravar uma linha por terapia e abortava com 23505
-- (documentado em 20260908100100_registrar_falta_em_lote:324-336, cuja
-- conclusao e literal: "a linha de falta representa o HORARIO, nao a terapia").
--
-- Entao a linha unica fica como esta — inclusive porque ela esta CERTA para o
-- Pulsar: o paciente faltou UMA vez, e a assiduidade dele deve contar uma
-- ausencia. Quem precisa de duas linhas e o parceiro, porque do lado dele sao
-- dois agendamentos. A expansao acontece aqui, na projecao, e em lugar nenhum
-- mais.
--
-- SEGURANCA DA EXPANSAO, conferida em producao antes de escrever isto:
--   - 225 ids distintos seriam gerados; ZERO colidem com chave ja existente
--   - ZERO ids seriam emitidos por mais de uma linha da fila
--   - 110 das 118 (93%) decompoem 1:1 limpo; os 8 casos de borda sao todos de
--     maio/junho, nenhum depois da data de corte
--   - ZERO faltas unidade_fechada tem terapia combinada, entao o feriado de
--     07/09 continua com exatamente 336 linhas
--
-- IMPACTO NO PAYLOAD: +1 linha. O recorte pos-corte tem 1.358 faltas, das quais
-- 1.356 tem chave e saem hoje; a view passa a devolver 1.357. Ha 2 linhas
-- combinadas depois do corte, mas uma e status='concluido' (nao e falta, nao
-- entra no criterio). A outra e a falta do Caio Henrique de 10/09, hoje
-- invisivel, que passa a sair como duas — uma por agendamento, cada uma com seu
-- profissional.
--
-- A 1.358a linha e a falta da Thais de 11/09, cujo agendamento foi EXCLUIDO no
-- TiTa 33 min antes do registro. Ela continua fora, de proposito: e a outra
-- causa (13 casos), e decidir se falta em sessao excluida deve chegar ao
-- parceiro e pergunta de negocio, nao tecnica.


-- ============================================================
-- 1. DECOMPOSICAO
-- ============================================================
-- Devolve os agendamentos do TiTa que correspondem a uma linha da fila. Array
-- de 1 elemento no caso normal; de N no caso da sessao combinada.

CREATE OR REPLACE FUNCTION public.fn_agendamentos_da_sessao(
  p_paciente_id   text,
  p_data          date,
  p_horario       time,
  p_terapia_nome  text
) RETURNS bigint[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- Igualdade de PARTE apos o split, jamais ILIKE '%...%'. O substring casaria
  -- 'Aplicador ABA (PS)' com 'Aplicador ABA (SF)' — nomes que diferem so no
  -- sufixo de duas letras e sao terapias distintas, com profissionais
  -- distintos. Lancar a falta na sessao errada e pior que nao lancar.
  WITH partes AS (
    SELECT DISTINCT lower(btrim(p)) AS nome
      FROM unnest(string_to_array(coalesce(p_terapia_nome, ''), ' + ')) AS p
     WHERE btrim(p) <> ''
  ),
  casadas AS (
    SELECT pt.nome,
           at.tita_agendamento_id,
           -- Conta quantos agendamentos ativos atendem a MESMA parte. Usado
           -- abaixo para descartar a metade ambigua.
           count(*) OVER (PARTITION BY pt.nome) AS quantos
      FROM partes pt
      JOIN public.agenda_tita at
        ON at.ativo
       AND at.paciente_id = (p_paciente_id)::bigint
       AND at.data_atendimento = p_data
       AND at.hora_inicial = p_horario
       AND lower(btrim(coalesce(at.terapia_nome, ''))) = pt.nome
     WHERE p_paciente_id IS NOT NULL
       -- Mesmo guarda de fn_match_tita_agendamento_id: paciente_id e `text`
       -- nesta tabela e o cast em valor nao-numerico derrubaria a consulta.
       AND p_paciente_id ~ '^\d+$'
  )
  SELECT array_agg(tita_agendamento_id ORDER BY tita_agendamento_id)
    FROM casadas
   -- Metade ambigua (dois agendamentos ATIVOS com o mesmo nome no horario) e
   -- DESCARTADA, nunca escolhida. Escolher "a mais recente" aqui seria um
   -- palpite que lanca a falta numa sessao possivelmente errada; devolver de
   -- menos e honesto e visivel. Sao 2 casos, ambos de junho.
   WHERE quantos = 1;
$$;

COMMENT ON FUNCTION public.fn_agendamentos_da_sessao(text, date, time, text) IS
  'Agendamentos do TiTa correspondentes a uma linha de fila_autorizacoes. Array de 1 '
  'no caso normal; de N na sessao combinada, cujo terapia_nome traz os nomes unidos '
  'por " + ". Casa por igualdade de parte apos split (nunca substring: (PS) casaria '
  '(SF)). Metade ambigua e descartada, nao chutada. Usado por vw_integracao_faltas.';


-- ============================================================
-- 2. A VIEW, UMA LINHA POR AGENDAMENTO
-- ============================================================
-- CREATE OR REPLACE, jamais DROP+CREATE: o DROP perde o reloptions e mata o
-- `security_invoker` em silencio — regressao real registrada em
-- 20260914120000_advisors_errors_duas_views_restantes.sql:11-19.
--
-- A lista e a ORDEM das colunas sao identicas as de 20260914170000; o
-- CREATE OR REPLACE recusa qualquer mudanca nas duas.

CREATE OR REPLACE VIEW public.vw_integracao_faltas
WITH (security_invoker = true) AS
SELECT
  -- Agora vem da expansao, nao da coluna. Para a falta normal e exatamente o
  -- mesmo valor que f.tita_agendamento_id ja tinha; para a combinada, e cada
  -- um dos agendamentos, um por linha de saida.
  exp.tita_agendamento_id,
  nullif(f.paciente_id, '')::bigint AS paciente_id,
  -- Cada linha de saida agora casa com o SEU proprio agendamento, entao a
  -- combinada deixa de ter profissional NULL e passa a trazer o terapeuta
  -- correto de cada sessao (no caso de 10/09: Amanda numa, Pedro Igor na
  -- outra). LEFT JOIN continua obrigatorio pelo motivo original: 12,7% das
  -- faltas nao tem linha ativa em agenda_tita e sumiriam com INNER.
  a.profissional_id,
  f.data_atendimento,
  f.horario,
  -- Na combinada, entrega o nome da sessao ESPECIFICA em vez da string
  -- concatenada. O parceiro tem um campo escalar do lado dele; mandar
  -- "Aplicador ABA (AE) + Coordenador de Caso" num campo de uma terapia so
  -- obrigava ele a fazer o split que nos ja fizemos aqui.
  coalesce(a.terapia_nome, f.terapia_nome, f.terapia_falta) AS terapia_nome,
  f.tipo_falta,
  f.codigo_justificativa,
  f.justificativa_falta AS justificativa,
  (f.status = 'falta' AND f.tipo_falta IS NOT NULL) AS ativa,
  f.status,
  (coalesce(f.updated_at, f.created_at) AT TIME ZONE 'UTC') AS atualizado_em
FROM public.fila_autorizacoes f
-- A expansao. `coalesce(f.tita_agendamento_id ...)` primeiro: quando a coluna
-- ja esta preenchida — 8.036 linhas — usa o valor gravado e NAO recalcula
-- nada. Isso preserva byte a byte o comportamento de tudo que ja funciona, e
-- limita a decomposicao as linhas que hoje estao sem chave.
CROSS JOIN LATERAL unnest(
  coalesce(
    CASE WHEN f.tita_agendamento_id IS NOT NULL
         THEN ARRAY[f.tita_agendamento_id]
    END,
    public.fn_agendamentos_da_sessao(
      f.paciente_id,
      f.data_atendimento,
      f.horario,
      coalesce(f.terapia_nome, f.terapia_falta)
    ),
    -- Array vazio, e nao NULL: `unnest(NULL)` devolve uma linha com NULL, que o
    -- WHERE abaixo descartaria — mas por caminho menos obvio. Vazio nao produz
    -- linha alguma, que e exatamente a semantica desejada para "nao achei
    -- agendamento nenhum".
    ARRAY[]::bigint[]
  )
) AS exp(tita_agendamento_id)
LEFT JOIN public.agenda_tita a
       ON a.tita_agendamento_id = exp.tita_agendamento_id
      AND a.ativo
WHERE exp.tita_agendamento_id IS NOT NULL
  AND (
        f.status = 'falta'
     OR f.tipo_falta IS NOT NULL
     OR f.falta_revertida_em IS NOT NULL
  );

REVOKE ALL ON public.vw_integracao_faltas FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.vw_integracao_faltas IS
  'Projecao de faltas para parceiros externos: chave do TiTa, paciente, profissional, '
  'sessao, motivo e estado. Sem CPF, carteirinha ou guia. UMA LINHA POR AGENDAMENTO: '
  'a sessao combinada (duas terapias no mesmo horario) e uma linha so na fila, por '
  'causa de unique_fila_agendamento, mas sai aqui como duas — uma por tita_agendamento_id '
  '— porque do lado do parceiro sao dois agendamentos e os dois precisam ser marcados. '
  'As duas linhas compartilham justificativa e codigo: e a mesma ausencia descrita duas '
  'vezes, nao duas faltas. Lida pela RPC integracao_faltas.';
