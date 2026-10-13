-- ENSAIO de 20261013120000_operacoes_clinicas_presenca — NÃO grava nada.
-- Roda a migration e termina em RAISE EXCEPTION com o relatório: o Postgres
-- desfaz tudo. O "erro" no fim É o resultado esperado; ler a mensagem RELATORIO.
-- Datas = até 6 dias com entrevista (2279 + paciente real) nos últimos 60 dias
-- e próximos 7. Esperado: ganhos = só cards de "Operações Clínicas" com
-- fluxo 'presenca'; perdidos_ou_alterados = 0.

create temp table _dias as
select distinct data_atendimento as dia
from public.agenda_tita
where ativo and terapia_id = 2279 and terapia_exibicao_id = 2279
  and paciente_nome not in ('Horário Administrativo','Notificação Prévia')
  and data_atendimento between current_date - 60 and current_date + 7
order by 1 desc limit 6;

create temp table _antes as
select d.dia, r.*
from _dias d cross join lateral public.listar_central_autorizacoes(d.dia) r;

-- =============================================================================
-- Entrevista Inicial (Operações Clínicas, 2279) na /solicitar — só presença/falta
-- =============================================================================
-- Pedido da coordenação em 13/10/2026: as avaliações iniciais de Julia Silva De
-- Sousa (8597), Marcelle Cabral Volpasso (8698) e Nathalia Medeiros D' Aniello
-- (8798) não apareciam na /solicitar, e a falta não era registrada.
--
-- "Entrevista Inicial" NÃO chega do TiTa: nem terapia, nem atividade, nem no
-- raw_json. Tudo vem como terapia 2279 / exibição 2279. O que separa a
-- entrevista do resto da agenda é o paciente: o resto é "Horário Administrativo"
-- (que a view já descarta). Levantamento de 90 dias: Julia 30 sessões, Marcelle
-- 5, Nathalia 4, Sandra Cristina Moura Morais (8595) 0 — só administrativo.
-- Escopo decidido: qualquer profissional, sem lista de ids.
--
-- Três bloqueios, três trocas:
--   1. View agenda_tita_autorizacao exigia codigo_tuss IS NOT NULL; 2279 não tem
--      TUSS. Passa quando terapia E exibição são 2279 — exibição 2267
--      (Equoterapia, casos da Marcelle) continua fora.
--   2. listar_central_autorizacoes tinha 'operações clínicas' na blacklist fixa.
--      Mesma exceção (2279/2279); o resto da blacklist não muda.
--   3. tipo_fluxo olhava só o convênio: paciente ASSIM (6 dos casos) cairia em
--      "Autorizar" sem TUSS. Card cujos slots não têm TUSS nenhum vira
--      'presenca' — sem TUSS não há o que pedir à ASSIM. Hoje nenhuma linha ASSIM
--      sem TUSS passa pela view (a exceção da 2800 é só não-ASSIM), então nada
--      que já aparece muda de fluxo.
--
-- TÉCNICA: replace sobre o corpo VIVO (pg_get_viewdef / pg_get_functiondef),
-- nunca CREATE OR REPLACE a partir de arquivo — preserva edições por texto
-- anteriores e o proconfig (search_path de 20261007190000). Cada trecho é
-- contado 1x antes de qualquer troca; senão RAISE e nada muda. Idempotente
-- pelo próprio texto novo.
-- =============================================================================

set lock_timeout = '5s';

-- ── 1) View ───────────────────────────────────────────────────────────────────
DO $migr$
DECLARE
  v_def text;
  v_n   int;
  v_alvo text := '(tu.codigo_tuss IS NOT NULL)';
  v_novo text := '((tu.codigo_tuss IS NOT NULL) OR ((a.terapia_id = 2279) AND (a.terapia_exibicao_id = 2279)))';
