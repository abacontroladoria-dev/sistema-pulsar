-- Reconciliação ASSIM — a triagem vale para a guia que ela viu, não para o número
--
-- APLICA a migration 20261002150000 e a registra no livro-caixa. Snippet e não
-- `db push` (histórico de migrations dessincronizado). Reexecutável: a marca
-- /* 20261002150000 */ faz as edições por texto pularem o que já foi editado.
--
-- Pode ser aplicado a qualquer momento: o frontend funciona antes e depois.
--
-- O que muda no banco (detalhe no cabeçalho da migration):
--   • autorizacoes_vinculos ganha `guia_emitida_em` (backfill das triagens cuja
--     guia ainda é a mesma) e o índice único ativo passa de (guia) para
--     (guia, guia_emitida_em).
--   • get_guias_orfas, get_auditoria_assim_periodo e get_tokens_mensal só ligam
--     a triagem à guia emitida ANTES dela; vincular_autorizacao(+_falta,
--     +_substituicao) e marcar_guia_sem_sessao deixam triar a guia reemitida.
--
-- Ensaiado em produção em 02/10/2026 dentro de transação desfeita: 6.136 blocos
-- da Conferência antes e depois, nenhuma situação mudou; as 8 sessões cobertas
-- por guia de número reemitido seguem GLOSA_RESOLVIDA, sem os dados da guia
-- nova; as sessões dos pacientes novos passam a receber a guia deles.
--
-- Não apaga nem desfaz nenhuma triagem.

begin;

-- =============================================================================
-- A triagem da Reconciliação vale para a GUIA que ela viu, não para o número.
--
-- O DEFEITO
--
-- O número da guia da ASSIM recicla, e `autorizacoes_assim` tem UNIQUE (guia):
-- a emissão nova sobrescreve a antiga. `autorizacoes_vinculos` guarda só o
-- número, então a guia nova — outro paciente, outro atendimento — herdava a
-- triagem feita sobre a antiga. Em 02/10/2026: 8 dos 28 vínculos ativos, todos
-- com o paciente da guia atual diferente do paciente da sessão triada (quatro
-- reemitidas no próprio dia 02/10). Eram 4 em 28/09.
--
-- Efeitos, por leitor:
--   - get_guias_orfas e a CTE `autorizacoes` de get_auditoria_assim_periodo
--     tiravam a guia nova do pareamento ("guia já triada não compete"). A
--     sessão do paciente novo ficava sem a guia dela, e a guia não aparecia
--     nem como pareada nem como órfã: ninguém conseguia triá-la.
--   - o LATERAL `vin` (período e tokens) e a Semente 3 de get_tokens_mensal
--     liam token, biofacial e data_execucao da guia NOVA para a sessão ANTIGA:
--     a Conferência mostrava a forma de autorização de outro paciente.
--   - as funções de gravação recusavam triar a guia nova ("já foi triada"),
--     e o índice único por número impediria mesmo se não recusassem.
--
-- A REGRA
--
-- Ninguém vincula uma guia que ainda não existe. Então a linha de
-- `autorizacoes_assim` que uma triagem descreve é a emitida ANTES dela:
--   aa.data_execucao <= (v.vinculado_em AT TIME ZONE 'America/Sao_Paulo')
-- `data_execucao` é timestamp sem fuso com hora de Brasília; `vinculado_em` é
-- timestamptz. É a mesma regra do cliente (`guiaPosteriorAoVinculo`, em
-- frontend/components/auditoria-assim/reconciliacao/vinculo.ts).
--
-- O robô grava `autorizacoes_assim` por upsert na guia com a data da linha do
-- extrato, que não muda entre execuções para a mesma guia — os 8 casos de
-- 02/10 com emissão posterior à triagem são todos de outro paciente.
--
-- O QUE MUDA
--
--   1. Coluna `guia_emitida_em`: a emissão da guia no momento da triagem. Só
--      as triagens cuja guia ainda é a mesma ganham valor no backfill; as 8 de
--      número reemitido ficam nulas (a emissão original foi sobrescrita).
--   2. Índice único ativo por (guia, guia_emitida_em) no lugar do único por
--      guia — duas triagens ativas do mesmo número, de emissões diferentes,
--      passam a caber. Nulos não colidem, e só as 8 antigas são nulas.
--   3. Leitores: o vínculo só aponta para a guia emitida antes dele. No `vin`
--      o JOIN vira LEFT JOIN: a COBERTURA da sessão antiga continua (a guia
--      antiga existiu e cobriu), e só os dados da guia — token, biofacial,
--      data — ficam nulos em vez de serem os do outro paciente. A observação
--      deixa de escrever " de <data>" quando a data não é conhecida.
--   4. Gravação: "já foi triada" passa a valer só para a mesma emissão, e o
--      insert grava `guia_emitida_em`.
--
-- Fora de alcance de propósito: get_conferencia_guias_dia (devolve só o
-- número da guia que cobriu, certo mesmo com reemissão), get_candidatas_vinculo,
-- reclassificar_situacao, desfazer_sessao_adiantada e get_faltas_auditoria_assim
-- (casam o vínculo pelo bloco ou pela fila, não pelo número).
--
-- TÉCNICA: edição por texto sobre pg_get_functiondef no banco vivo — nunca a
-- partir de arquivo do repo (ver 20260922240000). Cada alvo é de UMA linha (os
-- corpos em produção têm \r\n) e é conferido pela contagem exata; a marca
-- /* 20261002150000 */ torna a migration reexecutável. pg_get_functiondef
-- devolve os SET de proconfig, então statement_timeout e search_path
-- sobrevivem. Compatível, nas duas ordens, com as edições de get_tokens_mensal
-- de 20260925140000/150000 (elas mexem em `chaves_vinculo`; estas, na Semente
-- 3 e no `vin`).
-- =============================================================================