BEGIN
  v_def := pg_get_viewdef('public.agenda_tita_autorizacao'::regclass);

  IF position('2279' in v_def) > 0 THEN
    RAISE NOTICE 'agenda_tita_autorizacao já deixa passar Operações Clínicas';
    RETURN;
  END IF;

  v_n := (length(v_def) - length(replace(v_def, v_alvo, ''))) / length(v_alvo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'agenda_tita_autorizacao: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_alvo;
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.agenda_tita_autorizacao AS '
          || replace(v_def, v_alvo, v_novo);
  -- CREATE OR REPLACE zera reloptions.
  EXECUTE 'ALTER VIEW public.agenda_tita_autorizacao SET (security_invoker = true)';
  RAISE NOTICE 'agenda_tita_autorizacao: Operações Clínicas (2279/2279) passa sem TUSS';
END
$migr$;

-- ── 2) e 3) RPC ───────────────────────────────────────────────────────────────
DO $migr$
DECLARE
  v_def  text;
  v_par  text[];
  v_n    int;
  trocas text[][] := ARRAY[
    -- blacklist: abre parêntese ...
    ARRAY[$a$AND lower(COALESCE(ag.terapia_nome, '')) <> ALL (ARRAY[$a$,
          $a$AND (lower(COALESCE(ag.terapia_nome, '')) <> ALL (ARRAY[$a$],
    -- ... e fecha com a exceção da Entrevista Inicial
    ARRAY[$a$'triagem'::text])$a$,
          $a$'triagem'::text])
          OR (ag.terapia_id = 2279 AND ag.terapia_exibicao_id = 2279))$a$],
    -- card sem TUSS nenhum
    ARRAY[$a$array_agg(DISTINCT rs.codigo_tuss)                  AS codigos_tuss,$a$,
          $a$array_agg(DISTINCT rs.codigo_tuss)                  AS codigos_tuss,
    bool_and(rs.codigo_tuss IS NULL)                    AS sem_tuss,$a$],
    -- ... é presença mesmo na ASSIM
    ARRAY[$a$WHEN lower(COALESCE(b.convenio_nome, '')) ~~ '%assim%'::text$a$,
          $a$WHEN NOT b.sem_tuss AND lower(COALESCE(b.convenio_nome, '')) ~~ '%assim%'::text$a$]
  ];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'listar_central_autorizacoes'
     AND pg_get_function_identity_arguments(p.oid) = 'p_data date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'listar_central_autorizacoes(date) não existe';
  END IF;

  IF position('sem_tuss' in v_def) > 0 THEN
    RAISE NOTICE 'listar_central_autorizacoes já trata Operações Clínicas';
    RETURN;
  END IF;

  -- Conta TODAS antes de trocar qualquer uma.
  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_n := (length(v_def) - length(replace(v_def, v_par[1], ''))) / length(v_par[1]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'listar_central_autorizacoes: trecho esperado 1x, achei %: %. Reveja à mão.', v_n, v_par[1];
    END IF;
  END LOOP;

  FOREACH v_par SLICE 1 IN ARRAY trocas LOOP
    v_def := replace(v_def, v_par[1], v_par[2]);
  END LOOP;

  EXECUTE v_def;
  RAISE NOTICE 'listar_central_autorizacoes: Operações Clínicas como presença';
END
$migr$;

DO $t$
DECLARE r jsonb;
BEGIN
  create temp table _depois as
  select d.dia, x.*
  from _dias d cross join lateral public.listar_central_autorizacoes(d.dia) x;

  select jsonb_build_object(
    'dias', (select jsonb_agg(dia order by dia) from _dias),
    -- por dia: entrevistas na tabela, na view, e cards da RPC com Operações Clínicas
    'por_dia', (select jsonb_object_agg(d.dia, jsonb_build_array(
        (select count(*) from public.agenda_tita a where a.ativo and a.data_atendimento = d.dia
           and a.terapia_id = 2279 and a.terapia_exibicao_id = 2279
           and a.paciente_nome not in ('Horário Administrativo','Notificação Prévia')),
        (select count(*) from public.agenda_tita_autorizacao v where v.data_atendimento = d.dia
           and v.terapia_id = 2279 and v.terapia_exibicao_id = 2279),
        (select count(*) from _depois x where x.dia = d.dia
           and 'Operações Clínicas' = ANY(x.terapias)))) from _dias d),
    'rpc_editada', (select position('sem_tuss' in pg_get_functiondef(p.oid)) > 0
                      and position('2279' in pg_get_functiondef(p.oid)) > 0
                    from pg_proc p where p.proname = 'listar_central_autorizacoes'),
    'ganhos', (select jsonb_agg(jsonb_build_object('dia', dia, 'pac', paciente_nome, 'hora', horario,
                 'terapias', terapias, 'conv', convenio_nome, 'fluxo', tipo_fluxo, 'tela', mostrar_na_tela))
               from (select * from _depois except select * from _antes) g),
    'perdidos_ou_alterados', (select count(*) from (select * from _antes except select * from _depois) p),
    'sec_invoker', (select reloptions from pg_class where oid = 'public.agenda_tita_autorizacao'::regclass)
  ) into r;
  RAISE EXCEPTION 'RELATORIO: %', r;
END $t$;