set lock_timeout = '5s';

-- 1) A emissão que a triagem viu ------------------------------------------------
alter table public.autorizacoes_vinculos
  add column if not exists guia_emitida_em timestamp without time zone;

comment on column public.autorizacoes_vinculos.guia_emitida_em is
  'data_execucao da guia em autorizacoes_assim no momento da triagem. O número da guia recicla e autorizacoes_assim guarda só a emissão mais nova; esta coluna diz qual emissão foi triada. Nula nas triagens anteriores a 20261002150000 cujo número já tinha sido reemitido.';

update public.autorizacoes_vinculos v
   set guia_emitida_em = aa.data_execucao
  from public.autorizacoes_assim aa
 where aa.guia = v.guia
   and v.guia_emitida_em is null
   and aa.data_execucao <= (v.vinculado_em at time zone 'America/Sao_Paulo');

-- 2) Uma triagem ativa por EMISSÃO --------------------------------------------
create unique index if not exists autorizacoes_vinculos_guia_emissao_ativa_uq
  on public.autorizacoes_vinculos (guia, guia_emitida_em)
  where desfeito_em is null;

drop index if exists public.autorizacoes_vinculos_guia_ativa_uq;

reset lock_timeout;

-- 3) e 4) Edições por texto -----------------------------------------------------
create or replace function pg_temp.editar_por_texto(
  p_funcao    regprocedure,
  p_alvos     text[],
  p_novos     text[],
  p_esperados int[]
) returns text
language plpgsql as $f$
declare
  c_marca constant text := '/* 20261002150000 */';
  v_def   text := pg_get_functiondef(p_funcao);
  v_n     int;
begin
  if position(c_marca in v_def) > 0 then
    return p_funcao::text || ': já aplicada';
  end if;
  for i in 1 .. array_length(p_alvos, 1) loop
    v_n := (length(v_def) - length(replace(v_def, p_alvos[i], ''))) / length(p_alvos[i]);
    if v_n <> p_esperados[i] then
      raise exception '%: alvo % encontrado % vez(es), esperado %. Extraia com pg_get_functiondef e reveja à mão.',
        p_funcao, i, v_n, p_esperados[i];
    end if;
    v_def := replace(v_def, p_alvos[i], p_novos[i]);
  end loop;
  if position(c_marca in v_def) = 0 then
    raise exception '%: nenhuma troca leva a marca', p_funcao;
  end if;
  execute v_def;
  return p_funcao::text || ': editada';
end
$f$;

-- Órfãs: a guia triada fica fora da fila — só a emissão que a triagem viu.
select pg_temp.editar_por_texto(
  'public.get_guias_orfas(date,date)'::regprocedure,
  array[$q$where v.guia = aa.guia and v.desfeito_em is null$q$],
  array[$q$where v.guia = aa.guia and v.desfeito_em is null /* 20261002150000 */ and aa.data_execucao <= (v.vinculado_em at time zone 'America/Sao_Paulo')$q$],
  array[1]
);

-- Conferência: a mesma exclusão do pareamento, o `vin` em LEFT JOIN e a
-- observação sem " de " quando a data da guia não é conhecida.
select pg_temp.editar_por_texto(
  'public.get_auditoria_assim_periodo(date,date)'::regprocedure,
  array[
    $q$WHERE v.guia = aa.guia AND v.desfeito_em IS NULL$q$,
    $q$JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia$q$,
    $q$' de ', to_char(vin.data_execucao, 'DD/MM/YYYY HH24:MI'),$q$
  ],
  array[
    $q$WHERE v.guia = aa.guia AND v.desfeito_em IS NULL /* 20261002150000 */ AND aa.data_execucao <= (v.vinculado_em AT TIME ZONE 'America/Sao_Paulo')$q$,
    $q$LEFT JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia /* 20261002150000 */ AND aa2.data_execucao <= (v.vinculado_em AT TIME ZONE 'America/Sao_Paulo')$q$,
    $q$CASE WHEN vin.data_execucao IS NOT NULL THEN concat(' de ', to_char(vin.data_execucao, 'DD/MM/YYYY HH24:MI')) END,$q$
  ],
  array[1, 1, 1]
);

-- Conferência de Filipetas: Semente 3 só com a guia que a triagem viu; `vin`
-- em LEFT JOIN pelo mesmo motivo do período.
select pg_temp.editar_por_texto(
  'public.get_tokens_mensal(date)'::regprocedure,
  array[
    $q$JOIN public.autorizacoes_assim aa ON aa.guia = v.guia$q$,
    $q$JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia$q$
  ],
  array[
    $q$JOIN public.autorizacoes_assim aa ON aa.guia = v.guia /* 20261002150000 */ AND aa.data_execucao <= (v.vinculado_em AT TIME ZONE 'America/Sao_Paulo')$q$,
    $q$LEFT JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia /* 20261002150000 */ AND aa2.data_execucao <= (v.vinculado_em AT TIME ZONE 'America/Sao_Paulo')$q$
  ],
  array[1, 1]
);

-- Gravação: "já foi triada" só para a mesma emissão; o insert grava a emissão.
-- Guia sem data_execucao conta como a mesma (bloqueia), como antes.
select pg_temp.editar_por_texto(
  f::regprocedure,
  array[
    $q$where v.guia = p_guia and v.desfeito_em is null)$q$,
    $q$vinculado_por, vinculado_por_id)$q$,
    $q$coalesce(v_nome, 'Usuário'), v_uid)$q$
  ],
  array[
    $q$where v.guia = p_guia and v.desfeito_em is null /* 20261002150000 */ and coalesce(v_g.data_execucao, '-infinity'::timestamp) <= (v.vinculado_em at time zone 'America/Sao_Paulo'))$q$,
    $q$vinculado_por, vinculado_por_id, guia_emitida_em)$q$,
    $q$coalesce(v_nome, 'Usuário'), v_uid, v_g.data_execucao)$q$
  ],
  array[1, 1, 1]
)
from unnest(array[
  'public.vincular_autorizacao(text,text,uuid,text,integer)',
  'public.vincular_autorizacao_falta(text,uuid,text,integer)',
  'public.vincular_autorizacao_substituicao(text,uuid,text,integer)'
]) as f;

-- marcar_guia_sem_sessao não carrega a guia num record: lê a emissão inline.
select pg_temp.editar_por_texto(
  'public.marcar_guia_sem_sessao(text,text)'::regprocedure,
  array[
    $q$where v.guia = p_guia and v.desfeito_em is null)$q$,
    $q$(guia, tipo, bloco_id, fila_id, observacao, vinculado_por, vinculado_por_id)$q$,
    $q$coalesce(v_nome, 'Usuário'), v_uid)$q$
  ],
  array[
    $q$where v.guia = p_guia and v.desfeito_em is null /* 20261002150000 */ and coalesce((select aa.data_execucao from public.autorizacoes_assim aa where aa.guia = p_guia), '-infinity'::timestamp) <= (v.vinculado_em at time zone 'America/Sao_Paulo'))$q$,
    $q$(guia, tipo, bloco_id, fila_id, observacao, vinculado_por, vinculado_por_id, guia_emitida_em)$q$,
    $q$coalesce(v_nome, 'Usuário'), v_uid, (select aa.data_execucao from public.autorizacoes_assim aa where aa.guia = p_guia))$q$
  ],
  array[1, 1, 1]
);

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261002150000', 'vinculo_respeita_guia_reemitida')
on conflict (version) do nothing;

commit;

-- Conferência (só leitura):
--   ativos_com_emissao = 20 e ativos_sem_emissao = 8 em 02/10/2026;
--   funcoes_com_marca = 7; indice_antigo = 0, indice_novo = 1.
select
  (select count(*) from public.autorizacoes_vinculos where desfeito_em is null and guia_emitida_em is not null) as ativos_com_emissao,
  (select count(*) from public.autorizacoes_vinculos where desfeito_em is null and guia_emitida_em is null)     as ativos_sem_emissao,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_functiondef(p.oid) like '%/* 20261002150000 */%')                   as funcoes_com_marca,
  (select count(*) from pg_indexes where indexname = 'autorizacoes_vinculos_guia_ativa_uq')                    as indice_antigo,
  (select count(*) from pg_indexes where indexname = 'autorizacoes_vinculos_guia_emissao_ativa_uq')            as indice_novo;
